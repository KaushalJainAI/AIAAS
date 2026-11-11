"""
An agent run started from an org chat works inside that org's solution library.

Before this, `org_id` was set only by the chat pipeline, so every agent run —
including the workers a chat delegates to — searched only its owner's personal
solutions and saved there too: the team's fixes never reached the agents doing
the work. The org now rides the delegation, is stamped on the log so a resumed
run keeps it, and is re-checked against live membership on every start, which
is the one rule `core/orgs.py` is built on.
"""
import json
import pathlib
from types import SimpleNamespace
from unittest.mock import patch

from asgiref.sync import sync_to_async
from django.contrib.auth.models import User
from django.test import TransactionTestCase

from agents.config import AgentSerializer
from agents.models import SubAgent
from chat.tools.solutions import save_solution, search_solutions
from chat.turn.agent import TurnResult
from core import orgs
from core.models import Membership
from llm.models import AIModel, AIProvider
from logs.models import ExecutionLog
from solutions.models import Solution


async def no_preflight(**kwargs):
    return None


class RunOrgTests(TransactionTestCase):
    def setUp(self):
        self.owner = User.objects.create_user('owner', 'owner@example.test', 'pw')
        self.user = User.objects.create_user('worker', 'worker@example.test', 'pw')
        self.org = orgs.create(self.owner, 'Acme')
        # Membership directly: these tests are about runs, not the invite flow.
        Membership.objects.create(org=self.org, user=self.user, role='member')
        provider, _ = AIProvider.objects.get_or_create(
            slug='openrouter', defaults={'name': 'OpenRouter'})
        AIModel.objects.get_or_create(
            value='stub/model',
            defaults={'provider': provider, 'name': 'Stub', 'is_active': True})
        self.agent = SubAgent.objects.create(
            user=self.user, name='Fixer', prompt='Fix.', tool_grants={},
            guardrails={}, llm_provider='openrouter', llm_model='stub/model')
        self.seen = []

    async def _run(self, thread, **kwargs):
        from agents.agent.runtime import run_agent

        async def capture(turn, *, prompt, thread_id):
            self.seen.append(turn)
            return TurnResult(answer='done')

        with patch('chat.turn.agent.run_turn', capture), \
                patch('llm.access.preflight', no_preflight):
            return await run_agent(self.agent, 'go', user=self.user,
                                   thread_id=thread, **kwargs)

    async def test_a_delegated_run_carries_the_chats_org(self):
        await self._run('t-org', org_id=self.org.id, share_solutions=True)
        turn = self.seen[-1]
        self.assertEqual(turn.org_id, self.org.id)
        self.assertTrue(turn.share_solutions)

    async def test_the_org_is_stamped_so_a_resume_keeps_it(self):
        await self._run('t-resume', org_id=self.org.id, share_solutions=False)
        log = await ExecutionLog.objects.aget(thread_id='t-resume')
        self.assertEqual(log.input_data.get('org_id'), self.org.id)

        # A resume arrives with the log and nothing else.
        await self._run('t-resume', log=log)
        self.assertEqual(self.seen[-1].org_id, self.org.id)
        self.assertFalse(self.seen[-1].share_solutions)

    async def test_a_run_without_an_org_stays_personal(self):
        await self._run('t-personal')
        self.assertIsNone(self.seen[-1].org_id)
        self.assertFalse(self.seen[-1].share_solutions)

    async def test_an_org_the_owner_is_not_in_is_dropped(self):
        other = await sync_to_async(orgs.create)(self.owner, 'Elsewhere')
        await self._run('t-foreign', org_id=other.id, share_solutions=True)
        self.assertIsNone(self.seen[-1].org_id)
        self.assertFalse(self.seen[-1].share_solutions)

    async def test_leaving_the_org_cuts_a_resumed_run_off(self):
        await self._run('t-left', org_id=self.org.id)
        log = await ExecutionLog.objects.aget(thread_id='t-left')
        await sync_to_async(orgs.remove_member)(self.user, self.org.id, self.user.id)
        await self._run('t-left', log=log)
        self.assertIsNone(self.seen[-1].org_id)


