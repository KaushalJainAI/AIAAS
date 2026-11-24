"""
Undo: put back what a chat message or an agent run changed (docs/UNDO_PLAN.md
§6.4-6.6 and §6.8).

`logs/changes.py` records, per target, the state before a change set first
touched it and the state after it last did. This module reads those rows and
puts each target back, one change at a time:

* **Net effect, not history** (D1). A file written five times in one run has
  one row. Its before-copy is the version the set stamped (D3).
* **Never overwrite work done since** (D2). Before a change is put back, the
  target is compared with the state the set left it in. Anything different and
  the change is skipped, with a note saying why. There is no force option.
* **Skip rather than guess.** A target that cannot be put back exactly (its
  copy was pruned, its old folder is gone, a name is taken) is skipped with a
  plain-words note, and nothing it did is half-undone (each change is one
  transaction).

Refusals are for two things only. `RevertRefused` (409) means the set is still
live or already being undone. `ChangeNotFound` (404) means the set or change is
unknown or belongs to someone else; both get the same answer.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from workflow_backend import thresholds

from .models import Change, ChangeSet, ExecutionLog

logger = logging.getLogger(__name__)


class RevertRefused(Exception):
    """409: the set is still live, already being undone, or too big to undo at once."""


class ChangeNotFound(Exception):
    """404: no such set or change for this user. Unknown and foreign ids get the same answer."""


class _Skip(Exception):
    """Raised inside one change's transaction: roll it back and report `note`."""

    def __init__(self, note: str):
        super().__init__(note)
        self.note = note


#: Run statuses that end a run (docs/UNDO_PLAN.md Phase 0, item 5). The live
#: ones are pending, running and paused: a paused run is waiting on a person
#: and can still write once they answer. Matches `ExecutionLog.is_complete`.
FINISHED_RUN_STATUSES = frozenset({'completed', 'failed', 'cancelled', 'timeout'})

#: The statuses a revert may start from. `reverted` is in the list on purpose:
#: a second press walks the set again, leaves what is already back alone and
#: retries what was skipped the first time. Without it the second press would
#: be refused, and a skipped change could never be retried.
_REVERT_FROM = ['open', 'closed', 'partial', 'reverted']
#: How old a `reverting` lock must be before a new revert may take it over.
STALE_REVERT_LOCK = timedelta(minutes=10)

#: Plain-words notes (docs/UNDO_PLAN.md §6.4), one place so the UI and the tests agree.
NOTE_GONE_FILE = 'This file is gone for good (the bin was emptied).'
NOTE_GONE_FOLDER = 'This folder is gone for good (the bin was emptied).'
NOTE_CHANGED_FILE = ("Changed after this run — restore an older version from the file's "
                     "history instead")
NOTE_CHANGED_FOLDER = 'Changed after this run, so it was left as it is.'
NOTE_NOT_REMOVED = 'Not removed: it now holds files this run did not make.'
NOTE_PARENT_IN_BIN = 'Not brought back: its folder is still in the bin.'
NOTE_OLD_FOLDER_GONE = 'Could not move it back: its old folder is gone or in the bin.'
NOTE_LIVE_TOO_BIG = 'Too many changes to undo at once. Undo the workers one by one.'
NOTE_GONE_MEMORY = 'This fact is no longer stored.'
NOTE_CHANGED_MEMORY = 'Changed after this run, so it was left as it is.'
NOTE_GONE_AGENT = 'This agent is gone for good.'
NOTE_AGENT_CREATED = ("This run created the agent. Delete the agent from its page if you "
                      "don't want it.")
NOTE_AGENT_EDITED = 'The agent was edited again since, so it was left as it is.'


@dataclass
class _Tree:
    """A set and the workers under it, nearest first, bounded (§6.5)."""

    root: ChangeSet
    #: id -> set, root first, then by level.
    sets: dict = field(default_factory=dict)
    #: id -> child ids, newest first.
    children: dict = field(default_factory=dict)
    #: True when the walk stopped at `CHANGE_LIST_LIMIT` sets.
    too_big: bool = False

    def ids(self) -> list[int]:
        return list(self.sets)


