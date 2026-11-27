"""
Building a turn's context: prior messages, their attachments, and what the
selected model is actually able to read.

Kept apart from the views because none of it is HTTP — it is the answer to
"what does the model get to see this turn", which the streaming endpoint, the
plain endpoint and any test all need identically.
"""
from __future__ import annotations

import logging
from typing import Any, Iterable, Sequence
from uuid import UUID

from asgiref.sync import sync_to_async

from workflow_backend.thresholds import (
    CONTEXT_LOW_WATER_RATIO,
    HISTORY_WINDOW,
    HISTORY_WINDOW_STEP,
    MAX_CONTEXT_TOKENS,
    RECENT_TAIL_MESSAGES,
)

from llm.access import estimate_tokens
from chat.models import ChatAttachment, ChatMessage, ChatSession

logger = logging.getLogger(__name__)

#: Attachment kind → the AIModel capability flag required to send it raw.
#: pdf/pptx/docx/xlsx/text are absent on purpose: they always have an
#: extracted-text fallback, so they are sendable on every model and
#: `agent.prepare_attachments` decides raw (`file` block, needs
#: `supports_document_input`) versus text per the same registry flags.
_REQUIRED_CAPABILITY = {
    "image": "supports_image_input",
    "video": "supports_video_input",
}
_TEXT_EXTRACTED_TYPES = frozenset({"pdf", "pptx", "docx", "xlsx", "text"})

#: How many recent messages an image may come from (`recent_attachments`).
#: Documents are not bounded by this; they are admitted by upload position.
_ATTACHMENT_LOOKBACK = 5


# ── Loading history ──────────────────────────────────────────────────────────

def _flag_deleted_attachments(messages: Sequence[ChatMessage]) -> None:
    """Mark the upload markers whose file no longer exists, in place.

    Marker contents are not replayed any more: `to_wire_history` renders a short
    pointer built from the metadata, so the file text is never loaded here. The
    one question left for the database is whether the file still exists. A
    marker whose file is gone gets `attachment_deleted` on its in-memory metadata
    copy, which the pointer reads. Nothing is saved.
    """
    # Keyed by the canonical UUID string so `UUID` casing cannot read as "gone".
    # A malformed id cannot name a stored file, so it is left out of the lookup
    # and therefore counts as deleted.
    referenced: dict[str, list[ChatMessage]] = {}
    for message in messages:
        raw = (message.metadata or {}).get("attachment_id")
        if not raw:
            continue
        try:
            key = str(UUID(str(raw)))
        except (ValueError, TypeError):
            logger.debug("[History] Malformed attachment id %r", raw)
            key = str(raw)
        referenced.setdefault(key, []).append(message)
    if not referenced:
        return

    valid_ids = [UUID(key) for key in referenced if _is_uuid(key)]
    existing = {
        str(found)
        for found in ChatAttachment.objects.filter(id__in=valid_ids).values_list("id", flat=True)
    } if valid_ids else set()

    for attachment_id, markers in referenced.items():
        if attachment_id in existing:
            continue
        for message in markers:
            message.metadata = {**(message.metadata or {}), "attachment_deleted": True}


def _is_uuid(value: str) -> bool:
    try:
        UUID(value)
    except (ValueError, TypeError):
        return False
    return True


def _enrich_with_sources(messages: Sequence[ChatMessage]) -> None:
    """Re-attach the citations from earlier research turns, in place.

    Only the most recent few keep their snippets — older ones become bare links.
    Replaying every snippet from every past search fills the window with results
    the model has already used.
    """
    research_turns = [
        index for index, message in enumerate(messages)
        if message.role == "assistant" and (message.metadata or {}).get("sources")
    ]
    detailed = set(research_turns[-3:])

    for index in research_turns:
        message = messages[index]
        lines = []
        for source in (message.metadata or {}).get("sources", [])[:8]:
            title, url = source.get("title", "Source"), source.get("url", "#")
            if index in detailed:
                lines.append(f"- [{title}]({url}) — {source.get('snippet', '')[:500]}")
            else:
                lines.append(f"- [{title}]({url}) (older turn, reference only)")

        message.content += (
            "\n\n<context_metadata type=\"historical_research\">\n"
            "[SOURCES ALREADY REVIEWED]\n" + "\n".join(lines) +
            "\n[Call read_url if you need the full text again. Do not repeat this "
            "list to the user.]\n</context_metadata>"
        )


def _replayed_count(total: int, window: int) -> int:
    """How many of the newest `total` conversational messages to replay.

    Up to `window`, all of them. Past it, the count is `window` plus the
    remainder past a whole number of `HISTORY_WINDOW_STEP`s, so the oldest
    replayed message only changes when `total` crosses a step. A window that
    slid by one message per turn would change the first replayed message on
    every turn, and the provider could never reuse the prompt prefix after the
    system message. Totals 21-29 replay everything; totals 30-39 drop the oldest
    10 (the oldest replayed message stays fixed for those ten turns); totals
    40-49 drop the oldest 20; and so on.
    """
    if total <= window:
        return total
    return window + (total - window) % HISTORY_WINDOW_STEP


