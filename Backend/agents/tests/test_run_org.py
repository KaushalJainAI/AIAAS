"""
An agent run started from an org chat works inside that org's solution library.

Before this, `org_id` was set only by the chat pipeline, so every agent run —
including the workers a chat delegates to — searched only its owner's personal
solutions and saved there too: the team's fixes never reached the agents doing
the work. The org now rides the delegation, is stamped on the log so a resumed
run keeps it, and is re-checked against live membership on every start, which
is the one rule `core/orgs.py` is built on.
"""
import pathlib
from unittest.mock import patch

from asgiref.sync import sync_to_async
from django.contrib.auth.models import User
from django.test import TransactionTestCase

from agents.models import SubAgent
from chat.turn.agent import TurnResult
from core import orgs
from llm.models import AIModel, AIProvider
from logs.models import ExecutionLog


async def no_preflight(**kwargs):
    return None


class RunOrgTests(TransactionTestCase):
    def setUp(self):
        self.owner = User.objects.create_user('owner', 'owner@example.test', 'pw')
        self.user = User.objects.create_user('worker', 'worker@example.test', 'pw')
        self.org = orgs.create(self.owner, 'Acme')
        orgs.add_member(self.owner, self.org.id, self.user.email)
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


class DelegationPassesTheOrgTests(TransactionTestCase):
    """Every door a chat uses to start a run hands its org down."""

    def test_each_delegation_call_site_passes_org_id(self):
        root = pathlib.Path(__file__).resolve().parents[2]
        for rel, expected in (('chat/tools/agents.py', 2), ('chat/tools/tasks.py', 1)):
            text = (root / rel).read_text(encoding='utf-8')
            self.assertEqual(text.count('parent_autonomy='), expected, rel)
            self.assertEqual(text.count('org_id=context.get('), expected, rel)
