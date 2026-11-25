"""
Undo across the delegation boundary (docs/UNDO_PLAN.md D7, §7 Phase 5).

A chat turn delegates; the worker writes. Undoing the chat answer must put
back the worker's file, and must refuse while the worker is still running,
naming it. These join Phase 5's linking to Phase 4's engine, which were built
on separate branches and only meet here.
"""
from __future__ import annotations

import shutil
import tempfile

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from agents.models import SubAgent
from chat.models import ChatMessage, ChatSession
from inference import vfs
from inference.models import Document
from logs import changes, undo
from logs.models import ChangeSet, ExecutionLog

User = get_user_model()
_MEDIA = tempfile.mkdtemp(prefix='undo-tree-')


@override_settings(MEDIA_ROOT=_MEDIA)
class ChatUndoReachesWorkersTests(TestCase):
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
            session=session, role='user', content='write the report', message_type='chat')
        self.worker = SubAgent.objects.create(
            user=self.user, name='Researcher', prompt='Research.', tool_grants={},
            guardrails={}, llm_provider='openrouter', llm_model='stub/model')

    def _bound(self, **owner):
        return changes.bind(changes.Binding(user_id=self.user.id, tool='run_agent',
                                            call_id='c1', **owner))

    def _delegate_and_write(self, run_status):
        # The chat's delegating call takes its own set id (as the tools do)...
        token = self._bound(owner_kind='chat', chat_message_id=self.message.id)
        try:
            chat_set_id = changes.current_set_id(create=True)
        finally:
            changes.unbind(token)
        # ...and the worker run, started with that id as its parent, writes.
        log = ExecutionLog.objects.create(
            user=self.user, subagent=self.worker, status='running',
            trigger_type='manual', caller='api', started_at=timezone.now())
        token = self._bound(owner_kind='run', execution_id=str(log.execution_id),
                            parent_set_id=chat_set_id)
        try:
            vfs.write_file(self.scope, '/report.md', 'draft')
        finally:
            changes.unbind(token)
        ExecutionLog.objects.filter(pk=log.pk).update(status=run_status)
        summary = changes.close_chat(self.user.id, self.message.id)
        return ChangeSet.objects.get(pk=chat_set_id), summary

    def test_undoing_the_chat_answer_puts_back_the_workers_file(self):
        chat_set, summary = self._delegate_and_write('completed')
        self.assertEqual(summary['total'], 1)

        result = undo.revert(chat_set, self.user)

        self.assertEqual(result['reverted'], 1)
        doc = Document.all_objects.get(user=self.user, name='report.md')
        self.assertIsNotNone(doc.deleted_at)

    def test_undo_is_refused_while_the_worker_runs_and_names_it(self):
        chat_set, _ = self._delegate_and_write('running')

        with self.assertRaises(undo.RevertRefused) as ctx:
            undo.revert(chat_set, self.user)

        self.assertIn('Researcher', str(ctx.exception))
        doc = Document.all_objects.get(user=self.user, name='report.md')
        self.assertIsNone(doc.deleted_at)