#: Upload markers replayed on a conversation's first message, newest first.
#: Bounds a chat that had many files dropped in before anyone asked anything.
FIRST_TURN_SYSTEM_ROWS = 50


def load_history_sync(
    session: ChatSession, *, exclude_id: int | None, supports_docs: bool = False
) -> list[ChatMessage]:
    """
    Load the recent conversation, enriched with source context and deletion flags.

    The window counts *conversational* turns only. System rows are the upload
    markers carrying `metadata['attachment_id']`, so counting them against the
    limit would let a handful of uploads push out the actual conversation, while
    excluding them outright would silently drop every attachment from context.
    Take the turns, then re-admit the system rows falling within their span.
    Their pointer is rendered by `to_wire_history`; their file text is not
    loaded at all.

    The number of turns replayed is snapped to `HISTORY_WINDOW_STEP` (see
    `_replayed_count`), both for the plain window and for the notes tail, so
    the replayed prefix stays identical across consecutive turns.

    Once the conversation has notes (`session_notes`), the turns are no longer
    "the last N": they are the current task's messages, everything not yet
    filed into the notes (an update may still be running), and a short tail
    for continuity across a change of task. Every other message is a row in
    the notes, one tool call away.

    `supports_docs` is still accepted because the pipeline passes it. It no
    longer changes what is replayed: documents reach the model through
    `recent_attachments`, not through this history.
    """
    from . import session_notes

    conversational = (
        ChatMessage.objects
        .filter(session=session, role__in=["user", "assistant"])
        .exclude(id=exclude_id)
    )
    total = conversational.count()
    focus = session_notes.focus(getattr(session, "notes_state", None))
    if focus is None:
        keep = _replayed_count(total, HISTORY_WINDOW)
        turns = list(conversational.order_by("-created_at")[:keep])
    else:
        task_ids, through = focus
        picked = {m.id: m for m in conversational.filter(id__in=task_ids)}
        for m in conversational.filter(id__gt=through):
            picked.setdefault(m.id, m)
        tail = _replayed_count(total, RECENT_TAIL_MESSAGES)
        for m in conversational.order_by("-created_at")[:tail]:
            picked.setdefault(m.id, m)
        turns = sorted(picked.values(), key=lambda m: (m.created_at, m.id), reverse=True)

    # Upload markers inside the span of the kept turns. With no earlier turn
    # (the first message of a conversation) every marker is in span: a file
    # uploaded before the first question is exactly what that question is
    # about. `if turns else []` here once meant a new chat's upload never
    # reached the model (found by the live E2E run, 2026-11-25).
    system_rows_qs = (
        ChatMessage.objects.filter(session=session, role="system").exclude(id=exclude_id)
    )
    if turns:
        system_rows = list(system_rows_qs.filter(created_at__gte=turns[-1].created_at))
    else:
        system_rows = list(
            system_rows_qs.order_by("-created_at")[:FIRST_TURN_SYSTEM_ROWS])

    messages = sorted(turns + system_rows, key=lambda m: (m.created_at, m.id))
    _flag_deleted_attachments(messages)
    _enrich_with_sources(messages)
    return messages


#: The turn's door. The sync body is also read by `context_view`, which shows
#: the user exactly what the next turn would replay.
load_history = sync_to_async(load_history_sync)


def history_budget(input_budget: int) -> int:
    """How many tokens of earlier messages a turn replays, for a model whose
    input budget is `input_budget`.

    The share curation cuts back to (`CONTEXT_LOW_WATER_RATIO`, 45%) of what
    the model can read, so the replay alone never starts a turn past the point
    where curation would fire — and switching a conversation to a model with a
    smaller window replays less on its very next turn instead of being trimmed
    blindly at the wire. Older turns stay covered by the notes file's task
    index, and the model is told how many were left out. Capped at the old flat
    figure: past that, a bigger window buys a longer replay nobody reads.
    """
    return max(
        2_000,
        min(MAX_CONTEXT_TOKENS - 4_000, int(input_budget * CONTEXT_LOW_WATER_RATIO)),
    )


