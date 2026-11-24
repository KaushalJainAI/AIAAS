"""
The chat orchestrator's own limits, and an agent's step limit.

Sub-agents carried a time limit and a spend cap; chat — the orchestrator that
starts them — had neither, and both ran on a fixed 36 model calls. These pin
the account settings that replaced the constants (Settings → Orchestrator,
`UserProfile.chat_*` read through `chat/turn/limits.py`), the agent field
`maxIterations`, and what each limit actually does to a running turn.
"""
from __future__ import annotations


from asgiref.sync import async_to_sync
from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APITestCase

from agents import budget as agent_budget
from agents.config import AgentSerializer
from agents.models import SubAgent
from chat.turn import limits, pace
from chat.turn.agent import TurnContext, run_turn
from core.models import UserProfile
from llm.testing import (
    DEFAULT_MODEL, DEFAULT_PROVIDER, ScriptedModel, always, text, tool_call, usage,
)
from workflow_backend.thresholds import (
    DEFAULT_CHAT_SPEND_RUPEES,
    DEFAULT_CHAT_TURN_SECONDS,
    DEFAULT_MAX_STEPS,
    MAX_MAX_STEPS,
    RUPEES_PER_MILLION_TOKENS,
)


class ResolverTests(SimpleTestCase):
    def test_no_profile_means_the_defaults(self):
        got = limits.for_profile(None)
        self.assertEqual(
            (got.max_steps, got.time_limit_seconds, got.spend_cap_rupees, got.summarise_long_turns),
            (DEFAULT_MAX_STEPS, DEFAULT_CHAT_TURN_SECONDS, DEFAULT_CHAT_SPEND_RUPEES, False),
        )

    def test_a_stored_value_outside_the_range_is_clamped_not_trusted(self):
        class Row:
            chat_max_steps = 10_000
            chat_time_limit_seconds = 1
            chat_spend_cap_rupees = 50
            chat_summarise_long_turns = True
        got = limits.for_profile(Row())
        self.assertEqual(got.max_steps, MAX_MAX_STEPS)
        self.assertEqual(got.time_limit_seconds, 60)
        self.assertTrue(got.summarise_long_turns)

    def test_the_spend_cap_becomes_tokens_at_the_agent_rate(self):
        got = limits.OrchestratorLimits(spend_cap_rupees=85)
        self.assertEqual(got.token_budget, int(85 * 1_000_000 / RUPEES_PER_MILLION_TOKENS))
        self.assertIsNone(limits.OrchestratorLimits(spend_cap_rupees=0).token_budget)


class DeepPaceFollowsTheSettingTests(SimpleTestCase):
    def test_deep_is_the_turns_own_ceiling(self):
        self.assertEqual(pace.cap(pace.DEEP, 120), 120)
        self.assertEqual(pace.cap(pace.DEEP, 8), 8)

    def test_the_lighter_paces_are_unchanged(self):
        self.assertEqual(pace.cap(pace.QUICK, 120), 3)
        self.assertEqual(pace.cap(pace.STANDARD, 4), 4)


class SettingsApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='o', email='o@example.com', password='pw')
        UserProfile.objects.get_or_create(user=self.user)
        self.client.force_authenticate(self.user)

    def test_new_accounts_read_the_defaults(self):
        data = self.client.get('/api/auth/profile/').data
        self.assertEqual(data['chat_max_steps'], DEFAULT_MAX_STEPS)
        self.assertEqual(data['chat_time_limit_seconds'], DEFAULT_CHAT_TURN_SECONDS)
        self.assertEqual(data['chat_spend_cap_rupees'], DEFAULT_CHAT_SPEND_RUPEES)
        self.assertFalse(data['chat_summarise_long_turns'])

    def test_values_in_range_are_saved(self):
        response = self.client.patch('/api/auth/profile/', {
            'chat_max_steps': 120, 'chat_time_limit_seconds': 4 * 3600,
            'chat_spend_cap_rupees': 0, 'chat_summarise_long_turns': True,
        }, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        got = limits.for_profile(UserProfile.objects.get(user=self.user))
        self.assertEqual((got.max_steps, got.time_limit_seconds), (120, 4 * 3600))
        self.assertIsNone(got.token_budget)
        self.assertTrue(got.summarise_long_turns)

    def test_out_of_range_is_refused_with_the_range(self):
        for field, value in (('chat_max_steps', 500), ('chat_max_steps', 1),
                             ('chat_time_limit_seconds', 10),
                             ('chat_time_limit_seconds', 9 * 3600),
                             ('chat_spend_cap_rupees', 200_000)):
            with self.subTest(field=field, value=value):
                response = self.client.patch('/api/auth/profile/', {field: value}, format='json')
                self.assertEqual(response.status_code, 400)
                self.assertIn(field, response.data)


class AgentStepLimitTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='a', email='a@example.com', password='pw')

    def test_an_agent_that_predates_the_field_keeps_36(self):
        agent = SubAgent.objects.create(user=self.user, name='Legacy')
        self.assertEqual(AgentSerializer.to_config(agent)['maxIterations'], 36)
        self.assertEqual(agent_budget.steps_for(agent), 36)

    def test_a_chosen_limit_round_trips_and_is_what_the_runtime_reads(self):
        serializer = AgentSerializer(data={'name': 'Long', 'maxIterations': 150})
        self.assertTrue(serializer.is_valid(), serializer.errors)
        agent = SubAgent(user=self.user)
        AgentSerializer.apply(agent, serializer.validated_data)
        agent.save()
        self.assertEqual(AgentSerializer.to_config(agent)['maxIterations'], 150)
        self.assertEqual(agent_budget.steps_for(agent), 150)

    def test_out_of_range_is_refused(self):
        for value in (2, 201):
            serializer = AgentSerializer(data={'name': 'A', 'maxIterations': value})
            self.assertFalse(serializer.is_valid())
            self.assertIn('maxIterations', serializer.errors)

    def test_it_travels_with_a_published_agent(self):
        from agents.publishing import SHAREABLE_KEYS
        self.assertIn('maxIterations', SHAREABLE_KEYS)

    def test_the_builder_assistant_may_propose_it(self):
        from agents.views.builder import KNOBS, Reject
        self.assertEqual(KNOBS['maxIterations'].coerce(60, None), 60)
        with self.assertRaises(Reject):
            KNOBS['maxIterations'].coerce(999, None)


class _Wire:
    """What a scripted model was sent, read back per request."""

    scripted: ScriptedModel

    @property
    def offered(self) -> list[bool]:
        # Callable tools: offered and not `tool_choice='none'` (the last pass).
        return [r.tools_offered for r in self.scripted.requests]

    @property
    def tool_lists(self) -> list[list]:
        return [[(t.get("function") or {}).get("name") for t in r.tools]
                for r in self.scripted.requests]

    @property
    def choices(self) -> list:
        return [r.tool_choice for r in self.scripted.requests]

    @property
    def calls(self) -> int:
        return len(self.scripted.requests)


class _ToolLoopProvider(_Wire):
    """Asks for a tool every call (never answers on its own); each call costs
    `cost` tokens. The model is scripted at the wire, so what is recorded is
    what each request actually offered."""

    def __init__(self, cost: int) -> None:
        self.cost = cost
        self.scripted = ScriptedModel([always(self._respond)])

    def _respond(self, request):
        spent = usage(prompt_tokens=self.cost, completion_tokens=0)
        if request.tools_offered:
            return tool_call("read_file", {"path": "/x"}, id=f"c{request.index}") + \
                text("", usage=spent)
        return text("final answer", usage=spent)


class _PlanningProvider(_Wire):
    """Writes a plan on its first call (which promotes the pace), then keeps
    calling a tool until tool calls are forbidden."""

    def __init__(self) -> None:
        self.scripted = ScriptedModel([always(self._respond)])

    def _respond(self, request):
        if not request.tools_offered:
            return text("done")
        if request.index == 1:
            return tool_call("update_todos",
                             {"todos": [{"text": "the job", "status": "in_progress"}]}, id="plan")
        return tool_call("read_file", {"path": "/x"}, id=f"c{request.index}")


async def _ok(name, args, context):
    return "ok"


async def _never(name, args, context):
    return False


