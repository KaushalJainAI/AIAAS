"""Template auth (`{"type":"template"}`): the shared parts helper, the
ApiConnection write path, and what `call_api` sends for each part kind."""
from __future__ import annotations

import base64
import json
from unittest import mock

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from chat.tools import execute_tool
from credentials.manager import CredentialManager
from credentials.models import Credential, CredentialType
from credentials.refs import aresolve_refs
from datasources.auth_template import (
    apply_parts,
    check_parts,
    part_placeholders,
    placeholders,
)
from datasources.models import ApiConnection

User = get_user_model()

#: A literal public IP passes the SSRF guard without DNS, so these run offline.
PUBLIC_URL = 'https://93.184.216.34/v1'
SECRET = 'key-abc-123'


class PartsHelperTests(TestCase):
    def test_valid_parts_are_accepted(self):
        parts = check_parts([
            {'in': 'header', 'name': 'Authorization', 'value': 'Bearer {apiKey}'},
            {'in': 'query', 'name': 'token', 'value': '{token}'},
            {'in': 'basic', 'user': '{apiKey}', 'password': 'X'},
        ])
        self.assertEqual(len(parts), 3)

    def test_invalid_parts_are_refused(self):
        bad = {
            'kind not known': [{'in': 'cookie', 'name': 'a', 'value': 'b'}],
            'unknown key': [{'in': 'header', 'name': 'A', 'value': 'b', 'extra': 1}],
            'header name with a space': [{'in': 'header', 'name': 'X Key', 'value': 'b'}],
            'line break in a static value': [
                {'in': 'header', 'name': 'revision', 'value': '2025\r\nX-Evil: 1'}],
            'line break in a basic password': [
                {'in': 'basic', 'user': '{apiKey}', 'password': 'X\nY'}],
            'empty value': [{'in': 'header', 'name': 'A', 'value': ''}],
            'not a list': {'in': 'header'},
            'two basic parts': [
                {'in': 'basic', 'user': 'a', 'password': 'b'},
                {'in': 'basic', 'user': 'c', 'password': 'd'}],
            'five parts': [{'in': 'header', 'name': f'H{i}', 'value': 'v'} for i in range(5)],
        }
        for label, value in bad.items():
            with self.subTest(label), self.assertRaises(ValueError):
                check_parts(value)

    def test_placeholders_are_found_in_order(self):
        self.assertEqual(placeholders('Token token={apiKey}; x={a}'), ['apiKey', 'a'])
        self.assertEqual(placeholders('no braces'), [])

    def test_part_placeholders_are_distinct_and_cover_basic_parts(self):
        parts = check_parts([
            {'in': 'header', 'name': 'A', 'value': '{apiKey}'},
            {'in': 'basic', 'user': '{user}', 'password': '{apiKey}'},
        ])
        self.assertEqual(part_placeholders(parts), ['apiKey', 'user'])

    def test_apply_parts_builds_each_kind(self):
        parts = check_parts([
            {'in': 'header', 'name': 'Authorization', 'value': 'Token token={apiKey}'},
            {'in': 'header', 'name': 'revision', 'value': '2025-07-15'},
            {'in': 'query', 'name': 'key', 'value': '{apiKey}'},
        ])
        headers, params = apply_parts(parts, {'apiKey': SECRET})
        self.assertEqual(headers, {'Authorization': f'Token token={SECRET}',
                                   'revision': '2025-07-15'})
        self.assertEqual(params, {'key': SECRET})

    def test_apply_parts_builds_basic_auth(self):
        parts = check_parts([{'in': 'basic', 'user': '{apiKey}', 'password': 'X'}])
        headers, _ = apply_parts(parts, {'apiKey': SECRET})
        expected = base64.b64encode(f'{SECRET}:X'.encode()).decode()
        self.assertEqual(headers['Authorization'], f'Basic {expected}')

    def test_apply_parts_refuses_a_missing_value_and_line_breaks(self):
        parts = check_parts([{'in': 'header', 'name': 'A', 'value': 'Bearer {apiKey}'}])
        with self.assertRaises(ValueError):
            apply_parts(parts, {})
        with self.assertRaises(ValueError):
            apply_parts(parts, {'apiKey': 'abc\r\nX-Evil: 1'})


