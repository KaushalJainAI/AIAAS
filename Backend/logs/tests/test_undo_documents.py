"""
Undo for files and folders (logs/undo.py, docs/UNDO_PLAN.md §6.4-6.5, Phase 4).

Every case here writes through the real `inference.vfs` functions under a run
binding (as `test_change_record.py` does), then reverts the run's change set.

The one that matters most is `test_a_user_edit_after_the_run_is_never_overwritten`:
an undo that puts back text the user wrote since is worse than no undo (D2).
The clock is bumped explicitly after each write in these tests, because the
Windows clock ticks about every 15 ms and two writes can share a timestamp;
an etag that does not move would hide the change the test is about.
"""
from __future__ import annotations

import shutil
import tempfile
from contextlib import contextmanager
from datetime import timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from chat.models import ChatMessage, ChatSession
from inference import office_edit, vfs, versions
from inference.models import Document, DocumentVersion, Folder
from logs import changes, undo
from logs.models import Change, ChangeSet, ExecutionLog
from workflow_backend import thresholds

User = get_user_model()

_MEDIA = tempfile.mkdtemp(prefix='undo-documents-')


@override_settings(MEDIA_ROOT=_MEDIA)
class UndoCase(TestCase):
    """Shared helpers for the undo tests. It defines no tests of its own, so
    importing it into another test module runs nothing twice."""

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(_MEDIA, ignore_errors=True)

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user('owner', 'owner@example.com', 'pw')
        self.scope = vfs.build_scope(self.user, vfs.FULL)

    def new_run(self, name=''):
        sub = None
        if name:
            from agents.models import SubAgent
            sub = SubAgent.objects.create(user=self.user, name=name)
        return ExecutionLog.objects.create(
            user=self.user, subagent=sub, status='running', trigger_type='manual',
            caller='api', started_at=timezone.now(),
        )

    def end(self, log, status='completed'):
        ExecutionLog.objects.filter(pk=log.pk).update(status=status)

    @contextmanager
    def in_run(self, log, tool='write_file'):
        """Bind `log`'s run for the block, as `_dispatch_one` does per tool call."""
        binding = changes.Binding(user_id=self.user.id, owner_kind='run',
                                  execution_id=str(log.execution_id),
                                  tool=tool, call_id='c1')
        token = changes.bind(binding)
        try:
            yield binding
        finally:
            changes.unbind(token)

    def set_of(self, log):
        return ChangeSet.objects.get(execution=log)

    def rows(self, change_set):
        return Change.objects.filter(change_set=change_set)

    def doc(self, path):
        """A live document, found by the last part of its path (names are unique per test)."""
        return Document.objects.get(user=self.user, name=path.rsplit('/', 1)[-1])

    def any_doc(self, name):
        """A document by name, trashed or not."""
        return Document.all_objects.get(user=self.user, name=name)

    def tick(self, doc_or_folder, seconds=1):
        """Move `updated_at` on, so an etag written a moment ago differs from now."""
        when = timezone.now() + timedelta(seconds=seconds)
        model = Document if isinstance(doc_or_folder, Document) else Folder
        model.all_objects.filter(pk=doc_or_folder.pk).update(updated_at=when)

    def revert(self, log, **kwargs):
        return undo.revert(self.set_of(log), self.user, **kwargs)

    def outcome_of(self, result, change_id):
        return next(o for o in result['outcomes'] if o['change_id'] == change_id)


class UserEditAfterTheRunTests(UndoCase):
    def test_a_user_edit_after_the_run_is_never_overwritten(self):
        # D2, the most important case: the user wrote after the run. The undo
        # skips the file, says why, and leaves the user's text where it is.
        vfs.write_file(self.scope, '/a.md', 'before the run')
        log = self.new_run()
        with self.in_run(log):
            vfs.write_file(self.scope, '/a.md', 'the run wrote this')
        self.end(log)
        office_edit.save_text(self.doc('/a.md'), 'the user wrote this later',
                              version_source='app')
        self.tick(self.doc('/a.md'))

        result = self.revert(log)

        [change] = self.rows(self.set_of(log))
        self.assertEqual(change.outcome, 'skipped')
        self.assertIn('Changed after this run', change.outcome_note)
        self.assertEqual(result['skipped'], 1)
        self.assertEqual(result['reverted'], 0)
        self.assertEqual(self.doc('/a.md').content_text, 'the user wrote this later')

    def test_another_run_that_edits_after_is_skipped_too(self):
        vfs.write_file(self.scope, '/a.md', 'v0')
        run_a, run_b = self.new_run(), self.new_run()
        with self.in_run(run_a):
            vfs.write_file(self.scope, '/a.md', 'run A')
        self.end(run_a)
        with self.in_run(run_b):
            vfs.write_file(self.scope, '/a.md', 'run B')
        self.end(run_b)
        self.tick(self.doc('/a.md'))

        result = self.revert(run_a)

        self.assertEqual(result['skipped'], 1)
        self.assertEqual(self.doc('/a.md').content_text, 'run B')

    def test_a_user_trash_after_the_run_is_left_alone(self):
        # The run created the file; the user then moved it to the bin themselves.
        # The trash is a change since the run, so the undo skips it: the user's
        # own choice stands and nothing is restored behind their back.
        log = self.new_run()
        with self.in_run(log):
            vfs.write_file(self.scope, '/made.md', 'hello')
        self.end(log)
        vfs.delete(self.scope, '/made.md')
        self.tick(self.any_doc('made.md'))

        result = self.revert(log)

        [change] = self.rows(self.set_of(log))
        self.assertEqual(change.outcome, 'skipped')
        self.assertIn('Changed after this run', change.outcome_note)
        self.assertEqual(result['skipped'], 1)
        self.assertIsNotNone(self.any_doc('made.md').deleted_at)


