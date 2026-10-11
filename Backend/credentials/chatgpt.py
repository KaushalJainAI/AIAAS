"""
Continue with ChatGPT: sign-in, and the token every plan call is made with.

A user signs in once with their ChatGPT account and the `chatgpt` provider
(`llm/handlers/responses_api.py`) spends the usage already included in their
plan. This module is the whole of the sign-in: the authorize URL, the code
exchange, the refresh, and sign-out. Design: `docs/CHATGPT_PLAN_PROVIDER_PLAN.md`.

It is OpenAI's public-client flow — PKCE, no client secret — with two things
that differ from the Google OAuth already in this app:

  * **The client id is issued per account.** The first sign-in goes out as
    `dynamic_agent_client`; the callback returns the id to use from then on,
    and it is stored with the credential. Nothing here reads a client id from
    settings, which is why `Credential.get_valid_access_token` (Google-only by
    its own docstring) is not reused.
  * **The refresh token rotates.** Every refresh returns a replacement and
    retires the old one, so the new one must be saved, and two refreshes for
    one account must never race — `access_token_for` re-reads under a row lock
    before spending a refresh token.

The redirect is an HTTP loopback address, which reaches the machine running
the browser. That is what limits this to installs the user runs themselves,
and `enabled()` is the one switch: off, nothing here is reachable.

Everything is synchronous (`requests`), like the Google refresh beside it; the
handler calls `access_token_for` through `sync_to_async`.

The endpoint and parameter names are from developers.openai.com/siwc as read
on 2026-10-10. `scripts/chatgpt_plan_spike.py` checks them against a real
account; the plan's verification log records what it found.
"""
from __future__ import annotations

import base64
import hashlib
import logging
import secrets
import uuid
from datetime import timedelta
from urllib.parse import urlencode, urlsplit

import requests
from cryptography.fernet import Fernet
from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)

SLUG = 'chatgpt'

ISSUER = 'https://auth.openai.com'
AUTHORIZE_URL = f'{ISSUER}/api/accounts/authorize'
TOKEN_URL = f'{ISSUER}/api/accounts/oauth/token'
DISCOVERY_URL = f'{ISSUER}/.well-known/openid-configuration'
#: What the tokens are for: the API the plan calls are sent to.
RESOURCE = 'https://api.openai.com/v1'
SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
#: The client id of a first sign-in, before an account has one of its own.
DYNAMIC_CLIENT = 'dynamic_agent_client'
CALLBACK_PATH = '/auth/callback'

#: Where a person manages how much of their plan this app may use.
MANAGE_USAGE_URL = 'https://chatgpt.com/#settings/Usage'

#: How long a started sign-in may take to come back.
ATTEMPT_TTL_SECONDS = 600
#: Refresh this long before expiry, so a token handed to a model call does not
#: run out while the call is being made.
REFRESH_MARGIN = timedelta(minutes=5)
HTTP_TIMEOUT = 20

#: Refresh failures that mean the saved tokens are finished: the person has to
#: sign in again. Anything else (a network error, a 5xx) keeps the tokens.
DEAD_TOKEN_ERRORS = frozenset({
    'invalid_grant', 'invalid_refresh_token', 'token_expired',
    'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused',
})

_LOOPBACK_HOSTS = frozenset({'localhost', '127.0.0.1', '::1'})


class ChatGPTAuthError(Exception):
    """Sign-in or refresh failed.

    `code` is a short machine word for the caller to branch on; `needs_sign_in`
    says the fix is to sign in again rather than to wait.
    """

    def __init__(self, code: str, message: str, *, needs_sign_in: bool = False):
        super().__init__(message)
        self.code = code
        self.needs_sign_in = needs_sign_in


def enabled() -> bool:
    return bool(getattr(settings, 'CHATGPT_PLAN_ENABLED', False))


def is_loopback(host: str) -> bool:
    """Whether `host` (a Host header, port allowed) is this machine."""
    name = urlsplit(f'//{host}').hostname or ''
    return name in _LOOPBACK_HOSTS


def host_id() -> str:
    """This install's `ext_agent_host_id`: stable, and never a secret itself.

    Derived from SECRET_KEY rather than stored, so it is the same after every
    restart without a table to hold one value. Hashed first so the id cannot
    be turned back into the key.
    """
    if configured := getattr(settings, 'CHATGPT_HOST_ID', ''):
        return configured
    digest = hashlib.sha256(f'chatgpt-host:{settings.SECRET_KEY}'.encode()).hexdigest()
    return str(uuid.UUID(digest[:32]))


