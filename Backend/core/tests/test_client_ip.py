"""Who the caller is, behind our two reverse proxies.

Throttles (login 5/min, guest 50/day) key on the client address. With no
`NUM_PROXIES`, DRF keys on the whole `X-Forwarded-For` header, so a client
that sends its own header gets a fresh bucket every request.
"""
from django.test import RequestFactory, SimpleTestCase, override_settings
from rest_framework.throttling import BaseThrottle

from core.http.client_ip import client_ip

TWO_PROXIES = {'NUM_PROXIES': 2}


def _request(xff=None, remote='172.18.0.5'):
    meta = {'REMOTE_ADDR': remote}
    if xff is not None:
        meta['HTTP_X_FORWARDED_FOR'] = xff
    return RequestFactory().get('/', **meta)


class ClientIpTests(SimpleTestCase):
    def test_behind_caddy_and_nginx_the_client_is_second_from_the_right(self):
        with override_settings(REST_FRAMEWORK=TWO_PROXIES):
            self.assertEqual(client_ip(_request('203.0.113.7, 172.18.0.2')), '203.0.113.7')

    def test_a_forged_header_does_not_change_the_answer(self):
        """Whatever the client sends lands to the left of what Caddy wrote."""
        with override_settings(REST_FRAMEWORK=TWO_PROXIES):
            forged = _request('1.2.3.4, 5.6.7.8, 203.0.113.7, 172.18.0.2')
            self.assertEqual(client_ip(forged), '203.0.113.7')

    def test_the_throttle_key_matches_the_audit_address(self):
        with override_settings(REST_FRAMEWORK=TWO_PROXIES):
            request = _request('9.9.9.9, 203.0.113.7, 172.18.0.2')
            self.assertEqual(BaseThrottle().get_ident(request), client_ip(request))

    def test_without_proxies_remote_addr_is_the_client(self):
        with override_settings(REST_FRAMEWORK={}):
            self.assertEqual(client_ip(_request('1.2.3.4', remote='10.0.0.9')), '10.0.0.9')

    def test_a_short_header_falls_back_to_its_first_entry(self):
        with override_settings(REST_FRAMEWORK=TWO_PROXIES):
            self.assertEqual(client_ip(_request('203.0.113.7')), '203.0.113.7')


class DeploymentSettingTests(SimpleTestCase):
    def test_deployment_trusts_two_proxies(self):
        import pathlib

        text = (pathlib.Path(__file__).resolve().parents[2]
                / 'workflow_backend' / 'settings' / 'deployment.py').read_text(encoding='utf-8')
        self.assertIn("os.environ.setdefault('TRUSTED_PROXY_COUNT', '2')", text)