class DocumentRevertTests(UndoCase):
    def test_a_created_file_goes_to_the_bin(self):
        log = self.new_run()
        with self.in_run(log):
            vfs.write_file(self.scope, '/made.md', 'hello')
        self.end(log)

        result = self.revert(log)

        self.assertEqual(result['reverted'], 1)
        doc = self.any_doc('made.md')
        self.assertIsNotNone(doc.deleted_at)
        self.assertEqual(self.rows(self.set_of(log)).get().outcome, 'reverted')

    def test_an_edited_file_gets_its_pre_run_text_back(self):
        vfs.write_file(self.scope, '/a.md', 'pre-run')
        log = self.new_run()
        with self.in_run(log):
            vfs.write_file(self.scope, '/a.md', 'run text')
        self.end(log)

        self.revert(log)

        self.assertEqual(self.doc('/a.md').content_text, 'pre-run')
        # The run's text is not lost: the replaced state is a restore version.
        kept = (DocumentVersion.objects.filter(document=self.doc('/a.md'), source='restore')
                .order_by('-id').first())
        self.assertEqual(kept.content_text, 'run text')

    def test_an_edit_three_times_in_one_run_reverts_to_the_text_before_the_first(self):
        vfs.write_file(self.scope, '/a.md', 'pre-run')
        log = self.new_run()
        with self.in_run(log):
            vfs.write_file(self.scope, '/a.md', 'one')
            vfs.write_file(self.scope, '/a.md', 'two')
            vfs.write_file(self.scope, '/a.md', 'three')
        self.end(log)

        self.revert(log)

        self.assertEqual(self.doc('/a.md').content_text, 'pre-run')

    def test_a_deleted_file_is_live_again_in_its_folder(self):
        vfs.write_file(self.scope, '/box/a.md', 'keep me')
        folder_id = self.any_doc('a.md').folder_id
        log = self.new_run()
        with self.in_run(log):
            vfs.delete(self.scope, '/box/a.md')
        self.end(log)

        self.revert(log)

        doc = self.any_doc('a.md')
        self.assertIsNone(doc.deleted_at)
        self.assertEqual(doc.folder_id, folder_id)
        self.assertEqual(doc.content_text, 'keep me')

    def test_a_moved_file_goes_back_to_its_old_folder(self):
        vfs.write_file(self.scope, '/x/a.md', 'hi')
        old_folder = self.any_doc('a.md').folder_id
        log = self.new_run()
        with self.in_run(log):
            vfs.move(self.scope, '/x/a.md', '/y/a.md')
        self.end(log)

        self.revert(log)

        doc = self.any_doc('a.md')
        self.assertEqual(doc.folder_id, old_folder)
        self.assertEqual(doc.name, 'a.md')

    def test_a_moved_file_whose_old_name_is_taken_is_skipped(self):
        vfs.write_file(self.scope, '/x/a.md', 'run moved me')
        log = self.new_run()
        with self.in_run(log):
            vfs.move(self.scope, '/x/a.md', '/y/a.md')
        self.end(log)
        # The user now has a different a.md in the old place.
        vfs.write_file(self.scope, '/x/a.md', 'the user made this')

        result = self.revert(log)

        # `/y` was created by the move too, so the set also holds a folder row.
        change = self.rows(self.set_of(log)).get(target_type='document')
        self.assertEqual(change.outcome, 'skipped')
        self.assertIn('already there', change.outcome_note)
        # The folder `/y` the move made still holds the file, so it is skipped too.
        self.assertEqual(result['skipped'], 2)
        moved = Document.objects.get(user=self.user, name='a.md', folder__name='y')
        self.assertEqual(moved.content_text, 'run moved me')

    def test_created_then_edited_then_deleted_stays_in_the_bin(self):
        log = self.new_run()
        with self.in_run(log):
            vfs.write_file(self.scope, '/c.md', 'one')
            vfs.write_file(self.scope, '/c.md', 'two')
            vfs.delete(self.scope, '/c.md')
        self.end(log)

        result = self.revert(log)

        self.assertIsNotNone(self.any_doc('c.md').deleted_at)
        [change] = self.rows(self.set_of(log))
        self.assertEqual(change.outcome, 'reverted')
        self.assertEqual(change.outcome_note, 'Already in the bin.')
        self.assertEqual(result['skipped'], 0)

    def test_the_file_is_gone_for_good_when_the_bin_was_emptied(self):
        log = self.new_run()
        with self.in_run(log):
            vfs.write_file(self.scope, '/gone.md', 'bye')
        self.end(log)
        Document.all_objects.filter(user=self.user, name='gone.md').delete()

        result = self.revert(log)

        self.assertEqual(result['skipped'], 1)
        self.assertIn('gone for good', self.rows(self.set_of(log)).get().outcome_note)

    def test_a_pruned_before_copy_is_skipped_with_the_note(self):
        vfs.write_file(self.scope, '/a.md', 'v0')
        log = self.new_run()
        with self.in_run(log):
            vfs.write_file(self.scope, '/a.md', 'v1')
        self.end(log)
        # 26 newer copies push the run's own copy out (FILE_VERSIONS_KEPT is 25).
        for _ in range(26):
            versions.snapshot(self.doc('/a.md'), 'app', force=True)
        self.assertFalse(DocumentVersion.objects.filter(
            document=self.doc('/a.md'), change_set_id=self.set_of(log).pk).exists())

        result = self.revert(log)

        [change] = self.rows(self.set_of(log))
        self.assertEqual(change.outcome, 'skipped')
        self.assertIn('No copy from before this run was kept', change.outcome_note)
        self.assertEqual(result['skipped'], 1)
        self.assertEqual(self.doc('/a.md').content_text, 'v1')