class ScheduledRunOrgTests(TransactionTestCase):
    """An agent's own `orgId` lets its unattended runs use the team's solutions.

    The chat's org still wins, membership is read live on every run, and an
    unattended run may read the team's solutions but never add to them.
    """

    def setUp(self):
        self.owner = User.objects.create_user('lead', 'lead@example.test', 'pw')
        self.user = User.objects.create_user('nightly', 'nightly@example.test', 'pw')
        self.org = orgs.create(self.owner, 'Acme')
        self.beta = orgs.create(self.owner, 'Beta')
        for org in (self.org, self.beta):
            Membership.objects.create(org=org, user=self.user, role='member')
        provider, _ = AIProvider.objects.get_or_create(
            slug='openrouter', defaults={'name': 'OpenRouter'})
        AIModel.objects.get_or_create(
            value='stub/model',
            defaults={'provider': provider, 'name': 'Stub', 'is_active': True})
        self.agent = SubAgent.objects.create(
            user=self.user, name='Nightly', prompt='Summarise.', tool_grants={},
            guardrails={}, llm_provider='openrouter', llm_model='stub/model',
            allow_unattended=True, agent_context={'orgId': self.org.id},
        )
        self.seen = []

    async def _run(self, thread, **kwargs):
        from agents.agent.runtime import run_agent

        kwargs.setdefault('caller', 'trigger')

        async def capture(turn, *, prompt, thread_id):
            self.seen.append(turn)
            return TurnResult(answer='done')

        with patch('chat.turn.agent.run_turn', capture), \
                patch('llm.access.preflight', no_preflight):
            return await run_agent(self.agent, 'go', user=self.user,
                                   thread_id=thread, **kwargs)

    async def test_a_scheduled_run_works_in_the_agents_org(self):
        await self._run('nightly-1')
        turn = self.seen[-1]
        self.assertEqual(turn.caller, 'trigger')
        self.assertEqual(turn.org_id, self.org.id)
        self.assertFalse(turn.share_solutions)
        # The solution tools answer for the org the run was given, not the
        # owner's personal library.
        found = json.loads(await search_solutions(
            {'query': 'nightly build fails'},
            {'user_id': self.user.id, 'org_id': turn.org_id}))
        self.assertEqual(found['scope'], 'organisation')

    async def test_leaving_the_org_gives_the_next_scheduled_run_no_org(self):
        await self._run('nightly-2')
        self.assertEqual(self.seen[-1].org_id, self.org.id)

        await sync_to_async(orgs.remove_member)(self.user, self.org.id, self.user.id)
        await self._run('nightly-3')
        self.assertIsNone(self.seen[-1].org_id)
        self.assertFalse(self.seen[-1].share_solutions)
        # The builder is told the same thing the runtime does.
        config = await sync_to_async(AgentSerializer.to_config)(self.agent)
        self.assertIsNone(config['orgId'])

    async def test_a_scheduled_run_cannot_save_a_solution(self):
        await self._run('nightly-4')
        turn = self.seen[-1]
        out = json.loads(await save_solution(
            {'problem': 'Disk is full', 'resolution': 'Clear the build cache.'},
            {'user_id': self.user.id, 'org_id': turn.org_id,
             'caller': turn.caller, 'share_solutions': False}))
        self.assertIn('Unattended runs can read team solutions', out['error'])
        self.assertFalse(await Solution.objects.filter(author_id=self.user.id).aexists())

    async def test_a_scheduled_run_cannot_review_a_solution(self):
        from chat.tools.solutions import review_solution

        await self._run('nightly-5')
        turn = self.seen[-1]
        out = json.loads(await review_solution(
            {'id': 1, 'verdict': 'doubtful', 'reason': 'Looks wrong.'},
            {'user_id': self.user.id, 'org_id': turn.org_id, 'caller': turn.caller}))
        self.assertIn('Unattended runs can read team solutions', out['error'])

    async def test_a_chat_run_keeps_the_chats_org_over_the_agents(self):
        await self._run('chat-1', caller='chat', org_id=self.beta.id, share_solutions=True)
        turn = self.seen[-1]
        self.assertEqual(turn.org_id, self.beta.id)
        self.assertTrue(turn.share_solutions)

    async def test_a_personal_chat_run_stays_personal(self):
        # The answer of a run started from a personal chat flows back into that
        # chat, so the agent's org must not apply: an org's fixes would leave it.
        await self._run('chat-2', caller='chat')
        self.assertIsNone(self.seen[-1].org_id)
        self.assertFalse(self.seen[-1].share_solutions)

    async def test_a_worker_delegated_without_an_org_stays_personal(self):
        await self._run('worker-1', caller='orchestrator')
        self.assertIsNone(self.seen[-1].org_id)

    async def test_a_run_started_with_the_run_button_uses_the_agents_org(self):
        await self._run('api-1', caller='api')
        self.assertEqual(self.seen[-1].org_id, self.org.id)

    async def test_the_builder_refuses_an_org_the_owner_is_not_in(self):
        elsewhere = await sync_to_async(orgs.create)(self.owner, 'Elsewhere')

        def check(org_id):
            serializer = AgentSerializer(
                data={'name': 'Nightly', 'orgId': org_id},
                context={'request': SimpleNamespace(user=self.user)},
            )
            return serializer.is_valid(), serializer.errors

        ok, errors = await sync_to_async(check)(elsewhere.id)
        self.assertFalse(ok)
        self.assertIn('orgId', errors)

        ok, errors = await sync_to_async(check)(self.org.id)
        self.assertTrue(ok, errors)

        ok, errors = await sync_to_async(check)(None)
        self.assertTrue(ok, errors)


class DelegationPassesTheOrgTests(TransactionTestCase):
    """Every door a chat uses to start a run hands its org down."""

    def test_each_delegation_call_site_passes_org_id(self):
        root = pathlib.Path(__file__).resolve().parents[2]
        for rel, expected in (('chat/tools/agents.py', 2), ('chat/tools/tasks.py', 1)):
            text = (root / rel).read_text(encoding='utf-8')
            self.assertEqual(text.count('parent_autonomy='), expected, rel)
            self.assertEqual(text.count('org_id=context.get('), expected, rel)
