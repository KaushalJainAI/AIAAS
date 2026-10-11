"""
The ChatGPT plan provider: which models an account has, and what its errors mean.

`credentials/chatgpt.py` signs a user in; `handlers/responses_api.py` makes the
call. This module holds the two things in between that are about the *plan*
rather than about either of those:

  * **The model list is per account**, so it is fetched with the user's own
    token and never seeded. What an account can use depends on its plan.
  * **The plan has its own refusals** (`subscription_sharing_*`), and each one
    needs a different sentence: a reached limit is fixed in ChatGPT's settings,
    an ineligible plan is not fixed by signing in again.

Catalogue rows are stored as `chatgpt/<slug>` because `AIModel.value` is
unique across every provider and a bare `gpt-…` would collide with the
`openai` provider's rows. The handler strips the prefix on the wire.

What OpenAI's listing reports per model was not documented when this was
written (see the plan's verification log). `_row_defaults` therefore reads
every field it can find and falls back to stated, conservative values.
"""
from __future__ import annotations

import logging
from typing import Any

from django.core.cache import cache

logger = logging.getLogger(__name__)

PROVIDER = 'chatgpt'
MODEL_PREFIX = 'chatgpt/'
MODELS_URL = 'https://api.openai.com/v1/models'
#: How long one account's model list is reused.
MODELS_TTL_SECONDS = 600
LIST_TIMEOUT = 8

#: Used when the listing gives no context window. Deliberately small: a
#: declared window can only lower the request ceiling (`llm/budget.py`), so a
#: low guess costs some history while a high one costs a refused request.
DEFAULT_CONTEXT_WINDOW = 128_000


DISABLED_MESSAGE = (
    "ChatGPT plan usage is not available on this server. Pick a model from "
    "another provider."
)

#: Callers a plan may not pay for. A schedule, a mission or an eval sweep runs
#: with nobody watching, and a plan has a weekly cap that simply stops when it
#: is reached: quietly spending someone's week of ChatGPT overnight is the
#: surprise this product's guardrails exist to prevent. `chat`, `api` and
#: `orchestrator` (a person's chat delegating) are a person's own turn.
REFUSED_CALLERS = frozenset({'trigger', 'mission', 'eval'})

UNATTENDED_MESSAGE = (
    "This agent runs on your ChatGPT plan, which is only used while you are "
    "here: schedules, missions and evals cannot spend it. Pick a model from "
    "another provider for this agent to run it unattended."
)


def enabled() -> bool:
    from credentials import chatgpt as signin

    return signin.enabled()


def wire_model(value: str) -> str:
    """The id OpenAI expects: the catalogue value without our prefix."""
    return value.removeprefix(MODEL_PREFIX)


# ── Errors ───────────────────────────────────────────────────────────────────

#: code → (HTTP status to report, what kind of problem it is).
#: `limit`, `denied` and `signed_out` are the user's to fix and are raised;
#: `unsupported` and `retry` are explained and shown as a failed turn.
PLAN_ERRORS: dict[str, tuple[int, str]] = {
    'subscription_sharing_usage_limit_exceeded': (429, 'limit'),
    'subscription_sharing_user_not_eligible': (403, 'denied'),
    'subscription_sharing_invalid_user': (401, 'signed_out'),
    'subscription_sharing_route_not_supported': (403, 'unsupported'),
    'subscription_sharing_unsupported_capability': (400, 'unsupported'),
    'subscription_sharing_usage_unavailable': (503, 'retry'),
    'subscription_sharing_user_unavailable': (503, 'retry'),
}

