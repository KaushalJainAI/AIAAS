"""
How much credit is left on an OpenRouter key the user brought.

OpenRouter answers two questions about a key over plain HTTPS:

- `GET /api/v1/key` describes the key itself: what it has spent, its limit (or
  null when it has none), and whether it is a free-tier key. Every key has it.
- `GET /api/v1/credits` describes the account the key belongs to. Only some key
  types may read it, so a refusal there is normal and means "not shown", never
  an error.

The user sees the answer on the Credentials page, so this is a read for a
person, not a metered call: it never goes through `llm/access.py`, never
charges `UserProfile.credits_remaining`, and never logs or returns the key.

Failures come back as `{"available": False, "reason": ...}` rather than raising,
so the page can say why instead of showing a broken row. Only good answers are
cached (for 60 seconds, keyed by a hash of the key so the key itself is never a
cache key); a failure is asked again the next time someone looks.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
from typing import Any

import httpx
from asgiref.sync import sync_to_async
from django.core.cache import cache

logger = logging.getLogger(__name__)

KEY_URL = 'https://openrouter.ai/api/v1/key'
CREDITS_URL = 'https://openrouter.ai/api/v1/credits'

#: Short on purpose: this runs while someone waits on a button.
TIMEOUT = httpx.Timeout(8.0, connect=4.0)

#: How long a good answer is reused. Spend moves slowly enough that a minute
#: old number is honest, and a page that re-asks on every render stays cheap.
CACHE_TTL_SECONDS = 60


def _cache_key(api_key: str) -> str:
    digest = hashlib.sha256(api_key.encode()).hexdigest()
    return f'llm:openrouter-balance:{digest}'


def _unavailable(reason: str) -> dict[str, Any]:
    return {'available': False, 'reason': reason}


def _money(value: Any) -> float | None:
    """A dollar figure from OpenRouter, or None. Booleans are not money."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


async def _get_json(client: httpx.AsyncClient, url: str, api_key: str) -> tuple[int, Any]:
    """One GET with the key as the bearer token. Returns (status, body or None).

    Raises httpx errors to the caller, which decides what they mean. The key is
    sent only in the header and never placed in a message or a log line.
    """
    response = await client.get(
        url,
        headers={'Authorization': f'Bearer {api_key}', 'Accept': 'application/json'},
        timeout=TIMEOUT,
    )
    try:
        body = response.json()
    except ValueError:
        body = None
    return response.status_code, body


async def _fetch_credits(client: httpx.AsyncClient, api_key: str) -> float | None:
    """Account credit left, or None when the key may not read it or the answer is odd."""
    try:
        status, body = await _get_json(client, CREDITS_URL, api_key)
    except httpx.HTTPError:
        return None
    if status != 200 or not isinstance(body, dict):
        # 401/403 is the expected answer for keys that may not see the account.
        return None
    data = body.get('data')
    if not isinstance(data, dict):
        return None
    total = _money(data.get('total_credits'))
    spent = _money(data.get('total_usage'))
    if total is None or spent is None:
        return None
    return round(total - spent, 6)


async def _fetch_key(client: httpx.AsyncClient, api_key: str) -> dict[str, Any]:
    """The key's own figures, or an `unavailable` dict saying why not."""
    try:
        status, body = await _get_json(client, KEY_URL, api_key)
    except httpx.TimeoutException:
        return _unavailable('OpenRouter did not answer in time.')
    except httpx.HTTPError:
        return _unavailable('Could not reach OpenRouter.')

    if status in (401, 403):
        return _unavailable('OpenRouter rejected this key.')
    if status == 429:
        return _unavailable('OpenRouter is rate limiting this key. Try again shortly.')
    if status != 200:
        logger.info('openrouter key balance: HTTP %s', status)
        return _unavailable(f'OpenRouter returned HTTP {status}.')

    data = body.get('data') if isinstance(body, dict) else None
    if not isinstance(data, dict):
        return _unavailable("OpenRouter's answer was not understood.")
    return {
        'usage': _money(data.get('usage')),
        'limit': _money(data.get('limit')),
        'limit_remaining': _money(data.get('limit_remaining')),
        'usage_daily': _money(data.get('usage_daily')),
        'usage_monthly': _money(data.get('usage_monthly')),
        'is_free_tier': bool(data.get('is_free_tier')),
    }


async def openrouter_key_balance(api_key: str) -> dict[str, Any]:
    """What is left on one OpenRouter key.

    Returns `{available: True, usage, limit, limit_remaining, usage_daily,
    usage_monthly, is_free_tier, account_credits_remaining}`, where every money
    figure is a float or None (`limit` and `limit_remaining` are None when the
    key has no limit; `account_credits_remaining` is None when the account
    figure is not available to this key). Or `{available: False, reason}`.
    """
    if not api_key:
        return _unavailable('No key to check.')

    key = _cache_key(api_key)
    cached = await sync_to_async(cache.get)(key)
    if isinstance(cached, dict):
        return dict(cached)

    # Imported here, not at module scope, so tests can swap the shared client
    # by patching `workflow_backend.httpclient.shared_client`.
    from workflow_backend.httpclient import shared_client

    client = shared_client()
    key_figures, credits_left = await asyncio.gather(
        _fetch_key(client, api_key),
        _fetch_credits(client, api_key),
    )
    if 'reason' in key_figures:
        return key_figures

    result = {
        'available': True,
        **key_figures,
        'account_credits_remaining': credits_left,
    }
    await sync_to_async(cache.set)(key, result, CACHE_TTL_SECONDS)
    return dict(result)
