"""Better browser control (Phase 6): elements, new actions, viewport, resume, codes.

The remote browser is faked at the HTTP boundary, as `chat/tests/test_browser.py`
does. Pinned here: an element carries only ref, role, name and selector (never
an input's value); the element list is capped and says so; the new verbs are
checked before anything is sent; navigation follows the same URL and domain
rules as a start URL; the viewport is one of two strings; a session with no
url resumes at its last page, checked again against the site list; every
failed step says why in a short `code`.
"""
from __future__ import annotations

import json
from unittest import mock

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase, override_settings

from browsing import engine, sessions
from browsing.engine import BrowserError, check_steps, clean_elements, clean_steps, looks_submitting
from browsing.models import BrowserSession
from chat.tools import execute_tool
from chat.tools.registry import get

REMOTE = dict(BROWSER_ENGINE='remote', BROWSER_REMOTE_URL='https://browser.example', BROWSER_API_TOKEN='t')
NEW_VERBS = ('navigate', 'back', 'hover', 'check', 'uncheck')


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


def _run(name, args, **ctx):
    return json.loads(async_to_sync(execute_tool)(name, args, {'user_id': 1, **ctx}))


# ── 6.1: elements ───────────────────────────────────────────────────────────

class ElementCleaningTests(SimpleTestCase):
    def test_an_element_carries_only_ref_role_name_and_selector(self):
        out = clean_elements([{
            'ref': 'x9', 'role': 'textbox', 'name': 'Email', 'selector': '#email',
            'value': 'hunter2-typed', 'text': 'typed text', 'extra': 1,
        }])
        self.assertEqual(out, [{'ref': 'e1', 'role': 'textbox', 'name': 'Email',
                                'selector': '#email'}])
        self.assertNotIn('hunter2-typed', repr(out))

    def test_refs_are_numbered_here_in_order(self):
        out = clean_elements([{'selector': '#a'}, {'selector': '#b'}, {'selector': '#c'}])
        self.assertEqual([e['ref'] for e in out], ['e1', 'e2', 'e3'])

    def test_the_list_is_capped_at_eighty(self):
        raw = [{'selector': f'#b{i}', 'name': 'n'} for i in range(100)]
        self.assertEqual(len(clean_elements(raw)), engine.ELEMENT_CAP)
        self.assertEqual(engine.ELEMENT_CAP, 80)

    def test_a_long_name_is_cut_to_eighty(self):
        out = clean_elements([{'selector': '#x', 'name': 'n' * 500}])
        self.assertEqual(len(out[0]['name']), 80)

    def test_a_selector_too_long_for_a_step_is_dropped(self):
        too_long = '#' + 'a' * engine.SELECTOR_CHARS
        self.assertEqual(clean_elements([{'selector': too_long}]), [])

    def test_junk_entries_are_skipped(self):
        self.assertEqual(clean_elements(None), [])
        self.assertEqual(clean_elements('nope'), [])
        self.assertEqual(clean_elements(['#x', {'selector': ''}]), [])


def _remote_page(payload):
    """Patches the remote call to answer with `payload` as the script's data."""
    client = _Client({'data': payload})
    return client, [
        mock.patch('workflow_backend.httpclient.shared_client', return_value=client),
        mock.patch('core.safety.net.validate_url_async', return_value=(True, '')),
    ]


