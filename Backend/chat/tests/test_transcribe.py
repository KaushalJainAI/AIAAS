"""
The chat mic: `POST /api/chat/transcribe/` and the OpenRouter STT engine.

The view is transport only — it hands back text for the composer and never
starts a turn — so these tests pin the refusals (no engine, too big, not audio)
and the one request shape the engine sends. The network is never reached:
the engine test answers from an httpx MockTransport.
"""
from __future__ import annotations

import base64
import json
from unittest.mock import AsyncMock, patch

import httpx
from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIRequestFactory, force_authenticate

from chat.views import transcribe_clip


def _post(user, name='clip.webm', data=b'\x1aE\xdf\xa3fake-opus', **extra):
    factory = APIRequestFactory()
    body = {'audio': SimpleUploadedFile(name, data, content_type='audio/webm'), **extra}
    request = factory.post('/api/chat/transcribe/', body, format='multipart')
    force_authenticate(request, user=user)
    return async_to_sync(transcribe_clip)(request)


class TranscribeViewTests(TestCase):
    def setUp(self) -> None:
        self.user = get_user_model().objects.create_user(
            username='mic', email='mic@example.com', password='x')

    def test_no_engine_is_a_503_not_a_failed_turn(self):
        # settings/test.py pins STT_ENGINE='none'.
        response = _post(self.user)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.data['code'], 'stt_unavailable')

    @override_settings(STT_ENGINE='openrouter')
    def test_a_clip_comes_back_as_text(self):
        fake = AsyncMock(return_value={'text': 'check my inbox', 'language': 'en',
                                       'duration_s': 2.1, 'segments': []})
        with patch('voice.stt.transcribe', fake):
            response = _post(self.user, language='en')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['text'], 'check my inbox')
        args, kwargs = fake.call_args
        self.assertEqual(args[1], 'clip.webm')
        self.assertEqual(kwargs['language'], 'en')

    @override_settings(STT_ENGINE='openrouter', STT_MAX_UPLOAD_BYTES=10)
    def test_an_oversized_clip_is_refused_before_anything_is_spent(self):
        fake = AsyncMock()
        with patch('voice.stt.transcribe', fake):
            response = _post(self.user, data=b'x' * 11)
        self.assertEqual(response.status_code, 413)
        fake.assert_not_called()

    @override_settings(STT_ENGINE='openrouter')
    def test_a_file_that_is_not_audio_is_refused(self):
        fake = AsyncMock()
        with patch('voice.stt.transcribe', fake):
            response = _post(self.user, name='notes.pdf')
        self.assertEqual(response.status_code, 400)
        fake.assert_not_called()

    @override_settings(STT_ENGINE='openrouter')
    def test_a_provider_failure_says_so(self):
        from voice.stt import STTError

        with patch('voice.stt.transcribe', AsyncMock(side_effect=STTError('refused (402).'))):
            response = _post(self.user)
        self.assertEqual(response.status_code, 502)
        self.assertIn('402', response.data['error'])


class OpenRouterEngineTests(TestCase):
    @override_settings(STT_ENGINE='openrouter', STT_MODEL='openai/whisper-large-v3-turbo')
    def test_sends_base64_json_with_the_format_named(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen['url'] = str(request.url)
            seen['auth'] = request.headers.get('authorization')
            seen['body'] = json.loads(request.content)
            return httpx.Response(200, json={'text': ' hello there ', 'duration': 1.5,
                                             'language': 'en'})

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        with patch('workflow_backend.httpclient.shared_client', return_value=client):
            from voice.stt import transcribe

            result = async_to_sync(transcribe)(b'audio-bytes', 'clip.mp4')
        self.assertEqual(seen['url'], 'https://openrouter.ai/api/v1/audio/transcriptions')
        self.assertTrue(seen['auth'].startswith('Bearer '))
        self.assertEqual(seen['body']['model'], 'openai/whisper-large-v3-turbo')
        # Safari records audio/mp4, which the provider calls m4a.
        self.assertEqual(seen['body']['input_audio']['format'], 'm4a')
        self.assertEqual(base64.b64decode(seen['body']['input_audio']['data']), b'audio-bytes')
        self.assertEqual(result['text'], 'hello there')
        self.assertEqual(result['duration_s'], 1.5)

    @override_settings(STT_ENGINE='openrouter')
    def test_unavailable_without_the_platform_key(self):
        from voice import stt

        with patch('credentials.resolution.platform_api_key', return_value=None):
            self.assertFalse(stt.stt_available())
        with patch('credentials.resolution.platform_api_key', return_value='k'):
            self.assertTrue(stt.stt_available())
