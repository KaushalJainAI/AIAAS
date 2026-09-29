"""
Text-to-speech behind `TTS_ENGINE`.

`none` (default) — no synthesis; `text_to_speech` is not offered. Synthesis
spends money per call, so the tool is `irreversible` + `sensitive` and capped
at 5,000 characters per call (refused, never truncated — a cut sentence read
aloud is worse than no audio).

`openrouter` — OpenRouter's `/audio/speech` (OpenAI-speech compatible) on the
platform key, with `TTS_MODEL` (`hexgrad/kokoro-82m` — natural voices at
~$4/1M characters, 2026-09-29) and `TTS_VOICE`. No second key, mirroring
`stt.py`'s `openrouter` engine: the platform already holds
`OPENROUTER_API_KEY` for the default chat model. Unlike the transcription
endpoint this one returns raw audio bytes, not JSON.

`remote` (any other value) — posts JSON to `TTS_REMOTE_URL` and reads back raw
audio bytes.
"""
from __future__ import annotations

import logging

from django.conf import settings

logger = logging.getLogger(__name__)

#: Characters per call. A cap on what one approval spends, not a budget.
TTS_MAX_CHARS = 5_000

OPENROUTER_SPEECH_URL = 'https://openrouter.ai/api/v1/audio/speech'


class TTSError(RuntimeError):
    """Written for the model: what failed and what to do instead."""


def engine() -> str:
    return (getattr(settings, 'TTS_ENGINE', 'none') or 'none').strip().lower()


def _openrouter_key() -> str:
    from credentials.resolution import platform_api_key

    return platform_api_key('openrouter') or ''


def tts_available() -> bool:
    if engine() in ('', 'none'):
        return False
    if engine() == 'openrouter':
        # Offered only when it can run: a speaker button that always fails is
        # worse than one never offered.
        return bool(_openrouter_key())
    return True


async def synthesize(text: str, voice: str = '') -> tuple[bytes, str]:
    """Speak `text`. Returns (audio bytes, extension).

    Raises `TTSError` when no engine is configured or the provider fails.
    Tests patch this function.
    """
    if not tts_available():
        raise TTSError('No speech engine is configured on this platform.')
    if len(text) > TTS_MAX_CHARS:
        raise TTSError(
            f'That is {len(text):,} characters; one call speaks at most '
            f'{TTS_MAX_CHARS:,}. Split it into parts.'
        )
    if engine() == 'openrouter':
        return await _synthesize_openrouter(text, voice)
    return await _synthesize_remote(text, voice)


async def _synthesize_openrouter(text: str, voice: str) -> tuple[bytes, str]:
    from workflow_backend.httpclient import shared_client

    try:
        resp = await shared_client().post(
            OPENROUTER_SPEECH_URL,
            headers={
                'Authorization': f'Bearer {_openrouter_key()}',
                'HTTP-Referer': 'https://aiaas.local',
                'X-Title': 'AIAAS Workflow',
            },
            json={
                'model': getattr(settings, 'TTS_MODEL', '') or 'hexgrad/kokoro-82m',
                'input': text,
                'voice': voice or getattr(settings, 'TTS_VOICE', '') or 'af_heart',
                'response_format': 'mp3',
            },
            timeout=120,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning('[TTS] OpenRouter call failed: %s', exc)
        raise TTSError('The speech service could not be reached.') from exc
    if resp.status_code >= 400:
        logger.warning('[TTS] OpenRouter %s: %s', resp.status_code, resp.text[:300])
        raise TTSError(f'The speech service refused the request ({resp.status_code}).')
    data = resp.content
    if not data:
        raise TTSError('The speech service returned no audio.')
    return bytes(data), 'mp3'


async def _synthesize_remote(text: str, voice: str) -> tuple[bytes, str]:
    from workflow_backend.httpclient import shared_client

    endpoint = getattr(settings, 'TTS_REMOTE_URL', '')
    token = getattr(settings, 'TTS_API_TOKEN', '')
    if not endpoint:
        raise TTSError('The speech engine has no endpoint configured.')
    try:
        resp = await shared_client().post(
            endpoint.rstrip('/'),
            headers={'Authorization': f'Bearer {token}'} if token else None,
            json={'text': text, 'voice': voice or 'default'},
            timeout=120,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning('[TTS] remote call failed: %s', exc)
        raise TTSError('The speech service could not be reached.') from exc
    if resp.status_code >= 400:
        raise TTSError(f'The speech service refused the request ({resp.status_code}).')
    data = resp.content
    if not data:
        raise TTSError('The speech service returned no audio.')
    return bytes(data), 'mp3'
