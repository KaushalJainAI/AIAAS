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
        # settings/base.py defaults TTS_ENGINE='none'; test.py does not override it.
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
    @override_settings(TTS_ENGINE='openrouter', TTS_MODEL='hexgrad/kokoro-82m', TTS_VOICE='af_heart')
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
