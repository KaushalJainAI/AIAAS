"""
A held send re-checks, at delivery, whether it is still wanted (H-181).

A hold waits 20 s so a watching person can cancel it. If in that window they
stop the run or chat turn that queued it, or pause everything, the send must
not happen. The check runs when the timer fires, and a stop that happened
after the send went out changes nothing.
"""
from __future__ import annotations

from datetime import timedelta
from unittest import mock

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from chat.turn import runs as chat_runs
from core.models import UserProfile
from logs.models import ExecutionLog
from messaging import holds
from messaging.models import PendingSend

User = get_user_model()
SLACK_SEND = 'chat.tools.messaging.slack.send'


class HeldSendStopTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('stopper', 'stop@example.com', 'pw')
        self.slack = mock.AsyncMock(return_value='ts-1')

    def hold(self, *, chat_session_id='', execution_id=''):
        return PendingSend.objects.create(
            user=self.user, tool='message_send',
            payload={'channel': 'slack', 'to': '#team-ops', 'body': 'Deploy at 5?',
                     'draft_id': None},
            label='Slack to #team-ops',
            send_at=timezone.now() - timedelta(seconds=1),
            status='held', chat_session_id=chat_session_id, execution_id=execution_id)

    def deliver(self, row):
        with mock.patch(SLACK_SEND, new=self.slack):
            return async_to_sync(holds.deliver)(row.id)

    def assert_cancelled_not_sent(self, outcome, row, reason):
        self.assertEqual(outcome, 'cancelled')
        self.slack.assert_not_awaited()
        row.refresh_from_db()
        self.assertEqual(row.status, 'cancelled')
        self.assertIn(reason, row.error)


class PausedAccountTests(HeldSendStopTests):
    def test_a_hold_is_cancelled_when_the_account_is_paused_since_it_was_queued(self):
        UserProfile.objects.update_or_create(
            user=self.user, defaults={'paused_until': timezone.now() + timedelta(hours=1)})
        row = self.hold()
        self.assert_cancelled_not_sent(self.deliver(row), row, 'paused')

    def test_an_expired_pause_does_not_cancel(self):
        UserProfile.objects.update_or_create(
            user=self.user, defaults={'paused_until': timezone.now() - timedelta(minutes=1)})
        row = self.hold()
        self.assertEqual(self.deliver(row), 'sent')

    def test_a_pause_on_another_account_does_not_cancel(self):
        other = User.objects.create_user('someone', 'other@example.com', 'pw')
        UserProfile.objects.update_or_create(
            user=other, defaults={'paused_until': timezone.now() + timedelta(hours=1)})
        row = self.hold()
        self.assertEqual(self.deliver(row), 'sent')


class StoppedRunTests(HeldSendStopTests):
    def make_run(self, status):
        return ExecutionLog.objects.create(
            user=self.user, status=status, trigger_type='manual', caller='api',
            started_at=timezone.now())

    def test_a_hold_from_a_cancelled_run_is_cancelled(self):
        log = self.make_run('cancelled')
        row = self.hold(execution_id=str(log.execution_id))
        self.assert_cancelled_not_sent(self.deliver(row), row, 'run')

    def test_a_hold_from_a_run_that_finished_normally_still_sends(self):
        log = self.make_run('completed')
        row = self.hold(execution_id=str(log.execution_id))
        self.assertEqual(self.deliver(row), 'sent')

    def test_a_run_id_that_is_not_a_uuid_does_not_break_delivery(self):
        row = self.hold(execution_id='not-a-uuid')
        self.assertEqual(self.deliver(row), 'sent')


class StoppedChatTurnTests(HeldSendStopTests):
    def turn(self, key, status):
        run = chat_runs.ChatRun(key=key, user_id=self.user.id)
        run.status = status
        return run

    def test_a_hold_from_a_stopped_chat_turn_is_cancelled(self):
        row = self.hold(chat_session_id='sess-stop')
        with mock.patch.dict(chat_runs._runs, {'sess-stop': self.turn('sess-stop', 'stopped')}):
            outcome = self.deliver(row)
        self.assert_cancelled_not_sent(outcome, row, 'chat turn')

    def test_a_hold_from_a_turn_still_running_sends(self):
        row = self.hold(chat_session_id='sess-run')
        with mock.patch.dict(chat_runs._runs, {'sess-run': self.turn('sess-run', 'running')}):
            self.assertEqual(self.deliver(row), 'sent')

    def test_a_turn_that_ended_normally_and_was_forgotten_still_sends(self):
        # Most turns finish before their hold fires; their absence is not a stop.
        row = self.hold(chat_session_id='sess-gone')
        self.assertEqual(self.deliver(row), 'sent')

    def test_a_stopped_turn_of_another_user_does_not_cancel(self):
        row = self.hold(chat_session_id='sess-other')
        run = chat_runs.ChatRun(key='sess-other', user_id=self.user.id + 999)
        run.status = 'stopped'
        with mock.patch.dict(chat_runs._runs, {'sess-other': run}):
            self.assertEqual(self.deliver(row), 'sent')


class CancelledHoldIsNotSentTwiceTests(HeldSendStopTests):
    def test_a_cancelled_hold_is_skipped_by_a_second_delivery(self):
        UserProfile.objects.update_or_create(
            user=self.user, defaults={'paused_until': timezone.now() + timedelta(hours=1)})
        row = self.hold()
        self.assertEqual(self.deliver(row), 'cancelled')
        self.assertEqual(self.deliver(row), 'skipped')
        self.slack.assert_not_awaited()
