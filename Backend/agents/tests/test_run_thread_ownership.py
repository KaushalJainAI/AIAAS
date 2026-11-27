"""
Approve, reject and resume act only on the caller's own paused run (H-181).

The thread id arrives in the request body and a checkpoint is keyed by it
alone. Before, any signed-in user who knew a thread id could approve, reject
or resume it under an agent of their own. A thread that is not the caller's
run under that agent now gets the same 404 as an unknown id, and nothing is
recorded or started.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from agents.models import SubAgent
from logs.models import ExecutionLog


class ThreadOwnershipTests(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user(username='owner', password='pw')
        self.intruder = User.objects.create_user(username='intruder', password='pw')
        self.agent = SubAgent.objects.create(user=self.owner, name='Reporter')
        self.own_other_agent = SubAgent.objects.create(user=self.owner, name='Second')
        self.intruder_agent = SubAgent.objects.create(user=self.intruder, name='Mine')
        ExecutionLog.objects.create(
            user=self.owner, subagent=self.agent, status='paused', thread_id='thread-1',
            input_data={'thread_id': 'thread-1', 'goal': 'send the invoice'},
        )

    def url(self, agent, verb):
        return f'/api/orchestrator/agents/{agent.id}/{verb}/'

    def approve_body(self, thread_id='thread-1'):
        return {'thread_id': thread_id, 'call_id': 'call-1'}

    def reject_body(self, thread_id='thread-1'):
        return {'thread_id': thread_id, 'call_id': 'call-1'}

    # --- another account's thread, under the intruder's own agent -----------

    def test_an_intruder_cannot_approve_another_accounts_thread(self):
        self.client.force_authenticate(user=self.intruder)
        with patch('chat.turn.agent.approve_tool_call', new=AsyncMock()) as approve, \
             patch('agents.agent.runtime.resume_agent_run', new=AsyncMock()) as resume:
            response = self.client.post(self.url(self.intruder_agent, 'approve'),
                                        self.approve_body(), format='json')
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data, {'error': 'No paused run for that thread'})
        approve.assert_not_awaited()
        resume.assert_not_awaited()

    def test_an_intruder_cannot_reject_another_accounts_thread(self):
        self.client.force_authenticate(user=self.intruder)
        with patch('chat.turn.agent.reject_tool_call', new=AsyncMock(return_value=True)) as reject, \
             patch('agents.agent.runtime.resume_agent_run', new=AsyncMock()) as resume:
            response = self.client.post(self.url(self.intruder_agent, 'reject'),
                                        self.reject_body(), format='json')
        self.assertEqual(response.status_code, 404)
        reject.assert_not_awaited()
        resume.assert_not_awaited()

    def test_an_intruder_cannot_resume_another_accounts_thread(self):
        self.client.force_authenticate(user=self.intruder)
        with patch('agents.agent.runtime.resume_agent_run', new=AsyncMock()) as resume, \
             patch('agents.agent.runtime.start_agent_run', new=AsyncMock()) as start:
            response = self.client.post(
                self.url(self.intruder_agent, 'execute'),
                {'goal': 'anything', 'thread_id': 'thread-1'}, format='json')
        self.assertEqual(response.status_code, 404)
        resume.assert_not_awaited()
        start.assert_not_awaited()

    # --- the owner's thread, under a different agent of theirs --------------

    def test_a_thread_is_not_usable_under_another_agent_of_the_same_user(self):
        self.client.force_authenticate(user=self.owner)
        with patch('chat.turn.agent.approve_tool_call', new=AsyncMock()) as approve:
            response = self.client.post(self.url(self.own_other_agent, 'approve'),
                                        self.approve_body(), format='json')
        self.assertEqual(response.status_code, 404)
        approve.assert_not_awaited()

    # --- unknown thread ids look the same as foreign ones --------------------

    def test_an_unknown_thread_gets_the_same_404(self):
        self.client.force_authenticate(user=self.owner)
        with patch('chat.turn.agent.approve_tool_call', new=AsyncMock()) as approve:
            response = self.client.post(self.url(self.agent, 'approve'),
                                        self.approve_body('no-such-thread'), format='json')
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data, {'error': 'No paused run for that thread'})
        approve.assert_not_awaited()

    # --- the owner's own thread gets through ---------------------------------

    def test_the_owner_can_approve_their_own_paused_run(self):
        self.client.force_authenticate(user=self.owner)
        with patch('chat.turn.agent.approve_tool_call', new=AsyncMock()) as approve, \
             patch('agents.agent.hitl.resolve_request', new=AsyncMock()), \
             patch('agents.agent.runtime.resume_agent_run',
                   new=AsyncMock(return_value='exec-1')):
            response = self.client.post(self.url(self.agent, 'approve'),
                                        self.approve_body(), format='json')
        self.assertEqual(response.status_code, 200)
        approve.assert_awaited_once()

    def test_the_owner_can_resume_their_own_paused_run(self):
        self.client.force_authenticate(user=self.owner)
        with patch('agents.agent.runtime.resume_agent_run',
                   new=AsyncMock(return_value='exec-1')) as resume:
            response = self.client.post(
                self.url(self.agent, 'execute'),
                {'goal': 'continue', 'thread_id': 'thread-1'}, format='json')
        self.assertEqual(response.status_code, 202)
        resume.assert_awaited_once()
