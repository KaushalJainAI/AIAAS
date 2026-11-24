"""
A chat message's change set closes when its turn ends, and the final assistant
message carries the count (docs/UNDO_PLAN.md §6.7, Phase 5).

What these pin: `logs/changes.py::close_chat` closes the message's open set and
returns a summary over the whole tree (the set and its workers), or None when
nothing in the tree changed; an approval pause leaves the set open, and the
resumed turn records into that same set; the final assistant message gets
`metadata['changes']` only when the turn changed something; and the stop route
closes the set too.

The turn tests drive `run_chat_turn` the way `chat/tests/test_pipeline.py` does,
with the provider faked at the boundary. The tool that changes something is a
stub that records one untracked change through the live binding, so the real
dispatch path (`_dispatch_one` binds the chat owner around each call) runs.
"""
from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

from asgiref.sync import async_to_sync, sync_to_async
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase

from chat.models import ChatMessage, ChatSession
from chat.tests.test_pipeline import Recorder, text_stream, tool_then_answer
from chat.turn import pipeline
from chat.turn.agent import TurnResult
from chat.turn.pipeline import TurnRequest, run_chat_turn
from logs import changes
from logs.models import Change, ChangeSet, ExecutionLog
from django.utils import timezone

User = get_user_model()

SUMMARY_KEYS = {'set_id', 'total', 'revertible', 'not_revertible', 'incomplete'}


def _bound(binding):
    return changes.bind(binding)


