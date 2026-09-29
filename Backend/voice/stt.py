"""
Speech-to-text behind `STT_ENGINE`.

`none` — no transcription; `transcribe_audio` is not offered and the chat
mic answers 503.

`openrouter` (the default) — OpenRouter's `/audio/transcriptions` on the
platform key, with `STT_MODEL` (`openai/whisper-large-v3-turbo`, about
$0.012 an hour of audio on 2026-09-29). No second key and no second vendor:
the platform already holds `OPENROUTER_API_KEY` for the default chat model.
The request is JSON with base64 audio, not OpenAI's multipart shape.

`remote` (any other value) — posts multipart audio to `STT_REMOTE_URL` and
reads back segments (decision D5: Sarvam for Hindi/Indian-language accuracy,
otherwise Deepgram, behind a small adapter).

Nothing here joins a live call: meeting recordings are read from Drive or the
VFS, and the chat mic records a clip in the browser and posts it.
"""
from __future__ import annotations

import base64
import logging

from django.conf import settings

logger = logging.getLogger(__name__)

OPENROUTER_TRANSCRIPTIONS_URL = 'https://openrouter.ai/api/v1/audio/transcriptions'

#: What OpenRouter accepts in `input_audio.format`, keyed by file extension.
#: Safari's MediaRecorder writes `audio/mp4`, which is an m4a container.
_FORMATS = {
    'wav': 'wav', 'mp3': 'mp3', 'mpga': 'mp3', 'mpeg': 'mp3', 'flac': 'flac',
    'm4a': 'm4a', 'mp4': 'm4a', 'aac': 'aac', 'ogg': 'ogg', 'oga': 'ogg',
    'opus': 'ogg', 'webm': 'webm',
}


class STTError(RuntimeError):
    """Written for the model: what failed and what to do instead."""


def engine() -> str:
    return (getattr(settings, 'STT_ENGINE', 'none') or 'none').strip().lower()


def stt_available() -> bool:
    if engine() in ('', 'none'):
        return False
    if engine() == 'openrouter':
        # Offered only when it can run: a mic that always fails, or a tool the
        # model plans around and then has to explain, is worse than neither.
        return bool(_openrouter_key())
    return True


def audio_format(filename: str) -> str | None:
    """The provider's name for this file's audio format, or None if unknown."""
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    return _FORMATS.get(ext)


def _openrouter_key() -> str:
    from credentials.resolution import platform_api_key

    return platform_api_key('openrouter') or ''


async def transcribe(data: bytes, filename: str, *, language: str = '',
                     diarize: bool = False) -> dict:
    """Transcribe audio bytes. Returns `{text, segments, duration_s, language}`.

    Raises `STTError` when no engine is configured or the provider fails.
    Tests patch this function — the network is not what they prove.
    """
    if not stt_available():
        raise STTError('No transcription engine is configured on this platform.')
    if engine() == 'openrouter':
        return await _transcribe_openrouter(data, filename, language=language)
    return await _transcribe_remote(data, filename, language=language, diarize=diarize)


async def _transcribe_openrouter(data: bytes, filename: str, *, language: str) -> dict:
    from workflow_backend.httpclient import shared_client

    fmt = audio_format(filename)
    if fmt is None:
        raise STTError(
            f'{filename} is not an audio format the transcriber reads '
            f'(wav, mp3, flac, m4a, aac, ogg, webm).'
        )
    body = {
        'model': getattr(settings, 'STT_MODEL', '') or 'openai/whisper-large-v3-turbo',
        'input_audio': {'data': base64.b64encode(data).decode('ascii'), 'format': fmt},
        # verbose_json carries segments with timestamps, which the transcript
        # file renders; the mic only reads `text`.
        'response_format': 'verbose_json',
    }
    if language:
        body['language'] = language
    try:
        resp = await shared_client().post(
            OPENROUTER_TRANSCRIPTIONS_URL,
            headers={
                'Authorization': f'Bearer {_openrouter_key()}',
                'HTTP-Referer': 'https://aiaas.local',
                'X-Title': 'AIAAS Workflow',
            },
            json=body,
            # Upstream providers give up after ~60 s of processing; waiting
            # longer than that only delays the same error.
            timeout=90,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning('[STT] OpenRouter call failed: %s', exc)
        raise STTError('The transcription service could not be reached.') from exc
    if resp.status_code >= 400:
        logger.warning('[STT] OpenRouter %s: %s', resp.status_code, resp.text[:300])
        raise STTError(f'The transcription service refused the request ({resp.status_code}).')
    try:
        payload = resp.json()
    except ValueError as exc:
        raise STTError('The transcription service returned something unreadable.') from exc
    segments = [s for s in (payload.get('segments') or []) if isinstance(s, dict)][:500]
    return {
        'text': str(payload.get('text') or '').strip(),
        'segments': segments,
        'duration_s': float(payload.get('duration') or 0),
        'language': str(payload.get('language') or language or ''),
    }


async def _transcribe_remote(data: bytes, filename: str, *, language: str,
                             diarize: bool) -> dict:
    from workflow_backend.httpclient import shared_client

    endpoint = getattr(settings, 'STT_REMOTE_URL', '')
    token = getattr(settings, 'STT_API_TOKEN', '')
    if not endpoint:
        raise STTError('The transcription engine has no endpoint configured.')
    try:
        resp = await shared_client().post(
            endpoint.rstrip('/'),
            headers={'Authorization': f'Bearer {token}'} if token else None,
            files={'audio': (filename, data)},
            data={'language': language, 'diarize': 'true' if diarize else 'false'},
            timeout=120,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning('[STT] remote call failed: %s', exc)
        raise STTError('The transcription service could not be reached.') from exc
    if resp.status_code >= 400:
        raise STTError(f'The transcription service refused the request ({resp.status_code}).')
    try:
        payload = resp.json()
    except ValueError as exc:
        raise STTError('The transcription service returned something unreadable.') from exc
    segments = [s for s in (payload.get('segments') or []) if isinstance(s, dict)][:500]
    return {
        'text': str(payload.get('text') or ''),
        'segments': segments,
        'duration_s': float(payload.get('duration_s') or 0),
        'language': str(payload.get('language') or language or ''),
    }
