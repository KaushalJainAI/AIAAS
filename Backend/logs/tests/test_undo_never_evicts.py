"""
Undo must never make room by deleting a fact the run did not touch (H-181).

Each class names the failure it pins: a removed fact whose category filled up
again (undo used to evict the least recently touched fact to fit it back), a
live set whose liveness changed while the revert waited for the lock, and the
tree walk that must stay within the user and the breadth cap.
"""
from __future__ import annotations

from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone

from chat.tools.memory import _forget
from core import memory as user_memory
from core.models import UserMemory
from logs import undo
from logs.models import Change, ChangeSet, ExecutionLog

User = get_user_model()


class _Base(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user('memo', 'memo@example.test', 'pw')

    def run_log(self, status='running'):
        return ExecutionLog.objects.create(
            user=self.user, status=status, trigger_type='manual', caller='api',
            started_at=timezone.now())

    def bound_to(self, log, fn, tool='forget_about_user'):
        from logs import changes
        token = changes.bind(changes.Binding(
            user_id=self.user.id, owner_kind='run', execution_id=str(log.execution_id),
            tool=tool, call_id='c1'))
        try:
            return fn()
        finally:
            changes.unbind(token)


class UndoOfARemovedFactNeverEvictsAnother(_Base):
    def test_a_removed_fact_is_skipped_when_its_category_is_full_again(self):
        with mock.patch.object(UserMemory, 'MAX_PER_CATEGORY', 1):
            user_memory.remember(self.user, 'Works in IST', 'context')
            log = self.run_log()
            self.bound_to(log, lambda: _forget(self.user, 'Works in IST'))
            # The user stores something else while the run is over.
            user_memory.remember(self.user, 'Lives in Pune', 'context')
            ExecutionLog.objects.filter(pk=log.pk).update(status='completed')

            result = undo.revert(ChangeSet.objects.get(execution=log), self.user)

        texts = set(UserMemory.objects.filter(user=self.user).values_list('text', flat=True))
        self.assertEqual(texts, {'Lives in Pune'})
        self.assertEqual(result['skipped'], 1, result)
        self.assertEqual(result['reverted'], 0, result)
        outcome = result['outcomes'][0]
        self.assertEqual(outcome['outcome'], 'skipped')
        self.assertIn('memory category is full', outcome['note'])
        change = Change.objects.get(change_set=ChangeSet.objects.get(execution=log))
        self.assertEqual(change.outcome, 'skipped')

    def test_a_removed_fact_comes_back_when_its_category_has_room(self):
        with mock.patch.object(UserMemory, 'MAX_PER_CATEGORY', 2):
            user_memory.remember(self.user, 'Works in IST', 'context')
            log = self.run_log()
            self.bound_to(log, lambda: _forget(self.user, 'Works in IST'))
            user_memory.remember(self.user, 'Lives in Pune', 'context')
            ExecutionLog.objects.filter(pk=log.pk).update(status='completed')

            result = undo.revert(ChangeSet.objects.get(execution=log), self.user)

        texts = set(UserMemory.objects.filter(user=self.user).values_list('text', flat=True))
        self.assertEqual(texts, {'Works in IST', 'Lives in Pune'})
        self.assertEqual(result['reverted'], 1, result)

    def test_a_repeat_of_a_stored_fact_is_a_touch_even_when_the_category_is_full(self):
        # `remember` on a repeat never inserts, so nothing is evicted and the
        # undo may put the fact back (it is already there, so it is a touch).
        with mock.patch.object(UserMemory, 'MAX_PER_CATEGORY', 1):
            user_memory.remember(self.user, 'Works in IST', 'context')
            self.assertTrue(user_memory.has_room(self.user, 'works in ist.', 'context'))
            self.assertFalse(user_memory.has_room(self.user, 'Lives in Pune', 'context'))


class LivenessIsRecheckedUnderTheLockTests(_Base):
    def test_a_run_that_starts_while_the_lock_is_taken_stops_the_revert(self):
        from inference import vfs

        scope = vfs.build_scope(self.user, vfs.FULL)
        log = self.run_log(status='completed')
        self.bound_to(log, lambda: vfs.write_file(scope, '/notes.md', 'from the run'),
                      tool='write_file')
        change_set = ChangeSet.objects.get(execution=log)
        before_status = change_set.status

        real_lock = undo._lock_tree

        def lock_then_start_a_run(tree, user):
            prior = real_lock(tree, user)
            # Between the first liveness check and the lock, the run restarts.
            ExecutionLog.objects.filter(pk=log.pk).update(status='running')
            return prior

        with mock.patch.object(undo, '_lock_tree', side_effect=lock_then_start_a_run):
            with self.assertRaises(undo.RevertRefused):
                undo.revert(change_set, self.user)

        change_set.refresh_from_db()
        self.assertEqual(change_set.status, before_status)
        self.assertNotEqual(change_set.status, 'reverting')
        self.assertEqual(Change.objects.get(change_set=change_set).outcome, '')
