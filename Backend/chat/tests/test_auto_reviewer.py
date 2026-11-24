"""
The `auto` reviewer, as it actually runs (2026-09-24).

Every test in `test_auto_mode.py` swaps `_model_judge` for a fake, and that is
how `import llm; llm.complete(...)` — an `AttributeError` on every call, since
the funnel is `llm.access` — shipped: the judge never ran once in production,
`review` read the exception as "reviewer unavailable", and `auto` asked about
everything. These tests pin the real wiring and the four fixes that followed:

- the judge resolves through `llm.access.complete`, on the configured
  reviewer model rather than the chat's;
- a verdict is reached once per call, so a resumed batch is not re-judged;
- gates are decided concurrently, and an approved call is never re-gated;
- the reviewer reads recent user messages and the live plan, and says it is
  reviewing while it does.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import patch

from asgiref.sync import async_to_sync
from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import SimpleTestCase, TestCase, override_settings
from langchain_core.messages import AIMessage

from chat.turn import reviewer
from chat.turn.agent import TurnContext, tools_node
from chat.turn.pipeline import REVIEWER_RECENT_USER_MESSAGES, reviewer_text
from chat.turn.reviewer import auto_policy
from llm.testing import fail, provider_error, scripted_model, text


@override_settings(AUTO_REVIEWER_PROVIDER='openrouter',
                   AUTO_REVIEWER_MODEL='meta-llama/llama-4-scout')
class RealJudgeWiringTests(TestCase):
    """No fake judge and no fake `complete`: the model is scripted at the wire,
    so `_model_judge`, `llm.access` and the provider handler all run. A judge
    that called a missing function (the 2026-09-24 bug) fails here."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user('reviewed', password='pw')

    def judge(self, **kwargs):
        params = dict(described='Write notes.md', user_text='save notes.md',
                      todos=(), user_id=self.user.id, provider='openrouter',
                      model='openrouter/free')
        params.update(kwargs)
        return async_to_sync(reviewer._model_judge)(**params)

    def test_the_judge_calls_the_real_funnel_on_the_reviewer_model(self):
        with scripted_model(text('ALLOW it matches')) as model:
            allow, reason = self.judge()
        self.assertTrue(allow)
        self.assertEqual(reason, 'it matches')
        request = model.requests[0]
        self.assertEqual((request.provider, request.model),
                         ('openrouter', 'meta-llama/llama-4-scout'))
        self.assertFalse(request.stream)
        self.assertFalse(request.tools_offered)
        self.assertIn('Write notes.md', request.last_user_text())
        self.assertIn('approval reviewer', request.system_text())

    @override_settings(AUTO_REVIEWER_PROVIDER='openrouter', AUTO_REVIEWER_MODEL='')
    def test_a_blank_model_falls_back_to_the_chats_whole_pair(self):
        with scripted_model(text('ASK unsure'), provider='openai') as model:
            allow, _ = self.judge(provider='openai', model='gpt-x')
        self.assertFalse(allow)
        # Never the configured provider with the chat's model: that pair names
        # a model the provider does not serve.
        self.assertEqual((model.requests[0].provider, model.requests[0].model),
                         ('openai', 'gpt-x'))

    def _review(self):
        return async_to_sync(reviewer.review)(
            tool_name='write_file', args={'path': 'notes.md'},
            described='Write notes.md', user_text='save notes.md',
            user_id=self.user.id)

    def test_review_reaches_a_verdict_through_the_real_judge(self):
        with scripted_model(text('ALLOW yes')):
            out = self._review()
        self.assertEqual((out['allow'], out['reviewed_by']), (True, 'model'))

    def test_a_provider_error_is_an_ask_never_an_allow(self):
        with scripted_model(provider_error(503, 'overloaded')):
            out = self._review()
        self.assertEqual((out['allow'], out['reason']),
                         (False, 'The reviewer was unavailable.'))

    def test_a_dropped_connection_is_an_ask_too(self):
        with scripted_model(fail(ConnectionResetError('peer closed'))):
            out = self._review()
        self.assertFalse(out['allow'])


@override_settings(AUTO_REVIEWER_PROVIDER='openrouter',
                   AUTO_REVIEWER_MODEL='meta-llama/llama-4-scout')
