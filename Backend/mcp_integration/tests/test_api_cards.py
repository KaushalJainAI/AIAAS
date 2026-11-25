"""API cards (Phase 9b/10): the template, the card routes, the kind split and
the live-check command. Specs live in a temporary directory and the card rows
are built here, so nothing depends on the curated cards other agents write."""
from __future__ import annotations

import json
import shutil
import tempfile
from unittest import mock

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.exceptions import PermissionDenied
from django.core.management import call_command
from django.test import TestCase
from io import StringIO
from pathlib import Path

from rest_framework.test import APIClient

from credentials.manager import CredentialManager
from credentials.models import Credential, CredentialType
from datasources.models import ApiConnection
from mcp_integration import card_template
from mcp_integration.card_template import (
    check_operation,
    render_base_url,
    validate_card_template,
)
from mcp_integration.client import MCPClientManager, get_all_tools_from_all_servers, warm_cache
from mcp_integration.models import MCPServer
from mcp_integration.tool_provider import MCPToolProvider

User = get_user_model()

SECRET = 'sekrit-token-123'

SPEC = {
    'openapi': '3.0.0',
    'paths': {
        '/zones': {'get': {'summary': 'List zones', 'x-aiaas-check': True}},
        '/zones/{id}': {
            'head': {'summary': 'Zone exists'},
            'delete': {'summary': 'Not allowed on a card'},
        },
    },
}

TEMPLATE = {
    'base_url': 'https://{subdomain}.example-card.test/api/v2',
    'spec': 'test-card.json',
    'auth': {'parts': [{'in': 'header', 'name': 'Authorization', 'value': 'Bearer {apiKey}'}]},
    'fields': [{'name': 'subdomain', 'label': 'Subdomain', 'pattern': '^[a-z0-9-]{1,63}$'}],
    'allowed_methods': ['GET', 'HEAD'],
}

#: What the connect route saves for TEMPLATE: the one shape call_api understands.
TEMPLATE_AUTH = {'type': 'template', 'credential_type': 'card-test',
                 'parts': [{'in': 'header', 'name': 'Authorization', 'value': 'Bearer {apiKey}'}]}


class CardFixtureMixin:
    def setUp(self):
        cache.clear()
        CredentialManager()._cache.clear()
        self.addCleanup(CredentialManager()._cache.clear)
        self.alice = User.objects.create_user(
            username='alice', email='alice@example.com', password='pw')
        self.bob = User.objects.create_user(
            username='bob', email='bob@example.com', password='pw')
        self.carol = User.objects.create_user(
            username='carol', email='carol@example.com', password='pw')

        self.ctype, _ = CredentialType.objects.update_or_create(
            slug='card-test',
            defaults={'name': 'Card test key', 'auth_method': 'api_key',
                      'fields_schema': [{'name': 'apiKey'}]},
        )
        self.alice_cred = Credential(user=self.alice, credential_type=self.ctype,
                                     name='Card key')
        self.alice_cred.set_credential_data({'apiKey': SECRET})
        self.alice_cred.save()

        self.spec_dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.spec_dir, ignore_errors=True)
        (self.spec_dir / 'test-card.json').write_text(json.dumps(SPEC), encoding='utf-8')
        patcher = mock.patch.object(card_template, 'CATALOGUE_DIR', self.spec_dir)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.card = self.make_card()
        self.api = APIClient()
        self.api.force_authenticate(self.alice)

    def make_card(self, **overrides):
        values = {
            'name': 'Test Card', 'display_name': 'Test Card', 'kind': 'api',
            'icon_slug': 'test-card', 'enabled': True, 'user': None,
            'required_credential_types': ['card-test'], 'template': TEMPLATE,
            'category': 'utilities',
        }
        values.update(overrides)
        return MCPServer.objects.create(**values)

    def connect(self, server_id=None, fields=None, client=None):
        return (client or self.api).post(
            f'/api/mcp/servers/{server_id or self.card.id}/card/connect/',
            {'fields': fields if fields is not None else {'subdomain': 'acme'}},
            format='json',
        )


