"""
A turn that ends with no text is asked once more, then reported for what it was.

Every such turn used to be saved as "I wasn't able to produce an answer for
that. Please try rephrasing" — whether the model had run out of steps, had
returned an empty reply, or had only paused for an approval. Rephrasing fixes
none of the three. Drives the real graph with a stubbed model.
"""
from __future__ import annotations

import json
from unittest.mock import patch

from asgiref.sync import async_to_sync
from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase

from chat.turn import pipeline, prompts
from chat.turn.agent import TurnContext, TurnResult, run_turn


def _tool_call(index: int) -> dict:
    return {'type': 'tool_calls', 'tool_calls': [{
        'index': 0, 'id': f'call-{index}',
        'function': {'name': 'update_todos', 'arguments': json.dumps(
            {'todos': [{'text': f'step {index}', 'status': 'in_progress'}]})},
    }]}


class _Scripted:
    """Replies from a script, one entry per model call; records each prompt."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.prompts: list[str] = []
        self.tools: list[bool] = []

    def __call__(self, **kwargs):
        self.prompts.append(kwargs.get('prompt') or '')
        self.tools.append(bool(kwargs.get('tools')))
        index = len(self.prompts)
        reply = self.replies[min(index, len(self.replies)) - 1]

        async def chunks():
            if reply == 'TOOL':
                yield _tool_call(index)
            elif reply:
                yield {'type': 'content', 'content': reply}
            yield {'type': 'metadata', 'usage': {'total_tokens': 3}}

        return chunks()


async def _never(*_args, **_kwargs) -> bool:
    return False


async def _sink(*_args, **_kwargs) -> None:
    return None


class EmptyFinalReplyTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user('empty', 'empty@example.com', 'x')

    def run_with(self, model, thread: str, iterations: int = 6):
        turn = TurnContext(
            provider='stub', model='stub-model', system_message='test',
            user_id=self.user.id, session_id=thread, intent='chat', user_text='go',
            memory_enabled=False, max_iterations=iterations,
            approval_policy=_never, sink=_sink,
        )
        with patch('llm.access.stream', new=model):
            return async_to_sync(run_turn)(turn, prompt='go', thread_id=thread)

    def test_an_empty_reply_is_asked_once_more(self):
        model = _Scripted('', 'Here is the answer.')
        result = self.run_with(model, 'empty-retry')
        self.assertEqual(result.answer, 'Here is the answer.')
        self.assertEqual(result.empty_reason, '')
        self.assertEqual(model.prompts[1], prompts.ANSWER_AFTER_EMPTY)
        # The retry never offers tools: it exists to get text.
        self.assertFalse(model.tools[1])
        # Both calls are paid for, so both are counted.
        self.assertEqual(result.tokens, 6)

    def test_a_reply_that_stays_empty_says_so(self):
        model = _Scripted('')
        result = self.run_with(model, 'empty-twice')
        self.assertEqual(result.answer, '')
        self.assertEqual(result.empty_reason, 'empty')
        self.assertEqual(len(model.prompts), 2)  # one retry, not a loop

    def test_a_tool_call_at_the_step_limit_gets_a_last_answer(self):
        # Two passes: a tool call, then (tools withheld) another tool call,
        # which is dropped. The retry is what turns that into an answer.
        model = _Scripted('TOOL', 'TOOL', 'What I found so far.')
        result = self.run_with(model, 'empty-limit', iterations=2)
        self.assertEqual(result.answer, 'What I found so far.')
        self.assertEqual(result.empty_reason, '')

    def test_running_out_of_steps_is_reported_as_that(self):
        result = self.run_with(_Scripted('TOOL'), 'empty-limit-only', iterations=2)
        self.assertEqual(result.answer, '')
        self.assertEqual(result.empty_reason, 'limit')

    def test_a_normal_answer_is_not_asked_twice(self):
        model = _Scripted('Straight answer.')
        result = self.run_with(model, 'empty-normal')
        self.assertEqual(result.answer, 'Straight answer.')
        self.assertEqual(len(model.prompts), 1)


class FallbackWordingTests(SimpleTestCase):
    def test_each_reason_has_its_own_sentence(self):
        messages = pipeline._EMPTY_ANSWER_MESSAGES
        self.assertEqual(set(messages), {'limit', 'time', 'empty'})
        self.assertEqual(len(set(messages.values())), 3)

    def test_nothing_tells_the_user_to_rephrase(self):
        for text in (*pipeline._EMPTY_ANSWER_MESSAGES.values(),
                     pipeline._PAUSED_PLACEHOLDER):
            self.assertNotIn('rephras', text.lower())



class SavedMessageTests(TestCase):
    """What `_persist_answer` stores, which is what the user reads."""

    @classmethod
    def setUpTestData(cls):
        from chat.models import ChatSession

        cls.user = User.objects.create_user('saved', 'saved@example.com', 'x')
        cls.session = ChatSession.objects.create(user=cls.user, title='t')

    def save(self, **result):
        turn = TurnContext(
            provider='stub', model='stub-model', system_message='test',
            user_id=self.user.id, session_id=str(self.session.id), intent='chat',
            user_text='go', memory_enabled=False, max_iterations=3,
            approval_policy=_never, sink=_sink,
        )
        # Over the slow-turn mark, so no follow-up call is made.
        return async_to_sync(pipeline._persist_answer)(
            session=self.session, user=self.user, turn=turn,
            result=TurnResult(**result), question='go', intent='chat',
            elapsed_s=10_000,
        )

    def test_a_pause_is_not_called_a_failure(self):
        message = self.save(awaiting_approval=True)
        self.assertEqual(message.content, pipeline._PAUSED_PLACEHOLDER)

    def test_out_of_steps_is_what_the_user_is_told(self):
        message = self.save(empty_reason='limit')
        self.assertEqual(message.content, pipeline._EMPTY_ANSWER_MESSAGES['limit'])

    def test_a_real_answer_is_stored_as_written(self):
        self.assertEqual(self.save(answer='Done.').content, 'Done.')
