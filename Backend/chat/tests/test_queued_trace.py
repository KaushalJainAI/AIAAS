"""
The trace step of a held send says so (chat/turn/agent.py::_mark_queued,
docs/UNDO_PLAN.md Progress row 2).

The receipt under a reply is built from the saved `tool_trace`, which carries
no tool output. Without a flag on the step it cannot tell a send the send
window is still holding from one that went, so it said "asked to send". What
these pin: a held send's step gets `queued: True`; only the step for that call
id is touched; a plain result, an error and a call that never ran leave the
step as it was.
"""
from __future__ import annotations

import json

from django.test import SimpleTestCase

from chat.turn import agent as turn_agent


def _step(call_id, tool='message_send'):
    return {'tool': tool, 'args': {}, 'call_id': call_id, 'summary': ''}


class MarkQueuedTests(SimpleTestCase):
    def test_a_held_message_step_is_flagged(self):
        trace = [_step('c-1')]
        turn_agent._mark_queued(trace, 'c-1', json.dumps({
            'queued': True, 'hold_id': 3, 'channel': 'slack', 'to': 'ana'}))
        self.assertIs(trace[0].get('queued'), True)

    def test_a_held_email_step_is_flagged(self):
        trace = [_step('g-1', tool='gmail_send_message')]
        turn_agent._mark_queued(trace, 'g-1', json.dumps({
            'status': 'queued', 'queued': True, 'hold_id': 9}))
        self.assertIs(trace[0].get('queued'), True)

    def test_only_the_step_for_that_call_is_flagged(self):
        trace = [_step('c-1'), _step('c-2')]
        turn_agent._mark_queued(trace, 'c-2', '{"queued": true, "hold_id": 4}')
        self.assertNotIn('queued', trace[0])
        self.assertIs(trace[1].get('queued'), True)

    def test_a_sent_result_is_not_flagged(self):
        trace = [_step('c-1')]
        turn_agent._mark_queued(trace, 'c-1', '{"channel": "slack", "sent": true}')
        self.assertNotIn('queued', trace[0])

    def test_an_error_or_plain_text_is_not_flagged(self):
        trace = [_step('c-1'), _step('c-2')]
        turn_agent._mark_queued(trace, 'c-1', '{"error": "No such channel."}')
        turn_agent._mark_queued(trace, 'c-2', 'Error running message_send: boom')
        self.assertNotIn('queued', trace[0])
        self.assertNotIn('queued', trace[1])

    def test_a_queued_flag_that_is_not_true_is_ignored(self):
        trace = [_step('c-1')]
        turn_agent._mark_queued(trace, 'c-1', '{"queued": "yes"}')
        self.assertNotIn('queued', trace[0])

    def test_an_unknown_call_id_changes_nothing(self):
        trace = [_step('c-1')]
        turn_agent._mark_queued(trace, 'missing', '{"queued": true}')
        self.assertNotIn('queued', trace[0])