@override_settings(**REMOTE)
class ElementResultTests(SimpleTestCase):
    def test_a_call_returns_the_elements_and_says_when_there_were_more(self):
        many = [{'ref': f'e{i}', 'role': 'button', 'name': f'Go {i}', 'selector': f'#go{i}',
                 'value': 'secret'} for i in range(1, 91)]
        _client, patches = _remote_page({'url': 'https://shop.example.com', 'title': 'Shop',
                                         'text': '', 'links': [], 'steps': [],
                                         'elements': many, 'elements_truncated': True})
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        page = async_to_sync(engine.run)('https://shop.example.com')
        self.assertEqual(len(page['elements']), 80)
        self.assertTrue(page['elements_truncated'])
        self.assertTrue(all(set(e) == {'ref', 'role', 'name', 'selector'} for e in page['elements']))
        self.assertNotIn('secret', repr(page['elements']))

    def test_a_page_with_no_elements_says_so_plainly(self):
        _client, patches = _remote_page({'url': 'https://x.example', 'title': '', 'text': '',
                                         'links': [], 'steps': []})
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        page = async_to_sync(engine.run)('https://x.example')
        self.assertEqual(page['elements'], [])
        self.assertFalse(page['elements_truncated'])

    def test_the_script_reads_an_input_value_in_one_place_only(self):
        # The only `.value` read is the label of a submit, button or reset input.
        # Any new read of a field's value must come with a reason and a test.
        self.assertEqual(engine._SCRIPT.count('.value'), 1)
        self.assertIn("['submit', 'button', 'reset'].includes(type)", engine._SCRIPT)


@override_settings(**REMOTE)
class ElementsInToolResultTests(SimpleTestCase):
    def test_both_tools_hand_the_model_the_element_list(self):
        async def page_with_elements(*args, **kwargs):
            return {'url': 'https://shop.example.com/cart', 'title': 'Cart', 'text': 'Cart',
                    'truncated': False, 'links': [], 'steps': [], 'screenshot': None,
                    'elements': [{'ref': 'e1', 'role': 'button', 'name': 'Checkout',
                                  'selector': '#checkout'}],
                    'elements_truncated': False}

        with mock.patch('browsing.engine.run', side_effect=page_with_elements):
            read = _run('browse_page', {'url': 'https://shop.example.com/cart'})
            acted = _run('browser_act', {'url': 'https://shop.example.com/cart',
                                         'steps': [{'action': 'wait', 'selector': 'body'}]})
        for out in (read, acted):
            self.assertEqual(out['elements'][0]['selector'], '#checkout')
            self.assertFalse(out['elements_truncated'])


# ── 6.2: new step actions ───────────────────────────────────────────────────

class NewVerbShapeTests(SimpleTestCase):
    def test_the_new_verbs_join_the_closed_list_and_upload_stays_refused(self):
        self.assertTrue(set(NEW_VERBS) <= set(engine.ACTIONS))
        with self.assertRaises(BrowserError) as ctx:
            check_steps([{'action': 'upload', 'selector': '#f'}])
        self.assertIn('not available', str(ctx.exception))

    def test_the_tool_schema_offers_the_new_verbs(self):
        enum = get('browser_act').schema['function']['parameters']['properties']['steps'][
            'items']['properties']['action']['enum']
        self.assertTrue(set(NEW_VERBS) <= set(enum))

    def test_hover_check_and_uncheck_need_a_selector(self):
        for verb in ('hover', 'check', 'uncheck'):
            with self.subTest(verb=verb), self.assertRaises(BrowserError) as ctx:
                check_steps([{'action': verb}])
            self.assertIn('CSS selector', str(ctx.exception))

    def test_back_needs_nothing(self):
        self.assertEqual(check_steps([{'action': 'back'}]),
                         [{'action': 'back', 'selector': '', 'text': ''}])

    def test_navigate_needs_a_web_address_and_nothing_else(self):
        self.assertEqual(
            check_steps([{'action': 'navigate', 'text': 'https://shop.example.com/cart'}])[0]['text'],
            'https://shop.example.com/cart')
        for bad in ('', 'javascript:alert(1)', 'file:///etc/passwd', 'ftp://x.example', 'example.com'):
            with self.subTest(text=bad), self.assertRaises(BrowserError):
                check_steps([{'action': 'navigate', 'text': bad}])
        with self.assertRaises(BrowserError):
            check_steps([{'action': 'navigate', 'selector': '#x', 'text': 'https://a.example'}])

    def test_a_navigate_to_a_pay_page_is_not_flagged_as_a_submit(self):
        # The submit scan reads click and press steps only, so a URL that says
        # "pay" is an address, not an intent to pay.
        self.assertFalse(looks_submitting(
            [{'action': 'navigate', 'text': 'https://shop.example.com/pay-invoice'}]))
        self.assertTrue(looks_submitting([{'action': 'click', 'selector': '#pay'}]))


