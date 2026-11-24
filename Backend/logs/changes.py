"""
The change log: what one chat message or one agent run changed, so it can be
put back (docs/UNDO_PLAN.md §6).

Writing goes through a ContextVar **binding** (D5). `chat/turn/agent.py::_dispatch_one`
binds the owner around each tool call, and the write paths (`inference/vfs.py`,
the memory and agent-settings tools later) call the `record_*` functions below.
With no binding every function here does nothing, so the user's own app saves
are never journaled.

Three rules carry it:

* **Recording never raises.** The write has already happened by the time we
  record it; failing the call now would be worse. A failure is logged and the
  set is marked `incomplete`, so the list says it may be missing something.
* **One row per target** (D1). The row keeps the state before the set first
  touched the target and the state after the set last touched it. A run that
  rewrites one file five times has one row.
* **Calls that bind nothing record nothing.** An inline child run binds
  `None` for itself (D18), so it never writes into its parent's set.
"""
from __future__ import annotations

import logging
from contextvars import ContextVar, Token
from dataclasses import dataclass
from datetime import timedelta

from asgiref.sync import sync_to_async
from django.db import IntegrityError, transaction
from django.db.models import Max
from django.utils import timezone

from workflow_backend import thresholds

from .models import Change, ChangeSet, ExecutionLog

logger = logging.getLogger(__name__)

#: How deep a set's tree of children is followed. Delegation is capped at a
#: small depth already; this only guards against a parent cycle in bad data.
_MAX_TREE_DEPTH = 8


@dataclass
class Binding:
    """Who owns the tool call that is running right now."""

    user_id: int
    owner_kind: str                  # 'chat' | 'run'
    chat_message_id: int | None = None
    execution_id: str | None = None  # ExecutionLog.execution_id as a string
    parent_set_id: int | None = None
    tool: str = ''
    call_id: str = ''
    #: Filled on first use, so one call does one lookup.
    set_id: int | None = None
    #: How many changes this call recorded. A counter on a shared object, not a
    #: new Binding, so a sync_to_async thread's copy of the context still
    #: updates the same object (the side_calls.py trick).
    recorded: int = 0


_binding: ContextVar[Binding | None] = ContextVar('change_binding', default=None)


def bind(b: Binding | None) -> Token:
    """Make `b` the owner for this context. `None` is a valid binding: it
    means "this call has no owner", so nothing it does is journaled."""
    return _binding.set(b)


def unbind(token: Token) -> None:
    try:
        _binding.reset(token)
    except (ValueError, RuntimeError):
        # A token from another context should never reach here. Clear the
        # binding rather than leave one behind for the next call.
        _binding.set(None)


def current() -> Binding | None:
    return _binding.get()


# ---------------------------------------------------------------------------
# The set a binding writes into
# ---------------------------------------------------------------------------

def current_set_id(*, create: bool) -> int | None:
    """The change set the current call writes into, or None.

    `create=True` makes the set if it does not exist yet. A run's set is one
    per `ExecutionLog`. A chat message's set is the open one for that message.
    """
    b = _binding.get()
    if b is None:
        return None
    if b.set_id is not None:
        return b.set_id
    try:
        set_id = _set_for(b, create=create)
    except Exception:  # noqa: BLE001 — recording must never fail the write
        logger.exception('[Changes] Could not find the change set for %s', b.tool)
        return None
    b.set_id = set_id
    return set_id


async def acurrent_set_id(*, create: bool) -> int | None:
    return await sync_to_async(current_set_id)(create=create)


def _set_for(b: Binding, *, create: bool) -> int | None:
    if b.owner_kind == 'run':
        return _run_set(b, create=create)
    if b.owner_kind == 'chat':
        return _chat_set(b, create=create)
    return None


def _run_set(b: Binding, *, create: bool) -> int | None:
    log = ExecutionLog.objects.filter(execution_id=b.execution_id).only('id').first()
    if log is None:
        return None
    if not create:
        return ChangeSet.objects.filter(execution_id=log.pk).values_list('pk', flat=True).first()
    # A run's set is closed from the start: liveness comes from the run's own
    # status (docs/UNDO_PLAN.md §6.6), and `closed` keeps the one-open-per-
    # message constraint out of it.
    run_set, _ = ChangeSet.objects.get_or_create(
        execution_id=log.pk,
        defaults={'user_id': b.user_id, 'owner_kind': 'run',
                  'parent_id': b.parent_set_id, 'status': 'closed'},
    )
    return run_set.pk