class FolderRevertTests(UndoCase):
    def test_a_created_folder_with_only_the_runs_files_goes_to_the_bin(self):
        log = self.new_run()
        with self.in_run(log):
            vfs.write_file(self.scope, '/proj/a.md', 'x')
        self.end(log)

        self.revert(log)

        self.assertIsNotNone(self.any_doc('a.md').deleted_at)
        self.assertIsNotNone(Folder.all_objects.get(user=self.user, name='proj').deleted_at)

    def test_a_created_folder_that_now_holds_a_user_file_is_kept(self):
        log = self.new_run()
        with self.in_run(log):
            vfs.write_file(self.scope, '/proj/a.md', 'x')
        self.end(log)
        vfs.write_file(self.scope, '/proj/mine.md', 'the user put this here')

        result = self.revert(log)

        self.assertIsNotNone(self.any_doc('a.md').deleted_at)
        proj = Folder.all_objects.get(user=self.user, name='proj')
        self.assertIsNone(proj.deleted_at)
        self.assertEqual(result['skipped'], 1)
        folder_change = self.rows(self.set_of(log)).get(target_type='folder')
        self.assertEqual(folder_change.outcome, 'skipped')
        self.assertIn('Not removed', folder_change.outcome_note)

    def test_a_deleted_folder_comes_back_with_its_files(self):
        vfs.write_file(self.scope, '/keep/a.md', 'inside')
        log = self.new_run()
        with self.in_run(log):
            vfs.delete(self.scope, '/keep')
        self.end(log)

        self.revert(log)

        self.assertIsNone(Folder.all_objects.get(user=self.user, name='keep').deleted_at)
        self.assertIsNone(self.any_doc('a.md').deleted_at)

    def test_a_renamed_folder_gets_its_old_name_back(self):
        vfs.make_dir(self.scope, '/old')
        log = self.new_run()
        with self.in_run(log):
            vfs.move(self.scope, '/old', '/new')
        self.end(log)

        self.revert(log)

        self.assertTrue(Folder.objects.filter(user=self.user, name='old').exists())
        self.assertFalse(Folder.objects.filter(user=self.user, name='new').exists())


