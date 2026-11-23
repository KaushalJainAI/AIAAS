"""
Keeping a long run inside its context window, deliberately and on the record.

An agent run rebuilds its whole transcript on every iteration: `agent_node`
sends `history + to_wire(state["messages"])`, and that list only ever grows — up
to 40 iterations, each able to carry tool results of up to
`TOOL_OUTPUT_CHAR_LIMIT`. Something has to give, and until this module existed
the only thing that did was `llm.clamp_input`, which drops the oldest segments
blindly at the last possible moment and tells the model only that *something*
went.

Three mechanisms, each a toggle on the agent (`runtime_settings`), each doing
strictly less damage than the one after it:

- **compaction** — mechanical, free, no model call. An old tool-calling turn
  keeps its reasoning and the *names and arguments* of what it called; the
  results themselves shrink to a short record. What a step did stays legible;
  what it returned becomes a pointer.
- **recursiveContext** — when compaction alone cannot reach the low mark, the
  oldest steps are folded into a single running note, and that note is folded
  back in with the next block as the window refills. The only mechanism that
  costs a model call.
- **indexing** — everything the other two remove is archived first, and the
  record left behind names the id. This is what makes the other two safe rather
  than merely cheap: with indexing off, what is dropped is actually gone, and
  the notices left behind say so instead of pointing at an id nobody wrote.

Four properties are non-negotiable:

*It edits state, not the wire.* Curation returns replacement messages carrying
the ids they replace, so `add_messages` folds them into the checkpoint and the
work is done once. Curating the outgoing copy instead would recompute — and
re-archive — the same text on every remaining turn of the run.

*Segments, never messages.* An assistant turn carrying `tool_calls` and the
`tool` messages answering it move together or not at all. Splitting them leaves
a `tool_call_id` referring to a call that is no longer present, which providers
answer with a 400.

*A watermark, not a trickle.* Curation fires only when the transcript crosses
`CONTEXT_HIGH_WATER_RATIO` of the budget, then cuts to `CONTEXT_LOW_WATER_RATIO`
in one pass. Shaving a little every turn would change the request prefix on
every single call and forfeit provider prefix caching — the same reason the
clock does not live in the system message.

*There is exactly one summary note.* A second note is not more memory, it is the
same run written down twice; the fold always absorbs the previous note.

*The fold is prepared while the cache is warm.* Between an early mark
(`PREPARE_AHEAD_RATIO` of the high mark) and the high mark, the fold that the
next pass would make is started in the background, keyed by the run and by the
ids of the messages it would fold. When the fold is really needed and the ids
match, the prepared summary is used; otherwise the fold runs inline as before.
A prepared summary is cheap to produce while the provider's prompt cache still
holds the run's prefix, and the run does not stall at the fold. Its spend is
counted exactly once, whether it is used or thrown away.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from dataclasses import dataclass, field, replace
from typing import Any, Sequence

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    RemoveMessage,
    SystemMessage,
    ToolMessage,
)

from core.safety import provenance
from llm import budget
from llm.usage import EMPTY_USAGE, TokenUsage
from workflow_backend import background
from workflow_backend.thresholds import (
    CONTEXT_HIGH_WATER_RATIO,
    CONTEXT_KEEP_RECENT_SEGMENTS,
    CONTEXT_LOW_WATER_RATIO,
    CONTEXT_SUMMARY_INPUT_CHARS,
    CONTEXT_SUMMARY_TARGET_WORDS,
    CONTEXT_TOOL_ARG_KEEP_CHARS,
    CONTEXT_TOOL_ARGS_CHARS,
    CONTEXT_TOOL_RECORD_CHARS,
)

logger = logging.getLogger(__name__)

#: Marks the stand-in left where a tool result used to be. Recognisable in a
#: transcript dump, and recognisable to the next pass, so nothing is compacted
#: or archived twice.
RECORD_PREFIX = "[COMPACTED RESULT]"
#: Marks the single running note. Identified by prefix rather than by a message
#: id we would have to carry in state: the note is regenerated on every fold, so
#: a stored id would be one more thing that can go stale.
SUMMARY_PREFIX = "[EARLIER WORK IN THIS RUN — SUMMARY]"
#: Marks an argument value that was shrunk, so a later pass leaves it alone.
ARGS_MARKER = "[COMPACTED ARGUMENT]"

#: The early mark for preparing a fold, as a fraction of the high-water mark.
#: 0.85 of 0.70 is 0.595 of the budget: far enough below the trigger that the
#: background fold has the whole band between the marks to finish in, and high
#: enough that a run is not paying for a summary it may never need.
PREPARE_AHEAD_RATIO = 0.85
#: How long a pass waits for a prepared fold that is still running before it
#: folds inline. The inline call would start from zero, so waiting a little is
#: almost always cheaper; waiting for good is not.
PREPARED_WAIT_SECONDS = 20.0
#: Runs remembered by each module-level dict. Beyond this the oldest is dropped
#: (a prepared fold is let finish and its spend is still booked).
PREPARED_KEEP_RUNS = 256


@dataclass(frozen=True, slots=True)
class CurationPolicy:
    """What a caller has asked the curator to be allowed to do.

    `enabled=False` (the default) means `curate` returns nothing to apply, and
    the only bound on the window stays `clamp_input`. The agent runtime builds
    a real policy from `SubAgent.runtime_settings`; chat uses `CHAT_POLICY`, so
    callers differ in configuration rather than in code path.
    """

    enabled: bool = False
    compaction: bool = True
    recursive: bool = True
    indexing: bool = True

    #: Model used for the fold. Deliberately not the agent's own by default: a
    #: 40-turn run on an expensive model would otherwise pay full rate to
    #: compress itself. Empty means "use the run's own model".
    summary_provider: str = ""
    summary_model: str = ""

    @classmethod
    def from_settings(cls, settings: dict | None) -> CurationPolicy:
        """Build a policy from one agent's `runtime_settings`.

        The three keys are the context-lifecycle toggles the agent builder has
        always stored: `compaction`, `recursiveContext`, `indexing`. They
        defaulted to True in the serializer while nothing read them, so the
        defaults here match — turning the feature on must not silently change
        what an existing agent does beyond finally honouring its own settings.
        """
        from django.conf import settings as django_settings

        settings = settings or {}
        compaction = bool(settings.get("compaction", True))
        recursive = bool(settings.get("recursiveContext", True))
        indexing = bool(settings.get("indexing", True))

        # The agent's own choice wins over the platform default, and the
        # platform default over the run's model. Precedence in that order
        # because each step is a narrower statement of intent: the user picked
        # this model for *this agent*, the operator picked one for the install,
        # and falling back to the run's own model is nobody's decision — just
        # the last thing that is certain to work.
        #
        # A model without a provider is not usable, so the two move together: an
        # agent that names a model but no provider is asking for that model on
        # the platform's provider, which is what `summary_provider` falls back
        # to.
        chosen_model = (settings.get("summaryModel") or "").strip()
        chosen_provider = (settings.get("summaryProvider") or "").strip()
        return cls(
            summary_provider=(
                chosen_provider
                or getattr(django_settings, "CONTEXT_SUMMARY_PROVIDER", "")
            ),
            summary_model=(
                chosen_model
                or getattr(django_settings, "CONTEXT_SUMMARY_MODEL", "")
            ),
            # All three off is a request to be left alone, and honouring it is
            # the point of a toggle: `clamp_input` still keeps the run from
            # 400ing, so "off" degrades to the old behaviour rather than to an
            # unbounded window.
            enabled=compaction or recursive,
            compaction=compaction,
            recursive=recursive,
            indexing=indexing,
        )


#: Chat's policy. A chat turn used to have no curation at all, which was right
#: while a turn meant a search or two; as the orchestrator (`run_agent`,
#: `wait_tasks`, `answer_subagent`) one turn can go many iterations. Only the
#: two free mechanisms: compaction replaces old tool results with a record and
#: indexing keeps what was cut reachable. The fold is off because it is a paid
#: model call on a path the user is watching, and chat has no builder toggle
#: through which anyone chose to pay it.
CHAT_POLICY = CurationPolicy(
    enabled=True, compaction=True, recursive=False, indexing=True,
)


@dataclass(slots=True)
class CurationResult:
    """What one pass did: the state updates to apply, and the record of why."""

    updates: list[BaseMessage] = field(default_factory=list)
    results_compacted: int = 0
    steps_folded: int = 0
    tokens_before: int = 0
    tokens_after: int = 0
    archived_ids: tuple[str, ...] = ()
    summary_tokens: int = 0

    @property
    def curated(self) -> bool:
        return bool(self.results_compacted or self.steps_folded)

    @property
    def tokens_saved(self) -> int:
        return max(self.tokens_before - self.tokens_after, 0)


# ── Sizing and grouping, in message vocabulary ───────────────────────────────

def _wire(messages: Sequence[BaseMessage]) -> list[dict]:
    from .agent import to_wire

    return to_wire(messages)


def message_tokens(messages: Sequence[BaseMessage]) -> int:
    """What these messages will cost once rendered for the provider.

    Measured through `to_wire` rather than off `message.content`, so a
    tool-calling turn is charged for its serialised arguments — which are
    frequently the largest thing in it and which `content` does not contain.
    """
    return budget.history_tokens(_wire(messages))


@dataclass(slots=True)
class _Segment:
    """An assistant tool-call turn plus the results answering it, or one
    standalone message. The unit everything here moves in."""

    messages: list[BaseMessage]

    @property
    def head(self) -> BaseMessage:
        return self.messages[0]

    @property
    def tokens(self) -> int:
        return message_tokens(self.messages)

    @property
    def is_tool_turn(self) -> bool:
        return isinstance(self.head, AIMessage) and bool(self.head.tool_calls)

    @property
    def is_note(self) -> bool:
        return _is_note(self.head)


def _is_note(message: BaseMessage) -> bool:
    return (
        isinstance(message, SystemMessage)
        and isinstance(message.content, str)
        and message.content.startswith(SUMMARY_PREFIX)
    )


def segments(messages: Sequence[BaseMessage]) -> list[_Segment]:
    """Group messages into segments, order preserved.

    A `ToolMessage` with no tool-call turn ahead of it is already broken; it is
    attached to whatever precedes it rather than made a segment of its own, so
    curation cannot make the breakage worse by keeping the orphan and dropping
    its neighbours.
    """
    grouped: list[_Segment] = []
    for message in messages:
        if isinstance(message, ToolMessage) and grouped:
            grouped[-1].messages.append(message)
            continue
        grouped.append(_Segment(messages=[message]))
    return grouped


# ── Records ──────────────────────────────────────────────────────────────────

def _describe_call(turn: BaseMessage, call_id: str) -> str:
    """Name the call a result answers, so the record says what was asked."""
    if isinstance(turn, AIMessage):
        for call in turn.tool_calls or []:
            if call.get("id") != call_id:
                continue
            arguments = json.dumps(call.get("args") or {})
            return f"{call.get('name') or 'tool'}({arguments[:200]})"
    return "tool"


def _record_for(result: str, call: str, archive_id: str | None) -> str:
    """The text that replaces one tool result once it has been curated."""
    head = result[:CONTEXT_TOOL_RECORD_CHARS].strip()
    dropped = len(result) - len(head)

    where = (
        f"archived as tool_output id '{archive_id}' — call recall_context or "
        f"read_tool_output to read it"
        if archive_id else
        "not archived, so the removed text is gone; re-run the call if you "
        "need it"
    )
    return (
        f"{RECORD_PREFIX} {call}\n{head}\n"
        f"[... {dropped:,} characters removed to stay inside the context window. "
        f"{where}.]"
    )


def _already_compacted(message: BaseMessage) -> bool:
    # A result enclosed as untrusted data keeps its record inside the envelope,
    # so the prefix is looked for in the body.
    return (
        isinstance(message.content, str)
        and provenance.unwrap_untrusted(message.content).startswith(RECORD_PREFIX)
    )


# ── The pass ─────────────────────────────────────────────────────────────────

async def curate(
    messages: Sequence[BaseMessage],
    *,
    policy: CurationPolicy,
    model: str,
    reserve_output: int = 0,
    baseline_tokens: int = 0,
    context: dict[str, Any] | None = None,
    summarise=None,
    force: bool = False,
) -> CurationResult:
    """
    Decide what to remove from this run's transcript, and return it as updates.

    `force` is for after the provider has refused a request as too long: the
    watermark is skipped (we already know the request does not fit) and only
    the newest segment is protected, since the alternative is losing whole
    steps at the wire.

    `baseline_tokens` is everything else already committed to the request — the
    system message and any conversation history outside the run — because the
    watermark has to be measured against the real total, not against the part
    that happens to live in graph state.

    `summarise` is an injected `async (text) -> (summary, tokens)`. Injected so
    this module never imports the provider layer, and so a test can fold without
    a model.
    """
    context = context or {}
    result = CurationResult()
    if not policy.enabled or not messages:
        return result

    limit = await budget.input_budget_for(model, reserve_output=reserve_output)
    result.tokens_before = baseline_tokens + message_tokens(messages)
    key = _run_key(context)
    if not force and result.tokens_before <= limit * CONTEXT_HIGH_WATER_RATIO:
        # Below the high mark nothing is curated, but past the early mark the
        # fold that the next pass would make is started now, while the cache is
        # warm. See `_prepare_ahead`.
        if (
            key is not None
            and policy.recursive
            and summarise is not None
            and result.tokens_before
            > limit * PREPARE_AHEAD_RATIO * CONTEXT_HIGH_WATER_RATIO
        ):
            await _prepare_ahead(
                messages, policy, context, key,
                limit=limit,
                baseline_tokens=baseline_tokens,
                tokens_before=result.tokens_before,
                summarise=summarise,
            )
        return result

    target = int(limit * CONTEXT_LOW_WATER_RATIO)
    grouped = segments(messages)

    # The tail is never curated: the model must be able to see what it just did,
    # or it does it again. Counted in segments rather than tokens so that one
    # oversized recent result cannot push three whole turns out of view.
    head, tail = _split(grouped, 1 if force else CONTEXT_KEEP_RECENT_SEGMENTS)
    if not head:
        return result

    archived: list[str] = []
    updates: list[BaseMessage] = []

    def projected() -> int:
        return baseline_tokens + message_tokens(
            [m for segment in head + tail for m in segment.messages]
        )

    if policy.compaction:
        replacements, ids = await _compact(head, policy, context, target, projected)
        result.results_compacted = len(replacements)
        archived.extend(ids)
        updates.extend(replacements)

    spent_tokens = 0
    if policy.recursive and summarise is not None and projected() > target:
        folded, note, ids, tokens = await _fold(
            head, tail, policy, context, target, baseline_tokens, summarise
        )
        # Every token a fold spent is recorded, even when no note came of it:
        # the spend happened, so it has to reach the run's total either way.
        spent_tokens = tokens
        if note is not None:
            # RemoveMessage by id is what actually deletes from the checkpoint;
            # the note is appended, which puts it last in the transcript. That
            # is where a trailing system message belongs anyway — the same shape
            # `build_context_update` uses, landing after the prior conversation
            # and before the model's next move.
            updates.extend(RemoveMessage(id=m.id) for m in folded if m.id)
            updates.append(note)
            result.steps_folded = len(folded)
        archived.extend(ids)

    result.updates = updates
    result.archived_ids = tuple(archived)
    result.tokens_after = projected()
    _settle(result, key, summarise, spent_tokens)

    if result.curated:
        logger.info(
            "[Curation] %d result(s) compacted, %d message(s) folded: "
            "%d -> %d tokens (budget %d)",
            result.results_compacted, result.steps_folded,
            result.tokens_before, result.tokens_after, limit,
        )
    return result


async def _compact(
    head: list[_Segment],
    policy: CurationPolicy,
    context: dict[str, Any],
    target: int,
    projected,
) -> tuple[list[ToolMessage], list[str]]:
    """Shrink old tool results to records, oldest first, until the target is met.

    Oldest first because recency is the best available proxy for what is still
    needed, and stopping at the target leaves the newest of the old turns whole:
    a run that has only just crossed the mark loses only its earliest steps.

    Each replacement carries the id of the message it replaces, which is what
    makes `add_messages` substitute rather than append — the substitution is the
    point, since a checkpoint still holding the original text would be archived
    all over again on the next pass. `segment.messages` is updated too, so
    `projected()` measures the transcript as curated so far rather than as it
    arrived.
    """
    from chat.tools import tool_output

    replacements: list[BaseMessage] = []
    archived: list[str] = []

    for segment in head:
        if projected() <= target:
            break
        if not segment.is_tool_turn:
            continue

        # What the model *sent* can be as large as what came back — a written
        # file, a deck spec, a page of code — and it stays in every later
        # request just the same. Shrink oversized arguments before the results.
        shrunk = await _compact_arguments(segment.head, policy, context)
        if shrunk is not None:
            new_head, archive_id = shrunk
            segment.messages[0] = new_head
            replacements.append(new_head)
            if archive_id:
                archived.append(archive_id)

        for index, message in enumerate(segment.messages):
            if not isinstance(message, ToolMessage) or _already_compacted(message):
                continue
            if not message.id:
                # Without an id there is nothing for `add_messages` to replace,
                # and returning the shrunk copy anyway would append a second
                # result for the same call. `add_messages` stamps ids on
                # everything already in state, so this is a guard, not a case.
                continue
            content = message.content
            if not isinstance(content, str):
                continue
            # The text the tool returned, without its untrusted-data enclosure.
            # The record is enclosed again under the same tag and source, so a
            # compacted result is still third-party data to the model.
            envelope = provenance.parse_untrusted(content)
            body = envelope[2] if envelope is not None else content
            if len(body) <= CONTEXT_TOOL_RECORD_CHARS:
                continue

            call = _describe_call(segment.head, message.tool_call_id)
            archive_id = None
            if policy.indexing:
                archive_id = await tool_output.archive(call, body, context)
                if archive_id:
                    archived.append(archive_id)

            record = _record_for(body, call, archive_id)
            if envelope is not None:
                record = provenance.wrap_untrusted(
                    record, source=envelope[0], tag=envelope[1])
            replacement = ToolMessage(
                content=record,
                tool_call_id=message.tool_call_id,
                id=message.id,
                name=message.name,
            )
            segment.messages[index] = replacement
            replacements.append(replacement)

    return replacements, archived


def _shrink_value(value: Any, note: str) -> tuple[Any, bool]:
    """`value` with every long string replaced by a record. (copy, changed?)"""
    if isinstance(value, str):
        if len(value) <= CONTEXT_TOOL_ARG_KEEP_CHARS:
            return value, False
        head = value[:CONTEXT_TOOL_ARG_KEEP_CHARS]
        return f"{head}\n[... {len(value) - len(head):,} characters removed. {note}]", True
    if isinstance(value, dict):
        out, changed = {}, False
        for key, item in value.items():
            out[key], hit = _shrink_value(item, note)
            changed = changed or hit
        return out, changed
    if isinstance(value, list):
        out_list, changed = [], False
        for item in value:
            new, hit = _shrink_value(item, note)
            out_list.append(new)
            changed = changed or hit
        return out_list, changed
    return value, False


async def _compact_arguments(
    turn: BaseMessage, policy: CurationPolicy, context: dict[str, Any],
) -> tuple[AIMessage, str | None] | None:
    """Shrink the oversized arguments of one old tool-calling turn.

    Returns the replacement message (same id, so `add_messages` substitutes it)
    and the archive id, or None when nothing in it is large. The call's name and
    id stay exactly as they were — the results answering it still refer to that
    id — and the replaced text is archived first when indexing is on.
    """
    if not isinstance(turn, AIMessage) or not turn.id or not turn.tool_calls:
        return None
    if _arguments_compacted(turn):
        return None
    size = sum(len(json.dumps(call.get("args") or {})) for call in turn.tool_calls)
    if size <= CONTEXT_TOOL_ARGS_CHARS:
        return None

    from chat.tools import tool_output

    archive_id = None
    if policy.indexing:
        names = ",".join(str(call.get("name") or "tool") for call in turn.tool_calls)
        archive_id = await tool_output.archive(
            f"arguments:{names}",
            json.dumps([call.get("args") or {} for call in turn.tool_calls], indent=1),
            context,
        )
    note = (
        f"{ARGS_MARKER} archived as tool_output id '{archive_id}' — call "
        "read_tool_output to read it"
        if archive_id else
        f"{ARGS_MARKER} not archived; the call already ran, so nothing is lost "
        "but the text"
    )

    calls, changed = [], False
    for call in turn.tool_calls:
        args, hit = _shrink_value(call.get("args") or {}, note)
        changed = changed or hit
        calls.append({**call, "args": args})
    if not changed:
        return None
    return turn.model_copy(update={"tool_calls": calls}), archive_id


def _arguments_compacted(turn: AIMessage) -> bool:
    return ARGS_MARKER in json.dumps([call.get("args") for call in turn.tool_calls])


# ── Model spend, and folds prepared ahead ────────────────────────────────────
#
# A fold is a model call, and the spend has to reach the run's total exactly
# once. Three things can happen to a call made for a fold:
#
#   used       — the fold it was prepared for is the fold the pass needs; its
#                tokens and usage are billed by that pass.
#   discarded  — prepared for messages the pass no longer folds (or the claim
#                timed out or failed). It was still spent, so it is booked into
#                `_UNBILLED` and billed by the next pass that curates.
#   inline     — the pass folded without a prepared result; the call's usage is
#                already on the summariser that pass holds, and is billed there.
#
# The summariser's `usage` is an accumulator that `curate_node` prices at the
# end of the pass, so every path above ends in that one place.

@dataclass(frozen=True, slots=True)
class _Spend:
    tokens: int = 0
    usage: TokenUsage = EMPTY_USAGE

    def __add__(self, other: _Spend) -> _Spend:
        return _Spend(self.tokens + other.tokens, self.usage + other.usage)

    @property
    def is_empty(self) -> bool:
        return self.tokens == 0 and self.usage.is_empty


_NO_SPEND = _Spend()
#: The public name of a spend: what `settle` returns and what callers add up.
Spend = _Spend


@dataclass(slots=True, eq=False)
class _Prepared:
    """One fold started ahead of its pass. `tokens` and `usage` are written by
    the task itself, in its `finally`, so they are right whether it succeeded,
    failed or was cancelled."""

    key: str
    fingerprint: tuple[str, ...]
    task: asyncio.Task | None = None
    tokens: int = 0
    usage: TokenUsage = EMPTY_USAGE


#: At most one prepared fold per run. The key is the run's thread, so a second
#: early mark replaces the first rather than stacking another model call on it.
_PREPARED: dict[str, _Prepared] = {}
#: Spend from folds that were discarded, waiting for a pass that will bill it.
_UNBILLED: dict[str, _Spend] = {}


def _run_key(context: dict[str, Any]) -> str | None:
    """The run's key, from what `curate` already receives.

    `session_id` is the run's thread (`agent-<id>-<uuid>` for an agent run), so
    it is per run; `user_id` keeps two users' runs apart. Without a session there
    is nothing to key on, and nothing is prepared: the fold runs inline as before.
    """
    session = context.get("session_id")
    if not session:
        return None
    return f"{context.get('user_id')}:{session}"


def run_key(context: dict[str, Any]) -> str | None:
    """Public name for the key a run's curation is filed under, so the caller
    that ends a run (`settle`) passes exactly the key `curate` used."""
    return _run_key(context)


def _fingerprint(messages: Sequence[BaseMessage]) -> tuple[str, ...]:
    """Identity of the messages a fold covers.

    Ids, because compaction replaces a message under its own id: a result shrunk
    between the early mark and the fold is still the same message. A message with
    no id is keyed by its content instead, which compaction never touches.
    """
    return tuple(_message_key(message) for message in messages)


def _message_key(message: BaseMessage) -> str:
    if message.id:
        return str(message.id)
    body = json.dumps(
        [message.type, message.content, getattr(message, "tool_calls", None)],
        default=str, sort_keys=True,
    )
    return "sha:" + hashlib.sha256(body.encode("utf-8")).hexdigest()[:32]


def _usage_of(summarise) -> TokenUsage:
    usage = getattr(summarise, "usage", None)
    return usage if isinstance(usage, TokenUsage) else EMPTY_USAGE


def _set_usage(summarise, usage: TokenUsage) -> None:
    if summarise is None:
        return
    try:
        summarise.usage = usage
    except AttributeError:  # a bare callable that cannot carry an accumulator
        logger.warning("[Curation] Summariser cannot record usage; spend unpriced")


def _add_usage(summarise, usage: TokenUsage) -> None:
    if usage.is_empty:
        return
    _set_usage(summarise, _usage_of(summarise) + usage)


def _split(
    grouped: list[_Segment], keep: int,
) -> tuple[list[_Segment], list[_Segment]]:
    """(head, tail): the tail is the last `keep` segments and is never curated."""
    keep = min(keep, len(grouped))
    if not keep:
        return list(grouped), []
    return grouped[:-keep], grouped[-keep:]


def _fold_block(
    head: list[_Segment],
    tail: list[_Segment],
    baseline_tokens: int,
    target: int,
) -> tuple[list[_Segment], list[_Segment]]:
    """The oldest segments a fold would take, and what is left of `head`.

    Pure: the caller's lists are not changed. Used both by the fold itself and by
    `_prepare_ahead`, so the two cannot disagree about what "the block" is.
    """
    # What the note itself will cost. Folding more segments does not shrink
    # `fold + remainder`, so a condition measured over that total would never
    # change and the first pass would fold the entire run.
    note_tokens = CONTEXT_SUMMARY_TARGET_WORDS * 2

    fold: list[_Segment] = []
    remainder = list(head)
    while remainder:
        kept = [m for segment in remainder + tail for m in segment.messages]
        if baseline_tokens + note_tokens + message_tokens(kept) <= target:
            break
        fold.append(remainder.pop(0))
    return fold, remainder


def _folded_messages(
    fold: list[_Segment], remainder: list[_Segment], tail: list[_Segment],
) -> list[BaseMessage]:
    """What a fold reads: the segments it takes, plus any earlier note, wherever
    it sits. The previous note is always absorbed, which is what keeps there
    being exactly one."""
    stragglers = [segment for segment in remainder + tail if segment.is_note]
    messages = [m for segment in fold for m in segment.messages]
    messages += [m for segment in stragglers for m in segment.messages]
    return messages


async def _prepare_ahead(
    messages: Sequence[BaseMessage],
    policy: CurationPolicy,
    context: dict[str, Any],
    key: str,
    *,
    limit: int,
    baseline_tokens: int,
    tokens_before: int,
    summarise,
) -> None:
    """Start the fold the next pass would need, while the cache is warm.

    Between the early mark and the high mark, nothing is curated yet. The fold
    that will be needed is worked out now, as if the transcript were already at
    the high mark: the growth still to come is added to the baseline, so the
    block is the same one the real pass will pick, rather than a block that
    shifts with every new step. Compaction is simulated in full (without
    archiving, so nothing is written) because a fold is only ever needed after
    every compactable result has been compacted. No block means no fold is
    coming, and nothing is spent.

    The summary is generated from the simulated, compacted text, which is what
    the inline fold would have read. The archive is written by the real pass.
    """
    head, tail = _split(segments(messages), CONTEXT_KEEP_RECENT_SEGMENTS)
    if not head:
        return
    # Copies: the simulation compacts in place, and the real pass must not see it.
    head = [_Segment(messages=list(segment.messages)) for segment in head]
    tail = [_Segment(messages=list(segment.messages)) for segment in tail]

    at_high = int(limit * CONTEXT_HIGH_WATER_RATIO)
    target = int(limit * CONTEXT_LOW_WATER_RATIO)
    predicted_base = baseline_tokens + max(at_high - tokens_before, 0)

    if policy.compaction:
        def projected() -> int:
            return predicted_base + message_tokens(
                [m for segment in head + tail for m in segment.messages]
            )

        # `target=-1` never breaks: compact everything, as a fold-bound pass would.
        await _compact(
            head, replace(policy, indexing=False), context, -1, projected,
        )

    fold, remainder = _fold_block(head, tail, predicted_base, target)
    if not fold:
        return
    folded = _folded_messages(fold, remainder, tail)
    fingerprint = _fingerprint(folded)

    current = _PREPARED.get(key)
    if current is not None and current.fingerprint == fingerprint:
        return  # already in flight for exactly this block
    if current is not None:
        del _PREPARED[key]
        _retire(current)

    # The prepared call owns this summariser: it is only ever used by the one
    # call started here, so zeroing its accumulator makes it read back as exactly
    # that call's spend.
    _set_usage(summarise, EMPTY_USAGE)
    transcript = _render_for_summary(folded)[:CONTEXT_SUMMARY_INPUT_CHARS]
    entry = _Prepared(key=key, fingerprint=fingerprint)
    entry.task = background.spawn(
        _prepared_call(entry, summarise, transcript),
        name=f"curation-prefold:{key}",
    )
    _PREPARED[key] = entry
    logger.info(
        "[Curation] Fold prepared ahead for %s: %d message(s)", key, len(folded),
    )
    _bound_prepared()


async def _prepared_call(entry: _Prepared, summarise, transcript: str) -> tuple[str, int]:
    try:
        summary, tokens = await summarise(transcript)
        entry.tokens = tokens
        return summary, tokens
    finally:
        entry.usage = _usage_of(summarise)


async def _claim(entry: _Prepared) -> tuple[str, int] | None:
    """The prepared (summary, tokens), or None when the pass must fold inline."""
    task = entry.task
    if task is None or task.get_loop() is not asyncio.get_running_loop():
        return None  # started on another loop: cannot be awaited from here
    try:
        # `shield`: a timeout must not cancel the call, because its spend is
        # still owed and it is booked when it finishes.
        return await asyncio.wait_for(asyncio.shield(task), PREPARED_WAIT_SECONDS)
    except asyncio.TimeoutError:
        logger.info("[Curation] Prepared fold still running; folding inline")
        return None
    except asyncio.CancelledError:
        if task.cancelled():
            return None
        raise
    except Exception:  # noqa: BLE001
        logger.warning("[Curation] Prepared fold failed; folding inline", exc_info=True)
        return None


def _retire(entry: _Prepared) -> None:
    """A prepared fold that will not be used. Its spend still counts."""
    task = entry.task
    if task is None or task.done():
        _book(entry)
    else:
        task.add_done_callback(lambda _task: _book(entry))


def _book(entry: _Prepared) -> None:
    task = entry.task
    if task is not None and task.done() and not task.cancelled():
        task.exception()  # marks a failure as retrieved; the spend is what matters
    spend = _Spend(entry.tokens, entry.usage)
    if spend.is_empty:
        return
    _UNBILLED[entry.key] = _UNBILLED.get(entry.key, _NO_SPEND) + spend
    while len(_UNBILLED) > PREPARED_KEEP_RUNS:
        dropped = next(iter(_UNBILLED))
        del _UNBILLED[dropped]
        logger.warning("[Curation] Unbilled fold spend for %s dropped (too many runs)", dropped)


def _bound_prepared() -> None:
    while len(_PREPARED) > PREPARED_KEEP_RUNS:
        oldest = next(iter(_PREPARED))
        _retire(_PREPARED.pop(oldest))


def _settle(
    result: CurationResult,
    key: str | None,
    summarise,
    spent_tokens: int,
) -> None:
    """Decide what this pass pays for, and write it onto the result.

    A pass that curated is the one `curate_node` charges, so it carries the
    spend of every fold since the last such pass. A pass that did not curate is
    not charged, so its own spend is booked for the next one.
    """
    if key is None:
        if result.curated:
            result.summary_tokens = spent_tokens
        return

    owed = _UNBILLED.pop(key, _NO_SPEND)
    if result.curated:
        result.summary_tokens = spent_tokens + owed.tokens
        _add_usage(summarise, owed.usage)
        return

    spend = _Spend(spent_tokens, _usage_of(summarise)) + owed
    if not spend.is_empty:
        _UNBILLED[key] = spend
        while len(_UNBILLED) > PREPARED_KEEP_RUNS:
            del _UNBILLED[next(iter(_UNBILLED))]


def reset_prepared_state() -> None:
    """Forget every prepared fold and all unbilled spend. Tests only: in
    production each dict is bounded by `PREPARED_KEEP_RUNS` and cleared by use."""
    for entry in _PREPARED.values():
        if entry.task is not None and not entry.task.done():
            entry.task.cancel()
    _PREPARED.clear()
    _UNBILLED.clear()


#: How long `settle` waits for a prepared fold still running when its run ends.
#: Past this the fold is cancelled and whatever usage it had reported is booked.
SETTLE_WAIT_SECONDS = 20.0
#: After that cancel, how long to wait for the fold to unwind and report.
SETTLE_UNWIND_SECONDS = 2.0


async def settle(key: str | None, *, keep_prepared: bool = False) -> _Spend:
    """Bill everything a run's curation has spent and not yet booked.

    Called once when a run ends, however it ends (finished, failed, cancelled).
    A prepared fold still in flight has already cost money, so it is awaited for
    up to `SETTLE_WAIT_SECONDS`; past that it is cancelled and the usage it
    reports is booked. The run's pending entry and its `_UNBILLED` ledger are
    then dropped, and returned as the spend the caller must add to the run's
    totals. Idempotent: a second call for the same key returns zero.

    `keep_prepared` is for a chat turn: the chat's key outlives the turn, so a
    prepared fold still in flight is left for the next turn to use (or discard
    and bill, through `_UNBILLED`), and only the ledger is billed now. Waiting
    for it here would hold the user's turn open for up to `SETTLE_WAIT_SECONDS`
    and throw away a summary the next turn could have read from cache.
    """
    if not key:
        return _NO_SPEND
    if keep_prepared:
        return _UNBILLED.pop(key, _NO_SPEND)
    entry = _PREPARED.pop(key, None)
    spend = _NO_SPEND
    if entry is not None:
        await _await_at_run_end(entry)
        spend = _Spend(entry.tokens, entry.usage)
    return spend + _UNBILLED.pop(key, _NO_SPEND)


async def _await_at_run_end(entry: _Prepared) -> None:
    """Let a prepared fold finish if it can; otherwise cancel it. Afterwards the
    entry's `tokens` and `usage` are as final as they will be for this run."""
    task = entry.task
    if task is None or task.done():
        return
    if task.get_loop() is not asyncio.get_running_loop():
        # Started on another loop: it cannot be awaited or cancelled from here.
        logger.warning("[Curation] Prepared fold for %s is on another loop; booked later", entry.key)
        _retire(entry)
        return
    try:
        await asyncio.wait_for(asyncio.shield(task), SETTLE_WAIT_SECONDS)
    except asyncio.TimeoutError:
        logger.info("[Curation] Prepared fold for %s outlived its run; cancelling", entry.key)
        task.cancel()
        await asyncio.wait({task}, timeout=SETTLE_UNWIND_SECONDS)
        if not task.done():
            logger.warning("[Curation] Cancelled fold for %s did not unwind; booked later", entry.key)
            _retire(entry)
    except asyncio.CancelledError:
        if task.cancelled():
            return  # the fold itself was cancelled, so there is nothing more to wait for
        # The run is being cancelled too: the fold's spend is booked when it ends.
        _retire(entry)
        raise
    except Exception:  # noqa: BLE001
        # The fold failed; its task's `finally` has already recorded its usage.
        return


