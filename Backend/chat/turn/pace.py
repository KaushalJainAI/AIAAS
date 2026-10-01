"""
How much time a turn is worth: the pace, and the budget that follows from it.

A lookup and a month-end close used to get the same loop: the same iteration
cap, and a model never told how many rounds it had. So a quick question could
wander through nine tool rounds, and a long job found out it was over only when
tools were withheld on its last pass.

A turn now runs at one of three paces — `quick`, `standard`, `deep` — and three
things follow from it:

* **the cap** (`cap`), read by `agent_node` on every pass;
* **the line the model is shown** (`render`), every pass, saying how many tool
  rounds are left and, one round before the end, that the next reply must be
  the answer;
* **promotion** (`promote`): a turn that turns out to be a long job is moved to
  `deep` the moment the model plans or delegates.

Three decisions carry the design.

**The model classifies its own task, for free.** A classifier in front of the
turn adds its latency to every message and hurts the quick ones most. The
model's first reply already says what the task is: an answer, one batch of
calls, or a plan. So the pipeline only picks a *starting* pace from what is
certain (a mode the user picked, a command, an attachment) and the tool calls
decide the rest. Promotion is one-way on purpose: a quick turn wrongly promoted
costs one fast round, and a deep turn cannot be made fast after the fact.

**The pace lives in `metadata`, not in the transcript and not on the context.**
`TurnContext` is frozen and rebuilt on a resume, and curation rewrites
`messages` — the same reason the plan is parked in `metadata` (`todos.py`). A
turn promoted before an approval pause is still `deep` when it resumes.

**The line is a trailing message, never the system prompt.** It changes on
every pass; the system prompt is the session's cached prefix (the clock trap,
`prompts.py`).

A caller that sets no pace (no `metadata['pace']`: agent runs, evals) gets
none of this — its cap is `max_iterations` and nothing is rendered.
"""
from __future__ import annotations

from typing import Any, Iterable, Mapping

from workflow_backend.thresholds import PACE_ITERATIONS, PACE_QUICK_MAX_CHARS

QUICK, STANDARD, DEEP = "quick", "standard", "deep"
#: Slowest last. Promotion only ever moves right.
TIERS = (QUICK, STANDARD, DEEP)

#: Calling one of these is the model saying "this is a long job": it wrote a
#: plan, or handed work to an agent, or started research that reads many pages.
#: An allow-list of built-ins, checked against the registry by a test — an MCP
#: name is minted at runtime and can never be in it, so unknown means no
#: promotion.
PROMOTING_TOOLS = frozenset({
    "update_todos",
    "run_agent", "invoke_subagent", "start_tasks", "start_mission",
    "create_agent",
    "deep_research",
})

#: Intents the user picks (or a command sets) that state the pace outright.
_INTENT_TIER = {
    "search": QUICK,
    "image": QUICK,
    "video": QUICK,
    "research": DEEP,
}

#: Openers that usually mean "look this up". Only a hint for the *starting*
#: pace: a wrong guess costs nothing, because `quick` still has two tool rounds
#: and the model can promote itself. These used to make the pipeline run a web
#: search before the first model call, which charged "explain recursion" for a
#: search it never needed.
_LOOKUP_OPENERS = (
    "what is", "what's", "who is", "who's", "when did", "when is", "where is",
    "how to", "latest", "current", "news about", "tell me about", "search for",
    "look up", "find", "what are the", "define", "explain", "compare",
)


def looks_like_lookup(text: str) -> bool:
    """A short, single question that opens like a lookup."""
    stripped = (text or "").strip()
    if not stripped or len(stripped) > PACE_QUICK_MAX_CHARS or "\n" in stripped:
        return False
    return stripped.lower().startswith(_LOOKUP_OPENERS)