class TemplateValidatorTests(TestCase):
    def test_empty_template_is_valid(self):
        self.assertEqual(validate_card_template({}), {})

    def test_full_template_is_valid_and_normalised(self):
        out = validate_card_template(TEMPLATE)
        self.assertEqual(out['base_url'], TEMPLATE['base_url'])
        self.assertEqual(out['auth']['parts'][0]['in'], 'header')
        self.assertEqual(out['allowed_methods'], ['GET', 'HEAD'])

    def test_defaults_fill_in(self):
        out = validate_card_template({'base_url': 'https://api.example-card.test', 'spec': 'x.json'})
        self.assertEqual(out['fields'], [])
        self.assertEqual(out['auth'], {'parts': []})
        self.assertEqual(out['allowed_methods'], ['GET', 'HEAD'])

    def test_bad_templates_are_refused(self):
        base = {'base_url': 'https://api.example-card.test', 'spec': 'x.json'}
        bad = {
            'not an object': [],
            'unknown top key': {**base, 'extra': 1},
            'missing spec': {'base_url': base['base_url']},
            'plain http': {**base, 'base_url': 'http://api.example-card.test'},
            'space in base_url': {**base, 'base_url': 'https://api.example card.test'},
            'undeclared placeholder': {**base, 'base_url': 'https://{sub}.example.test'},
            'spec with a path': {**base, 'spec': '../x.json'},
            'spec not json': {**base, 'spec': 'x.yaml'},
            'field name not an identifier': {**base, 'fields': [{'name': '1abc', 'label': 'x'}]},
            'field unknown key': {**base, 'fields': [{'name': 'a', 'label': 'x', 'secret': 1}]},
            'field listed twice': {**base, 'fields': [
                {'name': 'a', 'label': 'x'}, {'name': 'a', 'label': 'y'}]},
            'field pattern not a regex': {**base, 'fields': [
                {'name': 'a', 'label': 'x', 'pattern': '('}]},
            'field options empty': {**base, 'fields': [{'name': 'a', 'label': 'x', 'options': []}]},
            'auth unknown key': {**base, 'auth': {'parts': [], 'cookies': []}},
            'part kind cookie': {**base, 'auth': {'parts': [
                {'in': 'cookie', 'name': 'a', 'value': 'b'}]}},
            'header name with a space': {**base, 'auth': {'parts': [
                {'in': 'header', 'name': 'X Key', 'value': '{apiKey}'}]}},
            'two basic parts': {**base, 'auth': {'parts': [
                {'in': 'basic', 'user': 'a', 'password': 'b'},
                {'in': 'basic', 'user': 'c', 'password': 'd'}]}},
            'five parts': {**base, 'auth': {'parts': [
                {'in': 'header', 'name': f'H{i}', 'value': 'v'} for i in range(5)]}},
            'method POST': {**base, 'allowed_methods': ['POST']},
            'method listed twice': {**base, 'allowed_methods': ['GET', 'GET']},
        }
        for label, value in bad.items():
            with self.subTest(label), self.assertRaises(ValueError):
                validate_card_template(value)


