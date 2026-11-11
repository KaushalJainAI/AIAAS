"""`match` on the two agent approval doors (UI redesign B2).

`agent_approve` (`/api/orchestrator/agents/<id>/approve/`) and the Inbox
respond view (`/api/orchestrator/hitl/<id>/respond/`) both pass `match` to
`approve_tool_call`. A narrowing that is not a subset of the paused call must
answer 400 and leave the run and the Inbox row exactly as they were.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from django.contrib.auth.models import User
from langchain_core.messages import AIMessage
from rest_framework.test import APITestCase

from agents.models import HITLRequest, SubAgent
from chat.models import ToolPermission
from logs.models import ExecutionLog

ARGS = {'to': 'vendor@example.com', 'subject': 'Invoice', 'body': 'Paid'}


class _Snapshot:
    def __init__(self, values):
        self.values = values


def _paused_snapshot():
    message = AIMessage(content='', tool_calls=[
        {'id': 'call-1', 'name': 'gmail_send_message', 'args': ARGS},
    ])
    return _Snapshot({'messages': [message], 'metadata': {}})


class _DoorBase(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='doors', password='pw')
        self.client.force_authenticate(user=self.user)
        self.agent = SubAgent.objects.create(user=self.user, name='Reporter')
        self.log = ExecutionLog.objects.create(
            user=self.user, subagent=self.agent, status='paused', thread_id='thread-1',
            input_data={'thread_id': 'thread-1', 'goal': 'send the invoice'},
        )
        self.graph = MagicMock()
        self.graph.aget_state = AsyncMock(return_value=_paused_snapshot())
        self.graph.aupdate_state = AsyncMock()
        patcher = patch('chat.turn.agent.get_graph', return_value=self.graph)
        patcher.start()
        self.addCleanup(patcher.stop)

    def assertNothingApproved(self):
        self.graph.aupdate_state.assert_not_awaited()
        self.assertFalse(ToolPermission.objects.filter(user=self.user).exists())


class AgentApproveMatchTests(_DoorBase):
    def approve(self, **body):
        return self.client.post(
            f'/api/orchestrator/agents/{self.agent.id}/approve/',
            {'thread_id': 'thread-1', 'call_id': 'call-1', **body}, format='json',
        )

    def test_a_narrowing_outside_the_call_is_a_400_and_nothing_resumes(self):
        with patch('agents.agent.hitl.resolve_request', new=AsyncMock()) as resolve, \
             patch('agents.agent.runtime.resume_agent_run', new=AsyncMock()) as resume:
            response = self.approve(scope='session', match={'to': 'nobody@example.com'})

        self.assertEqual(response.status_code, 400)
        self.assertIn('error', response.data)
        resolve.assert_not_awaited()
        resume.assert_not_awaited()
        self.assertNothingApproved()

    def test_a_narrowing_without_session_scope_is_a_400(self):
        with patch('agents.agent.runtime.resume_agent_run', new=AsyncMock()) as resume:
            response = self.approve(scope='once', match={'to': 'vendor@example.com'})

        self.assertEqual(response.status_code, 400)
        resume.assert_not_awaited()
        self.assertNothingApproved()

    def test_a_valid_narrowing_is_stored_and_the_run_resumes(self):
        with patch('agents.agent.hitl.resolve_request', new=AsyncMock()), \
             patch('agents.agent.runtime.resume_agent_run',
                   new=AsyncMock(return_value='exec-9')) as resume:
            response = self.approve(scope='session', match={'to': 'vendor@example.com'})

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['resumed'])
        resume.assert_awaited_once()
        row = ToolPermission.objects.get(user=self.user)
        self.assertEqual(row.session_key, 'thread-1')
        self.assertEqual(row.match, {'to': 'vendor@example.com'})

    def test_an_approval_without_a_match_is_unchanged(self):
        with patch('agents.agent.hitl.resolve_request', new=AsyncMock()), \
             patch('agents.agent.runtime.resume_agent_run',
                   new=AsyncMock(return_value='exec-9')):
            response = self.approve(scope='session')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(ToolPermission.objects.get(user=self.user).match, {})


class InboxRespondMatchTests(_DoorBase):
    def make_request(self):
        return HITLRequest.objects.create(
            user=self.user, execution=self.log, node_id='call-1',
            request_type='approval', title='Send email · Gmail',
            message='Send email using your Gmail connection.',
            context_data={'tool': 'gmail_send_message', 'call_id': 'call-1',
                          'thread_id': 'thread-1', 'agent_id': self.agent.id},
        )

    def respond(self, row, **body):
        return self.client.post(
            f'/api/orchestrator/hitl/{row.request_id}/respond/',
            {'action': 'approve', **body}, format='json',
        )

    def test_a_refused_narrowing_is_a_400_and_the_row_stays_pending(self):
        row = self.make_request()
        with patch('agents.agent.runtime.resume_agent_run', new=AsyncMock()) as resume:
            response = self.respond(row, scope='session', match={'to': 'nobody@example.com'})

        self.assertEqual(response.status_code, 400)
        resume.assert_not_awaited()
        row.refresh_from_db()
        self.assertEqual(row.status, 'pending')
        self.assertNothingApproved()

    def test_a_valid_narrowing_is_stored_and_the_row_closes(self):
        row = self.make_request()
        with patch('agents.agent.runtime.resume_agent_run',
                   new=AsyncMock(return_value='exec-9')):
            response = self.respond(row, scope='session', match={'to': 'vendor@example.com'})

        self.assertEqual(response.status_code, 200)
        row.refresh_from_db()
        self.assertEqual(row.status, 'approved')
        self.assertEqual(
            ToolPermission.objects.get(user=self.user).match,
            {'to': 'vendor@example.com'},
        )