class ChangeCase(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user('owner', 'owner@example.com', 'pw')
        self.session = ChatSession.objects.create(user=self.user, title='work')
        self.message = ChatMessage.objects.create(
            session=self.session, role='user', content='go', message_type='chat')

    def chat_binding(self, message_id=None):
        return changes.Binding(user_id=self.user.id, owner_kind='chat',
                               chat_message_id=message_id or self.message.id,
                               tool='write_file', call_id='c1')

    def record_one(self, message_id=None, label='Changed a thing'):
        """Record one untracked change in the message's open set, as a tool call would."""
        token = _bound(self.chat_binding(message_id))
        try:
            changes.record_untracked(label=label, external=False, effect='reversible')
        finally:
            changes.unbind(token)

    def open_set(self):
        return ChangeSet.objects.filter(chat_message=self.message, status='open').first()

    def add_worker_change(self, parent, *, revertible=True):
        """A worker's set under `parent`, holding one change of its own."""
        log = ExecutionLog.objects.create(
            user=self.user, status='completed', trigger_type='api', caller='chat',
            started_at=timezone.now(), completed_at=timezone.now())
        child = ChangeSet.objects.create(user=self.user, owner_kind='run', execution=log,
                                         parent=parent, status='closed')
        Change.objects.create(
            change_set=child, seq=1,
            target_type='document' if revertible else '', target_id=None,
            tool='write_file', call_id='c2', label='Wrote a worker file',
            revertible=revertible, reason='' if revertible else 'Not tracked here')
        return child


class CloseChatTests(ChangeCase):
    def test_close_closes_the_open_set_and_counts_its_worker(self):
        self.record_one()  # the chat set now exists and is open
        parent = self.open_set()
        self.add_worker_change(parent, revertible=True)

        summary = changes.close_chat(self.user.id, self.message.id)

        self.assertEqual(set(summary), SUMMARY_KEYS)
        self.assertEqual(summary['set_id'], parent.pk)
        # One from the chat set itself, one from the worker below it.
        self.assertEqual(summary['total'], 2)
        self.assertEqual(summary['revertible'], 1)
        self.assertEqual(summary['not_revertible'], 1)
        self.assertFalse(summary['incomplete'])
        parent.refresh_from_db()
        self.assertEqual(parent.status, 'closed')
        self.assertIsNotNone(parent.closed_at)

    def test_a_worker_change_alone_is_counted_for_the_chat(self):
        # The chat's own set has no change; only the worker below it does.
        self.record_one()
        parent = self.open_set()
        Change.objects.filter(change_set=parent).delete()
        self.add_worker_change(parent, revertible=True)

        summary = changes.close_chat(self.user.id, self.message.id)

        self.assertEqual(summary['total'], 1)
        self.assertEqual(summary['set_id'], parent.pk)

    def test_an_empty_tree_returns_none_and_still_closes(self):
        ChangeSet.objects.create(user=self.user, owner_kind='chat',
                                 chat_message=self.message, status='open')

        self.assertIsNone(changes.close_chat(self.user.id, self.message.id))
        self.assertFalse(ChangeSet.objects.filter(chat_message=self.message,
                                                  status='open').exists())

    def test_no_open_set_returns_none(self):
        self.assertIsNone(changes.close_chat(self.user.id, self.message.id))

    def test_a_second_close_finds_nothing_to_close(self):
        self.record_one()
        self.assertIsNotNone(changes.close_chat(self.user.id, self.message.id))
        self.assertIsNone(changes.close_chat(self.user.id, self.message.id))

    def test_another_users_message_is_not_closed(self):
        self.record_one()
        other = User.objects.create_user('other', 'other@example.com', 'pw')
        self.assertIsNone(changes.close_chat(other.id, self.message.id))
        self.assertIsNotNone(self.open_set())


class ApprovalPauseTests(ChangeCase):
    def turn(self):
        return SimpleNamespace(provider='openrouter', model='stub/model',
                               user_id=self.user.id)

    def persist(self, *, awaiting_approval: bool, answer: str = 'done'):
        result = TurnResult(answer=answer, awaiting_approval=awaiting_approval)
        return async_to_sync(pipeline._persist_answer)(
            session=self.session, user=self.user, chat_message_id=self.message.id,
            turn=self.turn(), result=result, question='go', intent='chat')

    def test_a_pause_leaves_the_set_open_and_the_resumed_turn_records_into_it(self):
        self.record_one(label='Before the pause')
        paused_set = self.open_set()

        paused = self.persist(awaiting_approval=True, answer='')

        self.assertEqual(self.open_set().pk, paused_set.pk)
        self.assertNotIn('changes', paused.metadata)

        # The approval resumes the same user message: the same binding, the same set.
        self.record_one(label='After the approval')
        resumed = self.persist(awaiting_approval=False)

        self.assertEqual(ChangeSet.objects.filter(chat_message=self.message).count(), 1)
        self.assertEqual(resumed.metadata['changes']['set_id'], paused_set.pk)
        self.assertEqual(resumed.metadata['changes']['total'], 2)
        self.assertEqual(Change.objects.filter(change_set=paused_set).count(), 2)


class StoppedTurnTests(ChangeCase):
    def test_a_stopped_turn_closes_its_set_and_flags_its_partial_answer(self):
        self.record_one()

        partial = async_to_sync(pipeline.persist_interrupted_answer)(
            self.session, self.user, 'Half of the answer')

        self.assertEqual(partial.metadata['changes']['total'], 1)
        self.assertTrue(partial.metadata['interrupted'])
        self.assertIsNone(self.open_set())

    def test_a_stop_with_no_text_still_closes_the_set(self):
        self.record_one()

        self.assertIsNone(async_to_sync(pipeline.persist_interrupted_answer)(
            self.session, self.user, '   '))
        self.assertIsNone(self.open_set())


class FinalMessageTests(ChangeCase):
    """The final assistant message, from a real `run_chat_turn`."""

    def setUp(self):
        super().setUp()
        self.chat = ChatSession.objects.create(user=self.user, title='Test')
        self._patch('chat.turn.agent.suggest_follow_ups', self._no_follow_ups)
        self._patch('chat.tools.get_available_tools', self._builtin_tools)
        self._patch('chat.sources.search.image_search', self._no_media)
        self._patch('chat.sources.search.video_search', self._no_media)

    def _patch(self, target, replacement):
        patcher = patch(target, replacement)
        patcher.start()
        self.addCleanup(patcher.stop)

    @staticmethod
    async def _no_follow_ups(*_args, **_kwargs) -> list[str]:
        return []

    @staticmethod
    async def _no_media(*_args, **_kwargs) -> list[dict]:
        return []

    @staticmethod
    async def _builtin_tools(*_args, **_kwargs) -> list[dict]:
        from chat.tools import AVAILABLE_TOOLS

        return list(AVAILABLE_TOOLS)

    def _run(self, content: str, *, stream) -> Any:
        with patch('llm.access.stream', stream):
            return async_to_sync(run_chat_turn)(
                session=self.chat, user=self.user,
                request=TurnRequest.parse({'content': content}), sink=Recorder())

    def test_a_turn_that_changed_something_says_so_on_its_answer(self):
        async def changing_tool(name, args, context) -> str:
            await sync_to_async(changes.record_untracked)(
                label='Changed a thing', external=False, effect='reversible')
            return json.dumps({'ok': True})

        with patch('chat.tools.execute_tool', changing_tool):
            outcome = self._run('change it', stream=tool_then_answer(
                'web_search', {'query': 'q'}, 'Changed it.'))

        metadata = outcome.assistant_message.metadata
        self.assertEqual(metadata['changes']['total'], 1)
        self.assertEqual(metadata['changes']['not_revertible'], 1)
        self.assertFalse(metadata['changes']['incomplete'])
        # The set is closed now, as the turn ended.
        self.assertFalse(ChangeSet.objects.filter(
            chat_message_id=outcome.user_message.id, status='open').exists())

    def test_a_turn_that_changed_nothing_has_no_changes_key(self):
        with patch('chat.tools.execute_tool', self._inert_tool):
            outcome = self._run('hello', stream=text_stream('Hi there.'))

        self.assertNotIn('changes', outcome.assistant_message.metadata)

    @staticmethod
    async def _inert_tool(name, args, context) -> str:
        return json.dumps({'type': 'search_results', 'text': '', 'sources': []})
