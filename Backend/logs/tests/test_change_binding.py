"""
The change-log binding and its sets (logs/changes.py, docs/UNDO_PLAN.md §6.2).

What these pin: with no binding nothing is recorded; a run owns one set per
execution and reuses it; a chat message owns one open set, and once that set
is closed a second one may open; the binding reaches a `sync_to_async` call and
its counter moves there; recording never raises; and the retention purge and
the tree summary count what they should.
"""
from __future__ import annotations

import uuid
from contextlib import contextmanager
from datetime import timedelta
from unittest import mock

from asgiref.sync import async_to_sync, sync_to_async
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from chat.models import ChatMessage, ChatSession
from logs import changes
from logs.models import Change, ChangeSet, ExecutionLog

User = get_user_model()


@contextmanager
def bound(binding):
    token = changes.bind(binding)
    try:
        yield binding
    finally:
        changes.unbind(token)


class BindingCase(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user('owner', 'owner@example.com', 'pw')
        self.run = ExecutionLog.objects.create(
            user=self.user, status='running', trigger_type='manual', caller='api',
            started_at=timezone.now(),
        )
        self.session = ChatSession.objects.create(user=self.user, title='work')
        self.message = ChatMessage.objects.create(
            session=self.session, role='user', content='write it', message_type='chat')

    def run_binding(self, parent=None):
        return changes.Binding(user_id=self.user.id, owner_kind='run',
                               execution_id=str(self.run.execution_id),
                               parent_set_id=parent, tool='write_file', call_id='c1')

    def chat_binding(self):
        return changes.Binding(user_id=self.user.id, owner_kind='chat',
                               chat_message_id=self.message.id, tool='write_file',
                               call_id='c1')


class NoBindingTests(BindingCase):
    def test_no_binding_means_no_set_and_no_rows(self):
        self.assertIsNone(changes.current())
        self.assertIsNone(changes.current_set_id(create=True))
        changes.record_untracked(label='x', external=False, effect='irreversible')
        self.assertEqual(ChangeSet.objects.count(), 0)
        self.assertEqual(Change.objects.count(), 0)

    def test_a_none_binding_records_nothing(self):
        # D18: a child run that binds None must not write into a parent's set.
        with bound(None):
            self.assertIsNone(changes.current_set_id(create=True))
            changes.record_untracked(label='x', external=False, effect='irreversible')
        self.assertEqual(Change.objects.count(), 0)

    def test_unbind_restores_the_outer_binding(self):
        outer = self.chat_binding()
        with bound(outer):
            with bound(None):
                self.assertIsNone(changes.current())
            self.assertIs(changes.current(), outer)
        self.assertIsNone(changes.current())


class RunSetTests(BindingCase):
    def test_a_run_owns_one_set_and_reuses_it(self):
        with bound(self.run_binding()) as b:
            first = changes.current_set_id(create=True)
            b.set_id = None  # a second call, as a second tool call would be
            second = changes.current_set_id(create=True)
        self.assertIsNotNone(first)
        self.assertEqual(first, second)
        found = ChangeSet.objects.get(pk=first)
        self.assertEqual(found.owner_kind, 'run')
        self.assertEqual(found.execution_id, self.run.pk)
        self.assertEqual(found.status, 'closed')
        self.assertEqual(ChangeSet.objects.filter(execution=self.run).count(), 1)

    def test_the_parent_set_is_stored_on_the_child(self):
        parent = ChangeSet.objects.create(user=self.user, owner_kind='chat',
                                          chat_message=self.message, status='closed')
        with bound(self.run_binding(parent=parent.pk)):
            child = changes.current_set_id(create=True)
        self.assertEqual(ChangeSet.objects.get(pk=child).parent_id, parent.pk)

    def test_a_run_with_no_log_row_has_no_set(self):
        ghost = changes.Binding(user_id=self.user.id, owner_kind='run',
                                execution_id=str(uuid.uuid4()), tool='write_file')
        with bound(ghost):
            self.assertIsNone(changes.current_set_id(create=True))
        self.assertEqual(ChangeSet.objects.count(), 0)

    def test_looking_without_creating_makes_no_set(self):
        with bound(self.run_binding()):
            self.assertIsNone(changes.current_set_id(create=False))
        self.assertEqual(ChangeSet.objects.count(), 0)


class ChatSetTests(BindingCase):
    def test_one_open_set_per_message(self):
        with bound(self.chat_binding()):
            first = changes.current_set_id(create=True)
        with bound(self.chat_binding()):
            second = changes.current_set_id(create=True)
        self.assertEqual(first, second)
        self.assertEqual(ChangeSet.objects.filter(chat_message=self.message).count(), 1)

    def test_a_second_open_set_is_allowed_once_the_first_is_closed(self):
        with bound(self.chat_binding()):
            first = changes.current_set_id(create=True)
        ChangeSet.objects.filter(pk=first).update(status='closed')
        with bound(self.chat_binding()):
            second = changes.current_set_id(create=True)
        self.assertNotEqual(first, second)
        self.assertEqual(ChangeSet.objects.get(pk=second).status, 'open')

    def test_a_chat_set_is_owned_by_the_user(self):
        with bound(self.chat_binding()):
            set_id = changes.current_set_id(create=True)
        self.assertEqual(ChangeSet.objects.get(pk=set_id).user_id, self.user.id)


class SyncToAsyncTests(BindingCase):
    def test_the_binding_is_visible_inside_sync_to_async(self):
        binding = self.run_binding()

        async def inside_the_loop():
            with bound(binding):
                seen = await sync_to_async(changes.current)()
                # The counter is a shared object, so a sync call moves it for us.
                await sync_to_async(changes.record_untracked)(
                    label='from a thread', external=False, effect='irreversible')
                set_id = await changes.acurrent_set_id(create=True)
            return seen is binding, binding.recorded, set_id

        # The ORM is read outside the event loop, where Django allows it.
        same, recorded, set_id = async_to_sync(inside_the_loop)()
        self.assertTrue(same)
        self.assertEqual(recorded, 1)
        self.assertEqual(Change.objects.filter(change_set_id=set_id).count(), 1)


class NeverRaisesTests(BindingCase):
    def test_a_failing_write_is_logged_and_marks_the_set_incomplete(self):
        with bound(self.chat_binding()) as b:
            with mock.patch('logs.changes._touch', side_effect=RuntimeError('db gone')):
                changes.record_untracked(label='x', external=False, effect='irreversible')
                set_id = b.set_id
        self.assertIsNotNone(set_id)
        self.assertTrue(ChangeSet.objects.get(pk=set_id).incomplete)
        # The failed row was inside the savepoint, so nothing half-written is left.
        self.assertEqual(Change.objects.filter(change_set_id=set_id).count(), 0)

    def test_a_failing_state_read_does_not_raise(self):
        with bound(self.chat_binding()):
            with mock.patch('logs.changes._document_now', side_effect=RuntimeError('boom')):
                changes.record_document(123, before=None, content=True, label='/a.md')
        self.assertEqual(Change.objects.count(), 0)


class SummaryAndCloseTests(BindingCase):
    def test_summary_counts_the_whole_tree(self):
        parent = ChangeSet.objects.create(user=self.user, owner_kind='chat',
                                          chat_message=self.message, status='closed')
        child = ChangeSet.objects.create(user=self.user, owner_kind='run',
                                         execution=self.run, parent=parent, status='closed',
                                         incomplete=True)
        Change.objects.create(change_set=parent, seq=1, target_type='document', target_id=1,
                              tool='write_file', label='/a.md', revertible=True)
        Change.objects.create(change_set=child, seq=1, target_type='', tool='send_email',
                              label='Send email', revertible=False)
        counted = changes.summary(parent)
        self.assertEqual(counted['total'], 2)
        self.assertEqual(counted['revertible'], 1)
        self.assertEqual(counted['not_revertible'], 1)
        self.assertTrue(counted['incomplete'])

    def test_close_chat_returns_the_summary_once(self):
        with bound(self.chat_binding()):
            changes.record_untracked(label='Send: a', external=True, effect='irreversible')
        result = changes.close_chat(self.user.id, self.message.id)
        self.assertEqual(result['total'], 1)
        self.assertEqual(result['not_revertible'], 1)
        self.assertEqual(ChangeSet.objects.get(chat_message=self.message).status, 'closed')
        self.assertIsNone(changes.close_chat(self.user.id, self.message.id))

    def test_close_chat_with_no_changes_returns_none(self):
        with bound(self.chat_binding()):
            changes.current_set_id(create=True)
        self.assertIsNone(changes.close_chat(self.user.id, self.message.id))


@override_settings(CHANGE_HISTORY_DAYS=30)
class PurgeTests(BindingCase):
    def test_sets_past_the_history_window_go_and_take_their_changes(self):
        old = ChangeSet.objects.create(user=self.user, owner_kind='chat',
                                       chat_message=self.message, status='closed')
        Change.objects.create(change_set=old, seq=1, target_type='', tool='t',
                              label='old', revertible=False)
        ChangeSet.objects.filter(pk=old.pk).update(
            created_at=timezone.now() - timedelta(days=40))
        recent = ChangeSet.objects.create(user=self.user, owner_kind='run',
                                          execution=self.run, status='closed')
        self.assertEqual(changes.purge_old_sets(), 1)
        self.assertFalse(ChangeSet.objects.filter(pk=old.pk).exists())
        self.assertFalse(Change.objects.filter(label='old').exists())
        self.assertTrue(ChangeSet.objects.filter(pk=recent.pk).exists())
