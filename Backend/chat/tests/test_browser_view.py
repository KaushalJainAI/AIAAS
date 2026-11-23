"""The Browser tab's data (Phase 5b): what a browser call leaves on the turn.

Pinned: the picture is readable by its owner only, and another user's id, a
made-up id and an expired one all get the same 404; every call keeps a picture,
and only a call that asked saves one to the user's files; a view never carries
typed text, a vault value or an input's value; the turn keeps the last ten
views, newest last; a refused call adds none; a picture that cannot be kept
costs the picture, never the call.

The remote browser is faked at `browsing.engine.run`, as `browsing/tests` does.
"""
from __future__ import annotations

import json
from unittest import mock

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from browsing import frames
from chat.tools import execute_tool
from chat.turn.agent import BROWSER_VIEWS_KEPT, _on_browser
from chat.turn.events import Event
from credentials.models import Credential, CredentialType

User = get_user_model()

REMOTE = dict(BROWSER_ENGINE='remote', BROWSER_REMOTE_URL='https://browser.example',
              BROWSER_API_TOKEN='t')
JPEG = b'\xff\xd8\xff\xe0' + b'view-picture'
MADE_UP = 'AAAAAAAAAAAAAAAA'


def _page(steps=(), screenshot=JPEG):
    return {
        'url': 'https://portal.example.com/login', 'title': 'Login',
        'text': 'Sign in to continue', 'truncated': False, 'links': [],
        'steps': [{'action': s.get('action'), 'ok': True} for s in steps],
        'screenshot': screenshot,
    }


async def _fake_run(url, **kwargs):
    return _page(steps=kwargs.get('steps') or [])


def _call(name, args, *, user, **ctx):
    context = {'user_id': user.id, 'browser_logins': set(), 'browser_domains': None, **ctx}
    # Logins are allow-listed per run; the vault test names its login here.
    with override_settings(**REMOTE), \
            mock.patch('browsing.engine.run', side_effect=_fake_run):
        return json.loads(async_to_sync(execute_tool)(name, args, context))