def change_set_for(user, set_id: int) -> ChangeSet:
    """The user's own set with this id. Unknown and foreign ids raise the same error."""
    change_set = ChangeSet.objects.filter(pk=set_id, user=user).first()
    if change_set is None:
        raise ChangeNotFound()
    return change_set


def _load_tree(change_set: ChangeSet) -> _Tree:
    from agents.agent.orchestrator import MAX_DELEGATION_DEPTH

    # Re-read the root: liveness reads its `updated_at` and `status`, and a
    # caller's copy may be minutes old. The user filter also makes a foreign
    # set raise here, the same as an unknown one.
    root = ChangeSet.objects.filter(pk=change_set.pk, user_id=change_set.user_id).first()
    if root is None:
        raise ChangeNotFound()
    tree = _Tree(root=root, sets={root.pk: root})
    frontier = [change_set.pk]
    # One query per level. One level past the delegation limit, as `logs/queries.py`
    # does: loading a set that does not exist costs nothing, and a live worker
    # that was missed would let a revert fight it.
    for _ in range(MAX_DELEGATION_DEPTH + 1):
        kids = list(
            ChangeSet.objects
            .filter(user_id=change_set.user_id, parent_id__in=frontier)
            .exclude(pk__in=list(tree.sets))
            .order_by('-created_at', '-id')
        )
        if not kids:
            break
        if len(tree.sets) + len(kids) > thresholds.CHANGE_LIST_LIMIT:
            tree.too_big = True
            break
        frontier = []
        for kid in kids:
            tree.sets[kid.pk] = kid
            tree.children.setdefault(kid.parent_id, []).append(kid.pk)
            frontier.append(kid.pk)
    return tree


def _count_changes(tree: _Tree) -> int:
    return Change.objects.filter(change_set_id__in=tree.ids()).count()


def _revert_order(tree: _Tree) -> list[int]:
    """Children before their parent, newest child first (§6.5)."""
    from agents.agent.orchestrator import MAX_DELEGATION_DEPTH

    order: list[int] = []

    def visit(set_id: int, depth: int) -> None:
        if depth <= MAX_DELEGATION_DEPTH:
            for kid in tree.children.get(set_id, []):
                visit(kid, depth + 1)
        order.append(set_id)

    visit(tree.root.pk, 0)
    return order


# ---------------------------------------------------------------------------
# Liveness (§6.6)
# ---------------------------------------------------------------------------

def _live_reasons(tree: _Tree) -> dict[int, str]:
    """Why each live set in the tree is live, keyed by set id, root first."""
    idle_after = timezone.now() - timedelta(seconds=thresholds.CHANGE_SET_IDLE_SECONDS)
    run_pks = {s.execution_id for s in tree.sets.values() if s.execution_id}
    runs = {r.pk: r for r in
            ExecutionLog.objects.filter(pk__in=run_pks).select_related('subagent')}

    reasons: dict[int, str] = {}
    for set_id, change_set in tree.sets.items():
        if change_set.owner_kind == 'run':
            run = runs.get(change_set.execution_id)
            if run is None or run.status in FINISHED_RUN_STATUSES:
                continue
            who = 'agent' if set_id == tree.root.pk else 'worker'
            name = run.subagent.name if run.subagent_id else ''
            reasons[set_id] = (f"The {who} '{name}' is still running." if name
                               else f'The {who} is still running.')
        elif change_set.status == 'open' and change_set.updated_at > idle_after:
            # A chat turn that has been quiet for CHANGE_SET_IDLE_SECONDS is
            # treated as abandoned, so a turn paused for approval for ages
            # does not hold its files forever.
            reasons[set_id] = 'The chat turn is still running.'
    return reasons