class RenderBaseUrlTests(TestCase):
    def setUp(self):
        self.template = validate_card_template({
            **TEMPLATE,
            'fields': [
                {'name': 'subdomain', 'label': 'Subdomain', 'help': 'acme in acme.example-card.test',
                 'pattern': '^[a-z0-9-]{1,63}$'},
                {'name': 'region', 'label': 'Region', 'options': ['eu', 'us']},
            ],
            'base_url': 'https://{subdomain}.{region}.example-card.test/api/v2',
        })

    def test_good_values_render(self):
        url = render_base_url(self.template, {'subdomain': 'acme', 'region': 'eu'})
        self.assertEqual(url, 'https://acme.eu.example-card.test/api/v2')

    def test_bad_values_are_refused(self):
        bad = {
            'missing value': {'region': 'eu'},
            'empty value': {'subdomain': '  ', 'region': 'eu'},
            'slash': {'subdomain': 'acme/evil', 'region': 'eu'},
            'at sign': {'subdomain': 'acme@evil', 'region': 'eu'},
            'colon': {'subdomain': 'acme:80', 'region': 'eu'},
            'space': {'subdomain': 'ac me', 'region': 'eu'},
            'question mark': {'subdomain': 'acme?x', 'region': 'eu'},
            'hash': {'subdomain': 'acme#x', 'region': 'eu'},
            'dot the pattern does not allow': {'subdomain': 'acme.evil', 'region': 'eu'},
            'pattern mismatch': {'subdomain': 'ACME', 'region': 'eu'},
            'not in options': {'subdomain': 'acme', 'region': 'asia'},
            'unknown field': {'subdomain': 'acme', 'region': 'eu', 'extra': 'x'},
            'fields not an object': ['acme'],
        }
        for label, values in bad.items():
            with self.subTest(label), self.assertRaises(ValueError):
                render_base_url(self.template, values)

    def test_a_dot_is_allowed_when_the_pattern_allows_one(self):
        template = validate_card_template({
            **TEMPLATE,
            'fields': [{'name': 'subdomain', 'label': 'Host', 'pattern': '^[a-z0-9.-]{1,200}$'}],
        })
        self.assertEqual(render_base_url(template, {'subdomain': 'acme.corp'}),
                         'https://acme.corp.example-card.test/api/v2')

    def test_placeholders_lists_names_in_order(self):
        self.assertEqual(card_template.placeholders('https://{a}.x/{b}/{a}'), ['a', 'b', 'a'])


class CheckOperationTests(TestCase):
    def test_exactly_one_flagged_operation(self):
        self.assertEqual(check_operation(SPEC), ('GET', '/zones'))
        with self.assertRaises(ValueError):
            check_operation({'paths': {'/a': {'get': {}}}})
        with self.assertRaises(ValueError):
            check_operation({'paths': {'/a': {'get': {'x-aiaas-check': True}},
                                       '/b': {'get': {'x-aiaas-check': True}}}})