def starting_tier(
    intent: str, text: str, *, has_attachments: bool = False,
    starts_work: bool = False,
) -> str:
    """The pace a chat turn starts at, from what is known before the model runs.

    `starts_work` is a command that begins a run (`/agent`): typing it is the
    user saying this is a job, not a question. A pinned toolbox is not that
    signal — `/search` and `/read` pin one tool for a single lookup.
    """
    if intent in _INTENT_TIER:
        return _INTENT_TIER[intent]
    if starts_work:
        return DEEP
    if has_attachments:
        # Reading a file and answering about it is at least a read plus a
        # synthesis, and often more.
        return STANDARD
    return QUICK if looks_like_lookup(text) else STANDARD


def start(tier: str) -> dict[str, str]:
    """The `metadata['pace']` value a turn begins with."""
    return {"tier": tier, "started": tier}


def current(metadata: Mapping[str, Any] | None) -> str:
    """The turn's pace right now, or "" for a turn that has none."""
    state = (metadata or {}).get("pace")
    tier = state.get("tier") if isinstance(state, Mapping) else None
    return tier if tier in TIERS else ""


def cap(tier: str, ceiling: int) -> int:
    """Model calls allowed at `tier`, never above the turn's own ceiling.

    No pace means the ceiling itself, which is what every caller had before.
    """
    if tier not in TIERS:
        return ceiling
    return max(1, min(PACE_ITERATIONS[tier], ceiling))


def promote(
    metadata: dict[str, Any], tool_names: Iterable[str], *, iteration: int,
) -> bool:
    """Move the turn to `deep` if this batch planned or delegated.

    Writes `metadata['pace']` and returns whether it changed. Idempotent, which
    matters: `interrupt()` re-runs `tools_node` from the top on a resume.
    """
    tier = current(metadata)
    if not tier or tier == DEEP:
        return False
    reason = next((name for name in tool_names if name in PROMOTING_TOOLS), None)
    if reason is None:
        return False
    metadata["pace"] = {
        "tier": DEEP, "started": tier, "promoted_by": reason,
        "promoted_at": iteration,
    }
    return True


def render(tier: str, iteration: int, limit: int) -> str:
    """The line the model reads this pass, or "" with no pace.

    `iteration` is how many model calls this turn has already made; `limit` is
    `cap(tier, ...)`. Not called on the last pass — tools are withheld there
    and the continuation nudge says so.
    """
    if tier not in TIERS:
        return ""
    left = max(0, limit - 1 - iteration)
    rounds = "1 tool round" if left == 1 else f"{left} tool rounds"

    if tier == QUICK:
        head = (
            "PACE: QUICK. The user is waiting on a fast answer. Answer "
            "directly if you can. Otherwise ask for everything you need in "
            f"one batch of tool calls and answer from the results ({rounds} "
            "left). If this really is a job with several steps, call "
            "`update_todos` with the plan first; that raises the budget."
        )
    elif tier == STANDARD:
        head = (
            f"PACE: STANDARD. {rounds.capitalize()} left this turn. Batch "
            "independent calls together. If the job has several distinct "
            "steps, call `update_todos` with the plan first; that raises the "
            "budget."
        )
    else:
        head = (
            f"PACE: DEEP. This is a long job and the user expects it to take "
            f"time: keep the plan current and delegate where an agent fits "
            f"({rounds} left)."
        )

    if left > 1:
        return head
    if tier == DEEP:
        return head + (
            " This is your last tool round. Finish what you can, mark what is "
            "left as blocked in the plan, and then answer."
        )
    return head + (
        " This is your last tool round: after it you must answer with what "
        "you have and say what is missing."
    )


def summary(metadata: Mapping[str, Any] | None) -> str:
    """`quick`, or `quick>deep` for a promoted turn. For the latency log."""
    state = (metadata or {}).get("pace")
    tier = current(metadata)
    if isinstance(state, Mapping) and state.get("started") in TIERS \
            and state["started"] != tier:
        return f"{state['started']}>{tier}"
    return tier or "-"