def redirect_uri(request_host: str) -> str:
    """The loopback address OpenAI sends the browser back to.

    Always `127.0.0.1` (the documented form), on whatever port this server
    was reached on, unless a setting pins it.
    """
    if configured := getattr(settings, 'CHATGPT_REDIRECT_URI', ''):
        return configured
    port = urlsplit(f'//{request_host}').port or 8000
    return f'http://127.0.0.1:{port}{CALLBACK_PATH}'


# ── Starting a sign-in ───────────────────────────────────────────────────────

def _attempt_key(state: str) -> str:
    return f'chatgpt:signin:{state}'


def _challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode('ascii')).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b'=').decode('ascii')


def begin(user_id: int, *, request_host: str) -> str:
    """Start a sign-in for `user_id` and return the URL to open.

    The verifier, nonce and owner are kept server-side under `state`, so the
    callback — which arrives with no session of ours — can only finish a
    sign-in this server started, for the user who started it.
    """
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    nonce = secrets.token_urlsafe(24)
    uri = redirect_uri(request_host)

    existing = _credential_for(user_id)
    client_id = (_blob(existing).get('client_id') if existing else '') or DYNAMIC_CLIENT

    cache.set(_attempt_key(state), {
        'user_id': user_id, 'verifier': verifier, 'nonce': nonce,
        'redirect_uri': uri, 'client_id': client_id,
    }, ATTEMPT_TTL_SECONDS)

    params = {
        'response_type': 'code',
        'client_id': client_id,
        'scope': SCOPE,
        'resource': RESOURCE,
        'redirect_uri': uri,
        'code_challenge': _challenge(verifier),
        'code_challenge_method': 'S256',
        'state': state,
        'nonce': nonce,
        'ext_agent_host_id': host_id(),
    }
    if client_id == DYNAMIC_CLIENT:
        # Named on a first registration only; a returning account already has
        # its client and the docs say to leave the hint off.
        params['agent_name_hint'] = getattr(settings, 'CHATGPT_AGENT_NAME', 'AIAAS')
    return f'{AUTHORIZE_URL}?{urlencode(params)}'


# ── Finishing it ─────────────────────────────────────────────────────────────

def complete(*, state: str, code: str, client_id: str = '') -> 'object':
    """Exchange the callback's `code` and save the credential.

    `client_id` is the id the callback issued (first sign-in), else the one
    the attempt started with. Raises `ChatGPTAuthError`; never returns a
    half-saved credential.
    """
    attempt = cache.get(_attempt_key(state)) if state else None
    if not attempt:
        raise ChatGPTAuthError(
            'unknown_attempt',
            'This sign-in link has expired or was already used. Start again.')
    # Used once, whatever happens next: a code is single-use at OpenAI too.
    cache.delete(_attempt_key(state))

    client_id = client_id or attempt['client_id']
    if not client_id or client_id == DYNAMIC_CLIENT:
        raise ChatGPTAuthError(
            'no_client_id', 'ChatGPT did not return a client id for this app.')

    tokens = _token_request({
        'grant_type': 'authorization_code',
        'client_id': client_id,
        'code': code,
        'code_verifier': attempt['verifier'],
        'redirect_uri': attempt['redirect_uri'],
        'resource': RESOURCE,
    })
    if not tokens.get('access_token') or not tokens.get('refresh_token'):
        raise ChatGPTAuthError(
            'incomplete_tokens', 'ChatGPT did not return a usable sign-in.')

    identity = _validated_identity(
        tokens.get('id_token') or '', client_id=client_id, nonce=attempt['nonce'])
    return _save(
        user_id=attempt['user_id'], client_id=client_id,
        tokens=tokens, identity=identity,
    )


def _token_request(form: dict) -> dict:
    """POST to the token endpoint. Raises `ChatGPTAuthError` on any refusal."""
    try:
        response = requests.post(TOKEN_URL, data=form, timeout=HTTP_TIMEOUT)
    except requests.RequestException as exc:
        raise ChatGPTAuthError(
            'unreachable', f'Could not reach ChatGPT sign-in ({type(exc).__name__}).',
        ) from exc
    try:
        body = response.json()
    except ValueError:
        body = {}
    if response.status_code == 200 and isinstance(body, dict):
        return body
    error = str((body or {}).get('error') or '') if isinstance(body, dict) else ''
    dead = error in DEAD_TOKEN_ERRORS
    if response.status_code >= 500 and not dead:
        raise ChatGPTAuthError(
            'unavailable', f'ChatGPT sign-in is unavailable (HTTP {response.status_code}).')
    raise ChatGPTAuthError(
        error or f'http_{response.status_code}',
        'ChatGPT refused the sign-in. Sign in again.',
        needs_sign_in=True,
    )