def _chat_set(b: Binding, *, create: bool) -> int | None:
    if b.chat_message_id is None:
        return None
    open_id = (ChangeSet.objects.filter(chat_message_id=b.chat_message_id, status='open')
               .values_list('pk', flat=True).first())
    if open_id is not None or not create:
        return open_id
    try:
        with transaction.atomic():
            return ChangeSet.objects.create(
                user_id=b.user_id, owner_kind='chat',
                chat_message_id=b.chat_message_id, status='open',
            ).pk
    except IntegrityError:
        # Two tool calls of one turn can run at once and both find no open
        # set. The loser reads the winner's.
        return (ChangeSet.objects.filter(chat_message_id=b.chat_message_id, status='open')
                .values_list('pk', flat=True).first())


# ---------------------------------------------------------------------------
# States: what a target looks like, in the form the change row stores
# ---------------------------------------------------------------------------

def doc_state(doc) -> dict:
    """A file's place and identity. Taken before a write, and after it."""
    return {
        'folder_id': doc.folder_id,
        'name': doc.name,
        'file_type': doc.file_type,
        'trashed': doc.deleted_at is not None,
        'etag': doc.updated_at.isoformat() if doc.updated_at else None,
    }


def folder_state(folder) -> dict:
    return {
        'parent_id': folder.parent_id,
        'name': folder.name,
        'trashed': folder.deleted_at is not None,
    }


def _document_now(doc_id: int) -> dict | None:
    from inference.models import Document

    doc = Document.all_objects.filter(pk=doc_id).first()
    return doc_state(doc) if doc is not None else None


def _folder_now(folder_id: int) -> dict | None:
    from inference.models import Folder

    folder = Folder.all_objects.filter(pk=folder_id).first()
    return folder_state(folder) if folder is not None else None


# ---------------------------------------------------------------------------
# Recording (sync, never raise)
# ---------------------------------------------------------------------------

def record_document(doc_id: int, *, before: dict | None, content: bool, label: str) -> None:
    """A file was created, overwritten, trashed, moved or copied.

    `before` is `doc_state(doc)` taken before the write, or None when the file
    did not exist. `content` is True when its bytes or text may have changed.
    """
    b = _binding.get()
    if b is None:
        return
    _journal(b, 'document', doc_id, before=before, after_fn=lambda: _document_now(doc_id),
             content=content, label=label)


def record_folder(folder_id: int, *, before: dict | None, label: str) -> None:
    """A folder was created, moved, renamed or trashed (`before` as above)."""
    b = _binding.get()
    if b is None:
        return
    _journal(b, 'folder', folder_id, before=before, after_fn=lambda: _folder_now(folder_id),
             content=False, label=label)


def record_memory(*, memory_id: int | None, before: dict | None, after: dict | None,
                  label: str) -> None:
    """A remembered fact changed. Phase 7 calls it from the memory tools."""
    b = _binding.get()
    if b is None:
        return
    _journal(b, 'memory', memory_id, before=before, after_fn=lambda: after,
             content=False, label=label)


def record_agent(agent_id: int, *, before: dict | None, after: dict, label: str) -> None:
    """An agent's settings changed. Phase 7 calls it from the agent tools."""
    b = _binding.get()
    if b is None:
        return
    _journal(b, 'agent', agent_id, before=before, after_fn=lambda: after,
             content=False, label=label)


def record_untracked(*, label: str, external: bool, effect: str) -> None:
    """A call that did something we cannot undo or do not track yet.

    It has no target and cannot be reverted. It is here so the list is honest
    (D8). `effect` is accepted for the log line; the reason shown depends on
    whether the call left the app.
    """
    b = _binding.get()
    if b is None:
        return
    reason = ("Left the app; can't be undone from here" if external
              else "Not tracked here; can't be undone from here")
    try:
        set_id = current_set_id(create=True)
        if set_id is None:
            return
        b.recorded += 1
        with transaction.atomic():
            if _is_full(set_id):
                _mark_incomplete(set_id)
                return
            Change.objects.create(
                change_set_id=set_id, seq=_next_seq(set_id),
                target_type='', target_id=None,
                tool=b.tool[:100], call_id=b.call_id[:100],
                label=label[:300], revertible=False, reason=reason,
            )
            _touch(set_id)
        logger.debug('[Changes] Untracked %s (%s) in set %s', b.tool, effect, set_id)
    except Exception:  # noqa: BLE001 — see module note
        logger.exception('[Changes] Could not record an untracked change for %s', b.tool)
        _mark_incomplete(b.set_id)


def _journal(b: Binding, target_type: str, target_id: int | None, *, before: dict | None,
             after_fn, content: bool, label: str) -> None:
    """Record one target's net effect in the current set (D1)."""
    try:
        set_id = current_set_id(create=True)
        if set_id is None:
            return
        after = after_fn()
        # Counted even when the cap stops the row, so the fallback in
        # `_dispatch_one` does not add an "untracked" row for a write we did see.
        b.recorded += 1
        try:
            _upsert_row(b, set_id, target_type, target_id, before=before, after=after,
                        content=content, label=label)
        except IntegrityError:
            # Two calls of one set wrote this target at the same moment (a
            # parallel tool batch): the other one created the row first. The
            # second attempt finds it and updates it.
            _upsert_row(b, set_id, target_type, target_id, before=before, after=after,
                        content=content, label=label)
    except Exception:  # noqa: BLE001 — see module note
        logger.exception('[Changes] Could not record %s %s for %s',
                         target_type, target_id, b.tool)
        _mark_incomplete(b.set_id)


