"""
What `call_api` refuses, and what it hands back to the model.

A connection built from an API card follows the card's kill switch: the
`MCPServer` row for `card_slug` must be enabled, or the call is not sent.
"""
from __future__ import annotations

import json
from unittest import mock

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase

from chat.tools import execute_tool
from datasources.models import ApiConnection
from mcp_integration.models import MCPServer

User = get_user_model()

#: A literal public IP passes the SSRF guard without DNS, so these run offline.
PUBLIC_URL = 'https://93.184.216.34/v1'
CARD_SLUG = 'guard-card'


class CardKillSwitchTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user('guard', 'guard@example.com', 'pw')
        self.card = MCPServer.objects.create(
            name='Guard Card', display_name='Guard Card', kind='api',
            icon_slug=CARD_SLUG, enabled=True, user=None,
            required_credential_types=[], template={}, category='utilities')
        self.conn = ApiConnection.objects.create(
            user=self.user, name='Guard connection', base_url=PUBLIC_URL,
            auth={'type': 'none'}, allowed_methods=['GET'], card_slug=CARD_SLUG)

    def _call(self, conn=None):
        """Run call_api against a fake HTTP client; return (result, client mock)."""
        conn = conn or self.conn
        fake = mock.MagicMock()
        resp = mock.MagicMock(status_code=200, headers={'content-type': 'application/json'})
        resp.json.return_value = {'ok': True}
        fake.get = mock.AsyncMock(return_value=resp)
        with mock.patch('workflow_backend.httpclient.shared_client', return_value=fake):
            out = json.loads(async_to_sync(execute_tool)(
                'call_api', {'connection': conn.id, 'method': 'GET', 'path': '/zones'},
                {'user_id': self.user.id, 'api_connections': {conn.id: 'all'}}))
        return out, fake

    def test_an_enabled_card_calls_through(self):
        out, fake = self._call()
        self.assertEqual(out.get('status'), 200, out)
        fake.get.assert_awaited_once()

    def test_a_switched_off_card_refuses_the_call(self):
        MCPServer.objects.filter(pk=self.card.pk).update(enabled=False)
        out, fake = self._call()
        self.assertIn('turned off', out['error'])
        self.assertIn(self.conn.name, out['error'])
        fake.get.assert_not_awaited()

    def test_a_missing_card_row_refuses_the_call(self):
        MCPServer.objects.filter(pk=self.card.pk).delete()
        out, fake = self._call()
        self.assertIn('error', out)
        fake.get.assert_not_awaited()

    def test_a_card_row_of_another_kind_does_not_stand_in(self):
        MCPServer.objects.filter(pk=self.card.pk).update(kind='mcp')
        out, fake = self._call()
        self.assertIn('error', out)
        fake.get.assert_not_awaited()

    def test_a_connection_not_built_from_a_card_is_unaffected(self):
        # Switching a card off must not touch a hand-made connection.
        MCPServer.objects.filter(pk=self.card.pk).update(enabled=False)
        plain = ApiConnection.objects.create(
            user=self.user, name='Hand made', base_url=PUBLIC_URL,
            auth={'type': 'none'}, allowed_methods=['GET'], card_slug='')
        out, fake = self._call(plain)
        self.assertEqual(out.get('status'), 200, out)
        fake.get.assert_awaited_once()
