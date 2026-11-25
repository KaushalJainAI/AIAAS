"""
The fixes from the final review of the undo branch (2026-11-25).

Each test names the failure it pins: a lead and its worker editing one file,
two reverts of one tree at once, a fact a full category pushed out, a chat set
written after it closed, a created agent, a held send, and the purge.
"""
from __future__ import annotations

import shutil
import tempfile
from datetime import timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from agents.models import SubAgent
from chat.models import ChatMessage, ChatSession
from inference import vfs
from inference.models import Document
from logs import changes, undo
from logs.models import Change, ChangeSet, ExecutionLog

User = get_user_model()
_MEDIA = tempfile.mkdtemp(prefix='undo-fixes-')


@override_settings(MEDIA_ROOT=_MEDIA)
class FixCase(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(_MEDIA, ignore_errors=True)

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user('lead', 'lead@example.test', 'pw')
        self.scope = vfs.build_scope(self.user, vfs.FULL)
        session = ChatSession.objects.create(user=self.user, title='work')
        self.message = ChatMessage.objects.create(
            session=session, role='user', content='go', message_type='chat')
        self.worker = SubAgent.objects.create(
            user=self.user, name='Researcher', prompt='Research.', tool_grants={},
            guardrails={}, llm_provider='openrouter', llm_model='stub/model')

    def as_chat(self, fn, tool='write_file'):
        token = changes.bind(changes.Binding(
            user_id=self.user.id, owner_kind='chat', chat_message_id=self.message.id,
            tool=tool, call_id='c-chat'))
        try:
            return fn()
        finally:
            changes.unbind(token)

    def new_worker_run(self, parent_set_id):
        return ExecutionLog.objects.create(
            user=self.user, subagent=self.worker, status='running',
            trigger_type='manual', caller='api', started_at=timezone.now())

    def as_worker(self, log, parent_set_id, fn):
        token = changes.bind(changes.Binding(
            user_id=self.user.id, owner_kind='run', execution_id=str(log.execution_id),
            parent_set_id=parent_set_id, tool='edit_file', call_id='c-worker'))
        try:
            return fn()
        finally:
            changes.unbind(token)

    def doc(self, name):
        return Document.all_objects.get(user=self.user, name=name)

    def tick(self, name):
        # The Windows clock ticks ~15.6 ms; make each write's etag distinct.
        Document.all_objects.filter(user=self.user, name=name).update(
            updated_at=timezone.now() + timedelta(seconds=1))


class LeadAndWorkerShareAFileTests(FixCase):
    def _lead_then_worker(self, *, third_party_edit=False):
        vfs.write_file(self.scope, '/report.md', 'original')
        self.as_chat(lambda: vfs.write_file(self.scope, '/report.md', 'lead draft'))
        chat_set_id = self.as_chat(lambda: changes.current_set_id(create=True))
        if third_party_edit:
            from inference.office_edit import save_text
            save_text(self.doc('report.md'), 'user edit in between', version_source='app')
            # Time passes: on this clock the edit could share the lead's tick.
            self.tick('report.md')
        # No tick here: moving the etag between the lead and the worker would
        # itself be an edit in between, which the hand-off rightly refuses.
        log = self.new_worker_run(chat_set_id)
        self.as_worker(log, chat_set_id, lambda: vfs.write_file(
            self.scope, '/report.md', 'worker final'))
        ExecutionLog.objects.filter(pk=log.pk).update(status='completed')
        changes.close_chat(self.user.id, self.message.id)
        return ChangeSet.objects.get(pk=chat_set_id)

    def test_undoing_the_chat_puts_back_the_text_from_before_the_lead(self):
        # The worker's row is undone first and moves the etag; the lead's row
        # must still be undone, not skipped as "changed since".
        chat_set = self._lead_then_worker()
        result = undo.revert(chat_set, self.user)
        self.assertEqual(result['reverted'], 2, result)
        self.assertEqual(self.doc('report.md').content_text, 'original')

    def test_an_edit_between_the_lead_and_the_worker_is_never_overwritten(self):
        chat_set = self._lead_then_worker(third_party_edit=True)
        result = undo.revert(chat_set, self.user)
        # The worker's own row goes back to the user's edit; the lead's row
        # would overwrite that edit, so it is skipped.
        self.assertEqual(result['reverted'], 1, result)
        self.assertEqual(result['skipped'], 1, result)
        self.assertEqual(self.doc('report.md').content_text, 'user edit in between')


class TreeLockTests(FixCase):
    def test_a_worker_cannot_be_reverted_while_its_parent_revert_holds_the_tree(self):
        vfs.write_file(self.scope, '/a.md', 'v0')
        chat_set_id = self.as_chat(lambda: changes.current_set_id(create=True))
        log = self.new_worker_run(chat_set_id)
        self.as_worker(log, chat_set_id, lambda: vfs.write_file(self.scope, '/a.md', 'v1'))
        ExecutionLog.objects.filter(pk=log.pk).update(status='completed')
        changes.close_chat(self.user.id, self.message.id)
        chat_set = ChangeSet.objects.get(pk=chat_set_id)
        worker_set = ChangeSet.objects.get(execution=log)

        undo._lock_tree(undo._load_tree(chat_set), self.user)  # the parent's revert, mid-walk

        with self.assertRaises(undo.RevertRefused):
            undo.revert(worker_set, self.user)

    def test_sets_the_revert_did_not_touch_get_their_status_back(self):
        chat_set_id = self.as_chat(lambda: changes.current_set_id(create=True))
        self.as_chat(lambda: vfs.write_file(self.scope, '/a.md', 'x'))
        log = self.new_worker_run(chat_set_id)
        self.as_worker(log, chat_set_id, lambda: vfs.write_file(self.scope, '/b.md', 'y'))
        ExecutionLog.objects.filter(pk=log.pk).update(status='completed')
        changes.close_chat(self.user.id, self.message.id)
        chat_set = ChangeSet.objects.get(pk=chat_set_id)
        only_lead = Change.objects.filter(change_set=chat_set, target_type='document')
        undo.revert(chat_set, self.user, change_ids=list(only_lead.values_list('pk', flat=True)))
        self.assertEqual(ChangeSet.objects.get(execution=log).status, 'closed')


class MemoryEvictionTests(FixCase):
    def test_a_fact_pushed_out_by_a_full_category_comes_back_on_undo(self):
        from chat.tools.memory import _remember
        from core import memory as user_memory
        from core.models import UserMemory

        with mock.patch.object(UserMemory, 'MAX_PER_CATEGORY', 1):
            user_memory.remember(self.user, 'Works in IST', 'context')
            # Older, so the cap (least recently saved first) picks it, not the
            # new fact the same clock tick would otherwise tie with.
            UserMemory.objects.filter(text='Works in IST').update(
                updated_at=timezone.now() - timedelta(days=1))
            log = ExecutionLog.objects.create(
                user=self.user, status='running', trigger_type='manual', caller='api',
                started_at=timezone.now())
            token = changes.bind(changes.Binding(
                user_id=self.user.id, owner_kind='run', execution_id=str(log.execution_id),
                tool='remember_about_user', call_id='c1'))
            try:
                _remember(self.user, 'Prefers short answers', 'context')
            finally:
                changes.unbind(token)
            self.assertFalse(UserMemory.objects.filter(text='Works in IST').exists())
            ExecutionLog.objects.filter(pk=log.pk).update(status='completed')

            undo.revert(ChangeSet.objects.get(execution=log), self.user)

        texts = set(UserMemory.objects.filter(user=self.user).values_list('text', flat=True))
        self.assertIn('Works in IST', texts)
        self.assertNotIn('Prefers short answers', texts)


class ChatSetReopenTests(FixCase):
    def test_a_write_after_the_set_closed_lands_in_the_same_set(self):
        self.as_chat(lambda: vfs.write_file(self.scope, '/a.md', 'x'))
        first = self.as_chat(lambda: changes.current_set_id(create=False))
        changes.close_chat(self.user.id, self.message.id)

        self.as_chat(lambda: vfs.write_file(self.scope, '/b.md', 'y'))

        self.assertEqual(ChangeSet.objects.filter(chat_message=self.message).count(), 1)
        self.assertEqual(Change.objects.filter(change_set_id=first).count(), 2)


class CreatedAgentTests(FixCase):
    def test_a_created_agent_is_listed_but_not_offered(self):
        log = ExecutionLog.objects.create(
            user=self.user, status='running', trigger_type='manual', caller='api',
            started_at=timezone.now())
        token = changes.bind(changes.Binding(
            user_id=self.user.id, owner_kind='run', execution_id=str(log.execution_id),
            tool='create_agent', call_id='c1'))
        try:
            changes.record_agent(self.worker.id, before=None, after={'revision': 1},
                                 label='Agent settings: Researcher',
                                 not_revertible_reason=undo.NOTE_AGENT_CREATED)
        finally:
            changes.unbind(token)
        row = Change.objects.get(target_type='agent')
        self.assertFalse(row.revertible)
        self.assertEqual(row.reason, undo.NOTE_AGENT_CREATED)
        ExecutionLog.objects.filter(pk=log.pk).update(status='completed')
        result = undo.revert(ChangeSet.objects.get(execution=log), self.user)
        self.assertEqual(result['status'], 'reverted')


class HeldSendTests(FixCase):
    def test_a_held_send_is_described_as_waiting_not_gone(self):
        from chat.turn.agent import _is_queued_send

        self.assertTrue(_is_queued_send('{"queued": true, "hold_id": 3}'))
        self.assertFalse(_is_queued_send('{"sent": true}'))
        self.assertFalse(_is_queued_send('Error: nope'))
        self.as_chat(lambda: changes.record_untracked(
            label='Send email: sam@example.com', external=True, effect='irreversible',
            reason='Waiting to send; cancel it from the send bar.'), tool='gmail_send_message')
        row = Change.objects.get(target_type='')
        self.assertIn('Waiting to send', row.reason)


class PurgeTreeTests(FixCase):
    @override_settings(CHANGE_HISTORY_DAYS=30)
    def test_a_tree_is_purged_whole_and_a_tree_mid_revert_is_kept(self):
        old = timezone.now() - timedelta(days=40)
        parent = ChangeSet.objects.create(user=self.user, owner_kind='chat', status='closed')
        child = ChangeSet.objects.create(user=self.user, owner_kind='run', status='closed',
                                         parent=parent)
        busy = ChangeSet.objects.create(user=self.user, owner_kind='run', status='reverting')
        ChangeSet.objects.filter(pk__in=[parent.pk, busy.pk]).update(created_at=old)
        # The child is younger than the cutoff, yet goes with its parent.
        ChangeSet.objects.filter(pk=child.pk).update(created_at=timezone.now())

        changes.purge_old_sets()

        self.assertFalse(ChangeSet.objects.filter(pk__in=[parent.pk, child.pk]).exists())
        self.assertTrue(ChangeSet.objects.filter(pk=busy.pk).exists())