class RevertEngineTests(UndoCase):
    def test_reverting_twice_does_nothing_the_second_time(self):
        vfs.write_file(self.scope, '/a.md', 'pre-run')
        log = self.new_run()
        with self.in_run(log):
            vfs.write_file(self.scope, '/a.md', 'run text')
        self.end(log)
        first = self.revert(log)
        second = self.revert(log)

        self.assertEqual(first['reverted'], 1)
        self.assertEqual(second['reverted'], 0)
        self.assertEqual(second['already_reverted'], 1)
        self.assertEqual(second['outcomes'], [])
        self.assertEqual(self.set_of(log).status, 'reverted')

    def test_a_live_run_is_refused_and_named(self):
        log = self.new_run(name='Researcher')
        with self.in_run(log):
            vfs.write_file(self.scope, '/a.md', 'writing')
        # Still running: status stays 'running'.
        with self.assertRaises(undo.RevertRefused) as ctx:
            self.revert(log)
        self.assertIn("'Researcher'", str(ctx.exception))
        self.assertEqual(self.set_of(log).status, 'closed')
        self.assertIsNone(self.any_doc('a.md').deleted_at)

    def test_a_concurrent_revert_is_refused(self):
        log = self.new_run()
        with self.in_run(log):
            vfs.write_file(self.scope, '/a.md', 'x')
        self.end(log)
        ChangeSet.objects.filter(execution=log).update(status='reverting')

        with self.assertRaises(undo.RevertRefused) as ctx:
            self.revert(log)
        self.assertIn('already being undone', str(ctx.exception))

    def test_an_open_chat_set_is_refused_while_fresh_and_allowed_once_idle(self):
        session = ChatSession.objects.create(user=self.user, title='work')
        message = ChatMessage.objects.create(
            session=session, role='user', content='write it', message_type='chat')
        binding = changes.Binding(user_id=self.user.id, owner_kind='chat',
                                  chat_message_id=message.id, tool='write_file', call_id='c1')
        token = changes.bind(binding)
        try:
            vfs.write_file(self.scope, '/chat.md', 'from chat')
        finally:
            changes.unbind(token)
        chat_set = ChangeSet.objects.get(chat_message=message)
        self.assertEqual(chat_set.status, 'open')

        with self.assertRaises(undo.RevertRefused):
            undo.revert(chat_set, self.user)

        ChangeSet.objects.filter(pk=chat_set.pk).update(
            updated_at=timezone.now() - timedelta(seconds=thresholds.CHANGE_SET_IDLE_SECONDS + 60))
        result = undo.revert(chat_set, self.user)
        self.assertEqual(result['reverted'], 1)
        self.assertIsNotNone(self.any_doc('chat.md').deleted_at)

    def test_a_subset_of_changes_reverts_only_those(self):
        log = self.new_run()
        with self.in_run(log):
            vfs.write_file(self.scope, '/a.md', 'a')
            vfs.write_file(self.scope, '/b.md', 'b')
        self.end(log)
        a_change = self.rows(self.set_of(log)).get(label='/a.md')

        result = self.revert(log, change_ids=[a_change.pk])

        self.assertEqual(result['reverted'], 1)
        self.assertIsNotNone(self.any_doc('a.md').deleted_at)
        self.assertIsNone(self.any_doc('b.md').deleted_at)
        self.assertEqual(self.set_of(log).status, 'partial')

    def test_a_change_id_outside_the_set_is_not_found(self):
        log = self.new_run()
        with self.in_run(log):
            vfs.write_file(self.scope, '/a.md', 'a')
        self.end(log)
        other = self.new_run()
        with self.in_run(other):
            vfs.write_file(self.scope, '/b.md', 'b')
        self.end(other)
        foreign_change = self.rows(self.set_of(other)).get()

        with self.assertRaises(undo.ChangeNotFound):
            self.revert(log, change_ids=[foreign_change.pk])

    def test_untracked_rows_are_listed_and_never_touched(self):
        log = self.new_run()
        with self.in_run(log):
            vfs.write_file(self.scope, '/a.md', 'a')
            changes.record_untracked(label='Sent an email to Priya', external=True,
                                     effect='irreversible')
        self.end(log)

        result = self.revert(log)

        self.assertEqual(result['reverted'], 1)
        self.assertEqual(result['not_revertible'], 1)
        untracked = self.rows(self.set_of(log)).get(target_type='')
        self.assertFalse(untracked.revertible)
        self.assertEqual(untracked.outcome, '')
        self.assertIn({'change_id': untracked.pk, 'label': 'Sent an email to Priya',
                       'outcome': 'not_revertible',
                       'note': "Left the app; can't be undone from here"},
                      result['outcomes'])

    def test_a_target_of_another_user_is_treated_as_gone(self):
        log = self.new_run()
        with self.in_run(log):
            vfs.write_file(self.scope, '/a.md', 'a')
        self.end(log)
        other = User.objects.create_user('other', 'other@example.com', 'pw')
        # Point the row at a document that belongs to someone else.
        foreign = vfs.build_scope(other, vfs.FULL)
        vfs.write_file(foreign, '/theirs.md', 'theirs')
        their_doc = Document.all_objects.get(user=other, name='theirs.md')
        Change.objects.filter(change_set=self.set_of(log)).update(target_id=their_doc.pk)

        result = self.revert(log)

        self.assertEqual(result['skipped'], 1)
        self.assertIsNone(Document.all_objects.get(pk=their_doc.pk).deleted_at)
