"""
What the vfs writes record into the change log (logs/changes.py, docs/UNDO_PLAN.md
§6.3), driven through the real `inference.vfs` functions with a binding set.

What these pin: one row per target however often it is written; the before
state from the first touch and the after state from the last; folders recorded
only when this call made them; the version copies a set leaves behind carry the
set's id (D3, the mandatory test: two sets writing one file within the coalesce
window keep two versions); app saves with no binding still coalesce as before;
and the row cap marks a set incomplete instead of growing without limit.
"""
from __future__ import annotations

import shutil
import tempfile
from contextlib import contextmanager
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from inference import vfs
from inference.models import Document, DocumentVersion
from logs import changes
from logs.models import Change, ChangeSet, ExecutionLog
from workflow_backend import thresholds

User = get_user_model()

_MEDIA = tempfile.mkdtemp(prefix='change-record-')


@override_settings(MEDIA_ROOT=_MEDIA)
class RecordCase(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(_MEDIA, ignore_errors=True)

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user('owner', 'owner@example.com', 'pw')
        self.scope = vfs.build_scope(self.user, vfs.FULL)

    def new_run(self):
        return ExecutionLog.objects.create(
            user=self.user, status='running', trigger_type='manual', caller='api',
            started_at=timezone.now(),
        )

    @contextmanager
    def in_run(self, log):
        """Bind `log`'s run for the block, as `_dispatch_one` does per tool call."""
        binding = changes.Binding(user_id=self.user.id, owner_kind='run',
                                  execution_id=str(log.execution_id),
                                  tool='write_file', call_id='c1')
        token = changes.bind(binding)
        try:
            yield binding
        finally:
            changes.unbind(token)

    def rows(self, set_id):
        return Change.objects.filter(change_set_id=set_id)

    def set_of(self, log):
        return ChangeSet.objects.get(execution=log)

    def doc(self, path):
        return Document.all_objects.get(user=self.user, name=path.rsplit('/', 1)[-1],
                                        deleted_at__isnull=True)


class FileRecordingTests(RecordCase):
    def test_a_new_file_is_one_row_with_no_before_state(self):
        log = self.new_run()
        with self.in_run(log):
            vfs.write_file(self.scope, '/notes/a.md', 'hello')
        target = self.set_of(log)
        # `/notes` is created in the same call, so it has its own folder row.
        [row] = self.rows(target.pk).filter(target_type='document')
        self.assertEqual(row.target_type, 'document')
        self.assertIsNone(row.before)
        self.assertTrue(row.content_changed)
        self.assertEqual(row.after['name'], 'a.md')
        self.assertTrue(row.label.endswith('/notes/a.md'))
        self.assertEqual(row.tool, 'write_file')

    def test_writing_one_file_three_times_is_still_one_row(self):
        vfs.write_file(self.scope, '/a.md', 'v0')  # made before the set existed
        before_set = changes.doc_state(self.doc('/a.md'))
        log = self.new_run()
        with self.in_run(log):
            vfs.write_file(self.scope, '/a.md', 'v1')
            vfs.write_file(self.scope, '/a.md', 'v2')
            vfs.write_file(self.scope, '/a.md', 'v3')
        target = self.set_of(log)
        [row] = self.rows(target.pk)
        # `before` is the state the set first found the file in...
        self.assertEqual(row.before['etag'], before_set['etag'])
        # ...and `after` is the state the last write left it in.
        self.assertEqual(row.after['etag'], changes.doc_state(self.doc('/a.md'))['etag'])
        self.assertNotEqual(row.after['etag'], row.before['etag'])

    def test_an_edit_records_before_and_keeps_a_version_of_the_set(self):
        vfs.write_file(self.scope, '/a.md', 'hello world')
        log = self.new_run()
        with self.in_run(log):
            vfs.edit_file(self.scope, '/a.md', 'world', 'there')
        target = self.set_of(log)
        [row] = self.rows(target.pk)
        self.assertIsNotNone(row.before)
        version = DocumentVersion.objects.get(change_set_id=target.pk)
        self.assertEqual(version.content_text, 'hello world')

    def test_two_sets_writing_one_file_within_the_window_keep_two_versions(self):
        # D3, the mandatory case. Without the set id on versions, run B's write
        # would coalesce into run A's copy, and reverting B would restore v0.
        vfs.write_file(self.scope, '/a.md', 'v0')
        run_a, run_b = self.new_run(), self.new_run()
        with self.in_run(run_a):
            vfs.write_file(self.scope, '/a.md', 'v1')
        with self.in_run(run_b):
            vfs.write_file(self.scope, '/a.md', 'v2')
        set_a, set_b = self.set_of(run_a), self.set_of(run_b)
        self.assertEqual(DocumentVersion.objects.filter(document=self.doc('/a.md')).count(), 2)
        from_a = DocumentVersion.objects.get(change_set_id=set_a.pk)
        from_b = DocumentVersion.objects.get(change_set_id=set_b.pk)
        self.assertEqual(from_a.content_text, 'v0')
        self.assertEqual(from_b.content_text, 'v1')

    def test_an_app_save_with_no_binding_still_coalesces(self):
        from inference.office_edit import save_text

        vfs.write_file(self.scope, '/a.md', 'first')
        doc = self.doc('/a.md')
        save_text(doc, 'second', version_source='app')
        save_text(self.doc('/a.md'), 'third', version_source='app')
        kept = DocumentVersion.objects.filter(document=doc)
        self.assertEqual(kept.count(), 1)
        self.assertIsNone(kept.get().change_set_id)
        self.assertEqual(ChangeSet.objects.count(), 0)
        self.assertEqual(Change.objects.count(), 0)

    def test_a_delete_records_the_file_as_trashed(self):
        vfs.write_file(self.scope, '/gone.md', 'bye')
        log = self.new_run()
        with self.in_run(log):
            vfs.delete(self.scope, '/gone.md')
        [row] = self.rows(self.set_of(log).pk)
        self.assertFalse(row.before['trashed'])
        self.assertTrue(row.after['trashed'])
        self.assertFalse(row.content_changed)

    def test_a_move_records_the_new_folder(self):
        vfs.write_file(self.scope, '/x/a.md', 'hi')
        log = self.new_run()
        with self.in_run(log):
            vfs.move(self.scope, '/x/a.md', '/y/a.md')
        file_rows = self.rows(self.set_of(log).pk).filter(target_type='document')
        [row] = file_rows
        self.assertNotEqual(row.before['folder_id'], row.after['folder_id'])
        self.assertEqual(row.label, '/y/a.md')

    def test_a_copy_records_a_new_file(self):
        vfs.write_file(self.scope, '/a.md', 'hi')
        log = self.new_run()
        with self.in_run(log):
            vfs.copy(self.scope, '/a.md', '/b.md')
        [row] = self.rows(self.set_of(log).pk)
        self.assertIsNone(row.before)
        self.assertTrue(row.content_changed)

    def test_a_restore_keeps_the_before_copy_under_the_set(self):
        vfs.write_file(self.scope, '/a.md', 'v0')
        vfs.write_file(self.scope, '/a.md', 'v1')  # no binding: an ordinary write
        # The first version kept is what the file said before that write: 'v0'.
        old = DocumentVersion.objects.filter(document=self.doc('/a.md')).order_by('id').first()
        log = self.new_run()
        with self.in_run(log):
            vfs.restore_file_version(self.scope, '/a.md', old.id)
        target = self.set_of(log)
        self.assertEqual(self.rows(target.pk).count(), 1)
        # The state the restore replaced is kept, stamped with the set.
        kept = DocumentVersion.objects.get(change_set_id=target.pk)
        self.assertEqual(kept.content_text, 'v1')


class FolderRecordingTests(RecordCase):
    def test_make_dir_records_only_the_folders_it_creates(self):
        vfs.make_dir(self.scope, '/a')
        log = self.new_run()
        with self.in_run(log):
            vfs.make_dir(self.scope, '/a/b/c')
        folder_rows = self.rows(self.set_of(log).pk).filter(target_type='folder')
        self.assertEqual(sorted(r.label for r in folder_rows), ['/a/b', '/a/b/c'])
        for row in folder_rows:
            self.assertIsNone(row.before)

    def test_a_system_root_created_by_path_is_not_recorded(self):
        log = self.new_run()
        with self.in_run(log):
            vfs.make_dir(self.scope, '/Chat/notes')
        folder_rows = self.rows(self.set_of(log).pk).filter(target_type='folder')
        self.assertEqual([r.label for r in folder_rows], ['/Chat/notes'])

    def test_a_folder_rename_records_the_name_before_and_after(self):
        vfs.make_dir(self.scope, '/old')
        log = self.new_run()
        with self.in_run(log):
            vfs.move(self.scope, '/old', '/new')
        [row] = self.rows(self.set_of(log).pk).filter(target_type='folder')
        self.assertEqual(row.before['name'], 'old')
        self.assertEqual(row.after['name'], 'new')

    def test_a_folder_delete_records_it_as_trashed(self):
        vfs.make_dir(self.scope, '/gone')
        log = self.new_run()
        with self.in_run(log):
            vfs.delete(self.scope, '/gone')
        [row] = self.rows(self.set_of(log).pk).filter(target_type='folder')
        self.assertFalse(row.before['trashed'])
        self.assertTrue(row.after['trashed'])


class RowCapTests(RecordCase):
    def test_the_row_cap_marks_the_set_incomplete(self):
        log = self.new_run()
        with mock.patch.object(thresholds, 'MAX_CHANGES_PER_SET', 3):
            with self.in_run(log):
                for n in range(4):
                    vfs.write_file(self.scope, f'/f{n}.md', 'x')
        target = self.set_of(log)
        self.assertEqual(self.rows(target.pk).count(), 3)
        self.assertTrue(ChangeSet.objects.get(pk=target.pk).incomplete)