def live_reason(change_set: ChangeSet) -> str | None:
    """Why this set (or a worker under it) is still running, or None."""
    return next(iter(_live_reasons(_load_tree(change_set)).values()), None)


# ---------------------------------------------------------------------------
# Reading: the sheet (§6.8)
# ---------------------------------------------------------------------------

def describe(change_set: ChangeSet) -> dict:
    """The set, its changes and its workers, nested. Bounded by CHANGE_LIST_LIMIT."""
    tree = _load_tree(change_set)
    reasons = _live_reasons(tree)
    rows = Change.objects.filter(change_set_id__in=tree.ids())
    total = rows.count()
    shown: dict[int, list] = {}
    shown_count = 0
    for change in rows.order_by('-created_at', '-id')[:thresholds.CHANGE_LIST_LIMIT]:
        shown.setdefault(change.change_set_id, []).append(_change_row(change))
        shown_count += 1
    return {
        'live': bool(reasons),
        'live_reason': next(iter(reasons.values()), None),
        'total': total,
        'truncated': tree.too_big or total > shown_count,
        'set': _describe_node(tree, tree.root.pk, reasons, shown),
    }


def _describe_node(tree: _Tree, set_id: int, reasons: dict, shown: dict) -> dict:
    change_set = tree.sets[set_id]
    return {
        'id': change_set.pk,
        'owner_kind': change_set.owner_kind,
        'status': change_set.status,
        'incomplete': change_set.incomplete,
        'created_at': change_set.created_at,
        'live': set_id in reasons,
        'live_reason': reasons.get(set_id),
        'changes': shown.get(set_id, []),
        'children': [_describe_node(tree, kid, reasons, shown)
                     for kid in tree.children.get(set_id, [])],
    }


def _change_row(change: Change) -> dict:
    return {
        'id': change.pk,
        'label': change.label,
        'target_type': change.target_type,
        'revertible': change.revertible,
        'reason': change.reason,
        'outcome': change.outcome,
        'outcome_note': change.outcome_note,
        'tool': change.tool,
    }


# ---------------------------------------------------------------------------
# Reverting (§6.5)
# ---------------------------------------------------------------------------

def revert(change_set: ChangeSet, user, *, change_ids: list[int] | None = None) -> dict:
    """Put back what the set (and its workers) changed. Returns the outcome list.

    Raises `RevertRefused` while anything in the tree is live or the set is
    already being undone, and `ChangeNotFound` for ids the user may not see.
    """
    if change_set.user_id != user.id:
        raise ChangeNotFound()

    tree = _load_tree(change_set)
    if tree.too_big or _count_changes(tree) > thresholds.CHANGE_LIST_LIMIT:
        raise RevertRefused(NOTE_LIVE_TOO_BIG)
    reason = next(iter(_live_reasons(tree).values()), None)
    if reason:
        raise RevertRefused(reason)

    wanted = None
    if change_ids is not None:
        wanted = set(change_ids)
        found = set(Change.objects.filter(change_set_id__in=tree.ids(), pk__in=wanted)
                    .values_list('pk', flat=True))
        if found != wanted:
            raise ChangeNotFound()

    # The lock: one conditional UPDATE, so two presses at once cannot both run.
    # A lock older than STALE_REVERT_LOCK is a revert whose process died (a
    # deploy, an OOM kill) before `finally` could settle it; without the
    # take-over the set could never be undone again. A live revert takes
    # seconds, so a fresh lock still refuses the second press.
    from django.db.models import Q

    stale = timezone.now() - STALE_REVERT_LOCK
    locked = (ChangeSet.objects
              .filter(pk=change_set.pk, user_id=user.id)
              .filter(Q(status__in=_REVERT_FROM)
                      | Q(status='reverting', updated_at__lt=stale))
              .update(status='reverting', updated_at=timezone.now()))
    if not locked:
        raise RevertRefused('This change set is already being undone.')

    counts = {'reverted': 0, 'skipped': 0, 'failed': 0,
              'not_revertible': 0, 'already_reverted': 0}
    outcomes: list[dict] = []
    touched: set[int] = set()
    try:
        by_set = _changes_by_set(tree)
        for set_id in _revert_order(tree):
            for change in by_set.get(set_id, []):
                if change.outcome == 'reverted':
                    counts['already_reverted'] += 1
                    continue
                if wanted is not None and change.pk not in wanted:
                    continue
                if change.target_type == '' or not change.revertible:
                    # Untracked: listed so the user sees it, never touched (D8).
                    counts['not_revertible'] += 1
                    outcomes.append(_outcome(change, 'not_revertible', change.reason))
                    continue
                outcome, note = _revert_one(change, tree.sets[set_id], user)
                _record(change, outcome, note)
                touched.add(set_id)
                counts[outcome] += 1
                outcomes.append(_outcome(change, outcome, note))
    finally:
        status = _settle(tree, touched)

    return {'status': status, 'outcomes': outcomes, **counts}


