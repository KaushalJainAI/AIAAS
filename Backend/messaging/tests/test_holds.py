"""
The send window (docs/UNDO_PLAN.md §5, decisions D12-D14).

A send made while a person is watching waits `OUTBOUND_HOLD_SECONDS` so they
can cancel it. An unattended run sends at once, exactly as it always did. A
held send goes out once, never twice, and a send interrupted mid-delivery is
reported to the user, never retried.
"""
from __future__ import annotations

import json
from datetime import timedelta
from unittest import mock

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from chat.tools import execute_tool
from messaging import holds
from messaging.models import MessagingAccount, OutboundMessage, PendingSend
from notifications.models import Notification

User = get_user_model()

SLACK_SEND = 'chat.tools.messaging.slack.send'
SPAWN = 'chat.tools.talk.spawn'


class HoldBase(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('holder', 'h@example.com', 'pw')
        self.other = User.objects.create_user('stranger', 's@example.com', 'pw')
        self.account = MessagingAccount.objects.create(
            user=self.user, channel='slack', label='team', verified=True)
        self.ctx = {'user_id': self.user.id, 'caller': 'chat', 'session_id': 'sess-1'}

    def call(self, name, args, **extra):
        ctx = dict(self.ctx)
        ctx.update(extra)
        return json.loads(async_to_sync(execute_tool)(name, args, ctx))

    def hold(self, *, send_at=None, status='held', user=None):
        return PendingSend.objects.create(
            user=user or self.user, tool='message_send',
            payload={'channel': 'slack', 'to': '#team-ops',
                     'body': 'Deploy at 5?', 'draft_id': None},
            label='Slack to #team-ops',
            send_at=send_at or timezone.now() - timedelta(seconds=1),
            status=status, chat_session_id='sess-1')


@override_settings(OUTBOUND_HOLD_SECONDS=20)
class AttendedSendTests(HoldBase):
    def test_an_attended_send_waits_and_never_reaches_the_provider(self):
        slack = mock.AsyncMock(return_value='ts-1')
        with mock.patch(SLACK_SEND, new=slack), mock.patch(SPAWN) as start:
            out = self.call('message_send', {
                'channel': 'slack', 'to': '#team-ops', 'body': 'Deploy at 5?'})
        start.call_args.args[0].close()  # the timer coroutine, never awaited here

        self.assertTrue(out['queued'])
        self.assertEqual(out['to'], '#team-ops')
        self.assertIn('Sending to #team-ops on slack in 20 s', out['rendered'])
        row = PendingSend.objects.get(id=out['hold_id'])
        self.assertEqual((row.status, row.tool), ('held', 'message_send'))
        self.assertEqual(row.payload['body'], 'Deploy at 5?')
        self.assertEqual(row.chat_session_id, 'sess-1')
        slack.assert_not_awaited()
        start.assert_called_once()
        self.assertEqual(OutboundMessage.objects.count(), 0)

    def test_a_held_send_counts_toward_the_run_limit(self):
        # The tool counts sends on the run's own context dict, so use one here.
        from chat.tools.talk import _sent_counts

        run_ctx = dict(self.ctx)
        with mock.patch(SLACK_SEND, new=mock.AsyncMock(return_value='ts-1')), \
                mock.patch(SPAWN) as start:
            async_to_sync(execute_tool)(
                'message_send', {'channel': 'slack', 'to': '#team-ops', 'body': 'one'},
                run_ctx)
        start.call_args.args[0].close()

        self.assertEqual(_sent_counts(run_ctx), {'#team-ops': 1})

    def test_an_unattended_send_goes_at_once_and_its_output_is_unchanged(self):
        # Pinned: this is the string the tool returned before the send window.
        slack = mock.AsyncMock(return_value='ts-9')
        with mock.patch(SLACK_SEND, new=slack):
            out = async_to_sync(execute_tool)(
                'message_send',
                {'channel': 'slack', 'to': '#team-ops', 'body': 'Nightly report'},
                {'user_id': self.user.id, 'caller': 'trigger',
                 'recipients': ['#team-ops']})
        self.assertEqual(out, json.dumps({
            'sent': True, 'channel': 'slack', 'to': '#team-ops',
            'provider_message_id': 'ts-9',
            'rendered': 'Sent to #team-ops on slack.'}))
        slack.assert_awaited_once()
        self.assertEqual(PendingSend.objects.count(), 0)

    @override_settings(OUTBOUND_HOLD_SECONDS=0)
    def test_a_zero_hold_sends_at_once(self):
        slack = mock.AsyncMock(return_value='ts-4')
        with mock.patch(SLACK_SEND, new=slack):
            out = self.call('message_send', {
                'channel': 'slack', 'to': '#team-ops', 'body': 'now'})
        self.assertTrue(out['sent'])
        slack.assert_awaited_once()
        self.assertEqual(PendingSend.objects.count(), 0)

    def test_an_eval_run_is_never_held(self):
        slack = mock.AsyncMock(return_value='ts-5')
        with mock.patch(SLACK_SEND, new=slack):
            out = self.call('message_send', {
                'channel': 'slack', 'to': '#team-ops', 'body': 'eval'}, caller='eval')
        self.assertTrue(out['sent'])
        self.assertEqual(PendingSend.objects.count(), 0)

    def test_a_bad_hold_value_means_no_hold(self):
        with override_settings(OUTBOUND_HOLD_SECONDS='soon'):
            self.assertEqual(holds.hold_seconds(), 0)
            self.assertFalse(holds.should_hold(self.ctx))

    def test_should_hold_needs_a_person_and_a_user(self):
        self.assertTrue(holds.should_hold(self.ctx))
        self.assertFalse(holds.should_hold({**self.ctx, 'caller': 'trigger'}))
        self.assertFalse(holds.should_hold({**self.ctx, 'caller': 'mission'}))
        self.assertFalse(holds.should_hold({'caller': 'chat'}))


@override_settings(OUTBOUND_HOLD_SECONDS=20)
class DeliverTests(HoldBase):
    def test_a_due_hold_sends_once(self):
        row = self.hold()
        slack = mock.AsyncMock(return_value='ts-2')
        with mock.patch(SLACK_SEND, new=slack):
            first = async_to_sync(holds.deliver)(row.id)
            second = async_to_sync(holds.deliver)(row.id)
        self.assertEqual((first, second), ('sent', 'skipped'))
        slack.assert_awaited_once()
        row.refresh_from_db()
        self.assertEqual(row.status, 'sent')
        self.assertEqual(row.result['provider_message_id'], 'ts-2')
        self.assertEqual(OutboundMessage.objects.filter(status='sent').count(), 1)

    def test_a_held_send_is_charged_on_delivery_never_on_queueing(self):
        # A cancelled hold must cost nothing, so the ledger write happens in
        # deliver(), once, with the call id that asked for the message.
        cost = mock.AsyncMock()
        with mock.patch('chat.tools.talk._record_message_cost', new=cost), \
                mock.patch(SLACK_SEND, new=mock.AsyncMock(return_value='ts-7')), \
                mock.patch(SPAWN) as start:
            out = self.call('message_send', {
                'channel': 'slack', 'to': '#team-ops', 'body': 'Deploy?'},
                call_id='call-42')
            start.call_args.args[0].close()
            cost.assert_not_awaited()

            PendingSend.objects.filter(id=out['hold_id']).update(
                send_at=timezone.now() - timedelta(seconds=1))
            self.assertEqual(async_to_sync(holds.deliver)(out['hold_id']), 'sent')
        cost.assert_awaited_once_with(
            {'user_id': self.user.id, 'call_id': 'call-42'}, 'slack')

    def test_a_hold_not_yet_due_is_left_alone(self):
        row = self.hold(send_at=timezone.now() + timedelta(seconds=30))
        slack = mock.AsyncMock(return_value='ts-x')
        with mock.patch(SLACK_SEND, new=slack):
            self.assertEqual(async_to_sync(holds.deliver)(row.id), 'skipped')
        slack.assert_not_awaited()
        row.refresh_from_db()
        self.assertEqual(row.status, 'held')

    def test_a_cancelled_hold_is_never_sent(self):
        row = self.hold(send_at=timezone.now() + timedelta(seconds=20))
        self.assertEqual(holds.cancel(self.user, row.id), 'cancelled')
        slack = mock.AsyncMock(return_value='ts-x')
        with mock.patch(SLACK_SEND, new=slack):
            self.assertEqual(async_to_sync(holds.deliver)(row.id), 'skipped')
        slack.assert_not_awaited()

    def test_cancel_after_the_send_is_too_late(self):
        row = self.hold()
        with mock.patch(SLACK_SEND, new=mock.AsyncMock(return_value='ts-3')):
            async_to_sync(holds.deliver)(row.id)
        self.assertEqual(holds.cancel(self.user, row.id), 'too_late')
        row.refresh_from_db()
        self.assertEqual(row.status, 'sent')

    def test_cancel_for_another_user_looks_like_an_unknown_id(self):
        row = self.hold(send_at=timezone.now() + timedelta(seconds=20))
        self.assertEqual(holds.cancel(self.other, row.id), 'not_found')
        self.assertEqual(holds.cancel(self.other, 999999), 'not_found')
        row.refresh_from_db()
        self.assertEqual(row.status, 'held')

    def test_send_now_sends_before_the_hold_would_have_ended(self):
        row = self.hold(send_at=timezone.now() + timedelta(seconds=20))
        slack = mock.AsyncMock(return_value='ts-7')
        with mock.patch(SLACK_SEND, new=slack):
            self.assertTrue(holds.send_now(self.user, row.id))
            self.assertEqual(async_to_sync(holds.deliver)(row.id), 'sent')
        slack.assert_awaited_once()

    def test_send_now_is_refused_once_the_hold_is_not_waiting(self):
        row = self.hold(status='cancelled')
        self.assertFalse(holds.send_now(self.user, row.id))

    def test_a_provider_error_fails_the_hold_and_is_never_retried(self):
        row = self.hold()
        slack = mock.AsyncMock(side_effect=RuntimeError('provider down'))
        with mock.patch(SLACK_SEND, new=slack):
            first = async_to_sync(holds.deliver)(row.id)
            second = async_to_sync(holds.deliver)(row.id)
        self.assertEqual((first, second), ('failed', 'skipped'))
        slack.assert_awaited_once()
        row.refresh_from_db()
        self.assertEqual(row.status, 'failed')
        self.assertEqual(row.error, 'The message could not be sent.')
        note = Notification.objects.get(user=self.user, type='outbound_failed')
        self.assertEqual(note.title, 'A message was not sent')
        self.assertEqual(note.data['hold_id'], row.id)

    def test_a_send_that_went_out_but_was_not_recorded_is_still_sent(self):
        # The provider accepted it; only our outbox write failed. Saying "not
        # sent" here would invite a second send.
        row = self.hold()
        slack = mock.AsyncMock(return_value='ts-8')
        with mock.patch(SLACK_SEND, new=slack), \
                mock.patch.object(OutboundMessage.objects, 'create',
                                  side_effect=RuntimeError('disk full')):
            self.assertEqual(async_to_sync(holds.deliver)(row.id), 'sent')
        row.refresh_from_db()
        self.assertEqual(row.status, 'sent')
        self.assertIn('could not be recorded', row.error)
        self.assertFalse(Notification.objects.filter(type='outbound_failed').exists())


@override_settings(OUTBOUND_HOLD_SECONDS=20)
class SweepTests(HoldBase):
    def test_the_sweep_delivers_an_overdue_hold(self):
        row = self.hold(send_at=timezone.now() - timedelta(minutes=1))
        with mock.patch(SLACK_SEND, new=mock.AsyncMock(return_value='ts-10')):
            result = async_to_sync(holds.sweep)()
        self.assertEqual(result, {'delivered': 1, 'unknown': 0})
        row.refresh_from_db()
        self.assertEqual(row.status, 'sent')

    def test_a_stuck_sending_row_becomes_unknown_and_is_never_sent_again(self):
        row = PendingSend.objects.create(
            user=self.user, tool='message_send',
            payload={'channel': 'slack', 'to': '#team-ops', 'body': 'x', 'draft_id': None},
            label='Slack to #team-ops', send_at=timezone.now(), status='sending')
        # A queryset update does not bump auto_now, so set the age directly.
        PendingSend.objects.filter(pk=row.pk).update(
            updated_at=timezone.now() - timedelta(minutes=6))
        slack = mock.AsyncMock(return_value='ts-11')
        with mock.patch(SLACK_SEND, new=slack):
            result = async_to_sync(holds.sweep)()
            again = async_to_sync(holds.sweep)()
        self.assertEqual(result, {'delivered': 0, 'unknown': 1})
        self.assertEqual(again, {'delivered': 0, 'unknown': 0})
        slack.assert_not_awaited()
        row.refresh_from_db()
        self.assertEqual(row.status, 'unknown')
        notes = Notification.objects.filter(user=self.user, type='outbound_failed')
        self.assertEqual(notes.count(), 1)
        self.assertIn('may or may not have gone out', notes.get().message)

    def test_a_recent_sending_row_is_left_alone(self):
        row = PendingSend.objects.create(
            user=self.user, tool='message_send', payload={}, label='x',
            send_at=timezone.now(), status='sending')
        self.assertEqual(async_to_sync(holds.sweep)(), {'delivered': 0, 'unknown': 0})
        row.refresh_from_db()
        self.assertEqual(row.status, 'sending')

    def test_the_sweep_takes_at_most_one_hundred_rows_a_pass(self):
        past = timezone.now() - timedelta(minutes=1)
        payload = {'channel': 'slack', 'to': '#team-ops', 'body': 'x', 'draft_id': None}
        PendingSend.objects.bulk_create([
            PendingSend(user=self.user, tool='message_send', payload=payload, label='x',
                        send_at=past, status='held') for _ in range(105)])
        with mock.patch(SLACK_SEND, new=mock.AsyncMock(return_value='ts')):
            result = async_to_sync(holds.sweep)()
        self.assertEqual(result['delivered'], 100)
        self.assertEqual(PendingSend.objects.filter(status='held').count(), 5)


@override_settings(OUTBOUND_HOLD_SECONDS=20)
class HoldRouteTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('route', 'r@example.com', 'pw')
        self.other = User.objects.create_user('elsewhere', 'e@example.com', 'pw')
        self.client.force_authenticate(user=self.user)

    def _hold(self, user=None, status='held', **kw):
        return PendingSend.objects.create(
            user=user or self.user, tool='message_send', payload={}, label='Slack to #x',
            send_at=timezone.now() + timedelta(seconds=20), status=status, **kw)

    def test_the_list_is_the_callers_and_capped(self):
        mine = [self._hold() for _ in range(55)]
        theirs = self._hold(user=self.other)
        res = self.client.get(reverse('messaging:hold_list'))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data['holds']), 50)
        self.assertTrue(res.data['truncated'])
        ids = {h['id'] for h in res.data['holds']}
        self.assertTrue(ids <= {row.id for row in mine})
        self.assertNotIn(theirs.id, ids)
        self.assertEqual({h['status'] for h in res.data['holds']}, {'held'})

    def test_the_list_can_be_narrowed_to_a_chat_session(self):
        self._hold(chat_session_id='sess-A')
        self._hold(chat_session_id='sess-B')
        res = self.client.get(reverse('messaging:hold_list'), {'session': 'sess-A'})
        self.assertEqual(len(res.data['holds']), 1)
        self.assertFalse(res.data['truncated'])

    def test_cancel_returns_cancelled_and_then_too_late(self):
        row = self._hold()
        url = reverse('messaging:hold_cancel', args=[row.id])
        self.assertEqual(self.client.post(url).data, {'status': 'cancelled'})
        again = self.client.post(url)
        self.assertEqual(again.status_code, 409)
        self.assertEqual(again.data, {'status': 'cancelled'})

    def test_a_foreign_id_gets_the_same_404_as_a_made_up_one(self):
        foreign = self._hold(user=self.other)
        for route in ('hold_cancel', 'hold_send_now'):
            theirs = self.client.post(reverse(f'messaging:{route}', args=[foreign.id]))
            made_up = self.client.post(reverse(f'messaging:{route}', args=[987654]))
            self.assertEqual(theirs.status_code, 404)
            self.assertEqual(theirs.status_code, made_up.status_code)
            self.assertEqual(theirs.content, made_up.content)
        foreign.refresh_from_db()
        self.assertEqual(foreign.status, 'held')

    def test_send_now_starts_delivery_and_reports_200(self):
        row = self._hold()
        with mock.patch('workflow_backend.background.run_in_thread') as start:
            res = self.client.post(reverse('messaging:hold_send_now', args=[row.id]))
        self.assertEqual(res.status_code, 200)
        start.call_args.args[0].close()
        start.assert_called_once()

    def test_send_now_after_it_has_been_sent_is_a_409(self):
        row = self._hold(status='sent')
        res = self.client.post(reverse('messaging:hold_send_now', args=[row.id]))
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data, {'status': 'sent'})