class VerdictCacheTests(TestCase):
    """The verdict cache, with the real judge behind it: each model request
    the script answers is one judgement."""

    def setUp(self):
        cache.clear()
        reviewer._verdicts.clear()
        self.addCleanup(reviewer._verdicts.clear)
        self.user = User.objects.create_user('cached', password='pw')

    def gate(self, policy, call_id, **extra):
        ctx = {'user_id': self.user.id, 'session_id': 's1', 'call_id': call_id, **extra}
        # Irreversible, so it reaches the judge: what can be undone is freed
        # by rule and never gets this far (`reviewer.rule_allow`).
        return async_to_sync(policy)(
            'publish_page', {'visibility': 'link', 'title': 'n'}, ctx)

    def test_the_same_call_is_judged_once(self):
        with scripted_model(text('ALLOW ok')) as model:
            policy = auto_policy(user_text='publish n')
            self.assertFalse(self.gate(policy, 'c1'))
            # A second policy object, as a resumed turn builds: still cached.
            self.assertFalse(self.gate(auto_policy(user_text='publish n'), 'c1'))
        self.assertEqual(len(model.requests), 1)

    def test_a_different_call_is_judged_again(self):
        with scripted_model(text('ALLOW ok'), text('ASK not this one')) as model:
            policy = auto_policy(user_text='publish n')
            self.assertFalse(self.gate(policy, 'c1'))
            self.assertTrue(self.gate(policy, 'c2'))
        self.assertEqual(len(model.requests), 2)

    def test_the_live_plan_beats_the_turns_snapshot(self):
        with scripted_model(text('ALLOW ok')) as model:
            policy = auto_policy(user_text='publish n', todos=[{'text': 'old step'}])
            self.gate(policy, 'c1', todos=[{'status': 'in_progress', 'text': 'new step'}])
        prompt = model.requests[0].last_user_text()
        self.assertIn('new step', prompt)
        self.assertNotIn('old step', prompt)

    def test_reviewing_is_announced_on_the_sink(self):
        frames: list = []

        async def sink(event, payload):
            frames.append((str(getattr(event, 'value', event)), payload))

        with scripted_model(text('ALLOW ok')):
            self.gate(auto_policy(user_text='publish n'), 'c1', sink=sink)
        self.assertEqual(frames[0][0], 'status')
        self.assertEqual(frames[0][1]['phase'], 'reviewing')


class ReviewerTextTests(SimpleTestCase):
    def msg(self, role, content):
        return SimpleNamespace(role=role, content=content)

    def test_recent_user_messages_come_first_and_the_question_last(self):
        past = [self.msg('user', f'u{i}') for i in range(6)] + [self.msg('assistant', 'a')]
        lines = reviewer_text(past, 'yes, send it').split('\n')
        self.assertEqual(len(lines), REVIEWER_RECENT_USER_MESSAGES)
        self.assertEqual(lines[-1], 'yes, send it')
        self.assertEqual(lines[0], 'u3')
        self.assertNotIn('a', lines)

    def test_a_recipient_named_earlier_reaches_the_rules(self):
        text = reviewer_text([self.msg('user', 'reply to john@acme.com')], 'send it')
        self.assertIsNone(reviewer.static_check(
            tool_name='message_send', args={'to': 'john@acme.com'}, user_text=text))

    def test_memory_off_is_the_message_alone(self):
        self.assertEqual(reviewer_text([], 'hi'), 'hi')


def _turn(policy) -> TurnContext:
    async def dispatch(name, args, context):
        return 'ok'

    return TurnContext(
        provider='test', model='test-model', system_message='sys',
        user_id=1, session_id='thread-1', intent='chat', user_text='q',
        tool_dispatch=dispatch, sensitive_tools=frozenset(),
        approval_policy=policy,
    )


def _run(calls, turn, metadata=None):
    state = {
        'messages': [AIMessage(content='', tool_calls=calls)],
        'metadata': dict(metadata or {}), 'tool_trace': [], 'thinking': '',
        'total_tokens': 0,
    }

    async def _no_images(*_a, **_k):
        return []

    with patch('chat.sources.search.image_search', _no_images):
        return async_to_sync(tools_node)(state, {'configurable': {'turn': turn}})


class GateSettlingTests(SimpleTestCase):
    def test_gates_are_decided_concurrently(self):
        # Each gate waits until all four have started. Run one after another,
        # the first would wait for ever (here: until its 5 s guard), so this
        # holds on any machine without measuring how long anything took.
        arrived = 0
        all_in = asyncio.Event()
        timed_out: list = []

        async def barrier_policy(name, args, context):
            nonlocal arrived
            arrived += 1
            if arrived == 4:
                all_in.set()
            try:
                await asyncio.wait_for(all_in.wait(), timeout=5)
            except asyncio.TimeoutError:
                timed_out.append(context['call_id'])
            return False

        calls = [{'name': 'write_file', 'id': f'c{i}', 'args': {'path': f'{i}.md'}}
                 for i in range(4)]
        _run(calls, _turn(barrier_policy))
        self.assertEqual(arrived, 4)
        self.assertEqual(timed_out, [], 'the gates ran one after another')

    def test_an_approved_call_is_not_gated_again(self):
        asked: list = []

        async def policy(name, args, context):
            asked.append(context['call_id'])
            return False

        calls = [{'name': 'write_file', 'id': 'c1', 'args': {'path': 'a.md'}},
                 {'name': 'write_file', 'id': 'c2', 'args': {'path': 'b.md'}}]
        _run(calls, _turn(policy), metadata={'approved_tool_calls': ['c1']})
        self.assertEqual(asked, ['c2'])

    def test_the_policy_sees_the_call_id_and_the_live_plan(self):
        seen: list = []

        async def policy(name, args, context):
            seen.append(context)
            return False

        _run([{'name': 'write_file', 'id': 'c9', 'args': {'path': 'a.md'}}],
             _turn(policy), metadata={'todos': [{'text': 'ship', 'status': 'pending'}]})
        self.assertEqual(seen[0]['call_id'], 'c9')
        self.assertEqual(seen[0]['todos'][0]['text'], 'ship')
