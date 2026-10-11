"""
Continue with ChatGPT: sign-in, the rotating refresh token, and the off switch.

No network: `requests` and the ID-token check are stubbed. What is pinned is
what would be silent if it broke — a callback this server did not start being
accepted, a rotated refresh token not being saved, a refresh spent twice, a
temporary failure signing someone out.
"""
from __future__ import annotations

from datetime import timedelta
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlsplit

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from credentials import chatgpt
from credentials.models import Credential, CredentialType

User = get_user_model()


def _response(status=200, body=None):
    response = MagicMock(status_code=status)
    response.json.return_value = body if body is not None else {}
    return response


def _tokens(**over):
    return {'access_token': 'at-1', 'refresh_token': 'rt-1', 'id_token': 'idt',
            'expires_in': 3600, 'scope': chatgpt.SCOPE, **over}


@override_settings(CHATGPT_PLAN_ENABLED=True)
class SignInTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username='u', password='pw')

    def _begin(self, user=None):
        url = chatgpt.begin((user or self.user).id, request_host='localhost:8000')
        return {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}

    def _complete(self, params, *, tokens=None, client_id='app_issued'):
        claims = {'sub': 'user-sub', 'email': 'me@example.com', 'nonce': params['nonce']}
        with patch('credentials.chatgpt.requests.post',
                   return_value=_response(200, tokens or _tokens())) as post, \
                patch('credentials.chatgpt._validated_identity', return_value=claims):
            credential = chatgpt.complete(
                state=params['state'], code='the-code', client_id=client_id)
        return credential, post

    def test_the_authorize_url_is_a_pkce_request_to_a_loopback_address(self):
        params = self._begin()
        self.assertEqual(params['client_id'], chatgpt.DYNAMIC_CLIENT)
        self.assertEqual(params['code_challenge_method'], 'S256')
        self.assertEqual(params['redirect_uri'], 'http://127.0.0.1:8000/auth/callback')
        self.assertEqual(params['resource'], chatgpt.RESOURCE)
        self.assertIn('agent_name_hint', params)
        attempt = cache.get(chatgpt._attempt_key(params['state']))
        self.assertEqual(chatgpt._challenge(attempt['verifier']), params['code_challenge'])

    def test_the_host_id_is_stable_and_is_not_the_secret_key(self):
        from django.conf import settings
        self.assertEqual(chatgpt.host_id(), chatgpt.host_id())
        self.assertNotIn(settings.SECRET_KEY, chatgpt.host_id())

    def test_a_finished_sign_in_stores_encrypted_tokens_and_the_issued_client(self):
        params = self._begin()
        credential, post = self._complete(params)
        form = post.call_args.kwargs['data']
        self.assertEqual(form['client_id'], 'app_issued')
        self.assertEqual(form['grant_type'], 'authorization_code')
        self.assertNotIn('client_secret', form)

        credential.refresh_from_db()
        self.assertTrue(credential.is_verified)
        self.assertEqual(credential.user_id, self.user.id)
        self.assertNotIn(b'at-1', bytes(credential.access_token))
        self.assertEqual(chatgpt._decrypt(credential.access_token), 'at-1')
        self.assertEqual(credential.get_credential_data()['client_id'], 'app_issued')
        self.assertEqual(chatgpt.status(self.user.id)['email'], 'me@example.com')

    def test_a_state_this_server_did_not_issue_is_refused(self):
        with self.assertRaises(chatgpt.ChatGPTAuthError) as caught:
            chatgpt.complete(state='made-up', code='c', client_id='app_x')
        self.assertEqual(caught.exception.code, 'unknown_attempt')
        self.assertFalse(Credential.objects.exists())

    def test_a_state_is_spent_by_its_first_use(self):
        params = self._begin()
        self._complete(params)
        with self.assertRaises(chatgpt.ChatGPTAuthError):
            chatgpt.complete(state=params['state'], code='again', client_id='app_issued')

    def test_the_credential_belongs_to_whoever_started_the_sign_in(self):
        other = User.objects.create_user(username='other', password='pw')
        credential, _ = self._complete(self._begin(other))
        self.assertEqual(credential.user_id, other.id)
        self.assertFalse(chatgpt.status(self.user.id)['connected'])

    def test_a_first_sign_in_with_no_issued_client_id_is_refused(self):
        params = self._begin()
        with self.assertRaises(chatgpt.ChatGPTAuthError) as caught:
            chatgpt.complete(state=params['state'], code='c', client_id='')
        self.assertEqual(caught.exception.code, 'no_client_id')

    def test_an_id_token_for_another_attempt_is_refused(self):
        params = self._begin()
        fake_jwt = MagicMock()
        fake_jwt.decode.return_value = {'sub': 's', 'nonce': 'not-this-attempt'}
        with patch('credentials.chatgpt.requests.post', return_value=_response(200, _tokens())), \
                patch('credentials.chatgpt._discovery', return_value={}), \
                patch.dict('sys.modules', {'jwt': fake_jwt}):
            with self.assertRaises(chatgpt.ChatGPTAuthError) as caught:
                chatgpt.complete(state=params['state'], code='c', client_id='app_issued')
        self.assertEqual(caught.exception.code, 'bad_nonce')
        self.assertFalse(Credential.objects.exists())

    def test_signing_in_again_replaces_the_credential_and_reuses_its_client(self):
        self._complete(self._begin())
        again = self._begin()
        self.assertEqual(again['client_id'], 'app_issued')
        self.assertNotIn('agent_name_hint', again)
        self._complete(again, tokens=_tokens(access_token='at-2'), client_id='')
        self.assertEqual(Credential.objects.filter(user=self.user).count(), 1)


