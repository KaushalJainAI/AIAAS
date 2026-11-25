"""How the service client reports a sidecar that says no (Phase 5).

With one sandbox slot, contention is normal: the sidecar answers 503 and the
client must turn that into a retryable tool error ("sandbox is busy"), not a
crash and not a silent fallback to the weaker engine. A 400 keeps the
sidecar's own reason, which names the fix.
"""
from __future__ import annotations

from unittest import mock

import httpx
from asgiref.sync import async_to_sync
from django.test import SimpleTestCase

from sandbox.service_client import run_via_service


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                f'status {self.status_code}',
                request=mock.Mock(), response=self)

    def json(self):
        return self._payload


class _FakeClient:
    def __init__(self, response):
        self._response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, *args, **kwargs):
        return self._response


class BusySandboxTests(SimpleTestCase):
    def _run(self, status_code: int, payload: dict) -> dict:
        client = _FakeClient(_FakeResponse(status_code, payload))
        with mock.patch('sandbox.service_client.httpx.AsyncClient',
                        return_value=client):
            return async_to_sync(run_via_service)('result = 1')

    def test_503_is_a_retryable_busy_error(self):
        outcome = self._run(503, {'error': 'sandbox busy, try again'})
        self.assertFalse(outcome['success'])
        self.assertIn('busy', outcome['error'])

    def test_400_keeps_the_sidecars_reason(self):
        outcome = self._run(400, {'error': 'collect must be a list of names'})
        self.assertFalse(outcome['success'])
        self.assertIn('collect must be a list of names', outcome['error'])


class LanguageAndCommandRequestTests(SimpleTestCase):
    """What the client sends: Python unchanged, other languages named, and a
    command pipeline to its own route."""

    def _capture(self, call):
        sent = {}

        class _Client(_FakeClient):
            async def post(self, url, json=None, **kwargs):
                sent['url'], sent['json'] = url, json
                return self._response

        async def _go():
            return await call()

        client = _Client(_FakeResponse(200, {'success': True, 'output': 'ok'}))
        with mock.patch('sandbox.service_client.httpx.AsyncClient', return_value=client):
            outcome = async_to_sync(_go)()
        return sent, outcome

    def test_python_requests_carry_no_language_field(self):
        sent, _ = self._capture(lambda: run_via_service('result = 1'))
        self.assertTrue(sent['url'].endswith('/execute'))
        self.assertNotIn('language', sent['json'])

    def test_javascript_is_named(self):
        sent, _ = self._capture(lambda: run_via_service('1', language='typescript'))
        self.assertEqual(sent['json']['language'], 'typescript')

    def test_a_sidecar_that_ignored_the_language_is_caught(self):
        # An old image runs the JavaScript as Python and answers without the
        # echo; that must not reach the model as the model's SyntaxError.
        _, outcome = self._capture(lambda: run_via_service('console.log(1)', language='javascript'))
        self.assertFalse(outcome['success'])
        self.assertIn('out of date', outcome['error'])

    def test_a_current_sidecar_echoes_the_language(self):
        client = _FakeClient(_FakeResponse(200, {'success': True, 'output': '1\n',
                                                 'language': 'javascript'}))

        async def _go():
            return await run_via_service('console.log(1)', language='javascript')

        with mock.patch('sandbox.service_client.httpx.AsyncClient', return_value=client):
            outcome = async_to_sync(_go)()
        self.assertTrue(outcome['success'])

    def test_commands_go_to_their_own_route(self):
        from sandbox.service_client import run_commands_via_service
        pipeline = [{'command': 'echo', 'args': ['hi']}]
        sent, outcome = self._capture(
            lambda: run_commands_via_service(pipeline, stdin='x', files={'a.txt': b'1'}))
        self.assertTrue(sent['url'].endswith('/commands'))
        self.assertEqual(sent['json']['pipeline'], pipeline)
        self.assertEqual(sent['json']['stdin'], 'x')
        self.assertEqual(sent['json']['files'], {'a.txt': 'MQ=='})
        self.assertEqual(outcome['exit_codes'], [])

    def test_an_old_sidecar_without_the_route_says_so(self):
        from sandbox.service_client import run_commands_via_service
        client = _FakeClient(_FakeResponse(404, {'error': 'not found'}))
        with mock.patch('sandbox.service_client.httpx.AsyncClient', return_value=client):
            outcome = async_to_sync(run_commands_via_service)([{'command': 'echo'}])
        self.assertFalse(outcome['success'])
        self.assertIn('out of date', outcome['error'])