class TurnObeysTheLimitsTests(TestCase):
    """What each limit does to a running turn: it stops asking for tools and
    answers, rather than being cut off mid-call."""

    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(username='t', email='t@example.com', password='pw')

    def _run(self, provider, thread, **turn_kwargs):
        turn = TurnContext(
            provider=DEFAULT_PROVIDER, model=DEFAULT_MODEL, system_message="test",
            user_id=self.user.id, session_id=thread, intent="chat", user_text="go", memory_enabled=False,
            tool_dispatch=_ok, approval_policy=_never, **turn_kwargs,
        )
        with provider.scripted.installed():
            return async_to_sync(run_turn)(turn, prompt="go", thread_id=thread)

    def test_the_step_limit_ends_with_an_answer(self):
        provider = _ToolLoopProvider(cost=1)
        result = self._run(provider, "steps", max_iterations=5)
        self.assertEqual(len(provider.offered), 5)
        self.assertFalse(provider.offered[-1], "last pass must forbid tool calls")
        self.assertEqual(result.answer, "final answer")

    def test_every_pass_sends_the_same_tools_for_the_prompt_cache(self):
        """The tool list is part of the prefix a provider caches. The last pass
        used to send none, so it re-read the whole transcript uncached; now it
        sends the same list and forbids calling one with tool_choice."""
        provider = _ToolLoopProvider(cost=1)
        self._run(provider, "cache-stable", max_iterations=5)
        self.assertTrue(provider.tool_lists[0])
        self.assertTrue(all(names == provider.tool_lists[0] for names in provider.tool_lists))
        self.assertEqual(provider.choices[:-1], [None] * 4)
        self.assertEqual(provider.choices[-1], "none")

    def test_an_agent_run_that_never_plans_stays_at_standard(self):
        """Agent runs start at `standard`: a 30-step limit is not spent on a
        job the model never treated as one with several steps."""
        from agents.agent.runtime import _starting_pace

        provider = _ToolLoopProvider(cost=1)
        with provider.scripted.installed():
            turn = TurnContext(
                provider=DEFAULT_PROVIDER, model=DEFAULT_MODEL, system_message="test", user_id=self.user.id,
                session_id="agent-pace", intent="research", user_text="go",
                memory_enabled=False, tool_dispatch=_ok, approval_policy=_never,
                max_iterations=30,
            )
            async_to_sync(run_turn)(turn, prompt="go", thread_id="agent-pace",
                                    metadata=_starting_pace(30))
        self.assertEqual(len(provider.offered), 12)

    def test_an_agent_run_that_plans_gets_its_whole_limit(self):
        from agents.agent.runtime import _starting_pace

        provider = _PlanningProvider()
        with provider.scripted.installed():
            turn = TurnContext(
                provider=DEFAULT_PROVIDER, model=DEFAULT_MODEL, system_message="test", user_id=self.user.id,
                session_id="agent-plan", intent="research", user_text="go",
                memory_enabled=False, tool_dispatch=_ok, approval_policy=_never,
                max_iterations=30,
            )
            async_to_sync(run_turn)(turn, prompt="go", thread_id="agent-plan",
                                    metadata=_starting_pace(30))
        self.assertEqual(provider.calls, 30)

    def test_no_pace_when_the_limit_is_already_small(self):
        from agents.agent.runtime import _starting_pace

        self.assertEqual(_starting_pace(12), {})
        self.assertEqual(_starting_pace(36), {'pace': {'tier': 'standard', 'started': 'standard'}})

    def test_a_higher_step_limit_is_honoured(self):
        provider = _ToolLoopProvider(cost=1)
        self._run(provider, "steps-high", max_iterations=50)
        self.assertEqual(len(provider.offered), 50)

    def test_the_spend_cap_ends_with_an_answer(self):
        provider = _ToolLoopProvider(cost=100)
        result = self._run(provider, "spend", max_iterations=50, token_budget=250)
        # Calls 1-3 spend 300 >= 250, so the 4th is the wrap-up pass.
        self.assertEqual(len(provider.offered), 4)
        self.assertFalse(provider.offered[-1])
        self.assertEqual(result.answer, "final answer")

    def test_the_time_limit_ends_with_an_answer(self):
        from agents.budget import Deadline

        provider = _ToolLoopProvider(cost=1)
        # Already inside the wrap-up window: the first pass is the last.
        result = self._run(provider, "time", max_iterations=50, deadline=Deadline.after(10))
        self.assertEqual(provider.offered, [False])
        self.assertEqual(result.answer, "final answer")