async def _fold(
    head: list[_Segment],
    tail: list[_Segment],
    policy: CurationPolicy,
    context: dict[str, Any],
    target: int,
    baseline_tokens: int,
    summarise,
) -> tuple[list[BaseMessage], SystemMessage | None, list[str], int]:
    """
    Replace the oldest segments — and any previous note, wherever it sits — with
    one running note.

    The previous note is always absorbed: leaving it in place and appending a
    second one would grow the transcript by a note per curation, which is the
    problem this is here to solve rather than a smaller version of it.
    """
    from chat.tools import tool_output

    fold, remainder = _fold_block(head, tail, baseline_tokens, target)

    # Any earlier note is folded in even when it is not in `fold` — it may be
    # sitting in the protected tail, which is exactly where the last pass left
    # it.
    if not fold:
        # Nothing new to fold. Rewriting the note on its own would spend a model
        # call to restate what it already says, on every pass, for the rest of
        # the run.
        return [], None, [], 0

    folded_messages = _folded_messages(fold, remainder, tail)

    # A fold prepared ahead is used only for exactly these messages. It is taken
    # out of the table either way, so it can be used or retired, never both.
    key = _run_key(context)
    pending = _PREPARED.pop(key, None) if key is not None else None
    claimed: tuple[str, int] | None = None
    try:
        if pending is not None and pending.fingerprint == _fingerprint(folded_messages):
            claimed = await _claim(pending)
    finally:
        if pending is not None and claimed is None:
            _retire(pending)

    transcript = _render_for_summary(folded_messages)
    archived: list[str] = []
    if policy.indexing:
        archive_id = await tool_output.archive("folded-steps", transcript, context)
        if archive_id:
            archived.append(archive_id)

    if claimed is not None:
        summary, tokens = claimed
        # The prepared call's usage is on its own summariser. Move it onto this
        # pass's, which is the one `curate_node` prices: counted here, once.
        _add_usage(summarise, pending.usage)
    else:
        try:
            summary, tokens = await summarise(transcript[:CONTEXT_SUMMARY_INPUT_CHARS])
        except Exception:  # noqa: BLE001
            # A failed fold must not fail the run. Nothing is applied, the messages
            # stay where they are, and `clamp_input` drops them at the wire if the
            # request is still too large — worse, but not an outage.
            logger.exception("[Curation] Fold failed; transcript left intact")
            return [], None, archived, 0

    if not summary.strip():
        return [], None, archived, tokens

    note = SUMMARY_PREFIX + "\n" + summary.strip()
    note += (
        f"\n[Full text of these steps is archived as tool_output id "
        f"'{archived[-1]}'. Call recall_context or read_tool_output for any "
        f"detail this summary does not carry.]"
        if archived else
        "\n[The steps behind this summary were not archived; this note is all "
        "that remains of them.]"
    )
    return folded_messages, SystemMessage(content=note), archived, tokens


