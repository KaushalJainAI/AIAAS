"""
Decision models: `llm/decisions.py`, the `decide` tool, the setting and the grant.

The network is never reached — the provider's `post` and `fetch_models` are
replaced. What is pinned: the question translation and its refusals (refuse,
never trim), the one rule for which provider/model answers, the listing order
(newest first, expired dropped, an unreachable listing degrading to the
default), the request body actually sent, the sentences errors become, and
the setting. The wiring that makes the tool reachable from chat and from a
granted agent is pinned in `chat/tests/test_decide_tool.py`.
"""
from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from llm import decisions
from llm.decisions import DecisionError, build_questions, build_state

LISTING = [
    {'id': 'typesafe/jev-1.13', 'name': 'TypeSafe: Jev 1.13', 'created': 100,
     'input_price_per_million': 0.042, 'is_free': False, 'context_length': 262144,
     'input_modalities': ['text', 'image'], 'is_router': False, 'expires': ''},
    {'id': '~typesafe/jev-latest', 'name': 'TypeSafe: Jev Latest', 'created': 300,
     'input_price_per_million': 0.042, 'is_free': False, 'context_length': 262144,
     'input_modalities': ['text', 'image'], 'is_router': True, 'expires': ''},
    {'id': 'typesafe/jev-1.14', 'name': 'TypeSafe: Jev 1.14', 'created': 200,
     'input_price_per_million': 0.042, 'is_free': False, 'context_length': 262144,
     'input_modalities': ['text', 'image'], 'is_router': False, 'expires': ''},
]

ANSWER = {
    'model': 'typesafe/jev-1.14-20261014',
    'answers': {
        'team': {'type': 'choice', 'choice': 'payments', 'confidence': 0.85,
                 'probabilities': {'payments': 0.9, 'frontend': 0.1}},
        'is_bug': {'type': 'noul', 'noul': 0.86},
        'urgency': {'type': 'score', 'score': 1.99, 'confidence': 1,
                    'legend': {'0': 'can wait', '1': 'this week', '2': 'blocking'},
                    'probabilities': {'0': 0, '1': 0, '2': 1}},
    },
    'usage': {'input_tokens': 380, 'output_tokens': 70, 'cost': 1.596e-05},
}

QUESTIONS = [
    {'name': 'team', 'type': 'choice', 'instructions': 'Which team owns it?',
     'options': [{'name': 'payments', 'description': 'billing'}, {'name': 'frontend'}]},
    {'name': 'is_bug', 'type': 'noul', 'instructions': 'Is it a defect?'},
    {'name': 'urgency', 'type': 'score', 'levels': ['can wait', 'this week', 'blocking']},
]


