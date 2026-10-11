"""
The speaker button: `POST /api/chat/speak/` and the OpenRouter TTS engine.

Transport only, `transcribe_clip`'s mirror image — it hands back audio for
the composer to play and touches neither the VFS nor the cost ledger (that is
`text_to_speech`'s job). These tests pin the refusals (no engine, blank text,
too long) and the one request shape the OpenRouter engine sends; the network
is never reached, answered from an httpx MockTransport.
"""
from __future__ import annotations

import base64
import json
from unittest.mock import AsyncMock, patch

import httpx
from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.core.exceptions import ObjectDoesNotExist
from django.test import TestCase, override_settings
from rest_framework.test import APIRequestFactory, force_authenticate

from chat.views import speak_text


def _post(user, **body):
    factory = APIRequestFactory()
    request = factory.post('/api/chat/speak/', {'text': 'hello there', **body}, format='json')
    force_authenticate(request, user=user)
    return async_to_sync(speak_text)(request)


class SpeakViewTests(TestCase):
    def setUp(self) -> None:
        self.user = get_user_model().objects.create_user(
            username='speaker', email='speaker@example.com', password='x')

    def test_no_engine_is_a_503_not_a_failed_turn(self):
        # base.py now defaults TTS_ENGINE='openrouter'; test.py pins it back to
        # 'none' (mirrors STT_ENGINE) so tests don't offer text_to_speech/
        # /speak everywhere just because the fake platform key is set.
        response = _post(self.user)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.data['code'], 'tts_unavailable')

    def test_requires_authentication(self):
        factory = APIRequestFactory()
        request = factory.post('/api/chat/speak/', {'text': 'hi'}, format='json')
        response = async_to_sync(speak_text)(request)
        self.assertIn(response.status_code, (401, 403))

    @override_settings(TTS_ENGINE='openrouter')
    def test_blank_text_is_refused(self):
        fake = AsyncMock()
        with patch('voice.tts.synthesize', fake):
            response = _post(self.user, text='   ')
        self.assertEqual(response.status_code, 400)
        fake.assert_not_called()

    @override_settings(TTS_ENGINE='openrouter')
    def test_oversized_text_is_refused_before_anything_is_spent(self):
        fake = AsyncMock()
        with patch('voice.tts.synthesize', fake):
            response = _post(self.user, text='x' * 6000)
        self.assertEqual(response.status_code, 400)
        fake.assert_not_called()

    @override_settings(TTS_ENGINE='openrouter')
    def test_a_reply_comes_back_as_base64_audio(self):
        fake = AsyncMock(return_value=(b'fake-mp3-bytes', 'mp3'))
        with patch('voice.tts.synthesize', fake):
            response = _post(self.user, text='here is your answer', voice='af_bella')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['format'], 'mp3')
        self.assertEqual(base64.b64decode(response.data['audio_base64']), b'fake-mp3-bytes')
        args, _ = fake.call_args
        self.assertEqual(args[0], 'here is your answer')
        self.assertEqual(args[1], 'af_bella')

    @override_settings(TTS_ENGINE='openrouter')
    def test_a_provider_failure_says_so(self):
        from voice.tts import TTSError

        with patch('voice.tts.synthesize', AsyncMock(side_effect=TTSError('refused (402).'))):
            response = _post(self.user)
        self.assertEqual(response.status_code, 502)
        self.assertIn('402', response.data['error'])


