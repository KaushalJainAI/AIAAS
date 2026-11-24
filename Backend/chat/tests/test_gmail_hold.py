"""
The send window for email (docs/UNDO_PLAN.md §5, D12-D14). The same four
cases as messaging/tests/test_holds.py, with Google's `send_json` replaced.
Nothing here reaches Google.
"""
from __future__ import annotations

import json
from datetime import timedelta
from unittest.mock import AsyncMock, patch

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from chat.tools.google import gmail
from chat.tools.google.client import GoogleAPIError
from messaging import holds
from messaging.models import PendingSend
from notifications.models import Notification

User = get_user_model()

SEND_JSON = 'chat.tools.google.gmail.send_json'
SPAWN = 'chat.tools.google.gmail.spawn'
ARGS = {'to': 'bob@example.com', 'subject': 'Hi', 'body': 'Body text'}
SENT = {'id': 'm1', 'threadId': 't1'}


@override_settings(OUTBOUND_HOLD_SECONDS=20)
class GmailHoldTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('mailer', 'm@example.com', 'pw')
        self.ctx = {'user_id': self.user.id, 'session_id': 'sess-g', 'caller': 'chat'}

    def send(self, args=ARGS, ctx=None, send_json=None):
        mock_send = send_json or AsyncMock(return_value=SENT)
        with patch(SEND_JSON, new=mock_send):
            out = async_to_sync(gmail.gmail_send_message)(args, dict(ctx or self.ctx))
        return out, mock_send

    def hold(self, send_at=None):
        return PendingSend.objects.create(
            user=self.user, tool='gmail_send_message', payload=dict(ARGS),
            label='Email to bob@example.com',
            send_at=send_at or timezone.now() - timedelta(seconds=1),
            chat_session_id='sess-g')

    def test_an_attended_email_waits_and_is_not_sent_yet(self):
        with patch(SPAWN) as start:
            out, send_json = self.send()
        start.call_args.args[0].close()  # the timer coroutine, never awaited here
        data = json.loads(out)

        self.assertEqual(data['status'], 'queued')
        self.assertTrue(data['queued'])
        self.assertIn('will be sent in 20 s', data['text'])
        row = PendingSend.objects.get(id=data['hold_id'])
        self.assertEqual((row.status, row.tool), ('held', 'gmail_send_message'))
        self.assertEqual(row.payload['body'], 'Body text')  # attended: no AI line
        self.assertEqual(row.chat_session_id, 'sess-g')
        send_json.assert_not_awaited()
        start.assert_called_once()

    def test_an_unattended_email_goes_at_once_and_its_output_is_unchanged(self):
        # Pinned: the string the tool returned before the send window.
        out, send_json = self.send(ctx={**self.ctx, 'caller': 'trigger'})
        self.assertEqual(out, json.dumps({
            'status': 'success', 'message_id': 'm1', 'thread_id': 't1',
            'text': 'Email sent.'}))
        send_json.assert_awaited_once()
        self.assertEqual(PendingSend.objects.count(), 0)

    @override_settings(OUTBOUND_HOLD_SECONDS=0)
    def test_a_zero_hold_sends_at_once(self):
        out, send_json = self.send()
        self.assertEqual(json.loads(out)['status'], 'success')
        send_json.assert_awaited_once()
        self.assertEqual(PendingSend.objects.count(), 0)

    def test_a_bad_address_fails_now_and_is_not_held(self):
        # Composing happens before the wait, so the model hears about it at once.
        bad = {**ARGS, 'to': 'a@x.com\r\nBcc: evil@x.com'}
        with patch(SPAWN) as start:
            out, send_json = self.send(args=bad)
        self.assertEqual(json.loads(out), {
            'error': 'Addresses may not contain line breaks.', 'code': 'bad_request'})
        start.assert_not_called()
        send_json.assert_not_awaited()
        self.assertEqual(PendingSend.objects.count(), 0)

    def test_a_held_email_is_sent_once_and_the_second_call_skips(self):
        row = self.hold()
        send_json = AsyncMock(return_value=SENT)
        with patch(SEND_JSON, new=send_json):
            first = async_to_sync(holds.deliver)(row.id)
            second = async_to_sync(holds.deliver)(row.id)
        self.assertEqual((first, second), ('sent', 'skipped'))
        send_json.assert_awaited_once()
        # Google gets only the user id, never the run's context.
        self.assertEqual(send_json.await_args.args[0], {'user_id': self.user.id})
        row.refresh_from_db()
        self.assertEqual((row.status, row.result['message_id']), ('sent', 'm1'))

    def test_a_cancelled_email_is_never_sent(self):
        row = self.hold(send_at=timezone.now() + timedelta(seconds=20))
        self.assertEqual(holds.cancel(self.user, row.id), 'cancelled')
        send_json = AsyncMock(return_value=SENT)
        with patch(SEND_JSON, new=send_json):
            self.assertEqual(async_to_sync(holds.deliver)(row.id), 'skipped')
        send_json.assert_not_awaited()

    def test_send_now_sends_before_the_wait_would_have_ended(self):
        row = self.hold(send_at=timezone.now() + timedelta(seconds=20))
        send_json = AsyncMock(return_value=SENT)
        with patch(SEND_JSON, new=send_json):
            self.assertTrue(holds.send_now(self.user, row.id))
            self.assertEqual(async_to_sync(holds.deliver)(row.id), 'sent')
        send_json.assert_awaited_once()

    def test_a_google_refusal_fails_the_hold_with_its_words_and_is_not_retried(self):
        row = self.hold()
        send_json = AsyncMock(side_effect=GoogleAPIError('quota', 'Gmail is busy.', 429))
        with patch(SEND_JSON, new=send_json):
            first = async_to_sync(holds.deliver)(row.id)
            second = async_to_sync(holds.deliver)(row.id)
        self.assertEqual((first, second), ('failed', 'skipped'))
        send_json.assert_awaited_once()
        row.refresh_from_db()
        self.assertEqual((row.status, row.error), ('failed', 'Gmail is busy.'))
        note = Notification.objects.get(user=self.user, type='outbound_failed')
        self.assertEqual(note.message, 'Email to bob@example.com: Gmail is busy.')

    def test_a_refused_send_with_no_hold_keeps_the_old_error_shape(self):
        send_json = AsyncMock(side_effect=GoogleAPIError('quota', 'Gmail is busy.', 429))
        with override_settings(OUTBOUND_HOLD_SECONDS=0):
            out, _ = self.send(send_json=send_json)
        self.assertEqual(out, json.dumps({'error': 'Gmail is busy.', 'code': 'quota'}))
