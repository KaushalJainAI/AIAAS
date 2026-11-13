"""Native phone push: device registration, the Expo sender, and the one door."""
import os
from datetime import timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from notifications.expo_push import EXPO_PUSH_URL, MAX_MESSAGES_PER_REQUEST, send_expo_push
from notifications.models import DeviceToken, ScheduledNotification
from notifications.push import send_push

DEVICES_URL = '/api/notifications/push/devices/'


def _token(n):
    return f'ExponentPushToken[device-{n}]'


def _response(tickets=None, status=200, text=''):
    response = MagicMock()
    response.status_code = status
    response.text = text
    response.json.return_value = {'data': tickets or []}
    return response


def _ok_for(messages):
    return _response([{'status': 'ok', 'id': f'ticket-{i}'} for i in range(len(messages))])


class RegisterDeviceTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='phone', password='pw')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_register_creates_a_row(self):
        response = self.client.post(
            DEVICES_URL,
            {'token': _token(1), 'platform': 'android', 'app_version': '1.2.0'},
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        device = DeviceToken.objects.get(token=_token(1))
        self.assertEqual(device.user, self.user)
        self.assertEqual(device.platform, 'android')
        self.assertEqual(device.app_version, '1.2.0')

    def test_registering_the_same_token_again_upserts(self):
        self.client.post(DEVICES_URL, {'token': _token(1), 'platform': 'ios'}, format='json')
        response = self.client.post(
            DEVICES_URL,
            {'token': _token(1), 'platform': 'ios', 'app_version': '1.3.0'},
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(DeviceToken.objects.filter(token=_token(1)).count(), 1)
        self.assertEqual(DeviceToken.objects.get(token=_token(1)).app_version, '1.3.0')

    def test_a_token_held_by_another_account_moves_to_the_caller(self):
        other = User.objects.create_user(username='previous', password='pw')
        DeviceToken.objects.create(user=other, token=_token(2), platform='android')

        response = self.client.post(DEVICES_URL, {'token': _token(2), 'platform': 'android'}, format='json')

        self.assertEqual(response.status_code, 201)
        self.assertEqual(DeviceToken.objects.get(token=_token(2)).user, self.user)
        self.assertEqual(DeviceToken.objects.filter(token=_token(2)).count(), 1)

    def test_legacy_expo_push_token_spelling_is_accepted(self):
        response = self.client.post(
            DEVICES_URL, {'token': 'ExpoPushToken[abc123]', 'platform': 'ios'}, format='json',
        )
        self.assertEqual(response.status_code, 201)

    def test_invalid_tokens_are_rejected(self):
        for bad in ['not-a-token', 'fcm:abcdef', 'ExponentPushToken[]', 'ExponentPushToken[a b]',
                    'ExponentPushToken[abc', '']:
            response = self.client.post(DEVICES_URL, {'token': bad, 'platform': 'ios'}, format='json')
            self.assertEqual(response.status_code, 400, bad)
        self.assertFalse(DeviceToken.objects.exists())

    def test_unknown_platform_is_rejected(self):
        response = self.client.post(DEVICES_URL, {'token': _token(3), 'platform': 'web'}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_register_requires_auth(self):
        response = APIClient().post(DEVICES_URL, {'token': _token(4), 'platform': 'ios'}, format='json')
        self.assertEqual(response.status_code, 401)

    def test_delete_removes_the_callers_own_token(self):
        DeviceToken.objects.create(user=self.user, token=_token(5), platform='ios')
        response = self.client.delete(DEVICES_URL, {'token': _token(5)}, format='json')
        self.assertEqual(response.status_code, 204)
        self.assertFalse(DeviceToken.objects.filter(token=_token(5)).exists())

    def test_delete_cannot_remove_another_accounts_token(self):
        other = User.objects.create_user(username='victim', password='pw')
        DeviceToken.objects.create(user=other, token=_token(6), platform='ios')

        response = self.client.delete(DEVICES_URL, {'token': _token(6)}, format='json')

        self.assertEqual(response.status_code, 204)
        self.assertTrue(DeviceToken.objects.filter(token=_token(6), user=other).exists())

    def test_delete_of_an_unknown_token_is_still_204(self):
        response = self.client.delete(DEVICES_URL, {'token': _token(7)}, format='json')
        self.assertEqual(response.status_code, 204)

    def test_delete_without_a_token_is_400(self):
        response = self.client.delete(DEVICES_URL, {}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_delete_requires_auth(self):
        response = APIClient().delete(DEVICES_URL, {'token': _token(8)}, format='json')
        self.assertEqual(response.status_code, 401)


@override_settings(EXPO_PUSH_ENABLED=True, EXPO_ACCESS_TOKEN='')
class SendExpoPushTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='sender', password='pw')
        self.http = MagicMock()
        patcher = patch('notifications.expo_push._http_client', return_value=self.http)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _device(self, n, user=None):
        return DeviceToken.objects.create(user=user or self.user, token=_token(n), platform='android')

    def test_builds_one_expo_message_per_device(self):
        self._device(1)
        self._device(2)
        self.http.post.return_value = _ok_for([1, 2])

        sent = send_expo_push(self.user, 'Approval needed', 'Open the Inbox', {'action_url': '/runs'})

        self.assertEqual(sent, 2)
        self.http.post.assert_called_once()
        args, kwargs = self.http.post.call_args
        self.assertEqual(args[0], EXPO_PUSH_URL)
        messages = kwargs['json']
        self.assertEqual({m['to'] for m in messages}, {_token(1), _token(2)})
        for message in messages:
            self.assertEqual(message['title'], 'Approval needed')
            self.assertEqual(message['body'], 'Open the Inbox')
            self.assertEqual(message['data'], {'action_url': '/runs'})
            self.assertEqual(message['sound'], 'default')
            self.assertEqual(message['priority'], 'high')
            self.assertEqual(message['channelId'], 'default')

    def test_no_access_token_header_when_unset(self):
        self._device(1)
        self.http.post.return_value = _ok_for([1])
        send_expo_push(self.user, 'Hi', 'there')
        self.assertNotIn('Authorization', self.http.post.call_args.kwargs['headers'])

    @override_settings(EXPO_ACCESS_TOKEN='secret-token')
    def test_access_token_is_sent_as_bearer_when_set(self):
        self._device(1)
        self.http.post.return_value = _ok_for([1])
        send_expo_push(self.user, 'Hi', 'there')
        self.assertEqual(
            self.http.post.call_args.kwargs['headers']['Authorization'], 'Bearer secret-token',
        )

    def test_chunks_over_one_hundred_messages(self):
        total = MAX_MESSAGES_PER_REQUEST * 2 + 5
        for n in range(total):
            self._device(n)
        self.http.post.side_effect = lambda url, json, headers: _ok_for(json)

        sent = send_expo_push(self.user, 'Bulk', 'body')

        self.assertEqual(sent, total)
        sizes = [len(c.kwargs['json']) for c in self.http.post.call_args_list]
        self.assertEqual(sizes, [100, 100, 5])
        self.assertTrue(all(len(c.kwargs['json']) <= 100 for c in self.http.post.call_args_list))

    def test_device_not_registered_deletes_that_token_only(self):
        self._device(1)
        self._device(2)

        def tickets(url, json, headers):
            return _response([
                {'status': 'error', 'message': 'gone', 'details': {'error': 'DeviceNotRegistered'}}
                if m['to'] == _token(2) else {'status': 'ok', 'id': 'x'}
                for m in json
            ])

        self.http.post.side_effect = tickets

        sent = send_expo_push(self.user, 'Hi', 'there')

        self.assertEqual(sent, 1)
        self.assertTrue(DeviceToken.objects.filter(token=_token(1)).exists())
        self.assertFalse(DeviceToken.objects.filter(token=_token(2)).exists())

    def test_other_ticket_errors_keep_the_token(self):
        self._device(1)
        self.http.post.return_value = _response([
            {'status': 'error', 'message': 'slow down', 'details': {'error': 'MessageRateExceeded'}},
        ])
        self.assertEqual(send_expo_push(self.user, 'Hi', 'there'), 0)
        self.assertTrue(DeviceToken.objects.filter(token=_token(1)).exists())

    def test_network_error_is_swallowed(self):
        self._device(1)
        self.http.post.side_effect = httpx.ConnectError('dns blip')
        self.assertEqual(send_expo_push(self.user, 'Hi', 'there'), 0)
        self.assertTrue(DeviceToken.objects.filter(token=_token(1)).exists())

    def test_a_failed_chunk_does_not_stop_the_next(self):
        total = MAX_MESSAGES_PER_REQUEST + 3
        for n in range(total):
            self._device(n)
        self.http.post.side_effect = [
            httpx.ReadTimeout('slow'),
            _response([{'status': 'ok', 'id': 'x'}] * 3),
        ]
        self.assertEqual(send_expo_push(self.user, 'Hi', 'there'), 3)

    def test_http_error_status_is_logged_not_raised(self):
        self._device(1)
        self.http.post.return_value = _response(status=500, text='upstream down')
        self.assertEqual(send_expo_push(self.user, 'Hi', 'there'), 0)
        self.assertTrue(DeviceToken.objects.filter(token=_token(1)).exists())

    def test_non_json_reply_is_swallowed(self):
        self._device(1)
        response = _response()
        response.json.side_effect = ValueError('not json')
        self.http.post.return_value = response
        self.assertEqual(send_expo_push(self.user, 'Hi', 'there'), 0)

    def test_user_without_devices_sends_nothing(self):
        self.assertEqual(send_expo_push(self.user, 'Hi', 'there'), 0)
        self.http.post.assert_not_called()

    def test_other_users_devices_are_not_pushed(self):
        other = User.objects.create_user(username='bystander', password='pw')
        self._device(1, user=other)
        self.assertEqual(send_expo_push(self.user, 'Hi', 'there'), 0)
        self.http.post.assert_not_called()

    def test_nothing_to_say_sends_nothing(self):
        self._device(1)
        self.assertEqual(send_expo_push(self.user, '', ''), 0)
        self.http.post.assert_not_called()


class DisabledTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='off', password='pw')
        DeviceToken.objects.create(user=self.user, token=_token(1), platform='ios')

    @override_settings(EXPO_PUSH_ENABLED=False)
    def test_disabled_setting_sends_nothing(self):
        with patch('notifications.expo_push._http_client') as client:
            self.assertEqual(send_expo_push(self.user, 'Hi', 'there'), 0)
        client.assert_not_called()

    def test_test_settings_keep_expo_off(self):
        from django.conf import settings

        self.assertFalse(settings.EXPO_PUSH_ENABLED)


class SendPushFanOutTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='fanout', password='pw')

    def test_one_call_reaches_both_channels(self):
        with patch('notifications.webpush.send_web_push', return_value=2) as web, \
                patch('notifications.expo_push.send_expo_push', return_value=1) as expo:
            reached = send_push(self.user, title='T', body='B', action_url='/runs', kind='hitl_request')

        self.assertEqual(reached, 3)
        web.assert_called_once()
        self.assertEqual(web.call_args.kwargs['action_url'], '/runs')
        expo.assert_called_once()
        self.assertEqual(expo.call_args.kwargs['data'], {'kind': 'hitl_request', 'action_url': '/runs'})

    def test_external_action_url_is_never_sent_to_the_phone(self):
        for bad in ['https://evil.example/steal', '//evil.example', '/\\evil.example']:
            with patch('notifications.webpush.send_web_push', return_value=0), \
                    patch('notifications.expo_push.send_expo_push', return_value=0) as expo:
                send_push(self.user, title='T', body='B', action_url=bad)
            self.assertNotIn('action_url', expo.call_args.kwargs['data'], bad)

    def test_default_action_url_is_inbox(self):
        with patch('notifications.webpush.send_web_push', return_value=0), \
                patch('notifications.expo_push.send_expo_push', return_value=0) as expo:
            send_push(self.user, title='T', body='B')
        self.assertEqual(expo.call_args.kwargs['data']['action_url'], '/inbox')

    def test_a_web_failure_does_not_stop_the_phone_push(self):
        with patch('notifications.webpush.send_web_push', side_effect=RuntimeError('boom')), \
                patch('notifications.expo_push.send_expo_push', return_value=1) as expo:
            self.assertEqual(send_push(self.user, title='T', body='B'), 1)
        expo.assert_called_once()

    def test_scheduled_reminders_go_through_the_one_door(self):
        from notifications.scheduled import run_scheduled_sweep

        ScheduledNotification.objects.create(
            user=self.user, title='Standup', message='Ten minutes',
            next_run_at=timezone.now() - timedelta(minutes=1), active=True,
        )
        with patch('notifications.push.send_push') as push:
            run_scheduled_sweep()
        push.assert_called_once()


class OneDoorTests(TestCase):
    """Nothing outside the two channel modules may call a channel directly.

    A direct call skips the fan-out, so a phone would silently miss every
    notification that caller sends. This scans the backend's own source.
    """

    BACKEND = Path(__file__).resolve().parents[2]
    ALLOWED = {
        Path('notifications/push.py'),
        Path('notifications/webpush.py'),
        Path('notifications/expo_push.py'),
    }
    CHANNEL_CALLS = ('send_web_push', 'send_expo_push')

    def test_only_the_fan_out_calls_a_channel(self):
        offenders = []
        for root, dirs, files in os.walk(self.BACKEND):
            dirs[:] = [d for d in dirs if d not in {'venv', 'tests', 'migrations', '__pycache__', 'node_modules'}
                       and not d.startswith('.')]
            for name in files:
                if not name.endswith('.py'):
                    continue
                path = Path(root, name)
                rel = path.relative_to(self.BACKEND)
                if rel in self.ALLOWED:
                    continue
                text = path.read_text(encoding='utf-8', errors='ignore')
                for channel in self.CHANNEL_CALLS:
                    if channel in text:
                        offenders.append(f'{rel}: {channel}')
        self.assertEqual(offenders, [], 'Call notifications.push.send_push instead')