def to_wire_history(
    messages: Iterable[ChatMessage], *, max_tokens: int = MAX_CONTEXT_TOKENS
) -> list[dict[str, str]]:
    """
    Render history as OpenAI-shaped messages within a token budget.

    Walks newest-first so that when the budget runs out it is the oldest turns
    that are lost. Assistant turns with a stored summary contribute the summary
    plus the id needed to fetch the rest.
    """
    wire: list[dict[str, str]] = []
    used = 0

    for message in reversed(list(messages)):
        if message.role == "system":
            # Only upload markers reach the model, and only as a pointer built
            # from their metadata. Their `content` is the UI card, not context.
            if not (message.metadata or {}).get("attachment_id"):
                continue
            role, content = "system", _attachment_pointer(message)
        elif message.role == "assistant" and (message.metadata or {}).get("delegated_run"):
            # A worker's result posted after its turn (`tasks.post_run_result`).
            # Its text came from third-party pages: the model reads it through
            # `get_agent_run`, inside the envelope, never as its own words.
            role, content = "system", _delegated_run_pointer(message)
        elif message.role in ("user", "assistant"):
            role = message.role
            summary = (message.metadata or {}).get("summary")
            if message.role == "assistant" and summary:
                content = (
                    f"[SUMMARY of message {message.id}]: {summary}\n\n"
                    f"(Call get_chat_message_full_text(message_id={message.id}) for the full text.)"
                )
            else:
                content = message.content
        else:
            continue

        cost = estimate_tokens(content)
        if used + cost > max_tokens:
            break
        wire.append({"role": role, "content": content})
        used += cost

    wire.reverse()
    return wire


def _delegated_run_pointer(message: ChatMessage) -> str:
    """The line the model sees for a worker result posted into the chat."""
    run = (message.metadata or {}).get("delegated_run") or {}
    name = str(run.get("agent_name") or "An agent").strip()
    execution_id = str(run.get("execution_id") or "").strip()
    status = str(run.get("status") or "").strip()
    ended = "finished" if status == "completed" else f"ended ({status or 'unknown'})"
    return (
        f"[{name} {ended} after your earlier turn; its result was shown to the user "
        f"as message {message.id}. Read it with get_agent_run(execution_id="
        f"\"{execution_id}\", wait_seconds=0) before using it.]"
    )


def _attachment_pointer(marker: ChatMessage) -> str:
    """The one line the model sees for an earlier upload.

    Built only from the marker's metadata, so it is identical on every turn and
    the replayed prefix stays cacheable. A marker whose file was deleted says so
    (`attachment_deleted`, set by `_flag_deleted_attachments`). Every key is
    optional; the attachment id is the only one the marker is recognised by.
    """
    meta = marker.metadata or {}
    attachment_id = str(meta.get("attachment_id") or "").strip()
    filename = str(meta.get("filename") or "").strip() or "a file"
    file_type = str(meta.get("file_type") or "").strip()
    vfs_path = str(meta.get("vfs_path") or "").strip()
    label = f"{filename} ({file_type})" if file_type else filename

    if meta.get("attachment_deleted"):
        return (
            f"[File uploaded earlier: {label}, attachment id {attachment_id}. "
            f"It has been deleted and is no longer available.]"
        )
    working = f" Working file `{vfs_path}`." if vfs_path else ""
    return (
        f"[File uploaded earlier: {label}, attachment id {attachment_id}.{working} "
        f"Read it with read_attachment_text or read_file when needed.]"
    )


@sync_to_async
def recent_attachments(messages: Sequence[ChatMessage]) -> list[ChatAttachment]:
    """Attachments that should reach the model this turn, excluding oversized files.

    Two rules, because the two kinds cost different things to resend:

    - Images come from the last `_ATTACHMENT_LOOKBACK` messages. They are cheap
      to send and a vision model needs them for follow-up questions.
    - Documents (anything not an image) come only from uploads made after the
      last assistant reply, i.e. uploaded for this turn. Re-sending a document
      on every later turn put tens of thousands of characters at the end of the
      request, where the provider cannot cache them. An older document is still
      reachable: its pointer from `to_wire_history` names it, and the model can
      open it with `read_attachment_text` or `read_file`.
    """
    ordered = list(messages)
    window_start = max(0, len(ordered) - _ATTACHMENT_LOOKBACK)
    last_reply = max(
        (i for i, m in enumerate(ordered) if m.role == "assistant"), default=-1,
    )

    # Latest marker position for each attachment id.
    position: dict[UUID, int] = {}
    for index, message in enumerate(ordered):
        raw = (message.metadata or {}).get("attachment_id")
        if not raw:
            continue
        try:
            attachment_id = UUID(str(raw))
        except (ValueError, TypeError):
            continue
        position[attachment_id] = max(index, position.get(attachment_id, -1))

    if not position:
        return []
    found = ChatAttachment.objects.filter(id__in=position.keys()).exclude(is_large_file=True)
    return [
        attachment
        for attachment in found
        if (
            position[attachment.id] >= window_start
            and (attachment.file_type or "").lower() == "image"
        )
        or position[attachment.id] > last_reply
    ]


