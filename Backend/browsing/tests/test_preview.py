"""The link preview endpoint (Phase 8): `POST /api/browser/preview/`.

Pinned: with no browser configured the route is a 404; the address is checked
before anything is sent (an internal address or a non-web scheme is a 400 and
nothing leaves the box); the preview is read-only and returns a title, the
owner's picture and a short excerpt; each preview is one browser minute on the
ledger; the endpoint is throttled per user.

The remote browser is faked at the HTTP boundary, as the other browser tests do.
"""
from __future__ import annotations

import base64
from unittest import mock
from urllib.parse import urlparse

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.settings import api_settings
from rest_framework.test import APIClient

from browsing import frames
from core.safety import net as safety_net

User = get_user_model()
REMOTE = dict(BROWSER_ENGINE='remote', BROWSER_REMOTE_URL='https://browser.example', BROWSER_API_TOKEN='t')
JPEG = b'\xff\xd8\xff\xe0' + b'preview-picture'
PREVIEW = '/api/browser/preview/'


class _Resp:
    def __init__(self, payload, status=200):
        self.payload, self.status_code = payload, status

    def json(self):
        return self.payload


class _Client:
    def __init__(self, payload, status=200):
        self.sent = []
        self.payload, self.status = payload, status

    async def post(self, url, **kw):
        self.sent.append((url, kw))
        return _Resp(self.payload, self.status)


def _page_payload(text='x' * 5000):
    return {'data': {'url': 'https://news.example.com/story', 'title': 'Story', 'text': text,
                     'links': [], 'steps': [],
                     'screenshot': base64.b64encode(JPEG).decode()}}


@override_settings(**REMOTE)
class PreviewTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user('previewer', 'p@example.com', 'pw')
        self.other = User.objects.create_user('neighbour', 'n@example.com', 'pw')
        self.api = APIClient()
        self.api.force_authenticate(user=self.user)
        self.client_fake = _Client(_page_payload())
        self.remote = mock.patch('workflow_backend.httpclient.shared_client',
                                 return_value=self.client_fake)
        self.remote.start()
        self.addCleanup(self.remote.stop)
        # The public test host is treated as safe without a DNS lookup (the sandbox
        # cannot resolve it). Everything else goes through the real guard, so the
        # internal-address and scheme tests still exercise it.
        real_validate = safety_net.validate_url

        def guard(url):
            return (True, '') if urlparse(url).hostname == 'news.example.com' else real_validate(url)

        guard_patch = mock.patch('core.safety.net.validate_url', side_effect=guard)
        guard_patch.start()
        self.addCleanup(guard_patch.stop)

    def test_no_browser_configured_is_a_404(self):
        with override_settings(BROWSER_ENGINE='none'):
            resp = self.api.post(PREVIEW, {'url': 'https://news.example.com/story'}, format='json')
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(self.client_fake.sent, [])

    def test_a_preview_gives_a_title_a_picture_and_a_short_excerpt(self):
        resp = self.api.post(PREVIEW, {'url': 'https://news.example.com/story'}, format='json')
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body['title'], 'Story')
        self.assertEqual(body['url'], 'https://news.example.com/story')
        self.assertLessEqual(len(body['text_excerpt']), 2000)
        self.assertEqual(frames.get(self.user.id, body['frame_id']), JPEG)

    def test_the_picture_is_only_the_owners(self):
        body = self.api.post(PREVIEW, {'url': 'https://news.example.com/story'},
                             format='json').json()
        self.assertIsNone(frames.get(self.other.id, body['frame_id']))

    def test_the_preview_is_read_only(self):
        self.api.post(PREVIEW, {'url': 'https://news.example.com/story'}, format='json')
        sent = self.client_fake.sent[0][1]['json']['context']
        self.assertEqual(sent['steps'], [])
        self.assertTrue(sent['screenshot'])

    def test_an_internal_address_is_refused_before_anything_is_sent(self):
        resp = self.api.post(PREVIEW, {'url': 'http://169.254.169.254/latest/meta-data'},
                             format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('error', resp.json())
        self.assertEqual(self.client_fake.sent, [])

    def test_a_non_web_scheme_is_refused(self):
        resp = self.api.post(PREVIEW, {'url': 'file:///etc/passwd'}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(self.client_fake.sent, [])

    def test_a_missing_or_overlong_url_is_a_400(self):
        self.assertEqual(self.api.post(PREVIEW, {}, format='json').status_code, 400)
        long_url = 'https://news.example.com/' + 'a' * 2100
        self.assertEqual(self.api.post(PREVIEW, {'url': long_url}, format='json').status_code, 400)
        self.assertEqual(self.client_fake.sent, [])

    def test_a_remote_failure_is_a_502_with_the_reason(self):
        self.client_fake.status = 500
        resp = self.api.post(PREVIEW, {'url': 'https://news.example.com/story'}, format='json')
        self.assertEqual(resp.status_code, 502)
        self.assertIn('refused the request', resp.json()['error'])

    def test_each_preview_is_one_browser_minute_on_the_ledger(self):
        with mock.patch('logs.costs.record') as record:
            self.api.post(PREVIEW, {'url': 'https://news.example.com/story'}, format='json')
        record.assert_called_once()
        self.assertEqual(record.call_args.kwargs['source'], 'browser_preview')
        self.assertEqual(record.call_args.kwargs['kind'], 'browser')

    def test_a_failed_preview_is_not_billed(self):
        self.client_fake.status = 500
        with mock.patch('logs.costs.record') as record:
            self.api.post(PREVIEW, {'url': 'https://news.example.com/story'}, format='json')
        record.assert_not_called()

    def test_the_endpoint_is_throttled_per_user(self):
        with mock.patch.dict(api_settings.DEFAULT_THROTTLE_RATES, {'browser_preview': '2/hour'}):
            codes = [self.api.post(PREVIEW, {'url': 'https://news.example.com/story'},
                                   format='json').status_code for _ in range(3)]
        self.assertEqual(codes, [200, 200, 429])

    def test_signed_out_callers_are_refused(self):
        resp = APIClient().post(PREVIEW, {'url': 'https://news.example.com/story'}, format='json')
        self.assertIn(resp.status_code, (401, 403))
        self.assertEqual(self.client_fake.sent, [])