@override_settings(CHATGPT_PLAN_ENABLED=True)
class RefreshTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username='u', password='pw')
        self.credential = chatgpt._save(
            user_id=self.user.id, client_id='app_issued', tokens=_tokens(),
            identity={'sub': 's', 'email': 'me@example.com'})

    def _expire(self):
        Credential.objects.filter(id=self.credential.id).update(
            token_expires_at=timezone.now() - timedelta(minutes=1))

    def test_a_live_token_is_returned_without_calling_anyone(self):
        with patch('credentials.chatgpt.requests.post') as post:
            token = chatgpt.access_token_for(self.credential.id, self.user.id)
        self.assertEqual(token, 'at-1')
        post.assert_not_called()

    def test_a_refresh_saves_the_rotated_refresh_token(self):
        self._expire()
        rotated = _tokens(access_token='at-2', refresh_token='rt-2')
        with patch('credentials.chatgpt.requests.post',
                   return_value=_response(200, rotated)) as post:
            token = chatgpt.access_token_for(self.credential.id, self.user.id)
        self.assertEqual(token, 'at-2')
        form = post.call_args.kwargs['data']
        self.assertEqual(form['refresh_token'], 'rt-1')
        self.assertEqual(form['client_id'], 'app_issued')
        self.credential.refresh_from_db()
        self.assertEqual(chatgpt._decrypt(self.credential.refresh_token), 'rt-2')

    def test_a_second_call_does_not_spend_the_refresh_token_again(self):
        self._expire()
        rotated = _tokens(access_token='at-2', refresh_token='rt-2')
        with patch('credentials.chatgpt.requests.post',
                   return_value=_response(200, rotated)) as post:
            chatgpt.access_token_for(self.credential.id, self.user.id)
            self.assertEqual(
                chatgpt.access_token_for(self.credential.id, self.user.id), 'at-2')
        self.assertEqual(post.call_count, 1)

    def test_a_refused_refresh_signs_the_user_out(self):
        self._expire()
        with patch('credentials.chatgpt.requests.post',
                   return_value=_response(400, {'error': 'invalid_grant'})):
            with self.assertRaises(chatgpt.ChatGPTAuthError) as caught:
                chatgpt.access_token_for(self.credential.id, self.user.id)
        self.assertTrue(caught.exception.needs_sign_in)
        self.credential.refresh_from_db()
        self.assertFalse(self.credential.is_verified)
        self.assertFalse(self.credential.refresh_token)
        self.assertTrue(chatgpt.status(self.user.id)['needs_sign_in'])

    def test_a_temporary_failure_keeps_the_tokens(self):
        self._expire()
        with patch('credentials.chatgpt.requests.post', return_value=_response(503, {})):
            with self.assertRaises(chatgpt.ChatGPTAuthError) as caught:
                chatgpt.access_token_for(self.credential.id, self.user.id)
        self.assertFalse(caught.exception.needs_sign_in)
        self.credential.refresh_from_db()
        self.assertTrue(self.credential.is_verified)
        self.assertEqual(chatgpt._decrypt(self.credential.refresh_token), 'rt-1')

    def test_another_user_cannot_read_this_credential(self):
        other = User.objects.create_user(username='other', password='pw')
        with self.assertRaises(chatgpt.ChatGPTAuthError):
            chatgpt.access_token_for(self.credential.id, other.id)

    def test_disconnect_deletes_even_when_openai_cannot_be_reached(self):
        import requests
        with patch('credentials.chatgpt._discovery',
                   return_value={'revocation_endpoint': 'https://auth.openai.com/revoke'}), \
                patch('credentials.chatgpt.requests.post',
                      side_effect=requests.ConnectionError()):
            self.assertFalse(chatgpt.disconnect(self.user.id))
        self.assertFalse(Credential.objects.filter(id=self.credential.id).exists())


class RouteTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username='u', password='pw')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_the_credential_type_exists_after_migrate_and_is_not_offered(self):
        cred_type = CredentialType.objects.get(slug='chatgpt')
        self.assertFalse(cred_type.is_active)
        listed = self.client.get('/api/credentials/types/')
        self.assertEqual(listed.status_code, 200)
        self.assertNotIn('"chatgpt"', listed.content.decode())
        self.assertIn('"openrouter"', listed.content.decode())

    def test_switched_off_the_routes_do_not_exist(self):
        with override_settings(CHATGPT_PLAN_ENABLED=False):
            self.assertEqual(self.client.post('/api/credentials/chatgpt/start/').status_code, 404)
            self.assertEqual(self.client.get('/auth/callback?code=a&state=b').status_code, 404)
            status = self.client.get('/api/credentials/chatgpt/status/')
            self.assertEqual(status.status_code, 200)
            self.assertFalse(status.json()['enabled'])

    @override_settings(CHATGPT_PLAN_ENABLED=True, ALLOWED_HOSTS=['*'])
    def test_start_refuses_a_request_that_did_not_come_from_this_machine(self):
        response = self.client.post('/api/credentials/chatgpt/start/', HTTP_HOST='app.example.com')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'not_local')

    @override_settings(CHATGPT_PLAN_ENABLED=True, ALLOWED_HOSTS=['*'])
    def test_start_returns_an_authorize_url_on_loopback(self):
        response = self.client.post('/api/credentials/chatgpt/start/', HTTP_HOST='localhost:8000')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['authorize_url'].startswith(chatgpt.AUTHORIZE_URL))

    @override_settings(CHATGPT_PLAN_ENABLED=True, ALLOWED_HOSTS=['*'])
    def test_the_callback_says_the_same_thing_for_every_failure(self):
        anonymous = APIClient()
        unknown = anonymous.get('/auth/callback?code=a&state=nope', HTTP_HOST='127.0.0.1:8000')
        declined = anonymous.get('/auth/callback?error=access_denied', HTTP_HOST='127.0.0.1:8000')
        self.assertEqual(unknown.status_code, 400)
        self.assertEqual(unknown.content, declined.content)
        self.assertNotIn(b'unknown_attempt', unknown.content)

    @override_settings(CHATGPT_PLAN_ENABLED=True, ALLOWED_HOSTS=['*'])
    def test_the_callback_is_not_served_to_another_host(self):
        response = APIClient().get('/auth/callback?code=a&state=b', HTTP_HOST='app.example.com')
        self.assertEqual(response.status_code, 404)

    def test_the_start_route_needs_a_signed_in_user(self):
        with override_settings(CHATGPT_PLAN_ENABLED=True):
            self.assertIn(APIClient().post('/api/credentials/chatgpt/start/').status_code, (401, 403))