class QuestionTranslationTests(SimpleTestCase):
    def test_the_flat_list_becomes_the_apis_map(self):
        out = build_questions(QUESTIONS)
        self.assertEqual(out['team'], {
            'type': 'choice', 'instructions': 'Which team owns it?',
            'criteria': {'payments': 'billing', 'frontend': 'frontend'},
        })
        self.assertEqual(out['is_bug'], {'type': 'noul', 'instructions': 'Is it a defect?'})
        self.assertEqual(out['urgency']['criteria'], ['can wait', 'this week', 'blocking'])

    def test_yes_no_guidance_becomes_true_false_criteria(self):
        out = build_questions([{'name': 'ok', 'type': 'yes_no', 'yes': 'it works', 'no': 'it fails'}])
        self.assertEqual(out['ok'], {'type': 'noul', 'criteria': {'true': 'it works', 'false': 'it fails'}})

    def test_options_over_the_cap_are_refused_not_trimmed(self):
        options = [{'name': f'o{i}'} for i in range(decisions.MAX_CHOICE_OPTIONS + 1)]
        with self.assertRaisesRegex(DecisionError, 'at most'):
            build_questions([{'name': 'pick', 'type': 'choice', 'options': options}])

    def test_refusals_name_the_fix(self):
        cases = [
            ([], 'at least one'),
            ([{'name': 'a', 'type': 'choice', 'options': [{'name': 'x'}]}], 'two options'),
            ([{'name': 'a', 'type': 'essay'}], 'choice, noul'),
            ([{'name': '1bad', 'type': 'noul', 'instructions': 'q'}], 'short `name`'),
            ([{'name': 'a', 'type': 'noul'}], 'needs `instructions`'),
            ([{'name': 'a', 'type': 'noul', 'instructions': 'q'}] * 2, 'Two questions'),
            ([{'name': 'a', 'type': 'score', 'levels': ['one']}], 'two levels'),
            ([{'name': f'q{i}', 'type': 'noul', 'instructions': 'q'}
              for i in range(decisions.MAX_QUESTIONS + 1)], 'at most'),
        ]
        for questions, phrase in cases:
            with self.subTest(phrase=phrase), self.assertRaisesRegex(DecisionError, phrase):
                build_questions(questions)

    def test_state_json_text_becomes_an_object_and_prose_stays_text(self):
        self.assertEqual(build_state('{"tier": "pro"}'), {'tier': 'pro'})
        self.assertEqual(build_state('a blank screen at checkout'), 'a blank screen at checkout')
        self.assertEqual(build_state('{not json'), '{not json')

    def test_state_is_required_and_bounded(self):
        with self.assertRaises(DecisionError):
            build_state('  ')
        with self.assertRaisesRegex(DecisionError, 'under'):
            build_state('x' * (decisions.MAX_STATE_CHARS + 1))


def _user(provider='', model=''):
    return SimpleNamespace(profile=SimpleNamespace(decision_provider=provider, decision_model=model))


@override_settings(DECISION_PROVIDER='openrouter', DECISION_MODEL='~typesafe/jev-latest')
class ResolveTests(SimpleTestCase):
    def test_no_preference_is_the_platform_default(self):
        self.assertEqual(decisions.resolve(_user()), ('openrouter', '~typesafe/jev-latest'))
        self.assertEqual(decisions.resolve(None), ('openrouter', '~typesafe/jev-latest'))

    def test_the_users_choice_beats_the_platform(self):
        self.assertEqual(decisions.resolve(_user('openrouter', 'typesafe/jev-1.14')),
                         ('openrouter', 'typesafe/jev-1.14'))

    def test_a_call_time_model_beats_the_users_choice(self):
        self.assertEqual(decisions.resolve(_user('openrouter', 'typesafe/jev-1.14'), model='typesafe/jev-1.13'),
                         ('openrouter', 'typesafe/jev-1.13'))

    def test_a_saved_provider_with_no_model_gets_that_providers_default(self):
        self.assertEqual(decisions.resolve(_user('openrouter', '')), ('openrouter', '~typesafe/jev-latest'))

    def test_a_saved_choice_for_a_provider_that_no_longer_exists_is_ignored(self):
        self.assertEqual(decisions.resolve(_user('gone', 'gone/model')), ('openrouter', '~typesafe/jev-latest'))

    def test_an_unknown_call_time_provider_is_refused(self):
        with self.assertRaisesRegex(DecisionError, 'no decision models'):
            decisions.resolve(_user(), provider='nowhere')


class ListingTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def test_newest_first_and_cached(self):
        impl = decisions.PROVIDERS['openrouter']
        with patch.object(impl, 'fetch_models', return_value=[dict(r) for r in LISTING]) as fetch:
            rows = decisions.list_models('openrouter')
            decisions.list_models('openrouter')
        self.assertEqual([r['id'] for r in rows],
                         ['~typesafe/jev-latest', 'typesafe/jev-1.14', 'typesafe/jev-1.13'])
        fetch.assert_called_once()

    def test_expired_models_are_dropped_from_the_raw_listing(self):
        payload = {'data': [
            {'id': 'a/live', 'name': 'Live', 'created': 2, 'pricing': {'prompt': '0.00000004'}},
            {'id': 'a/dead', 'name': 'Dead', 'created': 3, 'pricing': {'prompt': '0'},
             'expiration_date': '2001-01-01'},
            {'id': 'a/free', 'name': 'Free', 'created': 1, 'pricing': {'prompt': '0'}},
        ]}
        with patch('httpx.get', return_value=httpx.Response(
                200, json=payload, request=httpx.Request('GET', 'https://x'))):
            rows = decisions.PROVIDERS['openrouter'].fetch_models()
        self.assertEqual([r['id'] for r in rows], ['a/live', 'a/free'])
        self.assertEqual(rows[0]['input_price_per_million'], 0.04)
        self.assertTrue(rows[1]['is_free'])

    def test_an_unreachable_listing_offers_the_default_and_accepts_any_well_formed_id(self):
        impl = decisions.PROVIDERS['openrouter']
        with patch.object(impl, 'fetch_models', side_effect=httpx.ConnectError('down')):
            rows = decisions.list_models('openrouter')
            self.assertTrue(decisions.is_known_model('openrouter', 'someone/new-model'))
            self.assertFalse(decisions.is_known_model('openrouter', 'NOT AN ID'))
        self.assertEqual([r['id'] for r in rows], [impl.default_model])
        self.assertTrue(rows[0]['unverified'])

    def test_a_reachable_listing_is_the_authority(self):
        impl = decisions.PROVIDERS['openrouter']
        with patch.object(impl, 'fetch_models', return_value=[dict(r) for r in LISTING]):
            self.assertTrue(decisions.is_known_model('openrouter', 'typesafe/jev-1.14'))
            self.assertFalse(decisions.is_known_model('openrouter', 'someone/new-model'))
            self.assertFalse(decisions.is_known_model('nowhere', 'typesafe/jev-1.14'))


def _response(status=200, body=None):
    return httpx.Response(status, json=body if body is not None else ANSWER,
                          request=httpx.Request('POST', 'https://openrouter.ai/api/alpha/decisions'))


@override_settings(DECISION_PROVIDER='openrouter', DECISION_MODEL='~typesafe/jev-latest')
class DecideTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = get_user_model().objects.create_user(
            username='decider', email='decider@example.com', password='x')
        self.impl = decisions.PROVIDERS['openrouter']

    def _decide(self, **kw):
        return async_to_sync(decisions.decide)(self.user.id, '{"ticket": "blank screen"}', QUESTIONS, **kw)

    def test_sends_the_translated_request_with_the_saved_model(self):
        from core.models import UserProfile

        UserProfile.objects.update_or_create(
            user=self.user, defaults={'decision_provider': 'openrouter',
                                      'decision_model': 'typesafe/jev-1.14'})
        post = AsyncMock(return_value=_response())
        with patch('credentials.resolution.resolve_api_key', AsyncMock(return_value='sk-test')), \
                patch.object(self.impl, 'post', post):
            decision = self._decide()
        key, body = post.await_args.args
        self.assertEqual(key, 'sk-test')
        self.assertEqual(body['model'], 'typesafe/jev-1.14')
        self.assertEqual(body['state'], {'ticket': 'blank screen'})
        self.assertEqual(set(body['questions']), {'team', 'is_bug', 'urgency'})
        self.assertEqual(decision.provider, 'openrouter')
        self.assertEqual(decision.answers['team']['choice'], 'payments')
        self.assertEqual(decision.input_tokens, 380)
        self.assertEqual(decisions.summarise(decision), [
            'team: payments (confidence 0.85)', 'is_bug: P(yes) = 0.86', 'urgency: 1.99 ≈ "blocking"'])

    def test_no_key_is_a_sentence_not_a_crash(self):
        from credentials.resolution import CredentialUnavailable

        with patch('credentials.resolution.resolve_api_key',
                   AsyncMock(side_effect=CredentialUnavailable('none'))):
            with self.assertRaisesRegex(DecisionError, 'No OpenRouter key'):
                self._decide()

    def test_provider_errors_become_sentences(self):
        cases = [(401, 'refused the key'), (402, 'out of credits'), (404, 'not served'),
                 (429, 'rate-limiting'), (400, 'refused the request'), (503, 'unavailable')]
        for status, phrase in cases:
            with self.subTest(status=status), \
                    patch('credentials.resolution.resolve_api_key', AsyncMock(return_value='k')), \
                    patch.object(self.impl, 'post', AsyncMock(
                        return_value=_response(status, {'error': {'code': status, 'message': 'bad'}}))):
                with self.assertRaisesRegex(DecisionError, phrase):
                    self._decide()

    def test_an_unreachable_provider_is_a_sentence(self):
        with patch('credentials.resolution.resolve_api_key', AsyncMock(return_value='k')), \
                patch.object(self.impl, 'post', AsyncMock(side_effect=httpx.ConnectError('dns'))):
            with self.assertRaisesRegex(DecisionError, 'Could not reach'):
                self._decide()

    def test_bad_questions_are_refused_before_anything_is_sent(self):
        post = AsyncMock(return_value=_response())
        with patch('credentials.resolution.resolve_api_key', AsyncMock(return_value='k')), \
                patch.object(self.impl, 'post', post):
            with self.assertRaises(DecisionError):
                async_to_sync(decisions.decide)(self.user.id, 'x', [{'name': 'a', 'type': 'essay'}])
        post.assert_not_awaited()

    def test_the_tool_returns_answers_and_a_rendered_line(self):
        from chat.tools.decisions import decide as decide_tool

        with patch('credentials.resolution.resolve_api_key', AsyncMock(return_value='k')), \
                patch.object(self.impl, 'post', AsyncMock(return_value=_response())):
            out = json.loads(async_to_sync(decide_tool)(
                {'state': 'blank screen', 'questions': QUESTIONS}, {'user_id': self.user.id}))
        self.assertEqual(out['answers']['is_bug']['noul'], 0.86)
        self.assertIn('team: payments', out['rendered'])

    def test_the_tool_reports_errors_as_json(self):
        from chat.tools.decisions import decide as decide_tool

        out = json.loads(async_to_sync(decide_tool)({'state': 'x', 'questions': []}, {'user_id': self.user.id}))
        self.assertIn('at least one', out['error'])


class SettingTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = get_user_model().objects.create_user(
            username='picker', email='picker@example.com', password='x')
        from core.models import UserProfile

        UserProfile.objects.get_or_create(user=self.user)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.listing = patch.object(decisions.PROVIDERS['openrouter'], 'fetch_models',
                                    return_value=[dict(r) for r in LISTING])
        self.listing.start()
        self.addCleanup(self.listing.stop)

    @staticmethod
    def _profile_url():
        from django.urls import reverse

        return reverse('profile')

    def test_a_listed_model_saves_with_its_provider(self):
        resp = self.client.patch(self._profile_url(), {'decision_model': 'typesafe/jev-1.14'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        from core.models import UserProfile

        profile = UserProfile.objects.get(user=self.user)
        self.assertEqual(profile.decision_model, 'typesafe/jev-1.14')
        self.assertEqual(profile.decision_provider, 'openrouter')

    def test_an_unlisted_model_is_refused(self):
        resp = self.client.patch(self._profile_url(), {'decision_provider': 'openrouter',
                                                       'decision_model': 'made/up'}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('decision_model', resp.json())

    def test_an_unknown_provider_is_refused(self):
        resp = self.client.patch(self._profile_url(), {'decision_provider': 'nowhere'}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_blank_means_the_platform_default(self):
        resp = self.client.patch(self._profile_url(), {'decision_provider': '', 'decision_model': ''},
                                 format='json')
        self.assertEqual(resp.status_code, 200, resp.content)

    @override_settings(DECISION_PROVIDER='openrouter', DECISION_MODEL='~typesafe/jev-latest')
    def test_the_listing_endpoint_answers_provider_models_and_effective_choice(self):
        resp = self.client.get('/api/llm/decision-models/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual([p['slug'] for p in data['providers']], ['openrouter'])
        self.assertEqual(data['models'][0]['id'], '~typesafe/jev-latest')
        self.assertEqual(data['effective'], {'provider': 'openrouter', 'model': '~typesafe/jev-latest'})
        self.assertEqual(self.client.get('/api/llm/decision-models/?provider=nowhere').status_code, 400)