class OpenRouterTTSEngineTests(TestCase):
    @override_settings(TTS_ENGINE='openrouter')
    def test_sends_the_openai_speech_shape_and_returns_raw_bytes(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen['url'] = str(request.url)
            seen['auth'] = request.headers.get('authorization')
            seen['body'] = json.loads(request.content)
            return httpx.Response(200, content=b'raw-audio-bytes',
                                  headers={'content-type': 'audio/mpeg'})

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        with patch('workflow_backend.httpclient.shared_client', return_value=client):
            from voice.tts import synthesize

            # No model/voice/user named — resolve_voice falls to the
            # platform default (Kokoro + af_heart).
            data, ext = async_to_sync(synthesize)('hello world')
        self.assertEqual(seen['url'], 'https://openrouter.ai/api/v1/audio/speech')
        self.assertTrue(seen['auth'].startswith('Bearer '))
        self.assertEqual(seen['body']['model'], 'hexgrad/kokoro-82m')
        self.assertEqual(seen['body']['input'], 'hello world')
        self.assertEqual(seen['body']['voice'], 'af_heart')
        self.assertEqual(seen['body']['response_format'], 'mp3')
        self.assertEqual(data, b'raw-audio-bytes')
        self.assertEqual(ext, 'mp3')

    @override_settings(TTS_ENGINE='openrouter')
    def test_unavailable_without_the_platform_key(self):
        from voice import tts

        with patch('credentials.resolution.platform_api_key', return_value=None):
            self.assertFalse(tts.tts_available())
        with patch('credentials.resolution.platform_api_key', return_value='k'):
            self.assertTrue(tts.tts_available())

    def test_unavailable_when_the_engine_is_none(self):
        from voice import tts

        self.assertFalse(tts.tts_available())


class _FakeProfile:
    def __init__(self, tts_model: str = '', tts_voice: str = ''):
        self.tts_model = tts_model
        self.tts_voice = tts_voice


class _FakeUser:
    """Just enough of a User to exercise `resolve_voice` with no DB hit."""

    def __init__(self, profile: '_FakeProfile | None'):
        self.profile = profile


class ResolveVoiceTests(TestCase):
    """One function decides model+voice for the tool, `/speak`, and anything
    later — this pins its priority order and the model/voice matching rule."""

    def test_no_one_named_anything_uses_the_platform_default(self):
        from voice.tts import DEFAULT_TTS_MODEL, DEFAULT_TTS_VOICE, resolve_voice

        self.assertEqual(resolve_voice(None), (DEFAULT_TTS_MODEL, DEFAULT_TTS_VOICE))

    def test_an_explicit_choice_wins_over_everything(self):
        from voice.tts import resolve_voice

        user = _FakeUser(_FakeProfile(tts_model='google/gemini-3.8-flash-tts', tts_voice='Puck'))
        model, voice = resolve_voice(user, model='hexgrad/kokoro-82m', voice='af_bella')
        self.assertEqual((model, voice), ('hexgrad/kokoro-82m', 'af_bella'))

    def test_the_users_saved_preference_is_used_when_nothing_else_is_named(self):
        from voice.tts import resolve_voice

        user = _FakeUser(_FakeProfile(tts_model='google/gemini-3.8-flash-tts', tts_voice='Puck'))
        self.assertEqual(resolve_voice(user), ('google/gemini-3.8-flash-tts', 'Puck'))

    def test_a_saved_voice_is_not_carried_to_a_different_model(self):
        """Voice ids are model-specific — Gemini's "Puck" means nothing to
        Kokoro — so naming a different model without a voice must not send
        the saved one along; it falls through to that model's own default."""
        from voice.tts import resolve_voice

        user = _FakeUser(_FakeProfile(tts_model='google/gemini-3.8-flash-tts', tts_voice='Puck'))
        model, voice = resolve_voice(user, model='hexgrad/kokoro-82m')
        self.assertEqual(model, 'hexgrad/kokoro-82m')
        self.assertNotEqual(voice, 'Puck')

    def test_a_fixed_voice_model_with_no_voice_resolved_gets_the_catalogs_first(self):
        """OpenRouter's speech endpoint requires `voice`; a model whose
        catalog entry declares a fixed list must not resolve to blank."""
        from voice.tts import resolve_voice

        model, voice = resolve_voice(None, model='google/gemini-3.8-flash-tts')
        self.assertEqual(model, 'google/gemini-3.8-flash-tts')
        self.assertTrue(voice)

    def test_a_profile_with_no_row_degrades_to_the_default_rather_than_raising(self):
        from voice.tts import DEFAULT_TTS_MODEL, DEFAULT_TTS_VOICE, resolve_voice

        class _NoProfile:
            @property
            def profile(self):
                raise ObjectDoesNotExist

        self.assertEqual(resolve_voice(_NoProfile()), (DEFAULT_TTS_MODEL, DEFAULT_TTS_VOICE))