def _changes_by_set(tree: _Tree) -> dict[int, list[Change]]:
    grouped: dict[int, list[Change]] = {}
    for change in Change.objects.filter(change_set_id__in=tree.ids()).order_by('-seq'):
        grouped.setdefault(change.change_set_id, []).append(change)
    return grouped


def _revert_one(change: Change, change_set: ChangeSet, user) -> tuple[str, str]:
    """One change, in its own transaction: (outcome, note)."""
    try:
        with transaction.atomic():
            if change.target_type == 'document':
                note = _revert_document(change, change_set, user)
            elif change.target_type == 'folder':
                note = _revert_folder(change, change_set, user)
            elif change.target_type == 'memory':
                note = _revert_memory(change, user)
            elif change.target_type == 'agent':
                note = _revert_agent(change, user)
            else:
                raise _Skip('Undoing this kind of change is not available yet.')
    except _Skip as skip:
        return 'skipped', skip.note
    except Exception:  # noqa: BLE001 — one bad change must not stop the rest
        logger.exception('[Undo] Could not put back change %s', change.pk)
        return 'failed', 'Could not be put back: an error was logged.'
    return 'reverted', note


def _record(change: Change, outcome: str, note: str) -> None:
    change.outcome = outcome
    change.outcome_note = note[:300]
    change.reverted_at = timezone.now() if outcome == 'reverted' else None
    change.save(update_fields=['outcome', 'outcome_note', 'reverted_at', 'updated_at'])


def _outcome(change: Change, outcome: str, note: str) -> dict:
    return {'change_id': change.pk, 'label': change.label,
            'outcome': outcome, 'note': note}


def _settle(tree: _Tree, touched: set[int]) -> str:
    """Give each touched set the status its changes now earn (§6.5 step 4).

    The root holds the lock, so its status counts its whole tree. A worker's
    counts its own changes. Returns the root's new status.
    """
    now = timezone.now()
    for set_id in touched | {tree.root.pk}:
        scope = tree.ids() if set_id == tree.root.pk else [set_id]
        left = (Change.objects.filter(change_set_id__in=scope, revertible=True)
                .exclude(outcome='reverted').count())
        ChangeSet.objects.filter(pk=set_id).update(
            status='reverted' if left == 0 else 'partial', updated_at=now)
    return ChangeSet.objects.filter(pk=tree.root.pk).values_list('status', flat=True).get()


# ---------------------------------------------------------------------------
# Per-target reverters (§6.4). Each one checks first and skips rather than
# overwrite; by the time it writes, nothing it does can fail halfway.
# ---------------------------------------------------------------------------

def _document_changed_since(doc, after: dict) -> bool:
    from inference import office_edit

    return (office_edit.is_stale(doc, after.get('etag'))
            or (doc.deleted_at is not None) != bool(after.get('trashed'))
            or doc.folder_id != after.get('folder_id')
            or doc.name != after.get('name'))