LIMIT_MESSAGE = (
    "You have reached the usage limit for your ChatGPT plan in this app. "
    "Open ChatGPT → Settings → Usage to see or raise the limit, or pick a "
    "model from another provider, then send the message again."
)
DENIED_MESSAGE = (
    "Your ChatGPT plan cannot be used in other apps (this needs an eligible "
    "ChatGPT plan). Signing in again will not change that. Pick a model from "
    "another provider."
)
SIGNED_OUT_MESSAGE = (
    "Your ChatGPT sign-in has ended. Press Continue with ChatGPT in the model "
    "picker to sign in again, then send the message again."
)
UNSUPPORTED_MESSAGE = (
    "ChatGPT plan usage does not support something this turn sent (for "
    "example an audio or video file, or this model). Remove it or pick a "
    "different model, then send the message again."
)
RETRY_MESSAGE = (
    "ChatGPT plan usage is temporarily unavailable. Nothing was wrong with "
    "your question. Send your message again in a minute."
)


def plan_error_code(text: str) -> str:
    """The plan refusal named in a provider error body, or ''."""
    lowered = (text or '').lower()
    for code in PLAN_ERRORS:
        if code in lowered:
            return code
    return ''


def classify(status: int | None, body: str):
    """A plan failure the user must act on, as the funnel's typed error.

    Returns None for anything else, so `llm.access.classify_provider_error`
    carries on with its own rules.
    """
    from .access import LLMAccessDenied, LLMQuotaExhausted

    kind = PLAN_ERRORS.get(plan_error_code(body), (0, ''))[1]
    lowered = (body or '').lower()
    if kind == 'limit':
        return LLMQuotaExhausted(LIMIT_MESSAGE)
    if kind == 'denied':
        return LLMAccessDenied(DENIED_MESSAGE)
    if kind == 'signed_out' or 'sign in again' in lowered or status == 401:
        return LLMAccessDenied(SIGNED_OUT_MESSAGE)
    return None


def explain(status: int | None, body: str) -> str | None:
    """The sentence for a plan failure that is shown rather than raised."""
    kind = PLAN_ERRORS.get(plan_error_code(body), (0, ''))[1]
    if kind == 'unsupported':
        return UNSUPPORTED_MESSAGE
    if kind == 'retry':
        return RETRY_MESSAGE
    return None


# ── Models ───────────────────────────────────────────────────────────────────

def forget_models(user_id: int) -> None:
    from credentials import chatgpt as signin

    signin.forget_models(user_id)


def models_for(user_id: int) -> list[str]:
    """Catalogue values (`chatgpt/<slug>`) this account may use.

    Empty when the user is not signed in, or the listing could not be read —
    a provider with no models offers nothing, which is the honest picture of
    an account we cannot see into. A successful listing is cached per user;
    a failure is cached briefly so a broken sign-in is not re-dialled on every
    page load.
    """
    from credentials import chatgpt as signin

    if not signin.enabled():
        return []
    key = signin.models_cache_key(user_id)
    cached = cache.get(key)
    if cached is not None:
        return list(cached)

    entries = _fetch_listing(user_id)
    if entries is None:
        cache.set(key, [], 30)
        return []
    values = _store_rows(entries)
    cache.set(key, values, MODELS_TTL_SECONDS)
    return values


def _fetch_listing(user_id: int) -> list[dict] | None:
    """The account's raw model entries, or None when it cannot be read."""
    import requests

    from credentials import chatgpt as signin

    credential = signin._credential_for(user_id)
    if credential is None or not credential.is_verified:
        return None
    try:
        token = signin.access_token_for(credential.id, user_id)
        response = requests.get(
            MODELS_URL, headers={'Authorization': f'Bearer {token}'},
            timeout=LIST_TIMEOUT,
        )
    except signin.ChatGPTAuthError as exc:
        logger.info('ChatGPT model list skipped: %s', exc.code)
        return None
    except requests.RequestException as exc:
        logger.warning('ChatGPT model list unreachable: %s', type(exc).__name__)
        return None
    if response.status_code != 200:
        logger.warning('ChatGPT model list answered HTTP %s', response.status_code)
        if response.status_code == 401:
            signin.mark_signed_out(user_id, 'Model list answered 401')
        return None
    try:
        payload = response.json()
    except ValueError:
        return None
    entries = payload.get('data') or payload.get('models') if isinstance(payload, dict) else payload
    if not isinstance(entries, list):
        return None
    return [e for e in entries if isinstance(e, dict) and _slug(e) and _listed(e)]


