"""The approval frame carries the new description fields to the client (B1).

A unit test on `describe_call_async` cannot show that the frame reaches the
card, so this drives a real turn through the graph: the model asks to send an
email, the sensitive gate pauses it, and the `ask_permission` payload is read
the way the client reads it.
"""
from __future__ import annotations

from unittest.mock import patch

from asgiref.sync import async_to_sync
from django.contrib.auth.models import User
from django.test import TestCase

from chat.tests.test_turn_output_e2e import _ScriptedModel, _never
from chat.turn.agent import TurnContext, run_turn
from chat.turn.events import Event


class ApprovalFrameDetailsTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('frame', 'frame@example.com', 'pw')

    def _pause_on(self, name, args, thread):
        model = _ScriptedModel([(name, args)])
        seen: list[tuple[str, dict]] = []

        async def sink(event: Event, payload: dict) -> None:
            seen.append((str(event), payload))

        turn = TurnContext(
            provider='stub', model='stub-model', system_message='You are a test.',
            user_id=self.user.id, session_id=thread, intent='chat',
            user_text='go', memory_enabled=False, max_iterations=8,
            approval_policy=_never, sink=sink,
        )
        with patch('llm.access.stream', new=model):
            result = async_to_sync(run_turn)(turn, prompt='go', thread_id=thread)
        frames = [payload for name_, payload in seen if name_ == 'ask_permission']
        return result, frames

    def test_a_send_frame_says_what_it_does_and_what_its_button_says(self):
        result, frames = self._pause_on(
            'gmail_send_message',
            {'to': 'new.person@example.com', 'subject': 'Hello', 'body': 'Hi there'},
            thread='frame-send',
        )

        self.assertTrue(result.awaiting_approval)
        self.assertEqual(len(frames), 1)
        detail = frames[0]['detail']
        self.assertEqual(detail['effect'], 'irreversible')
        self.assertTrue(detail['leaves_workspace'])
        self.assertEqual(detail['action_label'], 'Send email')
        # Nobody the user has ever sent to: the card can say so.
        self.assertTrue(detail['first_contact'])
        # The old keys still ship beside the new ones.
        self.assertIn('sentence', detail)
        self.assertIn('fields', detail)
        self.assertEqual(frames[0]['args']['to'], 'new.person@example.com')