@override_settings(**REMOTE)
class NavigateToolTests(SimpleTestCase):
    def setUp(self):
        self.client = _Client({'data': {'url': 'https://shop.example.com/cart', 'title': 'Cart',
                                        'text': '', 'links': [], 'steps': []}})
        for patcher in (
            mock.patch('workflow_backend.httpclient.shared_client', return_value=self.client),
            mock.patch('core.safety.net.validate_url_async', return_value=(True, '')),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_a_navigate_inside_the_sites_is_sent_as_a_step(self):
        out = _run('browser_act', {'url': 'https://shop.example.com', 'steps': [
            {'action': 'navigate', 'text': 'https://shop.example.com/cart'}]},
            browser_domains=('example.com',))
        self.assertNotIn('error', out)
        sent = self.client.sent[0][1]['json']['context']['steps']
        self.assertEqual(sent, [{'action': 'navigate', 'selector': '',
                                 'text': 'https://shop.example.com/cart'}])

    def test_a_navigate_off_the_sites_is_refused_and_nothing_is_sent(self):
        out = _run('browser_act', {'url': 'https://shop.example.com', 'steps': [
            {'action': 'navigate', 'text': 'https://bank.example.org/'}]},
            browser_domains=('example.com',))
        self.assertEqual(out['code'], 'blocked')
        self.assertIn('may only go to these sites', out['error'])
        self.assertEqual(self.client.sent, [])

    def test_an_empty_site_list_allows_no_navigation(self):
        out = _run('browser_act', {'url': 'https://shop.example.com', 'steps': [
            {'action': 'navigate', 'text': 'https://shop.example.com/cart'}]},
            browser_domains=())
        self.assertIn('error', out)
        self.assertEqual(self.client.sent, [])

    def test_navigation_to_an_internal_address_is_refused_even_with_no_site_list(self):
        async def refuse(url):
            return (False, 'Not allowed: a private address.')

        with mock.patch('core.safety.net.validate_url_async', side_effect=refuse):
            out = _run('browser_act', {'url': 'https://shop.example.com', 'steps': [
                {'action': 'navigate', 'text': 'http://169.254.169.254/latest'}]},
                browser_domains=None)
        self.assertEqual(out, {'code': 'blocked', 'error': 'Not allowed: a private address.'})
        self.assertEqual(self.client.sent, [])

    def test_hover_check_uncheck_and_back_reach_the_script_as_data(self):
        steps = [{'action': 'hover', 'selector': '#menu'},
                 {'action': 'check', 'selector': '#terms'},
                 {'action': 'uncheck', 'selector': '#news'},
                 {'action': 'back'}]
        out = _run('browser_act', {'url': 'https://shop.example.com', 'steps': steps})
        self.assertNotIn('error', out)
        sent = self.client.sent[0][1]['json']['context']['steps']
        self.assertEqual([s['action'] for s in sent], ['hover', 'check', 'uncheck', 'back'])
        self.assertEqual(self.client.sent[0][1]['json']['code'], engine._SCRIPT)


# ── 6.3: phone-sized viewport ───────────────────────────────────────────────

class ViewportValidationTests(SimpleTestCase):
    def test_only_two_screens_are_offered(self):
        self.assertEqual(engine.viewport_of(None), 'desktop')
        self.assertEqual(engine.viewport_of(' Phone '), 'phone')
        for bad in ('tablet', 'watch', 'desktop; drop', 3):
            with self.subTest(viewport=bad), self.assertRaises(BrowserError):
                engine.viewport_of(bad)

    def test_both_tools_say_so_for_any_other_screen(self):
        client = _Client({'data': {}})
        with override_settings(**REMOTE), \
                mock.patch('workflow_backend.httpclient.shared_client', return_value=client), \
                mock.patch('core.safety.net.validate_url_async', return_value=(True, '')):
            read = _run('browse_page', {'url': 'https://shop.example.com', 'viewport': 'tablet'})
            acted = _run('browser_act', {'url': 'https://shop.example.com', 'viewport': 'tablet',
                                         'steps': [{'action': 'wait', 'selector': 'body'}]})
        for out in (read, acted):
            self.assertIn("viewport must be 'desktop' or 'phone'", out['error'])
        self.assertEqual(client.sent, [])


    def test_the_phone_screen_reaches_the_script_as_data(self):
        client = _Client({'data': {'url': 'https://shop.example.com', 'title': '', 'text': '',
                                   'links': [], 'steps': []}})
        with override_settings(**REMOTE), \
                mock.patch('workflow_backend.httpclient.shared_client', return_value=client), \
                mock.patch('core.safety.net.validate_url_async', return_value=(True, '')):
            _run('browse_page', {'url': 'https://shop.example.com', 'viewport': 'phone'})
            _run('browse_page', {'url': 'https://shop.example.com'})
        self.assertEqual(client.sent[0][1]['json']['context']['viewport'], 'phone')
        self.assertEqual(client.sent[1][1]['json']['context']['viewport'], 'desktop')

    def test_the_script_sets_a_phone_screen_and_user_agent(self):
        self.assertIn('isMobile: true', engine._SCRIPT)
        self.assertIn("width: 390, height: 844", engine._SCRIPT)
        self.assertIn("context.viewport === 'phone'", engine._SCRIPT)

    def test_the_schemas_name_the_two_screens(self):
        for tool in ('browse_page', 'browser_act'):
            with self.subTest(tool=tool):
                props = get(tool).schema['function']['parameters']['properties']
                self.assertEqual(props['viewport']['enum'], ['desktop', 'phone'])


# ── 6.4: carry on where the last call stopped ───────────────────────────────

@override_settings(**REMOTE)
class ResumeTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user('resumer', 'r@example.com', 'pw')
        self.other = get_user_model().objects.create_user('stranger', 's@example.com', 'pw')
        self.client_fake = _Client({'data': {'url': 'https://shop.example.com/cart',
                                             'title': 'Cart', 'text': '', 'links': [],
                                             'steps': []}})
        for patcher in (
            mock.patch('workflow_backend.httpclient.shared_client', return_value=self.client_fake),
            mock.patch('core.safety.net.validate_url_async', return_value=(True, '')),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        self.session = sessions.ensure(self.user, 'shop.example.com')
        BrowserSession.objects.filter(id=self.session.id).update(
            last_url='https://shop.example.com/cart')
        self.wait = [{'action': 'wait', 'selector': 'body'}]

    def _as(self, user, args, **ctx):
        return _run('browser_act', args, user_id=user.id, **ctx)

    def test_a_session_call_with_no_url_starts_where_the_last_call_ended(self):
        out = self._as(self.user, {'session': str(self.session.id), 'steps': self.wait},
                       browser_domains=('example.com',))
        self.assertNotIn('error', out)
        self.assertEqual(self.client_fake.sent[0][1]['json']['context']['url'],
                         'https://shop.example.com/cart')
        self.assertEqual(out['session'], str(self.session.id))

    def test_a_finished_session_call_keeps_the_page_it_ended_on(self):
        out = self._as(self.user, {'url': 'https://shop.example.com/start',
                                   'session': 'new', 'steps': self.wait})
        session = BrowserSession.objects.get(id=out['session'])
        self.assertEqual(session.last_url, 'https://shop.example.com/cart')

    def test_a_resumed_page_off_the_agents_sites_is_refused_not_followed(self):
        BrowserSession.objects.filter(id=self.session.id).update(
            last_url='https://bank.example.org/account')
        out = self._as(self.user, {'session': str(self.session.id), 'steps': self.wait},
                       browser_domains=('example.com',))
        self.assertIn('may only act on these sites', out['error'])
        self.assertEqual(self.client_fake.sent, [])

    def test_no_url_and_no_session_has_nothing_to_start_from(self):
        out = self._as(self.user, {'steps': self.wait})
        self.assertIn('Give a url', out['error'])
        self.assertEqual(self.client_fake.sent, [])

    def test_new_with_no_url_has_no_page_to_carry_on_from(self):
        out = self._as(self.user, {'session': 'new', 'steps': self.wait})
        self.assertIn('Give a url', out['error'])

    def test_another_users_session_is_not_resumed(self):
        out = self._as(self.other, {'session': str(self.session.id), 'steps': self.wait})
        self.assertIn('No open browser session', out['error'])
        self.assertEqual(self.client_fake.sent, [])

    def test_a_session_with_no_page_yet_says_so(self):
        fresh = sessions.ensure(self.user, 'portal.example.com')
        out = self._as(self.user, {'session': str(fresh.id), 'steps': self.wait})
        self.assertIn('no page yet', out['error'])

    def test_a_closed_session_does_not_resume(self):
        sessions.close(self.session)
        out = self._as(self.user, {'session': str(self.session.id), 'steps': self.wait})
        self.assertIn('No open browser session', out['error'])


# ── 6.5: a code for every failed step ───────────────────────────────────────

@override_settings(**REMOTE)
class StepCodeTests(SimpleTestCase):
    def test_the_script_names_each_failure_and_waits_for_visibility(self):
        for code in ('not_found', 'not_visible', 'timeout', 'navigated_away', 'failed'):
            self.assertIn(f"'{code}'", engine._SCRIPT)
        self.assertIn('err.code = present', engine._SCRIPT)
        self.assertIn('visible: visible', engine._SCRIPT)

    def test_the_script_never_echoes_a_typed_value_in_an_error(self):
        self.assertIn("'Could not type into '", engine._SCRIPT)

    def test_a_failed_step_keeps_its_code_and_a_short_error(self):
        client, patches = _remote_page({'url': 'https://shop.example.com', 'title': '', 'text': '',
                                        'links': [], 'steps': [
            {'action': 'click', 'ok': False, 'code': 'not_found', 'error': 'No element matches #x'},
        ]})
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        page = async_to_sync(engine.run)('https://shop.example.com', steps=[
            {'action': 'click', 'selector': '#x', 'text': ''}])
        self.assertEqual(page['steps'], [{'action': 'click', 'ok': False, 'code': 'not_found',
                                          'error': 'No element matches #x'}])

    def test_a_code_the_script_did_not_name_becomes_failed_and_the_error_is_cut(self):
        out = clean_steps([{'action': 'click', 'ok': False, 'code': 'made_up',
                            'error': 'x' * 900}])
        self.assertEqual(out[0]['code'], 'failed')
        self.assertEqual(len(out[0]['error']), engine.STEP_ERROR_CHARS)

    def test_a_success_carries_no_code_and_no_error(self):
        self.assertEqual(clean_steps([{'action': 'click', 'ok': True, 'error': 'stale'}]),
                         [{'action': 'click', 'ok': True}])

    def test_nothing_outside_the_known_keys_leaves_a_step(self):
        out = clean_steps([{'action': 'type', 'ok': False, 'code': 'failed', 'error': 'boom',
                            'value': 'hunter2-typed', 'text': 'hunter2-typed'}])
        self.assertEqual(set(out[0]), {'action', 'ok', 'code', 'error'})
        self.assertNotIn('hunter2-typed', repr(out))

    def test_extracted_content_still_arrives(self):
        client, patches = _remote_page({'url': 'https://x.example', 'title': '', 'text': '',
                                        'links': [], 'steps': [
            {'action': 'extract', 'ok': True, 'extracted': [['a', 'b']]},
        ]})
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        page = async_to_sync(engine.run)('https://x.example')
        self.assertEqual(page['extracted'], [[['a', 'b']]])

    def test_the_tool_result_carries_the_code(self):
        client, patches = _remote_page({'url': 'https://shop.example.com', 'title': '', 'text': '',
                                        'links': [], 'steps': [
            {'action': 'click', 'ok': False, 'code': 'timeout', 'error': 'Timed out'},
        ]})
        with override_settings(**REMOTE):
            for p in patches:
                p.start()
                self.addCleanup(p.stop)
            out = _run('browser_act', {'url': 'https://shop.example.com', 'steps': [
                {'action': 'click', 'selector': '#go'}]})
        self.assertEqual(out['steps'][0]['code'], 'timeout')