def _validated_identity(id_token: str, *, client_id: str, nonce: str) -> dict:
    """The ID token's claims, after checking it is really OpenAI's and ours.

    Signature against OpenAI's published keys, issuer, audience (our issued
    client), and the nonce this attempt sent — the nonce is what stops a token
    minted for a different sign-in being replayed into this one.
    """
    if not id_token:
        raise ChatGPTAuthError('no_id_token', 'ChatGPT did not say who signed in.')
    import jwt

    try:
        jwks_uri = _discovery().get('jwks_uri') or f'{ISSUER}/.well-known/jwks.json'
        key = jwt.PyJWKClient(jwks_uri, timeout=HTTP_TIMEOUT).get_signing_key_from_jwt(id_token)
        claims = jwt.decode(
            id_token, key.key, algorithms=['RS256', 'ES256'],
            audience=client_id, issuer=ISSUER,
        )
    except ChatGPTAuthError:
        raise
    except Exception as exc:  # noqa: BLE001 — every failure here is one refusal
        logger.warning('ChatGPT ID token rejected: %s', type(exc).__name__)
        raise ChatGPTAuthError(
            'bad_id_token', 'The sign-in ChatGPT returned could not be verified.') from exc
    if not nonce or claims.get('nonce') != nonce:
        raise ChatGPTAuthError(
            'bad_nonce', 'The sign-in ChatGPT returned was not for this attempt.')
    return claims


def _discovery() -> dict:
    cached = cache.get('chatgpt:discovery')
    if cached:
        return cached
    try:
        response = requests.get(DISCOVERY_URL, timeout=HTTP_TIMEOUT)
        document = response.json() if response.status_code == 200 else {}
    except (requests.RequestException, ValueError):
        document = {}
    if document:
        cache.set('chatgpt:discovery', document, 3600)
    return document


# ── The stored credential ────────────────────────────────────────────────────

def _fernet() -> Fernet:
    from credentials.models import Credential

    return Fernet(Credential._get_encryption_key())


def _credential_for(user_id: int, *, lock: bool = False, any_state: bool = False):
    from credentials.models import Credential

    rows = Credential.objects.filter(
        user_id=user_id, credential_type__slug=SLUG,
    ).order_by('-updated_at')
    if not any_state:
        rows = rows.filter(is_active=True)
    if lock:
        rows = rows.select_for_update()
    return rows.first()


def _blob(credential) -> dict:
    try:
        return credential.get_credential_data() or {}
    except ValueError:
        return {}


def _expiry(tokens: dict):
    try:
        seconds = int(tokens.get('expires_in') or 3600)
    except (TypeError, ValueError):
        seconds = 3600
    return timezone.now() + timedelta(seconds=seconds)


def _save(*, user_id: int, client_id: str, tokens: dict, identity: dict):
    """One ChatGPT credential per user: a second sign-in replaces the first."""
    from credentials.models import Credential, CredentialType

    try:
        cred_type = CredentialType.objects.get(slug=SLUG)
    except CredentialType.DoesNotExist as exc:
        raise ChatGPTAuthError(
            'not_installed', 'The ChatGPT credential type is missing; run migrate.') from exc

    fernet = _fernet()
    email = str(identity.get('email') or '')
    with transaction.atomic():
        # Any state: `(user, name)` is unique, so a switched-off row is reused.
        credential = _credential_for(user_id, lock=True, any_state=True) or Credential(
            user_id=user_id, credential_type=cred_type, name='ChatGPT plan')
        credential.set_credential_data({
            'client_id': client_id,
            'sub': str(identity.get('sub') or ''),
            'email': email,
            'scope': str(tokens.get('scope') or SCOPE),
            # Kept because a later re-authorisation sends it as `id_token_hint`.
            'id_token': tokens.get('id_token') or '',
        })
        credential.access_token = fernet.encrypt(tokens['access_token'].encode())
        credential.refresh_token = fernet.encrypt(tokens['refresh_token'].encode())
        credential.token_expires_at = _expiry(tokens)
        credential.public_metadata = {'email': email}
        credential.is_active = True
        credential.is_verified = True
        credential.last_error = ''
        credential.save()
    return credential