def _revert_document(change: Change, change_set: ChangeSet, user) -> str:
    from inference import recycle, versions, vfs
    from inference.models import Document, DocumentVersion, Folder

    before = change.before
    after = change.after or {}
    doc = Document.all_objects.filter(pk=change.target_id, user=user).first()
    if doc is None:
        raise _Skip(NOTE_GONE_FILE)
    if not after or _document_changed_since(doc, after):
        raise _Skip(NOTE_CHANGED_FILE)

    if before is None:
        # The run made the file. Put it in the bin, unless it is there already
        # (created and then deleted within the run).
        if doc.deleted_at is None:
            recycle.trash(user, documents=[doc])
            return 'Moved to the bin.'
        return 'Already in the bin.'

    needs_restore = doc.deleted_at is not None and not before.get('trashed')
    old_folder_id = before.get('folder_id')
    old_name = before.get('name') or doc.name
    needs_move = doc.folder_id != old_folder_id or doc.name != old_name

    version = None
    if change.content_changed:
        version = (DocumentVersion.objects
                   .filter(document=doc, change_set_id=change_set.pk)
                   .order_by('created_at', 'id').first())
        if version is None:
            raise _Skip(
                'No copy from before this run was kept (the file was too large, or only '
                f'the last {thresholds.FILE_VERSIONS_KEPT} versions are kept).')

    if (needs_restore and doc.folder_id is not None and
            Folder.all_objects.filter(pk=doc.folder_id, user=user,
                                      deleted_at__isnull=False).exists()):
        raise _Skip(NOTE_PARENT_IN_BIN)
    if needs_move:
        if old_folder_id is not None and not Folder.objects.filter(
                pk=old_folder_id, user=user).exists():
            raise _Skip(NOTE_OLD_FOLDER_GONE)
        if Document.objects.filter(user=user, folder_id=old_folder_id,
                                   name=old_name).exclude(pk=doc.pk).exists():
            raise _Skip(f'Could not move it back: a file named {old_name} is already there.')

    notes = []
    if needs_restore:
        result = recycle.restore(user, document_ids=[doc.pk])
        if result['refused']:
            raise _Skip(NOTE_PARENT_IN_BIN)
        notes.append('Brought back from the bin.')
    if version is not None:
        versions.restore(Document.all_objects.get(pk=doc.pk), version)
        notes.append('Text put back from before this run.')
    if needs_move:
        # The D20 helper: a column write, as vfs.move does, so `updated_at`
        # (the etag) does not move and the next revert does not read it as an edit.
        Document.all_objects.filter(pk=doc.pk).update(
            folder_id=old_folder_id, name=old_name, file_type=vfs._file_type(old_name))
        notes.append('Moved back to where it was.')
    return ' '.join(notes) or 'Nothing needed putting back.'


