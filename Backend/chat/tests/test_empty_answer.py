"""
A turn that ends with no text is asked once more, then reported for what it was.

Every such turn used to be saved as "I wasn't able to produce an answer for
that. Please try rephrasing" — whether the model had run out of steps, had
returned an empty reply, or had only paused for an approval. Rephrasing fixes
none of the three. Drives the real graph with a scripted model (llm/testing.py).
"""
from __future__ import annotations

from asgiref.sync import async_to_sync
from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase

from chat.turn import pipeline, prompts
from chat.turn.agent import TurnContext, TurnResult, run_turn
from llm.testing import DEFAULT_MODEL, DEFAULT_PROVIDER, scripted_model, text, tool_call


def _plan(index: int):
    """A model asking to update its plan: one tool call, one plan step in progress."""
    return tool_call('update_todos', {'todos': [{'text': f'step {index}', 'status': 'in_progress'}]},
                     id=f'call-{index}')


async def _never(*_args, **_kwargs) -> bool:
    return False


async def _sink(*_args, **_kwargs) -> None:
    return None


class EmptyFinalReplyTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user('empty', 'empty@example.com', 'x')

    def run_with(self, steps, thread: str, iterations: int = 6):
        """Run one turn against a scripted model. Returns the result and the model."""
        turn = TurnContext(
            provider=DEFAULT_PROVIDER, model=DEFAULT_MODEL, system_message='test',
            user_id=self.user.id, session_id=thread, intent='chat', user_text='go',
            memory_enabled=False, max_iterations=iterations,
            approval_policy=_never, sink=_sink,
        )
        with scripted_model(steps) as model:
            result = async_to_sync(run_turn)(turn, prompt='go', thread_id=thread)
        return result, model

    def test_an_empty_reply_is_asked_once_more(self):
        result, model = self.run_with([text(''), text('Here is the answer.')], 'empty-retry')
        self.assertEqual(result.answer, 'Here is the answer.')
        self.assertEqual(result.empty_reason, '')
        self.assertEqual(model.requests[1].last_user_text(), prompts.ANSWER_AFTER_EMPTY)
        # The retry never offers tools: it exists to get text.
        self.assertFalse(model.requests[1].tools_offered)
        # Both calls are paid for, so both are counted.
        self.assertEqual(result.tokens, 6)

    def test_a_reply_that_stays_empty_says_so(self):
        result, model = self.run_with([text(''), text('')], 'empty-twice')
        self.assertEqual(result.answer, '')
        self.assertEqual(result.empty_reason, 'empty')
        self.assertEqual(len(model.requests), 2)  # one retry, not a loop

    def test_a_tool_call_at_the_step_limit_gets_a_last_answer(self):
        # Two passes: a tool call, then (tools withheld) another tool call,
        # which is dropped. The retry is what turns that into an answer.
        result, _ = self.run_with(
            [_plan(1), _plan(2), text('What I found so far.')], 'empty-limit', iterations=2)
        self.assertEqual(result.answer, 'What I found so far.')
        self.assertEqual(result.empty_reason, '')

    def test_running_out_of_steps_is_reported_as_that(self):
        # Every call asks for a tool, so the run never reaches an answer.
        result, _ = self.run_with([_plan(1), _plan(2), _plan(3)], 'empty-limit-only', iterations=2)
        self.assertEqual(result.answer, '')
        self.assertEqual(result.empty_reason, 'limit')

    def test_a_normal_answer_is_not_asked_twice(self):
        result, model = self.run_with([text('Straight answer.')], 'empty-normal')
        self.assertEqual(result.answer, 'Straight answer.')
        self.assertEqual(len(model.requests), 1)


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