class CardConnectTests(CardFixtureMixin, TestCase):
    def test_connect_builds_exactly_one_connection_with_template_auth(self):
        with mock.patch('datasources.serializers.check_egress', return_value=(True, '')):
            res = self.connect()
        self.assertEqual(res.status_code, 200, res.content)
        rows = ApiConnection.objects.filter(user=self.alice)
        self.assertEqual(rows.count(), 1)
        row = rows.get()
        self.assertEqual(res.json(), {'connection_id': row.id})
        self.assertEqual(row.card_slug, 'test-card')
        self.assertEqual(row.name, 'Test Card')
        self.assertEqual(row.base_url, 'https://acme.example-card.test/api/v2')
        self.assertEqual(row.auth, TEMPLATE_AUTH)
        self.assertEqual(row.allowed_methods, ['GET', 'HEAD'])
        self.assertEqual(row.openapi_spec, SPEC)
        self.assertNotIn(SECRET, json.dumps(row.auth))

    def test_connecting_twice_updates_the_same_row(self):
        with mock.patch('datasources.serializers.check_egress', return_value=(True, '')):
            first = self.connect(fields={'subdomain': 'acme'})
            second = self.connect(fields={'subdomain': 'globex'})
        self.assertEqual(first.json()['connection_id'], second.json()['connection_id'])
        row = ApiConnection.objects.get(user=self.alice)
        self.assertEqual(row.base_url, 'https://globex.example-card.test/api/v2')

    def test_missing_credential_is_400(self):
        with mock.patch('datasources.serializers.check_egress', return_value=(True, '')):
            res = self.connect(client=self._client_for(self.carol))
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()['code'], 'credential_missing')
        self.assertFalse(ApiConnection.objects.filter(user=self.carol).exists())

    def test_platform_disabled_card_is_409(self):
        self.card.enabled = False
        self.card.save()
        res = self.connect()
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.json()['code'], 'server_unavailable')

    def test_unknown_and_foreign_ids_get_the_same_404(self):
        foreign = self.make_card(name='Bobs', icon_slug='bobs-card', user=self.bob)
        unknown = self.connect(server_id=999999)
        other = self.connect(server_id=foreign.id)
        self.assertEqual(unknown.status_code, 404)
        self.assertEqual(other.status_code, 404)
        self.assertEqual(unknown.json(), other.json())

    def test_a_plain_connector_is_not_a_card(self):
        plain = self.make_card(name='Plain', icon_slug='plain', kind='mcp',
                               type='stdio', command='npx', template={})
        res = self.connect(server_id=plain.id)
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()['code'], 'not_a_card')

    def test_invalid_field_is_400(self):
        res = self.connect(fields={'subdomain': 'acme/evil'})
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()['code'], 'invalid_field')
        self.assertIn('error', res.json())

    def test_a_clashing_user_tool_keeps_its_name(self):
        ApiConnection.objects.create(user=self.alice, name='Test Card',
                                     base_url='https://93.184.216.34/v1')
        with mock.patch('datasources.serializers.check_egress', return_value=(True, '')):
            res = self.connect()
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(ApiConnection.objects.filter(
            user=self.alice, name='Test Card (connector)', card_slug='test-card').exists())
        self.assertTrue(ApiConnection.objects.filter(
            user=self.alice, name='Test Card', card_slug='').exists())

    def test_a_missing_spec_file_is_a_logged_500(self):
        self.card.template = {**TEMPLATE, 'spec': 'absent.json'}
        self.card.save()
        res = self.connect()
        self.assertEqual(res.status_code, 500)
        self.assertEqual(res.json()['code'], 'spec_missing')

    def test_disconnect_removes_the_connection_and_keeps_the_credential(self):
        with mock.patch('datasources.serializers.check_egress', return_value=(True, '')):
            self.connect()
        res = self.api.post(f'/api/mcp/servers/{self.card.id}/card/disconnect/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {'removed': 1})
        self.assertFalse(ApiConnection.objects.filter(user=self.alice).exists())
        self.assertTrue(Credential.objects.filter(id=self.alice_cred.id).exists())

    def test_disconnect_on_a_plain_connector_is_400(self):
        plain = self.make_card(name='Plain', icon_slug='plain', kind='mcp',
                               type='stdio', command='npx', template={})
        res = self.api.post(f'/api/mcp/servers/{plain.id}/card/disconnect/')
        self.assertEqual(res.status_code, 400)

    def _client_for(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client


class CardListAndToolsTests(CardFixtureMixin, TestCase):
    def _listed(self):
        res = self.api.get('/api/mcp/servers/')
        self.assertEqual(res.status_code, 200)
        return next(s for s in res.json()['servers'] if s['id'] == self.card.id)

    def test_card_connected_follows_the_users_connection(self):
        self.assertFalse(self._listed()['card_connected'])
        with mock.patch('datasources.serializers.check_egress', return_value=(True, '')):
            self.connect()
        listed = self._listed()
        self.assertTrue(listed['card_connected'])
        self.assertEqual(listed['template_fields'], TEMPLATE['fields'])

    def test_card_connected_is_per_user(self):
        with mock.patch('datasources.serializers.check_egress', return_value=(True, '')):
            self.connect()
        bob = APIClient()
        bob.force_authenticate(self.bob)
        listed = next(s for s in bob.get('/api/mcp/servers/').json()['servers']
                      if s['id'] == self.card.id)
        self.assertFalse(listed['card_connected'])

    def test_card_connected_is_false_for_other_kinds(self):
        plain = self.make_card(name='Plain', icon_slug='plain', kind='mcp',
                               type='stdio', command='npx', template={})
        listed = next(s for s in self.api.get('/api/mcp/servers/').json()['servers']
                      if s['id'] == plain.id)
        self.assertFalse(listed['card_connected'])
        self.assertEqual(listed['template_fields'], [])

    def test_tools_are_read_from_the_spec_with_no_network(self):
        with mock.patch('mcp_integration.views.MCPClientManager') as manager:
            res = self.api.get(f'/api/mcp/servers/{self.card.id}/tools/')
        manager.assert_not_called()
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['tools'], [
            {'name': 'GET /zones', 'description': 'List zones'},
            {'name': 'HEAD /zones/{id}', 'description': 'Zone exists'},
        ])

    def test_validate_credentials_answers_from_the_vault(self):
        res = self.api.get(f'/api/mcp/servers/{self.card.id}/validate_credentials/')
        self.assertEqual(res.json(), {'ok': True, 'errors': []})
        carol = APIClient()
        carol.force_authenticate(self.carol)
        res = carol.get(f'/api/mcp/servers/{self.card.id}/validate_credentials/')
        self.assertFalse(res.json()['ok'])
        self.assertTrue(res.json()['errors'])


class ApiCardNeverRunsAsMcpTests(CardFixtureMixin, TestCase):
    """An API card must never be dialled as an MCP server."""

    def setUp(self):
        super().setUp()
        # Give the card the worst case: a row that would otherwise look like a
        # stdio server with a command to run.
        MCPServer.objects.filter(id=self.card.id).update(type='stdio', command='npx')

    def test_the_mcp_engine_never_calls_list_tools_for_a_card(self):
        with mock.patch.object(MCPClientManager, 'list_tools',
                               new_callable=mock.AsyncMock, return_value=[]) as list_tools:
            descriptors = async_to_sync(MCPToolProvider.get_openai_tool_descriptors)(self.alice)
            aggregate = async_to_sync(get_all_tools_from_all_servers)(self.alice)
            with mock.patch('mcp_integration.client.threading.Thread') as thread:
                warm_cache(self.card.id, self.alice, kind=self.card.kind)
        list_tools.assert_not_called()
        thread.assert_not_called()
        self.assertEqual(descriptors, [])
        self.assertEqual(aggregate, [])

    def test_a_card_cannot_be_listed_through_the_mcp_client(self):
        manager = MCPClientManager(self.card.id, user=self.alice)
        with self.assertRaises(PermissionDenied):
            async_to_sync(manager.list_tools)()


class ConnectorCheckCommandTests(CardFixtureMixin, TestCase):
    def run_check(self, *extra, status_code=200, user='alice@example.com'):
        out = StringIO()
        with mock.patch('mcp_integration.management.commands.connector_check._get',
                        new_callable=mock.AsyncMock, return_value=status_code) as get, \
                mock.patch('mcp_integration.management.commands.connector_check.check_egress',
                           return_value=(True, '')):
            call_command('connector_check', 'test-card', '--user', user,
                         '--field', 'subdomain=acme', *extra, stdout=out)
        return out.getvalue(), get

    def test_pass_sends_one_get_with_the_credential_and_enables_the_card(self):
        text, get = self.run_check('--enable')
        self.assertIn('PASS', text)
        self.assertNotIn(SECRET, text)
        get.assert_awaited_once()
        method, url, headers, params = get.await_args.args
        self.assertEqual(method, 'GET')
        self.assertEqual(url, 'https://acme.example-card.test/api/v2/zones')
        self.assertEqual(headers['Authorization'], f'Bearer {SECRET}')
        self.card.refresh_from_db()
        self.assertTrue(self.card.enabled)
        self.assertFalse(self.card.coming_soon)

    def test_fail_leaves_the_card_off(self):
        self.card.enabled = False
        self.card.coming_soon = True
        self.card.save()
        text, _ = self.run_check('--enable', status_code=401)
        self.assertIn('FAIL', text)
        self.assertIn('401', text)
        self.assertNotIn(SECRET, text)
        self.card.refresh_from_db()
        self.assertFalse(self.card.enabled)
        self.assertTrue(self.card.coming_soon)

    def test_no_credential_fails_without_a_request(self):
        text, get = self.run_check(user='carol@example.com')
        self.assertIn('FAIL', text)
        get.assert_not_awaited()

    def test_other_kinds_are_not_supported_yet(self):
        self.make_card(name='Plain', icon_slug='plain', kind='mcp',
                       type='stdio', command='npx', template={})
        out = StringIO()
        call_command('connector_check', 'plain', '--user', 'alice@example.com', stdout=out)
        self.assertIn('not supported yet', out.getvalue())