def _slug(entry: dict) -> str:
    return str(entry.get('slug') or entry.get('id') or '').strip()


def _listed(entry: dict) -> bool:
    # The docs say to show entries with `visibility: "list"`. An entry with no
    # visibility field at all is shown: hiding everything because a field was
    # renamed would leave a signed-in user with an empty picker.
    visibility = entry.get('visibility')
    return visibility in (None, '', 'list')


def _first_int(entry: dict, *names: str) -> int:
    for name in names:
        value = entry.get(name)
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)) and value > 0:
            return int(value)
    return 0


def _modalities(entry: dict) -> set[str]:
    found: set[str] = set()
    for name in ('input_modalities', 'modalities', 'supported_input_modalities'):
        value = entry.get(name)
        if isinstance(value, dict):
            value = value.get('input')
        if isinstance(value, (list, tuple)):
            found.update(str(v).lower() for v in value)
    return found


def _effort_levels(entry: dict) -> list[str]:
    from . import effort as effort_levels

    for name in ('supported_reasoning_levels', 'reasoning_efforts',
                 'supported_reasoning_efforts', 'reasoning_levels'):
        value = entry.get(name)
        if isinstance(value, (list, tuple)):
            names = [v.get('effort') if isinstance(v, dict) else v for v in value]
            return list(effort_levels.clean_levels([str(n) for n in names if n]))
    return []


def _row_defaults(entry: dict) -> dict[str, Any]:
    """What one listing entry says about a model, with stated fallbacks.

    Two fallbacks are guesses and are named as such. With no modality field,
    a `gpt-…` model is taken to read images, as every GPT model since 4o has;
    anything else is taken to read text only and is then kept out of the
    picker by the image rule (`llm/views.py::offered_in_picker`). And with no
    effort field, no rung is declared, so no effort is ever sent — the safe
    default `populate_models.m()` already uses.
    """
    slug = _slug(entry)
    modalities = _modalities(entry)
    reads_images = 'image' in modalities if modalities else slug.startswith(('gpt-', 'codex'))
    levels = _effort_levels(entry)
    default_effort = str(entry.get('default_reasoning_level') or entry.get('default_reasoning_effort') or '')
    return {
        'name': str(entry.get('display_name') or entry.get('name') or slug)[:100],
        'description': 'Uses your ChatGPT plan.',
        'is_active': True,
        'is_free': False,
        'supports_text_input': True,
        'supports_text_generation': True,
        'supports_image_input': reads_images,
        'supports_tool_calling': True,
        'supports_structured_output': True,
        'context_window': _first_int(
            entry, 'context_window', 'context_length', 'max_context_window',
            'max_input_tokens') or DEFAULT_CONTEXT_WINDOW,
        'effort_levels': levels,
        'default_effort': default_effort if default_effort in levels else '',
        # `hand`, so neither the seed's prune nor the OpenRouter refresh
        # touches a row that only this module knows how to justify.
        'source': 'hand',
        'retired_at': None,
    }


def _store_rows(entries: list[dict]) -> list[str]:
    """Upsert a catalogue row per listed model; return their values.

    The rows are global (the turn loop reads context window and effort rungs
    from this table) but *which* of them a user is offered is the per-user
    list this returns — one account's models never appear for another.
    """
    from .models import AIModel, AIProvider

    provider, _ = AIProvider.objects.get_or_create(
        slug=PROVIDER,
        defaults={
            'name': 'ChatGPT plan',
            'description': 'Your ChatGPT subscription (Continue with ChatGPT).',
            'icon': 'GPT',
        },
    )
    values: list[str] = []
    for entry in entries:
        value = f'{MODEL_PREFIX}{_slug(entry)}'[:150]
        try:
            AIModel.objects.update_or_create(
                value=value, defaults={'provider': provider, **_row_defaults(entry)})
        except Exception:  # noqa: BLE001 — one bad entry must not empty the list
            logger.warning('Could not store ChatGPT model %s', value, exc_info=True)
            continue
        values.append(value)
    return values
