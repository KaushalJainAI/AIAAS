"""What is left on an OpenRouter key: llm/balance.py and GET /api/credentials/<id>/balance/.

OpenRouter is answered by an httpx MockTransport swapped in for the shared
client (the same seam voice/tts tests use), so nothing reaches the network.
"""
import json
from contextlib import contextmanager
from unittest.mock import patch

import httpx
from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from credentials.models import Credential, CredentialAuditLog, CredentialType
from llm import balance
from llm.balance import openrouter_key_balance

User = get_user_model()

KEY = 'sk-or-v1-balance-test-key-0001'

KEY_OK_LIMITED = {'data': {
    'label': 'sk-or-v1-...0001', 'usage': 4.47, 'limit': 10, 'limit_remaining': 5.53,
    'usage_daily': 0.01, 'usage_weekly': 1.2, 'usage_monthly': 4.47, 'is_free_tier': False,
}}
KEY_OK_UNLIMITED = {'data': {
    'label': 'sk-or-v1-...0001', 'usage': 4.47, 'limit': None, 'limit_remaining': None,
    'usage_daily': 0.0, 'usage_monthly': 4.47, 'is_free_tier': False,
}}
CREDITS_OK = {'data': {'total_credits': 20, 'total_usage': 15}}


class FakeOpenRouter:
    """Answers the two OpenRouter routes from a script; records every request.

    Each route's script is `(status, body)`, or an exception to raise instead.
    """

    def __init__(self, key=(200, KEY_OK_LIMITED), credits=(200, CREDITS_OK)):
        self.scripts = {balance.KEY_URL: key, balance.CREDITS_URL: credits}
        self.calls = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.calls.append((url, request.headers.get('authorization')))
        outcome = self.scripts[url]
        if isinstance(outcome, Exception):
            raise outcome
        status, body = outcome
        if body is None:
            return httpx.Response(status, content=b'<html>not json</html>')
        return httpx.Response(status, json=body)

    @contextmanager
    def installed(self):
        client = httpx.AsyncClient(transport=httpx.MockTransport(self.handler))
        with patch('workflow_backend.httpclient.shared_client', return_value=client):
            yield self


class OpenRouterBalanceFunctionTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_a_limited_key_reports_what_is_left(self):
        fake = FakeOpenRouter()
        with fake.installed():
            result = async_to_sync(openrouter_key_balance)(KEY)

        self.assertTrue(result['available'])
        self.assertEqual(result['limit'], 10.0)
        self.assertEqual(result['limit_remaining'], 5.53)
        self.assertEqual(result['usage'], 4.47)
        self.assertEqual(result['usage_daily'], 0.01)
        self.assertEqual(result['usage_monthly'], 4.47)
        self.assertFalse(result['is_free_tier'])
        self.assertEqual(result['account_credits_remaining'], 5.0)

    def test_the_key_is_sent_as_a_bearer_token_and_never_returned(self):
        fake = FakeOpenRouter()
        with fake.installed():
            result = async_to_sync(openrouter_key_balance)(KEY)

        self.assertEqual({call[1] for call in fake.calls}, {f'Bearer {KEY}'})
        self.assertNotIn(KEY, json.dumps(result))

    def test_an_unlimited_key_has_null_limits_and_no_account_figure(self):
        # 403 on /credits is the normal answer for a key that may not read the account.
        fake = FakeOpenRouter(key=(200, KEY_OK_UNLIMITED), credits=(403, {'error': 'forbidden'}))
        with fake.installed():
            result = async_to_sync(openrouter_key_balance)(KEY)

        self.assertTrue(result['available'])
        self.assertIsNone(result['limit'])
        self.assertIsNone(result['limit_remaining'])
        self.assertEqual(result['usage'], 4.47)
        self.assertIsNone(result['account_credits_remaining'])

    def test_a_rejected_key_says_so(self):
        fake = FakeOpenRouter(key=(401, {'error': 'no'}))
        with fake.installed():
            result = async_to_sync(openrouter_key_balance)(KEY)

        self.assertFalse(result['available'])
        self.assertIn('rejected', result['reason'])
        self.assertNotIn(KEY, result['reason'])

    def test_a_server_error_names_its_status(self):
        fake = FakeOpenRouter(key=(503, None))
        with fake.installed():
            result = async_to_sync(openrouter_key_balance)(KEY)

        self.assertFalse(result['available'])
        self.assertIn('HTTP 503', result['reason'])

    def test_a_timeout_is_reported_as_one(self):
        fake = FakeOpenRouter(key=httpx.ReadTimeout('slow'))
        with fake.installed():
            result = async_to_sync(openrouter_key_balance)(KEY)

        self.assertFalse(result['available'])
        self.assertIn('did not answer in time', result['reason'])

    def test_a_connection_failure_is_reported_as_one(self):
        fake = FakeOpenRouter(key=httpx.ConnectError('refused'))
        with fake.installed():
            result = async_to_sync(openrouter_key_balance)(KEY)

        self.assertFalse(result['available'])
        self.assertIn('Could not reach OpenRouter', result['reason'])

    def test_an_answer_without_data_is_not_understood(self):
        fake = FakeOpenRouter(key=(200, {'unexpected': True}))
        with fake.installed():
            result = async_to_sync(openrouter_key_balance)(KEY)

        self.assertFalse(result['available'])
        self.assertIn('not understood', result['reason'])

    def test_an_empty_key_makes_no_call(self):
        fake = FakeOpenRouter()
        with fake.installed():
            result = async_to_sync(openrouter_key_balance)('')

        self.assertFalse(result['available'])
        self.assertEqual(fake.calls, [])

    def test_a_good_answer_is_reused_for_a_minute(self):
        fake = FakeOpenRouter()
        with fake.installed():
            first = async_to_sync(openrouter_key_balance)(KEY)
            calls_after_first = len(fake.calls)
            second = async_to_sync(openrouter_key_balance)(KEY)

        self.assertEqual(calls_after_first, 2)  # /key and /credits
        self.assertEqual(len(fake.calls), 2)
        self.assertEqual(first, second)

    def test_a_failure_is_not_cached(self):
        failing = FakeOpenRouter(key=(500, None))
        with failing.installed():
            async_to_sync(openrouter_key_balance)(KEY)

        working = FakeOpenRouter()
        with working.installed():
            result = async_to_sync(openrouter_key_balance)(KEY)

        self.assertTrue(result['available'])
        self.assertEqual(len(working.calls), 2)

    def test_the_cache_key_is_a_hash_not_the_key(self):
        self.assertNotIn(KEY, balance._cache_key(KEY))