class TemplateWriteTests(TestCase):
    """The ApiConnectionSerializer is the one save path for these rows."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user('templ', 'templ@example.com', 'pw')
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.ctype, _ = CredentialType.objects.update_or_create(
            slug='tmpl-key',
            defaults={'name': 'Template key', 'auth_method': 'api_key',
                      'fields_schema': [{'name': 'apiKey'}]},
        )

    def _post(self, auth, **extra):
        body = {'name': 'Templated', 'base_url': PUBLIC_URL, 'auth': auth, **extra}
        return self.client.post('/api/datasources/api-connections/', body, format='json')

    def test_a_template_auth_is_stored_cleaned(self):
        res = self._post({'type': 'template', 'credential_type': 'tmpl-key', 'parts': [
            {'in': 'header', 'name': 'Authorization', 'value': 'Bearer {apiKey}'}]})
        self.assertEqual(res.status_code, 201, res.content)
        row = ApiConnection.objects.get(user=self.user)
        self.assertEqual(row.auth, {'type': 'template', 'credential_type': 'tmpl-key', 'parts': [
            {'in': 'header', 'name': 'Authorization', 'value': 'Bearer {apiKey}'}]})

    def test_a_placeholder_must_be_a_field_of_the_credential_type(self):
        res = self._post({'type': 'template', 'credential_type': 'tmpl-key', 'parts': [
            {'in': 'query', 'name': 'token', 'value': '{nope}'}]})
        self.assertEqual(res.status_code, 400)

    def test_an_unknown_credential_type_is_refused(self):
        res = self._post({'type': 'template', 'credential_type': 'no-such', 'parts': []})
        self.assertEqual(res.status_code, 400)

    def test_bad_parts_are_refused(self):
        res = self._post({'type': 'template', 'credential_type': 'tmpl-key', 'parts': [
            {'in': 'header', 'name': 'X Key', 'value': '{apiKey}'}]})
        self.assertEqual(res.status_code, 400)

    def test_card_slug_is_read_only(self):
        res = self._post({'type': 'none'}, card_slug='forged')
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()['card_slug'], '')
        self.assertEqual(ApiConnection.objects.get(user=self.user).card_slug, '')


class CallApiTemplateAuthTests(TestCase):
    """What `call_api` puts on the wire for a template connection."""

    def setUp(self):
        cache.clear()
        CredentialManager()._cache.clear()
        self.addCleanup(CredentialManager()._cache.clear)
        self.user = User.objects.create_user('caller2', 'caller2@example.com', 'pw')
        self.ctype, _ = CredentialType.objects.update_or_create(
            slug='tmpl-call',
            defaults={'name': 'Template call key', 'auth_method': 'api_key',
                      'fields_schema': [{'name': 'apiKey'}]},
        )
        cred = Credential(user=self.user, credential_type=self.ctype, name='Call key')
        cred.set_credential_data({'apiKey': SECRET})
        cred.save()

    def _call(self, parts, *, query=None, credential=True):
        if not credential:
            Credential.objects.filter(user=self.user).delete()
        conn = ApiConnection.objects.create(
            user=self.user, name=f'Tmpl {id(parts)}', base_url=PUBLIC_URL,
            auth={'type': 'template', 'credential_type': 'tmpl-call', 'parts': parts},
            allowed_methods=['GET'])
        fake = mock.MagicMock()
        resp = mock.MagicMock(status_code=200, headers={'content-type': 'application/json'})
        resp.json.return_value = {'ok': True}
        fake.get = mock.AsyncMock(return_value=resp)
        args = {'connection': conn.id, 'method': 'GET', 'path': '/zones'}
        if query is not None:
            args['query'] = query
        with mock.patch('workflow_backend.httpclient.shared_client', return_value=fake):
            out = json.loads(async_to_sync(execute_tool)(
                'call_api', args,
                {'user_id': self.user.id, 'api_connections': {conn.id: 'all'}}))
        self.assertEqual(out.get('status'), 200, out)
        fake.get.assert_awaited_once()
        return fake.get.await_args.kwargs['headers'], fake.get.await_args.kwargs['params']

    def test_bearer_part(self):
        headers, _ = self._call([{'in': 'header', 'name': 'Authorization',
                                  'value': 'Bearer {apiKey}'}])
        self.assertEqual(headers['Authorization'], f'Bearer {SECRET}')

    def test_a_raw_header_part(self):
        headers, _ = self._call([{'in': 'header', 'name': 'X-Api-Key', 'value': '{apiKey}'}])
        self.assertEqual(headers['X-Api-Key'], SECRET)

    def test_a_token_prefix_part(self):
        headers, _ = self._call([{'in': 'header', 'name': 'Authorization',
                                  'value': 'Token token={apiKey}'}])
        self.assertEqual(headers['Authorization'], f'Token token={SECRET}')

    def test_a_query_part(self):
        _, params = self._call([{'in': 'query', 'name': 'token', 'value': '{apiKey}'}])
        self.assertEqual(params['token'], SECRET)

    def test_a_basic_part(self):
        headers, _ = self._call([{'in': 'basic', 'user': '{apiKey}', 'password': 'X'}])
        expected = base64.b64encode(f'{SECRET}:X'.encode()).decode()
        self.assertEqual(headers['Authorization'], f'Basic {expected}')

    def test_a_static_part_needs_no_credential(self):
        headers, _ = self._call([{'in': 'header', 'name': 'revision', 'value': '2025-07-15'}],
                                credential=False)
        self.assertEqual(headers['revision'], '2025-07-15')

    def test_a_missing_credential_sends_no_auth_but_still_calls(self):
        headers, params = self._call(
            [{'in': 'header', 'name': 'Authorization', 'value': 'Bearer {apiKey}'}],
            credential=False)
        self.assertNotIn('Authorization', headers)
        self.assertEqual(params, {})

    def test_a_model_supplied_authorization_is_dropped(self):
        headers, params = self._call(
            [{'in': 'header', 'name': 'X-Api-Key', 'value': '{apiKey}'}],
            query={'Authorization': 'Bearer attacker', 'page': 2})
        self.assertNotIn('attacker', json.dumps([headers, params]))
        self.assertEqual(params, {'page': 2})

    def test_all_references_resolve_in_one_call(self):
        parts = [
            {'in': 'header', 'name': 'Authorization', 'value': 'Bearer {apiKey}'},
            {'in': 'query', 'name': 'key', 'value': '{apiKey}'},
        ]
        with mock.patch('credentials.refs.aresolve_refs',
                        wraps=aresolve_refs) as spy:
            headers, params = self._call(parts)
        self.assertEqual(spy.call_count, 1)
        self.assertEqual(headers['Authorization'], f'Bearer {SECRET}')
        self.assertEqual(params['key'], SECRET)

    def _call_error(self, parts):
        """Run call_api on a stored template and return its error, sending nothing."""
        conn = ApiConnection.objects.create(
            user=self.user, name=f'Broken {id(parts)}', base_url=PUBLIC_URL,
            auth={'type': 'template', 'credential_type': 'tmpl-call', 'parts': parts},
            allowed_methods=['GET'])
        fake = mock.MagicMock()
        fake.get = mock.AsyncMock()
        with mock.patch('workflow_backend.httpclient.shared_client', return_value=fake):
            out = json.loads(async_to_sync(execute_tool)(
                'call_api', {'connection': conn.id, 'method': 'GET', 'path': '/zones'},
                {'user_id': self.user.id, 'api_connections': {conn.id: 'all'}}))
        fake.get.assert_not_awaited()
        return out

    def test_a_stored_static_part_with_a_line_break_is_a_tool_error(self):
        # Written straight to the row, past the serializer, as an old row could be.
        out = self._call_error([{'in': 'header', 'name': 'revision',
                                 'value': '2025\r\nX-Evil: 1'}])
        self.assertIn('error', out)
        self.assertNotIn('status', out)

    def test_a_stored_part_that_cannot_be_applied_is_a_tool_error_not_a_crash(self):
        # The apply step is reached only by static parts; make it fail to prove
        # the failure comes back as the tool's answer rather than an exception.
        with mock.patch('datasources.auth_template.apply_parts',
                        side_effect=ValueError('boom')):
            out = self._call_error([{'in': 'header', 'name': 'revision', 'value': '2025'}])
        self.assertIn('error', out)