def _render_for_summary(messages: Sequence[BaseMessage]) -> str:
    """Flatten messages into something a summariser can read.

    A previous note renders like anything else and is labelled by its own
    prefix, which is what makes the fold recursive rather than merely repeated.
    """
    lines: list[str] = []
    for message in messages:
        content = message.content
        text = content if isinstance(content, str) else json.dumps(content)
        if isinstance(message, AIMessage) and message.tool_calls:
            calls = ", ".join(
                f"{call.get('name')}({json.dumps(call.get('args') or {})[:200]})"
                for call in message.tool_calls
            )
            lines.append(f"[assistant called: {calls}]\n{text or ''}")
        elif isinstance(message, ToolMessage):
            lines.append(f"[result of {message.name or 'tool'}]\n{text or ''}")
        else:
            lines.append(f"[{message.type}]\n{text or ''}")
    return "\n\n".join(lines)


#: The checkpoint's sections, in the order they must appear. The fold writes
#: this shape and nothing parses it, but `chat/tests/test_curation_prefold.py`
#: pins the headings, so a template edit cannot silently drop one.
SUMMARY_SECTIONS = (
    "Objective",
    "Requirements and constraints",
    "Decisions",
    "Work state",
    "Next move",
    "Relevant files and ids",
    "Important facts",
)