class FrameEndpointTests(TestCase):
    def setUp(self):
        cache.clear()
        self.owner = User.objects.create_user('view-owner', 'vo@example.com', 'pw')
        self.other = User.objects.create_user('view-other', 'vx@example.com', 'pw')
        self.owner_api = APIClient()
        self.owner_api.force_authenticate(user=self.owner)
        self.other_api = APIClient()
        self.other_api.force_authenticate(user=self.other)

    def test_the_owner_gets_the_picture_privately(self):
        frame_id = frames.put(self.owner.id, JPEG)
        resp = self.owner_api.get(f'/api/browser/frames/{frame_id}/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp['Content-Type'], 'image/jpeg')
        self.assertEqual(resp.content, JPEG)
        self.assertIn('private', resp['Cache-Control'])
        self.assertIn('max-age=3600', resp['Cache-Control'])

    def test_another_users_frame_and_a_made_up_id_get_the_same_404(self):
        frame_id = frames.put(self.owner.id, JPEG)
        foreign = self.other_api.get(f'/api/browser/frames/{frame_id}/')
        made_up = self.owner_api.get(f'/api/browser/frames/{MADE_UP}/')
        self.assertEqual(foreign.status_code, 404)
        self.assertEqual(made_up.status_code, 404)
        self.assertEqual(foreign.content, made_up.content)

    def test_an_expired_frame_gets_that_same_404(self):
        frame_id = frames.put(self.owner.id, JPEG)
        cache.delete(f'browser:frame:{self.owner.id}:{frame_id}')
        expired = self.owner_api.get(f'/api/browser/frames/{frame_id}/')
        made_up = self.owner_api.get(f'/api/browser/frames/{MADE_UP}/')
        self.assertEqual(expired.status_code, 404)
        self.assertEqual(expired.content, made_up.content)

    def test_no_sign_in_no_picture(self):
        frame_id = frames.put(self.owner.id, JPEG)
        resp = APIClient().get(f'/api/browser/frames/{frame_id}/')
        self.assertIn(resp.status_code, (401, 403))

    def test_status_says_whether_a_browser_is_set_up(self):
        resp = self.owner_api.get('/api/browser/status/')
        self.assertEqual(resp.json(), {'available': False})
        with override_settings(**REMOTE):
            resp = self.owner_api.get('/api/browser/status/')
        self.assertEqual(resp.json(), {'available': True})


class BrowserViewTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user('view-user', 'vu@example.com', 'pw')
        cred_type, _ = CredentialType.objects.update_or_create(
            slug='portal-gst',
            defaults={'name': 'GST Portal', 'auth_method': 'custom',
                      'fields_schema': [{'name': 'password'}]},
        )
        cls.cred = Credential(user=cls.user, credential_type=cred_type, name='GST')
        cls.cred.set_credential_data({'password': 's3cr3t-pw'})
        cls.cred.save()

    def setUp(self):
        cache.clear()

    def test_every_call_keeps_a_picture_but_only_an_asked_for_one_is_saved(self):
        with mock.patch('chat.tools.browser._save_screenshot',
                        new=mock.AsyncMock(return_value='screenshots/portal.jpg')) as save:
            quiet = _call('browse_page', {'url': 'https://portal.example.com/login'},
                          user=self.user)
            self.assertNotIn('screenshot_path', quiet)
            save.assert_not_called()
            kept = frames.get(self.user.id, quiet['browser_view']['frame_id'])
            self.assertEqual(kept, JPEG)

            asked = _call('browse_page', {'url': 'https://portal.example.com/login',
                                          'screenshot': True}, user=self.user)
            self.assertEqual(asked['screenshot_path'], 'screenshots/portal.jpg')
            save.assert_called_once()

    def test_a_view_names_the_call_and_its_picture(self):
        out = _call('browse_page', {'url': 'https://portal.example.com/login'}, user=self.user)
        view = out['browser_view']
        self.assertEqual(set(view), {'frame_id', 'url', 'title', 'session', 'live_url',
                                     'steps', 'needs_user'})
        self.assertEqual(view['title'], 'Login')
        self.assertEqual(view['steps'], [])
        self.assertIsNone(view['needs_user'])
        self.assertTrue(view['frame_id'])

    def test_typed_text_and_vault_values_never_reach_the_view(self):
        out = _call('browser_act', {
            'url': 'https://portal.example.com/login',
            'steps': [
                {'action': 'type', 'selector': '#email', 'text': 'hunter2-typed'},
                {'action': 'fill_secret', 'selector': '#pw', 'secret_ref': 'portal-gst.password'},
                {'action': 'click', 'selector': '#go'},
            ],
        }, user=self.user, browser_logins={'portal-gst'})
        view = out['browser_view']
        self.assertEqual([s['action'] for s in view['steps']], ['type', 'fill_secret', 'click'])
        for step in view['steps']:
            self.assertEqual(set(step), {'action', 'selector', 'ok'})
        self.assertNotIn('hunter2-typed', json.dumps(view))
        self.assertNotIn('s3cr3t-pw', json.dumps(view))
        self.assertNotIn('s3cr3t-pw', json.dumps(out))

    def test_a_selector_is_cut_to_120_characters(self):
        # Under the 300-character step cap, over the 120 the view shows.
        long_selector = '#' + 'a' * 199
        out = _call('browser_act', {
            'url': 'https://portal.example.com/login',
            'steps': [{'action': 'click', 'selector': long_selector}],
        }, user=self.user)
        self.assertEqual(len(out['browser_view']['steps'][0]['selector']), 120)

    def test_a_refused_call_adds_no_view_and_no_event(self):
        out = _call('browser_act', {
            'url': 'https://portal.example.com/login',
            'steps': [{'action': 'click', 'selector': '#g-recaptcha'}],
        }, user=self.user)
        self.assertIn('error', out)
        self.assertNotIn('browser_view', out)
        meta, seen = {}, []

        async def sink(event, payload):
            seen.append(event)

        async_to_sync(_on_browser)(out, {}, meta, sink)
        self.assertEqual(meta, {})
        self.assertEqual(seen, [])

    def test_the_turn_keeps_the_last_ten_views_newest_last(self):
        self.assertEqual(BROWSER_VIEWS_KEPT, 10)
        meta, seen = {}, []

        async def sink(event, payload):
            seen.append((event, payload))

        for i in range(12):
            parsed = {'browser_view': {'frame_id': f'f{i}', 'url': 'https://x.example'}}
            async_to_sync(_on_browser)(parsed, {}, meta, sink)

        views = meta['browser']
        self.assertEqual(len(views), 10)
        self.assertEqual(views[0]['frame_id'], 'f2')
        self.assertEqual(views[-1]['frame_id'], 'f11')
        event, payload = seen[-1]
        self.assertEqual(event, Event.BROWSER_UPDATE)
        self.assertEqual(payload['browser'], views)
        self.assertEqual(len(seen), 12)

    def test_an_oversized_picture_costs_the_picture_not_the_call(self):
        async def big_run(url, **kwargs):
            return _page(screenshot=b'\x00' * (frames.MAX_FRAME_BYTES + 1))

        with override_settings(**REMOTE), mock.patch('browsing.engine.run', side_effect=big_run):
            out = json.loads(async_to_sync(execute_tool)(
                'browse_page', {'url': 'https://portal.example.com/login'},
                {'user_id': self.user.id}))
        self.assertNotIn('error', out)
        self.assertEqual(out['browser_view']['frame_id'], '')
        self.assertEqual(out['title'], 'Login')

    def test_a_cache_failure_costs_the_picture_not_the_call(self):
        with mock.patch('browsing.frames.cache') as broken:
            broken.set.side_effect = RuntimeError('cache is down')
            out = _call('browse_page', {'url': 'https://portal.example.com/login'},
                        user=self.user)
        self.assertNotIn('error', out)
        self.assertEqual(out['browser_view']['frame_id'], '')
