"""
Text-to-speech behind `TTS_ENGINE`.

`none` (default) — no synthesis; `text_to_speech` is not offered. Synthesis
spends money per call, so the tool is `irreversible` + `sensitive` and capped
at 5,000 characters per call (refused, never truncated — a cut sentence read
aloud is worse than no audio).

`openrouter` — OpenRouter's `/audio/speech` (OpenAI-speech compatible) on the
platform key, mirroring `stt.py`'s `openrouter` engine: the platform already
holds `OPENROUTER_API_KEY` for the default chat model, so this needs no
second key. Unlike the transcription endpoint this one returns raw audio
bytes, not JSON.

`remote` (any other value) — posts JSON to `TTS_REMOTE_URL` and reads back raw
audio bytes.

Which model and voice speak is resolved in one place, `resolve_voice()`, for
every caller — the `text_to_speech` tool, `POST /api/chat/speak/`, and
anything added later. See its docstring for the priority order. The catalog
of known models and their per-model voice lists is
`imagine.services.catalog.TTS_MODELS` — OpenRouter has no discovery endpoint
for speech models, so that hand-curated list is the one source of truth
everywhere a voice model is offered, not a second copy here.
"""
from __future__ import annotations

import logging

from django.conf import settings

logger = logging.getLogger(__name__)

#: Characters per call. A cap on what one approval spends, not a budget.
TTS_MAX_CHARS = 5_000

OPENROUTER_SPEECH_URL = 'https://openrouter.ai/api/v1/audio/speech'

#: The platform's own fallback, used when nobody — not the caller, not the
#: user's profile, not `TTS_ENGINE`'s settings override — named one. Kokoro:
#: by far the cheapest model in the catalog (~$0.62/1M characters), the right
#: default for a feature nobody opted into a price for. `af_heart` is one of
#: its 54 voices; Kokoro takes a free-form voice id, so this is a pick, not a
#: validated default.
DEFAULT_TTS_MODEL = 'hexgrad/kokoro-82m'
DEFAULT_TTS_VOICE = 'af_heart'


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


def _catalog_voices(model_id: str) -> list[str]:
    from imagine.services.catalog import TTS_MODELS

    for row in TTS_MODELS:
        if row['id'] == model_id:
            return list(row.get('voices') or [])
    return []


def resolve_voice(user, model: str = '', voice: str = '') -> tuple[str, str]:
    """The model and voice to speak with — one answer, however it is asked.

    Priority: an explicit call-time choice (a tool argument, a `/speak` body)
    wins outright; failing that, the signed-in user's saved preference
    (`UserProfile.tts_model`/`tts_voice`); failing that, the platform
    default above. A saved voice is only inherited when it belongs to the
    model actually in effect — a voice id is model-specific (Gemini's
    "Puck" means nothing to Kokoro), so a caller naming a *different* model
    without a voice falls through to that model's own default rather than
    sending a mismatched one. When a chosen model declares a fixed voice
    list and none was resolved, the first entry fills in — OpenRouter's
    speech endpoint requires `voice`, so leaving it blank is a guaranteed
    refusal, not a neutral default.
    """
    model = (model or '').strip()
    voice = (voice or '').strip()
    try:
        profile = user.profile if user is not None else None
    except Exception:  # noqa: BLE001 — a OneToOne that was never created
        profile = None
    pref_model = (getattr(profile, 'tts_model', '') or '').strip() if profile else ''
    pref_voice = (getattr(profile, 'tts_voice', '') or '').strip() if profile else ''

    if not model:
        model = pref_model
    if not voice and model == pref_model:
        voice = pref_voice
    if not model:
        model = DEFAULT_TTS_MODEL
    if not voice and model == DEFAULT_TTS_MODEL:
        voice = DEFAULT_TTS_VOICE
    if not voice:
        choices = _catalog_voices(model)
        if choices:
            voice = choices[0]
    return model, voice


async def synthesize(text: str, voice: str = '', model: str = '', user=None) -> tuple[bytes, str]:
    """Speak `text`. Returns (audio bytes, extension).

    `model`/`voice` are the already-resolved choice when the caller ran one
    through `resolve_voice()` itself (the `text_to_speech` tool does, since it
    also needs the model id for its cost estimate); passing `user` instead
    lets this function resolve them the same way. Raises `TTSError` when no
    engine is configured or the provider fails. Tests patch this function.
    """
    if not tts_available():
        raise TTSError('No speech engine is configured on this platform.')
    if len(text) > TTS_MAX_CHARS:
        raise TTSError(
            f'That is {len(text):,} characters; one call speaks at most '
            f'{TTS_MAX_CHARS:,}. Split it into parts.'
        )
    model, voice = resolve_voice(user, model, voice)
    if engine() == 'openrouter':
        return await _synthesize_openrouter(text, voice, model)
    return await _synthesize_remote(text, voice)


async def _synthesize_openrouter(text: str, voice: str, model: str) -> tuple[bytes, str]:
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
                'model': model,
                'input': text,
                'voice': voice,
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