def access_token_for(credential_id, user_id: int) -> str:
    """A live access token for this user's ChatGPT credential.

    Refreshes when the stored one is within `REFRESH_MARGIN` of expiry. The
    refresh happens under a row lock with the expiry re-read inside it, so N
    concurrent model calls perform one refresh: a rotating refresh token spent
    twice is refused the second time, and that refusal reads as "signed out".

    Raises `ChatGPTAuthError`. `needs_sign_in` is set when the tokens are
    finished; a temporary failure leaves them in place.
    """
    from credentials.models import Credential

    try:
        credential = Credential.objects.get(
            id=credential_id, user_id=user_id, is_active=True,
            credential_type__slug=SLUG,
        )
    except (Credential.DoesNotExist, ValueError, TypeError) as exc:
        raise ChatGPTAuthError(
            'not_connected', 'You are not signed in with ChatGPT.',
            needs_sign_in=True) from exc

    if not _expiring(credential):
        if token := _decrypt(credential.access_token):
            return token

    # The sign-out write happens *after* the block: raised inside it, the
    # rollback would undo the very row that records the tokens are finished.
    finished: ChatGPTAuthError | None = None
    with transaction.atomic():
        locked = Credential.objects.select_for_update().get(id=credential.id)
        if not _expiring(locked):
            # Someone else refreshed while we waited for the lock.
            if token := _decrypt(locked.access_token):
                return token
        refresh_token = _decrypt(locked.refresh_token)
        client_id = _blob(locked).get('client_id') or ''
        if not refresh_token or not client_id:
            finished = ChatGPTAuthError(
                'not_connected', 'Your ChatGPT sign-in has ended. Sign in again.',
                needs_sign_in=True)
        else:
            try:
                tokens = _token_request({
                    'grant_type': 'refresh_token',
                    'client_id': client_id,
                    'refresh_token': refresh_token,
                    'resource': RESOURCE,
                })
            except ChatGPTAuthError as exc:
                if not exc.needs_sign_in:
                    raise
                finished = exc
        if finished is None:
            if not tokens.get('access_token'):
                raise ChatGPTAuthError('unavailable', 'ChatGPT returned no token.')
            fernet = _fernet()
            locked.access_token = fernet.encrypt(tokens['access_token'].encode())
            # The old refresh token is dead the moment this one is issued.
            if tokens.get('refresh_token'):
                locked.refresh_token = fernet.encrypt(tokens['refresh_token'].encode())
            locked.token_expires_at = _expiry(tokens)
            locked.is_verified = True
            locked.last_error = ''
            locked.save(update_fields=[
                'access_token', 'refresh_token', 'token_expires_at',
                'is_verified', 'last_error', 'updated_at',
            ])
            return tokens['access_token']

    mark_signed_out(user_id, f'Refresh refused: {finished.code}')
    raise finished


def _expiring(credential) -> bool:
    expires = credential.token_expires_at
    return expires is None or expires - REFRESH_MARGIN <= timezone.now()


def _decrypt(raw) -> str:
    if not raw:
        return ''
    try:
        return _fernet().decrypt(bytes(raw)).decode()
    except Exception:  # noqa: BLE001 — an unreadable token is an absent one
        return ''


def _mark_signed_out(credential, reason: str) -> None:
    """Tokens are finished: stop offering the provider until a new sign-in."""
    credential.access_token = None
    credential.refresh_token = None
    credential.token_expires_at = None
    credential.is_verified = False
    credential.last_error = reason[:500]
    credential.save(update_fields=[
        'access_token', 'refresh_token', 'token_expires_at',
        'is_verified', 'last_error', 'updated_at',
    ])


def mark_signed_out(user_id: int, reason: str) -> None:
    """The provider said this account's access is gone (revoked, signed out)."""
    with transaction.atomic():
        if credential := _credential_for(user_id, lock=True):
            _mark_signed_out(credential, reason)


def models_cache_key(user_id: int) -> str:
    """Where `llm/chatgpt_plan.py` keeps this user's model list.

    Named here because sign-in and sign-out have to drop it, and this app may
    not import the provider layer that fills it.
    """
    return f'chatgpt:models:{user_id}'


def forget_models(user_id: int) -> None:
    cache.delete(models_cache_key(user_id))


def status(user_id: int) -> dict:
    """What the UI shows: connected or not, and as whom."""
    credential = _credential_for(user_id)
    connected = bool(credential and credential.is_verified and credential.refresh_token)
    return {
        'enabled': enabled(),
        'connected': connected,
        'email': (credential.public_metadata or {}).get('email', '') if connected else '',
        'needs_sign_in': bool(credential and not connected),
        'manage_usage_url': MANAGE_USAGE_URL,
    }


def disconnect(user_id: int) -> bool:
    """Sign out: revoke at OpenAI, then delete the credential here.

    Returns whether OpenAI confirmed the revocation. The local delete happens
    either way — a credential the user asked to remove must not stay because
    a remote call failed.
    """
    credential = _credential_for(user_id)
    if credential is None:
        return True
    revoked = False
    refresh_token = _decrypt(credential.refresh_token)
    client_id = _blob(credential).get('client_id') or ''
    endpoint = _discovery().get('revocation_endpoint') or ''
    if refresh_token and client_id and endpoint:
        try:
            response = requests.post(endpoint, data={
                'token': refresh_token,
                'token_type_hint': 'refresh_token',
                'client_id': client_id,
            }, timeout=HTTP_TIMEOUT)
            revoked = response.status_code == 200
        except requests.RequestException:
            revoked = False
    credential.delete()
    return revoked
