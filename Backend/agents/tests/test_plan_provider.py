"""
An agent on a ChatGPT plan runs only when a person started it.

A plan has a weekly cap that stops when it is reached, so a schedule, a
mission or an eval sweep must not be able to spend it. Refused in two places:
at save (a schedule on such an agent would fail on every firing) and at run
time (an agent with a blank model inherits the account default, which the
serializer cannot see).
"""
from unittest.mock import patch

from asgiref.sync import async_to_sync
from django.contrib.auth.models import User
from django.test import SimpleTestCase, override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from agents.agent import runtime
from agents.agent.runtime import AgentRunRefused, _check_plan_provider
from agents.models import SubAgent
from llm import chatgpt_plan


class CallerTests(SimpleTestCase):
    def test_unattended_callers_are_refused_with_the_reason(self):
        for caller in ('trigger', 'mission', 'eval'):
            with self.assertRaises(AgentRunRefused) as caught:
                _check_plan_provider('chatgpt', caller)
            self.assertIn('only used while you are here', str(caught.exception))

    def test_a_person_starting_a_run_is_not_refused(self):
        for caller in ('chat', 'api', 'orchestrator'):
            _check_plan_provider('chatgpt', caller)

    def test_no_other_provider_is_affected(self):
        for caller in ('trigger', 'mission', 'eval', 'chat'):
            _check_plan_provider('openrouter', caller)

    def test_every_refused_caller_is_a_real_caller(self):
        from agents.grants import CALLERS
        self.assertLessEqual(chatgpt_plan.REFUSED_CALLERS, CALLERS)


@override_settings(CHATGPT_PLAN_ENABLED=True)
class SaveAndRunTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='owner', password='pw')
        self.client.force_authenticate(user=self.user)

    def _post(self, **overrides):
        body = {
            'name': 'Plan agent', 'brief': 'Summarises things.',
            'provider': 'chatgpt', 'model': 'chatgpt/gpt-6-luna',
            'temperature': 0, 'tools': {}, 'autonomy': 'ask', **overrides,
        }
        return self.client.post(reverse('orchestrator:agent_list'), body, format='json')

    def test_a_schedule_on_a_plan_agent_is_refused_at_save(self):
        r = self._post(schedule='0 9 * * 1', allowUnattended=True)
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('schedule', r.data)
        self.assertFalse(SubAgent.objects.exists())

    def test_a_plan_agent_with_no_schedule_saves(self):
        r = self._post()
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        self.assertEqual(SubAgent.objects.get(id=r.data['id']).llm_provider, 'chatgpt')

    def test_a_trigger_cannot_start_a_run_that_resolves_to_the_plan(self):
        """Blank on the agent, plan on the account: only the runtime sees it."""
        agent = SubAgent.objects.create(
            user=self.user, name='Inherits', allow_unattended=True)

        async def resolved(agent, user):
            return 'chatgpt', 'chatgpt/gpt-6-luna', None

        async def no_guardrails(agent, user):
            return None

        async def preflight(**_kwargs):
            raise AssertionError('refused before any credential lookup')

        with patch.object(runtime, '_resolve_run_model', resolved), \
                patch.object(runtime, 'check_guardrails', no_guardrails), \
                patch('llm.access.preflight', preflight):
            with self.assertRaises(AgentRunRefused) as caught:
                async_to_sync(runtime.start_agent_run)(
                    agent, 'go', user=self.user, caller='trigger')
        self.assertIn('ChatGPT plan', str(caught.exception))
