"""
User-made MCP servers are retired (CONNECTOR_CATALOGUE_PLAN.md, Phase 0).

With `MCP_CUSTOM_SERVERS_ENABLED` off — the default everywhere but the test
settings — a user can no longer add a server, their existing rows reach no
agent through either door, and they can still delete them. Rows are kept, so
switching it back on restores every one.
"""
import json

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from mcp_integration.client import (
    _servers_for_user_sync,
    custom_servers_enabled,
    visible_server_ids_sync,
)
from mcp_integration.models import MCPServer
from mcp_integration.tool_provider import MCPToolProvider, encode_tool_name

User = get_user_model()

OFF = override_settings(MCP_CUSTOM_SERVERS_ENABLED=False)


class DefaultIsOffTests(TestCase):
    def test_base_settings_ship_it_off(self):
        """The test settings turn it on for the engine suites; production must
        not inherit that. Read base.py's own default, not the active value."""
        import os

        from workflow_backend.settings import base

        self.assertNotIn('MCP_CUSTOM_SERVERS_ENABLED', os.environ)
        self.assertFalse(base.MCP_CUSTOM_SERVERS_ENABLED)


class RetiredBase(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='dana', password='x')
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.mine = MCPServer.objects.create(
            name='My Server', type='http', url='https://mcp.example.com/mcp',
            user=self.user, enabled=True,
        )
        self.curated = MCPServer.objects.create(
            name='Curated', type='http', url='https://mcp.example.org/mcp',
            user=None, enabled=True,
        )


@OFF
class RetiredApiTests(RetiredBase):
    def test_the_switch_reads_off(self):
        self.assertFalse(custom_servers_enabled())

    def test_creating_a_server_is_refused_with_a_code(self):
        res = self.client.post('/api/mcp/servers/', {
            'name': 'New', 'type': 'http', 'url': 'https://mcp.example.net/mcp',
        }, format='json')
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data['code'], 'custom_servers_disabled')
        self.assertFalse(MCPServer.objects.filter(name='New').exists())

    def test_the_list_shows_only_the_catalogue(self):
        res = self.client.get('/api/mcp/servers/')
        ids = {s['id'] for s in res.data['servers']}
        self.assertIn(self.curated.id, ids)
        self.assertNotIn(self.mine.id, ids)

    def test_an_owned_row_answers_like_an_unknown_id(self):
        """Read, edit, toggle and sign-in all 404, the same as an id that does
        not exist: a retired row is not a thing the product has."""
        for method, path, body in (
            ('get', f'/api/mcp/servers/{self.mine.id}/', None),
            ('patch', f'/api/mcp/servers/{self.mine.id}/', {'url': 'https://x.example/mcp'}),
            ('post', f'/api/mcp/servers/{self.mine.id}/set-enabled/', {'enabled': False}),
            ('get', f'/api/mcp/servers/{self.mine.id}/tools/', None),
        ):
            with self.subTest(method=method, path=path):
                res = getattr(self.client, method)(path, body, format='json')
                self.assertEqual(res.status_code, 404)
        self.mine.refresh_from_db()
        self.assertEqual(self.mine.url, 'https://mcp.example.com/mcp')
        self.assertTrue(self.mine.enabled)

    def test_the_owner_can_still_delete_it(self):
        res = self.client.delete(f'/api/mcp/servers/{self.mine.id}/')
        self.assertEqual(res.status_code, 204)
        self.assertFalse(MCPServer.objects.filter(id=self.mine.id).exists())

    def test_someone_else_cannot_delete_it(self):
        other = User.objects.create_user(username='eve', password='x')
        client = APIClient()
        client.force_authenticate(other)
        res = client.delete(f'/api/mcp/servers/{self.mine.id}/')
        self.assertEqual(res.status_code, 404)
        self.assertTrue(MCPServer.objects.filter(id=self.mine.id).exists())


@OFF
class RetiredDoorTests(RetiredBase):
    """Both doors resolve through `_visible_servers_queryset`."""

    def test_the_offered_set_excludes_it(self):
        # Migrations seed the real catalogue too, so assert membership only.
        ids = {s.id for s in _servers_for_user_sync(self.user.id)}
        self.assertIn(self.curated.id, ids)
        self.assertNotIn(self.mine.id, ids)
        self.assertNotIn(self.mine.id, visible_server_ids_sync(self.user.id))

    def test_dispatch_refuses_its_old_tool_name(self):
        """A model that saw the tool in an earlier turn names it anyway."""
        name = encode_tool_name(self.mine.id, 'search')
        out = json.loads(async_to_sync(MCPToolProvider.execute)(name, {}, self.user))
        self.assertEqual(out['code'], 'tool_not_found')


@OFF
class RetiredAgentSaveTests(RetiredBase):
    def _post(self, connectors):
        return self.client.post(
            '/api/orchestrator/agents/',
            {'name': 'A', 'tools': {'mcp': True}, 'connectors': connectors},
            format='json',
        )

    def test_an_agent_naming_a_retired_row_still_saves_and_keeps_the_id(self):
        """Dropping the id would leave `connectors` empty, which means every
        connection: retiring a server must never widen an agent."""
        res = self._post([self.mine.id])
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['connectors'], [self.mine.id])

    def test_someone_elses_row_is_still_unknown(self):
        other = User.objects.create_user(username='frank', password='x')
        theirs = MCPServer.objects.create(
            name='Theirs', type='http', url='https://mcp.example.io/mcp', user=other,
        )
        res = self._post([theirs.id])
        self.assertEqual(res.status_code, 400)


class SwitchOnRestoresTests(RetiredBase):
    """The test settings have it on: everything comes back, nothing was lost."""

    def test_rows_are_visible_and_creatable_again(self):
        self.assertIn(self.mine.id, visible_server_ids_sync(self.user.id))
        res = self.client.get(f'/api/mcp/servers/{self.mine.id}/')
        self.assertEqual(res.status_code, 200)
