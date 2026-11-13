"""
Native phone push for the React Native app, through the Expo Push Service.

The app registers with `expo-notifications`, which hands back an
`ExponentPushToken[...]`. We send to that token at Expo's HTTP API, and Expo
delivers to FCM (Android) and APNs (iOS) itself, so this module never talks to
Google or Apple directly and needs no platform credentials.

Best-effort, like `webpush.py`: a dead Expo must never break a sweep, a tool
call or a webhook. `send_expo_push` never raises. A ticket that says
`DeviceNotRegistered` means the phone uninstalled the app or revoked the
token, so that row is deleted and never tried again.

Called from sync code only (sweeps, tool work running in a worker thread, the
signature callback), so it uses a sync `httpx.Client`. The async
`workflow_backend.httpclient.shared_client()` needs a running event loop, which
these callers do not have.
"""
from __future__ import annotations

import logging
import re
import threading

import httpx
from django.conf import settings

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

# Expo accepts at most 100 messages per request.
MAX_MESSAGES_PER_REQUEST = 100

REQUEST_TIMEOUT = httpx.Timeout(15.0, connect=5.0)
LIMITS = httpx.Limits(max_connections=10, max_keepalive_connections=5, keepalive_expiry=30.0)

# Expo has issued both spellings over time; both are current.
_EXPO_TOKEN = re.compile(r'^Expo(nent)?PushToken\[[^\[\]\s]+\]$')

_client_lock = threading.Lock()
_client: httpx.Client | None = None


def is_expo_token(token) -> bool:
    """Whether `token` has the shape Expo issues. Shape only, not validity."""
    return isinstance(token, str) and bool(_EXPO_TOKEN.match(token))


def is_enabled() -> bool:
    return bool(getattr(settings, 'EXPO_PUSH_ENABLED', False))


def _http_client() -> httpx.Client:
    """One pooled sync client for the process, created on first use."""
    global _client
    with _client_lock:
        if _client is None or _client.is_closed:
            _client = httpx.Client(timeout=REQUEST_TIMEOUT, limits=LIMITS)
        return _client


def _headers() -> dict:
    headers = {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
    }
    access_token = getattr(settings, 'EXPO_ACCESS_TOKEN', '') or ''
    if access_token:
        headers['Authorization'] = f'Bearer {access_token}'
    return headers


def _message(token: str, title: str, body: str, data: dict) -> dict:
    return {
        'to': token,
        'title': title,
        'body': body or '',
        'data': data,
        'sound': 'default',
        'priority': 'high',
        'channelId': 'default',
    }


def _send_chunk(messages: list[dict]) -> int:
    """POST one batch and act on its tickets. Returns tickets Expo accepted."""
    response = _http_client().post(EXPO_PUSH_URL, json=messages, headers=_headers())
    if response.status_code >= 400:
        logger.warning(
            "Expo push rejected a batch of %d (HTTP %s): %s",
            len(messages), response.status_code, (response.text or '')[:300],
        )
        return 0

    payload = response.json()
    tickets = payload.get('data') if isinstance(payload, dict) else None
    if not isinstance(tickets, list):
        logger.warning("Expo push returned no tickets for a batch of %d", len(messages))
        return 0

    from .models import DeviceToken

    accepted = 0
    unregistered: list[str] = []
    # Tickets come back in the same order as the messages they answer.
    for message, ticket in zip(messages, tickets):
        if not isinstance(ticket, dict):
            continue
        if ticket.get('status') == 'ok':
            accepted += 1
            continue
        details = ticket.get('details') or {}
        if isinstance(details, dict) and details.get('error') == 'DeviceNotRegistered':
            unregistered.append(message['to'])
        else:
            logger.warning("Expo push ticket error: %s", ticket.get('message', 'unknown'))

    if unregistered:
        removed, _ = DeviceToken.objects.filter(token__in=unregistered).delete()
        logger.info("Removed %d unregistered push device(s)", removed)
    return accepted


def send_expo_push(user, title: str, body: str = '', data: dict | None = None) -> int:
    """
    Push to every native device registered to `user`. Returns tickets accepted.

    Never raises: callers are sweeps, tool dispatch and webhooks. A failed
    batch is logged and the next batch is still tried.
    """
    try:
        if not is_enabled():
            return 0
        if not title and not body:
            return 0

        from .models import DeviceToken

        tokens = list(DeviceToken.objects.filter(user=user).values_list('token', flat=True))
        if not tokens:
            return 0

        payload = dict(data or {})
        messages = [_message(token, title, body, payload) for token in tokens]

        sent = 0
        for start in range(0, len(messages), MAX_MESSAGES_PER_REQUEST):
            chunk = messages[start:start + MAX_MESSAGES_PER_REQUEST]
            try:
                sent += _send_chunk(chunk)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "Expo push failed for user %s: %s: %s",
                    getattr(user, 'pk', user), type(exc).__name__, exc,
                )
        return sent
    except Exception:  # noqa: BLE001
        logger.exception("Expo push failed")
        return 0