def _upsert_row(b: Binding, set_id: int, target_type: str, target_id: int | None, *,
                before: dict | None, after: dict | None, content: bool, label: str) -> None:
    with transaction.atomic():
        row = None
        if target_id is not None:
            row = (Change.objects.select_for_update()
                   .filter(change_set_id=set_id, target_type=target_type,
                           target_id=target_id)
                   .first())
        if row is None:
            if _is_full(set_id):
                _mark_incomplete(set_id)
                return
            Change.objects.create(
                change_set_id=set_id, seq=_next_seq(set_id),
                target_type=target_type, target_id=target_id,
                tool=b.tool[:100], call_id=b.call_id[:100],
                label=label[:300], before=before, after=after,
                content_changed=content, revertible=True,
            )
        else:
            # The first touch keeps `before`, `tool` and `call_id`; every touch
            # moves `after` on and can only add to `content_changed`.
            row.after = after
            row.label = label[:300]
            row.content_changed = row.content_changed or content
            row.save(update_fields=['after', 'label', 'content_changed', 'updated_at'])
        _touch(set_id)


def _is_full(set_id: int) -> bool:
    return Change.objects.filter(change_set_id=set_id).count() >= thresholds.MAX_CHANGES_PER_SET


def _next_seq(set_id: int) -> int:
    return (Change.objects.filter(change_set_id=set_id).aggregate(top=Max('seq'))['top'] or 0) + 1


def _touch(set_id: int) -> None:
    # Every record moves `updated_at`: the chat set's idle rule reads it (§6.6).
    ChangeSet.objects.filter(pk=set_id).update(updated_at=timezone.now())


def _mark_incomplete(set_id: int | None) -> None:
    if set_id is None:
        return
    try:
        ChangeSet.objects.filter(pk=set_id).update(incomplete=True, updated_at=timezone.now())
    except Exception:  # noqa: BLE001 — the flag is best effort
        logger.exception('[Changes] Could not mark set %s incomplete', set_id)


# ---------------------------------------------------------------------------
# Reading and closing
# ---------------------------------------------------------------------------

def _tree_ids(root: int) -> list[int]:
    seen = [root]
    frontier = [root]
    for _ in range(_MAX_TREE_DEPTH):
        kids = list(ChangeSet.objects.filter(parent_id__in=frontier)
                     .exclude(pk__in=seen).values_list('pk', flat=True))
        if not kids:
            break
        seen.extend(kids)
        frontier = kids
    return seen


def summary(change_set) -> dict:
    """Counts over a set and its children. Accepts a ChangeSet or its id."""
    set_id = getattr(change_set, 'pk', change_set)
    ids = _tree_ids(set_id)
    rows = Change.objects.filter(change_set_id__in=ids)
    total = rows.count()
    revertible = rows.filter(revertible=True).count()
    return {
        'set_id': set_id,
        'total': total,
        'revertible': revertible,
        'not_revertible': total - revertible,
        'incomplete': ChangeSet.objects.filter(pk__in=ids, incomplete=True).exists(),
    }


def close_chat(user_id: int, chat_message_id: int) -> dict | None:
    """Close a chat message's open set. Returns its summary, or None when it
    holds no changes in its whole tree (Phase 5 calls this at the turn's end).
    """
    open_set = ChangeSet.objects.filter(
        user_id=user_id, chat_message_id=chat_message_id, status='open').first()
    if open_set is None:
        return None
    now = timezone.now()
    ChangeSet.objects.filter(pk=open_set.pk).update(status='closed', closed_at=now, updated_at=now)
    counted = summary(open_set.pk)
    return counted if counted['total'] else None


def purge_old_sets(*, batch: int = 200, max_batches: int = 50) -> int:
    """Delete sets older than `CHANGE_HISTORY_DAYS`, changes with them.

    Batched and capped, so one sweep never holds a long delete. The rest waits
    for the next sweep.
    """
    from django.conf import settings

    cutoff = timezone.now() - timedelta(days=int(settings.CHANGE_HISTORY_DAYS))
    purged = 0
    for _ in range(max_batches):
        ids = list(ChangeSet.objects.filter(created_at__lt=cutoff)
                   .values_list('pk', flat=True)[:batch])
        if not ids:
            break
        ChangeSet.objects.filter(pk__in=ids).delete()
        purged += len(ids)
    return purged