# ── Model capability gating ──────────────────────────────────────────────────

async def partition_attachments(
    attachments: Sequence[ChatAttachment], *, model: str, witness: bool = False,
) -> tuple[list[ChatAttachment], list[dict[str, Any]]]:
    """
    Split attachments into what this model can ingest and what it cannot.

    Sending an image to a text-only model does not degrade gracefully: it is
    either a 400 or — worse — the image is dropped and the model answers
    confidently about a picture it never received. Both look to the user like
    the assistant ignored their upload, so blocked entries carry a reason meant
    to be shown to them.

    `witness=True` says a vision model is callable for this user, which changes
    what "blocked" means for an image: the file still stays off the wire — a
    text-only model must not receive it — but the block is now a detour rather
    than a dead end, and the entry says so. Blocking is unchanged when there is
    no witness; an image nobody can look at is still an image nobody can look at.
    """
    if not attachments:
        return [], []

    from llm.models import AIModel

    entry = await AIModel.objects.filter(value=model, is_active=True).afirst()

    sendable: list[ChatAttachment] = []
    blocked: list[dict[str, Any]] = []

    for attachment in attachments:
        kind = (attachment.file_type or "other").lower()

        if kind in _TEXT_EXTRACTED_TYPES:
            sendable.append(attachment)
            continue

        capability = _REQUIRED_CAPABILITY.get(kind)
        if capability is None:
            # No ingestion path exists at all, so this is not a per-model
            # limitation and switching models will not help.
            blocked.append({
                "filename": attachment.filename,
                "file_type": kind,
                "reason": f"'{kind}' attachments cannot be read by any model here.",
                "switch_model_helps": False,
            })
        elif entry is not None and getattr(entry, capability, False):
            sendable.append(attachment)
        else:
            examinable = witness and kind == "image"
            blocked.append({
                "filename": attachment.filename,
                "file_type": kind,
                "attachment_id": str(attachment.id),
                "reason": (
                    f"The selected model ({model}) cannot see {kind}s, so it will "
                    f"ask a vision model about this one instead."
                    if examinable else
                    f"The selected model ({model}) cannot read {kind} input."
                ),
                "switch_model_helps": True,
                "witness": examinable,
            })

    return sendable, blocked


def describe_blocked(blocked: Sequence[dict[str, Any]]) -> str:
    """Render the blocked list as a line the user can act on."""
    if not blocked:
        return ""

    examined = [b for b in blocked if b.get("witness")]
    switchable = [
        b for b in blocked if b.get("switch_model_helps") and not b.get("witness")
    ]
    unsupported = [b for b in blocked if not b.get("switch_model_helps")]
    parts: list[str] = []

    if examined:
        # Not an error, so it does not read like one — but still said out loud,
        # because the user is entitled to know the description came from a
        # second model rather than from the one they picked.
        names = ", ".join(f"**{b['filename']}**" for b in examined)
        parts.append(
            f"The selected model cannot see {names}, so a vision model is being "
            f"asked about {'them' if len(examined) > 1 else 'it'} instead."
        )

    if switchable:
        names = ", ".join(f"**{b['filename']}**" for b in switchable)
        kinds = ", ".join(sorted({b["file_type"] for b in switchable}))
        parts.append(
            f"{names} could not be read because the selected model does not accept "
            f"{kinds} input. Switch to a multimodal model to use "
            f"{'them' if len(switchable) > 1 else 'it'}."
        )
    if unsupported:
        names = ", ".join(f"**{b['filename']}**" for b in unsupported)
        parts.append(f"{names} cannot be read by any available model.")

    return " ".join(parts)


def describe_for_model(blocked: Sequence[dict[str, Any]]) -> str:
    """
    Render the blocked list for the *model*, not the user.

    Deliberately a different string from `describe_blocked`. The user's version
    is an explanation; this one is an instruction, and it has to carry the
    attachment ids — an agent told "you were not given chart.png" can only
    apologise, while one told the id can go and ask about it.
    """
    if not blocked:
        return ""

    lines: list[str] = []
    examinable = [b for b in blocked if b.get("witness") and b.get("attachment_id")]
    withheld = [b for b in blocked if not b.get("witness")]

    for item in examinable:
        lines.append(
            f"- {item['filename']} (image, id {item['attachment_id']}): you cannot "
            f"see it. Call ask_vision with that id to question an assistant that "
            f"can, before answering anything about it."
        )
    for item in withheld:
        lines.append(
            f"- {item['filename']} ({item.get('file_type', 'file')}): withheld — "
            f"{item.get('reason', 'you cannot read it')} Say so plainly rather "
            f"than guessing."
        )

    return "[UPLOADED FILES YOU WERE NOT GIVEN]\n" + "\n".join(lines)