SUMMARY_INSTRUCTION = (
    "You are writing the running checkpoint of an agent run. The agent keeps "
    "working from this checkpoint after the steps it describes have left its "
    "view, so it must hold everything a later step will need and nothing it can "
    "read again. Fill in these sections, in this order, under these exact "
    "headings:\n\n"
    "Objective: the goal the run is pursuing, in one or two sentences.\n"
    "Requirements and constraints: what the user or the task asked for, and any "
    "limit they set.\n"
    "Decisions: each choice made, and why, one line each.\n"
    "Work state: three sub-lines, Completed:, Active: and Blocked:. Completed "
    "holds what finished and its result. Active holds what is in progress and "
    "the open questions. Blocked holds each failure with why it failed, and what "
    "it is waiting on.\n"
    "Next move: the single next step the record points to.\n"
    "Relevant files and ids: at most 15 entries, one per line. Paths, ids and "
    "URLs only, never file contents.\n"
    "Important facts: the exact values, names, ids and figures a later step will "
    "need, each as it appeared in the input.\n\n"
    "Rules:\n"
    "- If an earlier checkpoint appears in the input, UPDATE it section by "
    "section: merge in the new facts, move an item from Active to Completed when "
    "it finishes, and drop whatever a later step superseded. Do not rewrite it "
    "from scratch, and do not append a second copy of it.\n"
    f"- Stay within {CONTEXT_SUMMARY_TARGET_WORDS} words in total.\n"
    "- Never invent a detail. Every value you write must appear in the input.\n"
    "- Do not copy what the agent can read again: file contents, tool output, or "
    "the todo list, which is kept separately and must be left out.\n"
    "- Write `none` for a section with nothing in it.\n"
    "- Do not address the user and do not add conclusions of your own.\n"
    "- Output only the checkpoint, starting with the Objective heading."
)
