"""
What one request costs, and how it may be cut down when it costs too much.

Split out of `access.py` because three layers now need the same arithmetic and
the same notion of a *segment*: the final guard in `clamp_input`, the curator in
`chat/turn/curation.py`, and any caller sizing a transcript before it builds
one. Two copies of "how big is this history" is how a budget quietly stops
matching the thing it is budgeting.

The unit here is deliberately the segment, not the message. An assistant message
carrying `tool_calls` and the `tool` messages answering its call ids are one
indivisible thing on the wire: drop the assistant and the results become orphans
referring to a call id that is no longer present, which every OpenAI-compatible
provider rejects with a 400. Trimming used to walk messages one at a time and
had exactly that failure mode — a long agent run did not degrade, it died, after
the user had already paid for the tool calls.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from typing import Any, Iterable, Sequence

from workflow_backend.thresholds import LLM_INPUT_TOKEN_CEILING, MAX_LLM_INPUT_TOKENS

logger = logging.getLogger(__name__)

#: Room left for the model's own reply plus the per-message scaffolding no
#: estimate here can see (role names, delimiters, provider-side additions).
#: Deliberately generous: overshooting the window is a hard 400, undershooting
#: costs a little context.
_WINDOW_SAFETY_TOKENS = 2_048

#: `AIModel.context_window` is admin-editable, so it is cached with a TTL rather
#: than for the life of the process.
_WINDOW_TTL_SECONDS = 300
_window_cache: dict[str, tuple[float, int]] = {}

#: Windows learned from a provider refusing a request as too long. The catalogue
#: can be wrong (or say 0, "unknown"), and the provider's refusal is the only
#: authoritative statement of the real limit, so it wins over the catalogue for
#: the life of the process. Only ever lowers a budget.
_learned_windows: dict[str, int] = {}


# ── Sizing ───────────────────────────────────────────────────────────────────

def estimate_tokens(text: str | None) -> int:
    """Approximate token count. ~4 chars per token for English prose."""
    return len(text) // 4 if text else 0


def content_tokens(content: Any) -> int:
    """Size a message body: a string on most entries, a list of parts on a
    multimodal one."""
    if isinstance(content, str):
        return estimate_tokens(content)
    if isinstance(content, list):
        # Image parts carry a url or a base64 blob whose cost is a provider
        # matter, not a character count; text parts are counted normally.
        return sum(
            estimate_tokens(part.get("text"))
            for part in content
            if isinstance(part, dict) and isinstance(part.get("text"), str)
        )
    return 0


def entry_tokens(entry: dict) -> int:
    """
    Everything in one wire entry that costs tokens, not only its text.

    A tool-calling assistant entry has `content: None` and carries the call in
    `tool_calls`, where the serialised `arguments` are frequently the largest
    thing in the turn. Counting only `content` scored those entries at zero, so a
    transcript made almost entirely of tool calls measured as nearly empty and
    the budget it was checked against meant nothing.
    """
    total = content_tokens(entry.get("content"))

    for call in entry.get("tool_calls") or []:
        function = call.get("function") or {}
        arguments = function.get("arguments")
        if not isinstance(arguments, str):
            arguments = json.dumps(arguments or {})
        total += estimate_tokens(function.get("name")) + estimate_tokens(arguments)
        total += 8  # id + envelope

    if entry.get("tool_call_id"):
        total += 8

    return total


def history_tokens(entries: Iterable[dict]) -> int:
    return sum(entry_tokens(entry) for entry in entries)


def tools_tokens(tools: Sequence[dict] | None) -> int:
    """What the tool definitions sent with a request cost.

    They ride in their own `tools` field, so nothing that sizes `messages` saw
    them — and an orchestrator offering seventy tools spends 10-20k tokens on
    them every call. Left uncounted, a request measured as fitting was refused
    by the provider as too long.
    """
    if not tools:
        return 0
    try:
        return estimate_tokens(json.dumps(list(tools)))
    except (TypeError, ValueError):
        return 0


def truncate_middle(text: str, max_tokens: int) -> str:
    """
    Cut the middle out of an oversized string, keeping both ends.

    Head-only truncation is the obvious approach and the wrong one here: the tail
    of a user turn is usually the actual question ("...given all that, which
    should I pick?"). Losing it leaves the model a pile of context and no task.
    """
    max_chars = max_tokens * 4
    if len(text) <= max_chars:
        return text
    keep = max_chars // 2
    return (
        f"{text[:keep]}\n\n"
        f"[... {len(text) - 2 * keep} characters trimmed to fit the context window ...]\n\n"
        f"{text[-keep:]}"
    )


# ── Segments ─────────────────────────────────────────────────────────────────

@dataclass(slots=True)
class Segment:
    """One indivisible run of wire entries.

    Either a single standalone message (a user turn, a plain assistant answer, a
    system notice) or an assistant tool-call turn together with every `tool`
    result answering it. Nothing may drop, collapse or reorder part of one.
    """

    entries: list[dict]

    @property
    def tokens(self) -> int:
        return history_tokens(self.entries)

    @property
    def head(self) -> dict:
        return self.entries[0]

    @property
    def role(self) -> str:
        return str(self.head.get("role") or "")

    @property
    def is_tool_turn(self) -> bool:
        """An assistant turn that called tools — the only compactable shape."""
        return bool(self.head.get("tool_calls"))

    @property
    def results(self) -> list[dict]:
        return [entry for entry in self.entries[1:] if entry.get("role") == "tool"]


def split_segments(history: Sequence[dict]) -> list[Segment]:
    """Group wire history into segments, preserving order exactly.

    A `tool` entry with no assistant tool-call turn ahead of it is already
    broken; it is attached to whatever precedes it rather than promoted to a
    segment of its own, so that trimming cannot make the breakage worse by
    keeping the orphan and dropping its neighbours.
    """
    segments: list[Segment] = []
    for entry in history:
        if entry.get("role") == "tool" and segments:
            segments[-1].entries.append(entry)
            continue
        segments.append(Segment(entries=[entry]))
    return segments


def flatten(segments: Iterable[Segment]) -> list[dict]:
    return [entry for segment in segments for entry in segment.entries]


# ── Model-derived budget ─────────────────────────────────────────────────────

def cached_input_budget(model: str, *, reserve_output: int = 0) -> int:
    """`input_budget_for` without the database read — cache or nothing.

    `_build_request` is on every model call, including a streamed guest turn
    whose key is resolved lazily as the response is consumed. Awaiting a query
    there adds a suspension point inside the request path, which is enough to
    reorder when later work observes process state — it broke a guest test that
    patches the environment around the call. So the hot path reads what is
    already known and the lookup happens in `preflight`, which is async
    already, runs once per turn, and is where every other "can this call be
    made" question is answered.

    A cold cache means the flat ceiling, which is exactly the behaviour this
    replaced: never worse than before, better as soon as a turn has preflighted.
    """
    cached = _window_cache.get(model or "")
    window = _with_learned(model, cached[1] if cached else 0)
    return _budget_from_window(window, reserve_output)


def _with_learned(model: str, window: int) -> int:
    learned = _learned_windows.get(model or "")
    if not learned:
        return window
    return min(window, learned) if window > 0 else learned


def learn_window(model: str, *, reported: int | None, sent_tokens: int = 0) -> int:
    """Lower `model`'s window after the provider refused a request as too long.

    `reported` is the limit the provider named in its error, when it named one
    ("maximum context length is 131072 tokens") — the authoritative figure. When
    it named none, the window is taken as three quarters of what we believed it
    was (or of what we sent), so the retry lands well inside whatever the real
    limit is rather than probing just under it. Returns the window now in force.
    """
    if not model:
        return 0
    if reported and reported > 0:
        window = reported
    else:
        cached = _window_cache.get(model)
        believed = _with_learned(model, cached[1] if cached else 0)
        base = believed or (MAX_LLM_INPUT_TOKENS + _WINDOW_SAFETY_TOKENS)
        if sent_tokens:
            base = min(base, sent_tokens)
        window = int(base * 0.75)
    window = max(window, 4_000)
    previous = _learned_windows.get(model)
    if previous is None or window < previous:
        _learned_windows[model] = window
        logger.warning(
            "[Budget] %s refused a request as too long; using a %d-token window",
            model, window,
        )
    return _learned_windows[model]


async def prime(model: str) -> None:
    """Fetch and cache `model`'s context window. Never raises."""
    await context_window(model)


def _budget_from_window(window: int, reserve_output: int) -> int:
    """The input budget for a model with this window.

    A known window is used whole (less the reply and a safety margin), so a
    long run gets everything the model can read and curation starts at 70% of
    *the model's* limit. An unknown window keeps the flat budget. The optional
    `LLM_INPUT_TOKEN_CEILING` caps both, for an install that wants to bound what
    one call can cost.
    """
    ceiling = LLM_INPUT_TOKEN_CEILING if LLM_INPUT_TOKEN_CEILING > 0 else None
    if window <= 0:
        return min(MAX_LLM_INPUT_TOKENS, ceiling or MAX_LLM_INPUT_TOKENS)
    usable = window - max(reserve_output, 0) - _WINDOW_SAFETY_TOKENS
    if ceiling:
        usable = min(usable, ceiling)
    return max(usable, 2_000)


def budget_for(model: str, window: int, *, reserve_output: int = 0) -> int:
    """`input_budget_for` for a caller that already read the window (sync)."""
    return _budget_from_window(_with_learned(model, window), reserve_output)


async def input_budget_for(model: str, *, reserve_output: int = 0) -> int:
    """
    How many input tokens this model can actually be sent.

    The model's own window, less its reply and a margin (2026-11-16: it used to
    be capped at a flat 96k, which cut a 1M-token model to a tenth of what it
    reads; `LLM_INPUT_TOKEN_CEILING` is the opt-in cost cap now). A window the
    provider has refused past is lowered to what it said (`learn_window`).

    A model absent from the registry, or one whose `context_window` is 0
    ("unknown/variable"), keeps the flat `MAX_LLM_INPUT_TOKENS`: guessing big
    there is a 400, and guessing small throws away context.
    """
    # Never returns something unusable: a tiny window still gets a floor, and the
    # per-message clamps are what keep that floor honest.
    return _budget_from_window(
        _with_learned(model, await context_window(model)), reserve_output
    )


async def context_window(model: str) -> int:
    """`AIModel.context_window` for `model`, or 0 when unknown."""
    if not model:
        return 0

    cached = _window_cache.get(model)
    now = time.monotonic()
    if cached and now - cached[0] < _WINDOW_TTL_SECONDS:
        return cached[1]

    try:
        from llm.models import AIModel

        window = await AIModel.objects.filter(
            value=model
        ).values_list("context_window", flat=True).afirst()
    except Exception:  # noqa: BLE001
        # Sizing a request must not depend on the registry being reachable.
        logger.debug("[Budget] Context window lookup failed for %r", model, exc_info=True)
        return 0

    resolved = int(window or 0)
    _window_cache[model] = (now, resolved)
    return resolved