class OpenRouterBalanceRouteTests(TestCase):
    def setUp(self):
        cache.clear()
        self.owner = User.objects.create_user(username='balance-owner', password='pw')
        self.other = User.objects.create_user(username='balance-other', password='pw')
        self.openrouter = CredentialType.objects.update_or_create(
            slug='openrouter',
            defaults={'name': 'OpenRouter', 'auth_method': 'api_key',
                      'fields_schema': [{'name': 'apiKey', 'required': True}]},
        )[0]
        self.other_type = CredentialType.objects.update_or_create(
            slug='balance-test-other',
            defaults={'name': 'Balance test other', 'auth_method': 'api_key',
                      'fields_schema': [{'name': 'apiKey', 'required': True}]},
        )[0]
        self.cred = self._credential(self.owner, self.openrouter, 'My OpenRouter')
        self.client_ = APIClient()
        self.client_.force_authenticate(self.owner)

    def _credential(self, user, ctype, name):
        cred = Credential(user=user, credential_type=ctype, name=name)
        cred.set_credential_data({'apiKey': KEY})
        cred.save()
        return cred

    def _url(self, pk):
        return f'/api/credentials/{pk}/balance/'

    def test_returns_the_balance_of_the_owners_openrouter_key(self):
        fake = FakeOpenRouter()
        with fake.installed():
            response = self.client_.get(self._url(self.cred.pk))

        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.data['available'])
        self.assertEqual(response.data['limit_remaining'], 5.53)
        self.assertEqual(response.data['account_credits_remaining'], 5.0)
        self.assertNotIn(KEY, response.content.decode())
        self.assertEqual({call[1] for call in fake.calls}, {f'Bearer {KEY}'})

    def test_decrypting_for_a_balance_is_audited_as_an_access(self):
        with FakeOpenRouter().installed():
            self.client_.get(self._url(self.cred.pk))
        self.assertTrue(CredentialAuditLog.objects.filter(
            credential=self.cred, user=self.owner, action='accessed').exists())

    def test_an_unknown_id_and_a_foreign_id_are_the_same_404(self):
        foreign = self._credential(self.other, self.openrouter, 'Their OpenRouter')
        fake = FakeOpenRouter()
        with fake.installed():
            unknown = self.client_.get(self._url(999999))
            foreign_response = self.client_.get(self._url(foreign.pk))

        self.assertEqual(unknown.status_code, 404)
        self.assertEqual(foreign_response.status_code, 404)
        self.assertEqual(unknown.content, foreign_response.content)
        self.assertEqual(fake.calls, [])

    def test_only_openrouter_keys_have_a_balance(self):
        other = self._credential(self.owner, self.other_type, 'Not OpenRouter')
        fake = FakeOpenRouter()
        with fake.installed():
            response = self.client_.get(self._url(other.pk))

        self.assertEqual(response.status_code, 400)
        self.assertIn('OpenRouter', response.data['error'])
        self.assertEqual(fake.calls, [])

    def test_a_provider_failure_is_a_200_with_the_reason(self):
        with FakeOpenRouter(key=(401, {'error': 'no'})).installed():
            response = self.client_.get(self._url(self.cred.pk))

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data['available'])
        self.assertIn('rejected', response.data['reason'])

    def test_anonymous_callers_are_refused(self):
        response = APIClient().get(self._url(self.cred.pk))
        self.assertIn(response.status_code, (401, 403))