def _revert_folder(change: Change, change_set: ChangeSet, user) -> str:
    from inference import filesystem, recycle
    from inference.models import Document, Folder

    before = change.before
    after = change.after or {}
    folder = Folder.all_objects.filter(pk=change.target_id, user=user).first()
    if folder is None:
        raise _Skip(NOTE_GONE_FOLDER)
    if (not after
            or folder.parent_id != after.get('parent_id')
            or folder.name != after.get('name')
            or (folder.deleted_at is not None) != bool(after.get('trashed'))):
        raise _Skip(NOTE_CHANGED_FOLDER)

    if before is None:
        # Created by the run. Its files were put back first (newest change
        # first), so anything still live in it is not the run's.
        if (Document.objects.filter(user=user, folder=folder).exists()
                or Folder.objects.filter(user=user, parent=folder).exists()):
            raise _Skip(NOTE_NOT_REMOVED)
        if folder.deleted_at is None:
            recycle.trash(user, folders=[folder])
            return 'Moved to the bin.'
        return 'Already in the bin.'

    needs_restore = folder.deleted_at is not None and not before.get('trashed')
    old_parent_id = before.get('parent_id')
    old_name = before.get('name') or folder.name
    needs_move = folder.parent_id != old_parent_id
    needs_rename = folder.name != old_name

    if (needs_restore and folder.parent_id is not None and
            Folder.all_objects.filter(pk=folder.parent_id, user=user,
                                      deleted_at__isnull=False).exists()):
        raise _Skip(NOTE_PARENT_IN_BIN)

    target = folder.parent
    if needs_move:
        target = None
        if old_parent_id is not None:
            target = Folder.objects.filter(pk=old_parent_id, user=user).first()
            if target is None:
                raise _Skip(NOTE_OLD_FOLDER_GONE)
    if ((needs_move or needs_rename)
            and filesystem.folder_name_taken(user, target, old_name, exclude_pk=folder.pk)):
        raise _Skip(f'Could not move it back: a folder named {old_name} is already there.')

    notes = []
    if needs_restore:
        result = recycle.restore(user, folder_ids=[folder.pk])
        if result['refused']:
            raise _Skip(NOTE_PARENT_IN_BIN)
        notes.append('Brought back from the bin.')
    folder = Folder.all_objects.get(pk=folder.pk)
    try:
        if needs_move:
            filesystem.move(user, folders=[folder], target=target)
            notes.append('Moved back to where it was.')
        if needs_rename:
            filesystem.rename_folder(folder, old_name)
            notes.append('Renamed back.')
    except filesystem.FilesystemError as exc:
        raise _Skip(f'Could not move it back: {exc}')
    return ' '.join(notes) or 'Nothing needed putting back.'


def _revert_memory(change: Change, user) -> str:
    from core import memory as user_memory
    from core.models import UserMemory

    before = change.before
    after = change.after or {}
    if before is None:
        # The run stored this fact. Delete it only if it is still there with the
        # text the run gave it; a fact the user has since edited is theirs.
        row = UserMemory.objects.filter(pk=change.target_id, user=user).first()
        if row is None:
            raise _Skip(NOTE_GONE_MEMORY)
        if row.text != after.get('text'):
            raise _Skip(NOTE_CHANGED_MEMORY)
        row.delete()
        return 'Forgotten.'
    # The run removed this fact. Store it again (a repeat is a touch, not a copy).
    user_memory.remember(user, before['text'], before.get('category') or 'context')
    return 'Remembered again.'


def _revert_agent(change: Change, user) -> str:
    from agents.models import SubAgent
    from logs import revisions
    from logs.models import SubAgentRevision

    before = change.before
    after = change.after or {}
    agent = SubAgent.objects.filter(pk=change.target_id, user=user).first()
    if agent is None:
        raise _Skip(NOTE_GONE_AGENT)
    if before is None:
        # Created by the run. Deleting an agent is too large a step to take from
        # an undo, so the note sends the user to the agent's page.
        raise _Skip(NOTE_AGENT_CREATED)
    newest = (SubAgentRevision.objects.filter(subagent=agent)
              .order_by('-number').values_list('number', flat=True).first())
    if before.get('revision') is None or not after or newest != after.get('revision'):
        raise _Skip(NOTE_AGENT_EDITED)
    try:
        revisions.restore(agent, before['revision'], user=user)
    except SubAgentRevision.DoesNotExist:
        raise _Skip('The version to go back to is gone.')
    except revisions.RestoreRefused as refused:
        raise _Skip(f'Could not put the settings back: {_refusal_text(refused.detail)}')
    return 'Settings put back.'


def _refusal_text(detail) -> str:
    """The first plain message in a serializer's error body."""
    if isinstance(detail, dict):
        for value in detail.values():
            if isinstance(value, (list, tuple)):
                return str(value[0]) if value else 'the configuration is no longer valid.'
            return str(value)
    return str(detail)
