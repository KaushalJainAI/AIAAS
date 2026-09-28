"""
The model second opinion (`core/safety/moderation.py`): refuses only our three
categories, fails open, runs after the patterns, never on the network here.
"""
from unittest import mock

from django.core.cache import cache
from django.test import SimpleTestCase, TestCase, override_settings

from core.safety import moderation


class _Response:
    def __init__(self, content, status=200):
        self._content = content
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f'HTTP {self.status_code}')

    def json(self):
        return {'choices': [{'message': {'content': self._content}}]}


@override_settings(CONTENT_MODERATION_MODEL='openai/gpt-oss-safeguard-20b',
                   OPENROUTER_API_KEY='k')
class ModerationTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def _answer(self, content, status=200):
        return mock.patch('httpx.post', return_value=_Response(content, status))

    def test_a_category_label_refuses_with_our_message(self):
        with self._answer('cbrn'):
            refused = moderation.check('some request', where='image prompt')
        self.assertEqual(refused.category, 'cbrn')
        self.assertNotIn('some request', refused.message)

    def test_safe_passes(self):
        with self._answer('safe'):
            self.assertIsNone(moderation.check('a lighthouse', where='image prompt'))

    def test_failures_and_nonsense_pass(self):
        with self._answer('cbrn', status=500):
            self.assertIsNone(moderation.check('x', where='page'))
        cache.clear()
        with self._answer(None):
            self.assertIsNone(moderation.check('y', where='page'))
        with self._answer('I think this is fine'):
            self.assertIsNone(moderation.check('z', where='page'))
        with mock.patch('httpx.post', side_effect=TimeoutError('slow')):
            self.assertIsNone(moderation.check('w', where='page'))

    def test_a_verdict_is_cached(self):
        with self._answer('ncii') as post:
            moderation.check('same text', where='page')
            moderation.check('same text', where='page')
        self.assertEqual(post.call_count, 1)

    @override_settings(CONTENT_MODERATION_MODEL='')
    def test_blank_model_is_off(self):
        with mock.patch('httpx.post') as post:
            self.assertIsNone(moderation.check('anything', where='page'))
        post.assert_not_called()


@override_settings(CONTENT_MODERATION_MODEL='openai/gpt-oss-safeguard-20b',
                   OPENROUTER_API_KEY='k')
class PublishUsesItTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_a_page_the_model_refuses_is_not_published(self):
        from django.contrib.auth.models import User

        from inference.pages import PublishError, publish

        user = User.objects.create_user(username='p', password='pw')
        with mock.patch('httpx.post', return_value=_Response('cbrn')):
            with self.assertRaises(PublishError) as refused:
                publish(user, title='Notes', kind='report', body='harmless words',
                        visibility='link')
        self.assertIn('weapons', str(refused.exception))
        cache.clear()
        with mock.patch('httpx.post', return_value=_Response('safe')):
            page = publish(user, title='Notes', kind='report', body='harmless words',
                           visibility='link')
        self.assertTrue(page.slug)
