"""
Decision models: typed answers with probabilities, not prose.

A decision model takes a *state* (any text or JSON) and a set of typed
*questions*, and answers each one with a choice, a yes/no probability or a
position on a scale. It cannot write a sentence, which is the point: where the
platform needs a closed-set answer (route this ticket, is this urgent, which of
these three), a chat model writing prose that we then parse is slower, costs
more, and gives no real probability to set a threshold on.

They are reached through OpenRouter's Decisions API (`POST
/api/alpha/decisions`), not chat completions, so this is a door of its own
beside `llm/access.py` rather than a handler under `llm/handlers/` — a handler
is chat-shaped (`complete()` / `stream()`), and a decision is one request in,
one typed answer out. It pays with the user's own key only: the
`credentials.resolution` lookup with the platform fallback switched off, so a
decision is always billed to a key the person added under Credentials and
never to ours.

Four rules carry it.

* **Provider, then model — like the chat picker.** `PROVIDERS` holds one
  adapter per provider that has a decision endpoint (OpenRouter today; a new
  one is a subclass of `DecisionProvider`). `resolve()` is the one answer to
  "which": an explicit call-time choice, else the user's
  `UserProfile.decision_provider`/`decision_model`, else
  `settings.DECISION_PROVIDER`/`DECISION_MODEL` — the
  `voice.tts.resolve_voice` shape.
* **Ids come from the provider's live listing**, newest first, never typed
  here. The settings picker and the serializer both read `list_models()`
  (cached an hour); the one hard-coded id is the default, a router alias
  (`~typesafe/jev-latest`) because, as with `openrouter/free`, a router is
  the only default that survives an individual model being retired.
* **Questions are checked here and refused, never trimmed.** A dropped option
  is a decision quietly made over the wrong set; the model calling the tool
  can be told to shorten it.
* **The endpoint is alpha.** Everything about its shape is in this file, so a
  change upstream is a change here and nowhere else.
"""
from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any

from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger(__name__)

#: Fallbacks when settings name nothing. The model is a router alias, not a
#: pinned release — see the module docstring. Verified answering 2026-11-13.
DEFAULT_DECISION_PROVIDER = 'openrouter'
DEFAULT_DECISION_MODEL = '~typesafe/jev-latest'

QUESTION_TYPES = ('choice', 'noul', 'score')
MAX_QUESTIONS = 10
MAX_CHOICE_OPTIONS = 20
MAX_SCORE_LEVELS = 10
MAX_TEXT_CHARS = 2_000          # one instruction or one option's guidance
MAX_STATE_CHARS = 60_000        # well under every listed model's context
REQUEST_TIMEOUT_S = 60

_NAME_RE = re.compile(r'^[A-Za-z][A-Za-z0-9_]{0,39}$')
#: Listings are public and change rarely; an hour keeps the picker cheap.
_LIST_CACHE_TTL = 3600


class DecisionError(Exception):
    """A decision that could not be made, with a sentence the caller can show."""


@dataclass
class Decision:
    provider: str
    model: str
    answers: dict[str, dict[str, Any]]
    input_tokens: int = 0
    cost_usd: float = 0.0
    latency_ms: int = 0
    refused: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            'provider': self.provider,
            'model': self.model,
            'answers': self.answers,
            'refused': self.refused,
            'usage': {'input_tokens': self.input_tokens, 'cost_usd': self.cost_usd},
            'latency_ms': self.latency_ms,
        }


# ── Providers ────────────────────────────────────────────────────────────────

class DecisionProvider:
    """One provider's decision endpoint: how to list its models, how to call.

    A provider is chosen and then a model within it, exactly like the chat
    picker. Adding a provider means subclassing this and adding it to
    `PROVIDERS`; nothing above or below this file changes. The key comes from
    `credentials.resolution` under `credential_provider` — the user's own
    credential only, never the platform key.
    """

    slug = ''
    label = ''
    credential_provider = ''
    default_model = ''
    #: Shape of a model id, for when the listing cannot be reached.
    model_id_re = re.compile(r'.+')

    def fetch_models(self) -> list[dict[str, Any]]:  # pragma: no cover - abstract
        raise NotImplementedError

    async def post(self, key: str, body: dict[str, Any]):  # pragma: no cover - abstract
        raise NotImplementedError


class OpenRouterDecisions(DecisionProvider):
    """OpenRouter's Decisions API — Jev, Gemini Decision, Perplexity Decider, …"""

    slug = 'openrouter'
    label = 'OpenRouter'
    credential_provider = 'openrouter'
    default_model = DEFAULT_DECISION_MODEL
    model_id_re = re.compile(r'^~?[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._:-]*$')
    models_url = 'https://openrouter.ai/api/v1/models?output_modalities=decisions'
    decisions_url = 'https://openrouter.ai/api/alpha/decisions'

    def fetch_models(self) -> list[dict[str, Any]]:
        import httpx
        from datetime import date

        resp = httpx.get(self.models_url, timeout=10)
        resp.raise_for_status()
        today = date.today().isoformat()
        rows = []
        for row in resp.json().get('data') or []:
            if not row.get('id'):
                continue
            expires = str(row.get('expiration_date') or '')
            if expires and expires[:10] <= today:
                continue  # already switched off upstream
            pricing = row.get('pricing') or {}
            try:
                per_million = round(float(pricing.get('prompt') or 0) * 1_000_000, 4)
            except (TypeError, ValueError):
                per_million = None
            arch = row.get('architecture') or {}
            rows.append({
                'id': row['id'],
                'name': row.get('name') or row['id'],
                'created': int(row.get('created') or 0),
                'input_price_per_million': per_million,
                'is_free': per_million == 0,
                'context_length': row.get('context_length') or 0,
                'input_modalities': arch.get('input_modalities') or ['text'],
                'is_router': row['id'].startswith('~'),
                'expires': expires[:10],
            })
        return rows

    async def post(self, key: str, body: dict[str, Any]):
        from workflow_backend.httpclient import shared_client

        return await shared_client().post(
            self.decisions_url,
            headers={
                'Authorization': f'Bearer {key}',
                'HTTP-Referer': 'https://aiaas.local',
                'X-Title': 'AIAAS Workflow',
            },
            json=body,
            timeout=REQUEST_TIMEOUT_S,
        )


#: Every provider with a decision endpoint, in picker order.
PROVIDERS: dict[str, DecisionProvider] = {
    p.slug: p for p in (OpenRouterDecisions(),)
}


def get_provider(slug: str) -> DecisionProvider | None:
    return PROVIDERS.get((slug or '').strip())


# ── Which model ──────────────────────────────────────────────────────────────

def default_choice() -> tuple[str, str]:
    """The platform default (provider, model), from settings."""
    provider = (getattr(settings, 'DECISION_PROVIDER', '') or '').strip()
    if provider not in PROVIDERS:
        provider = DEFAULT_DECISION_PROVIDER
    model = (getattr(settings, 'DECISION_MODEL', '') or '').strip()
    return provider, model or PROVIDERS[provider].default_model


def resolve(user=None, provider: str = '', model: str = '') -> tuple[str, str]:
    """The (provider, model) to ask — one answer, however it is asked.

    An explicit call-time choice wins; failing that, the user's saved
    `decision_provider`/`decision_model`; failing that, the platform default.
    A saved model is inherited only with its own provider — an id means
    nothing to another provider (the `voice.tts.resolve_voice` rule).
    """
    provider = (provider or '').strip()
    model = (model or '').strip()
    try:
        profile = user.profile if user is not None else None
    except Exception:  # noqa: BLE001 — a OneToOne that was never created
        profile = None
    pref_provider = (getattr(profile, 'decision_provider', '') or '').strip() if profile else ''
    pref_model = (getattr(profile, 'decision_model', '') or '').strip() if profile else ''
    if pref_provider not in PROVIDERS:
        pref_provider, pref_model = '', ''

    if not provider:
        provider = pref_provider or (DEFAULT_DECISION_PROVIDER if model else '')
    if not provider:
        return default_choice()
    if provider not in PROVIDERS:
        raise DecisionError(f'{provider!r} has no decision models. Choose one of: {", ".join(PROVIDERS)}.')
    if not model and provider == pref_provider:
        model = pref_model
    if not model:
        d_provider, d_model = default_choice()
        model = d_model if d_provider == provider else PROVIDERS[provider].default_model
    return provider, model


def list_models(provider: str = DEFAULT_DECISION_PROVIDER, *, refresh: bool = False) -> list[dict[str, Any]]:
    """`provider`'s decision models now, newest first. Never raises.

    Newest first because the newest release is usually the one to pick. An
    unreachable listing returns the cached copy, else just the provider's
    default marked `unverified` — the picker offers one row rather than none,
    and validation falls back to checking the id's shape.
    """
    impl = get_provider(provider)
    if impl is None:
        return []
    cache_key = f'llm:decision-models:v2:{impl.slug}'
    if not refresh:
        cached = cache.get(cache_key)
        if cached:
            return cached
    try:
        rows = impl.fetch_models()
    except Exception as exc:  # noqa: BLE001
        logger.warning('[Decisions] %s model listing unavailable: %s', impl.slug, exc)
        return [{'id': impl.default_model, 'name': impl.default_model, 'created': 0,
                 'input_price_per_million': None, 'is_free': False, 'context_length': 0,
                 'input_modalities': ['text'], 'is_router': impl.default_model.startswith('~'),
                 'expires': '', 'unverified': True}]
    rows.sort(key=lambda r: (-r['created'], r['id']))
    cache.set(cache_key, rows, _LIST_CACHE_TTL)
    return rows


def list_providers() -> list[dict[str, str]]:
    return [{'slug': p.slug, 'label': p.label, 'default_model': p.default_model}
            for p in PROVIDERS.values()]


def is_known_model(provider: str, model_id: str) -> bool:
    """Whether `model_id` is a decision model `provider` serves, as far as we can tell.

    Checked against the live listing; when that listing could not be reached,
    only the id's shape is checked — refusing a save because a third party is
    down would be the wrong failure.
    """
    impl = get_provider(provider)
    model_id = (model_id or '').strip()
    if impl is None or not model_id:
        return False
    rows = list_models(impl.slug)
    if model_id in {r['id'] for r in rows}:
        return True
    unreachable = len(rows) == 1 and rows[0].get('unverified')
    return bool(unreachable and impl.model_id_re.match(model_id))


# ── Questions ────────────────────────────────────────────────────────────────

def _text(value: Any, what: str) -> str:
    text = str(value or '').strip()
    if len(text) > MAX_TEXT_CHARS:
        raise DecisionError(f'{what} is {len(text):,} characters; keep it under {MAX_TEXT_CHARS:,}.')
    return text


def build_questions(questions: Any) -> dict[str, dict[str, Any]]:
    """Turn the tool's list-of-questions into the API's map. Refuses, never trims.

    In: ``[{name, type, instructions?, options?: [{name, description?}],
    levels?: [str], yes?: str, no?: str}]`` — a flat list of simple fields,
    because that is what every provider's tool-calling accepts reliably. Out:
    the Decisions API's ``{name: {type, instructions, criteria}}``.
    """
    if not isinstance(questions, list) or not questions:
        raise DecisionError('Ask at least one question.')
    if len(questions) > MAX_QUESTIONS:
        raise DecisionError(f'{len(questions)} questions; ask at most {MAX_QUESTIONS} per call and split the rest.')
    out: dict[str, dict[str, Any]] = {}
    for i, q in enumerate(questions, 1):
        if not isinstance(q, dict):
            raise DecisionError(f'Question {i} is not an object.')
        name = str(q.get('name') or '').strip()
        if not _NAME_RE.match(name):
            raise DecisionError(
                f'Question {i} needs a short `name` (letters, digits, underscores; starts with a letter).')
        if name in out:
            raise DecisionError(f'Two questions are named {name!r}.')
        qtype = str(q.get('type') or '').strip().lower()
        if qtype in ('yes_no', 'yesno', 'bool', 'boolean'):
            qtype = 'noul'
        if qtype not in QUESTION_TYPES:
            raise DecisionError(f'Question {name!r} has type {qtype!r}; use choice, noul (yes/no) or score.')
        spec: dict[str, Any] = {'type': qtype}
        instructions = _text(q.get('instructions'), f'The instructions for {name!r}')
        if instructions:
            spec['instructions'] = instructions

        if qtype == 'choice':
            options = q.get('options') or []
            if not isinstance(options, list) or len(options) < 2:
                raise DecisionError(f'Choice {name!r} needs at least two options.')
            if len(options) > MAX_CHOICE_OPTIONS:
                raise DecisionError(
                    f'Choice {name!r} has {len(options)} options; at most {MAX_CHOICE_OPTIONS}. '
                    'Group the rare ones under "other".')
            criteria: dict[str, str] = {}
            for opt in options:
                if isinstance(opt, str):
                    opt = {'name': opt}
                if not isinstance(opt, dict):
                    raise DecisionError(f'An option of {name!r} is not a name or an object.')
                key = str(opt.get('name') or '').strip()
                if not key or len(key) > 80:
                    raise DecisionError(f'Every option of {name!r} needs a name of at most 80 characters.')
                if key in criteria:
                    raise DecisionError(f'Choice {name!r} lists {key!r} twice.')
                criteria[key] = _text(opt.get('description'), f'Option {key!r}') or key
            spec['criteria'] = criteria
        elif qtype == 'score':
            levels = q.get('levels') or []
            if not isinstance(levels, list) or len(levels) < 2:
                raise DecisionError(f'Score {name!r} needs at least two levels, lowest first.')
            if len(levels) > MAX_SCORE_LEVELS:
                raise DecisionError(f'Score {name!r} has {len(levels)} levels; at most {MAX_SCORE_LEVELS}.')
            spec['criteria'] = [_text(level, f'A level of {name!r}') or f'level {n}'
                                for n, level in enumerate(levels)]
        else:
            yes = _text(q.get('yes'), f'The yes guidance for {name!r}')
            no = _text(q.get('no'), f'The no guidance for {name!r}')
            if yes or no:
                spec['criteria'] = {'true': yes or 'yes', 'false': no or 'no'}
            if not instructions and not yes:
                raise DecisionError(f'Yes/no question {name!r} needs `instructions` saying what is asked.')
        out[name] = spec
    return out


def build_state(state: Any) -> Any:
    """Plain text stays text; JSON text becomes the object it encodes."""
    if isinstance(state, (dict, list)):
        text = json.dumps(state, ensure_ascii=False)
        value: Any = state
    else:
        text = str(state or '').strip()
        value = text
        if text[:1] in ('{', '['):
            try:
                value = json.loads(text)
            except ValueError:
                value = text
    if not text:
        raise DecisionError('Give the `state`: the facts the decision is about.')
    if len(text) > MAX_STATE_CHARS:
        raise DecisionError(
            f'The state is {len(text):,} characters; keep it under {MAX_STATE_CHARS:,} — '
            'pass the fields that matter, not whole documents.')
    return value


# ── The call ─────────────────────────────────────────────────────────────────

def _summarise(answers: dict[str, dict[str, Any]]) -> list[str]:
    lines = []
    for name, a in answers.items():
        kind = a.get('type')
        if kind == 'choice':
            conf = a.get('confidence')
            lines.append(f"{name}: {a.get('choice')}" + (f' (confidence {conf:.2f})' if isinstance(conf, (int, float)) else ''))
        elif kind == 'noul':
            p = a.get('noul')
            lines.append(f'{name}: P(yes) = {p:.2f}' if isinstance(p, (int, float)) else f'{name}: ?')
        elif kind == 'score':
            legend = a.get('legend') or {}
            score = a.get('score')
            nearest = legend.get(str(round(score))) if isinstance(score, (int, float)) else None
            lines.append(f'{name}: {score}' + (f' ≈ "{nearest}"' if nearest else ''))
        elif kind == 'refusal':
            lines.append(f'{name}: declined by the model')
    return lines


def _explain_status(status: int, body: str, model: str) -> str:
    try:
        message = (json.loads(body).get('error') or {}).get('message') or ''
    except Exception:  # noqa: BLE001
        message = ''
    message = str(message)[:300]
    if status in (401, 403):
        return 'The provider refused the key. Check its credential under Credentials.'
    if status == 402:
        return 'The provider account is out of credits. Top it up, then try again.'
    if status == 404:
        return f'The decision model {model!r} is not served any more. Pick another in Settings.'
    if status == 429:
        return 'The provider is rate-limiting decision calls. Wait a moment and try again.'
    if status == 400:
        return f'The decision model refused the request: {message or "invalid parameters"}.'
    if status >= 500:
        return 'The decision model is unavailable right now. Try again shortly.'
    return f'The decision call failed ({status}){": " + message if message else ""}.'


async def decide(user_id: int, state: Any, questions: Any, *, provider: str = '',
                 model: str = '', user=None) -> Decision:
    """Ask a decision model. Raises `DecisionError` with a sentence to show."""
    from credentials.resolution import CredentialUnavailable, resolve_api_key

    if user is None and user_id:
        from asgiref.sync import sync_to_async
        from django.contrib.auth import get_user_model

        user = await sync_to_async(
            lambda: get_user_model().objects.select_related('profile').filter(pk=user_id).first())()
    provider, model = resolve(user, provider, model)
    impl = PROVIDERS[provider]
    body = {
        'model': model,
        'state': build_state(state),
        'questions': build_questions(questions),
    }
    try:
        key = await resolve_api_key(
            impl.credential_provider, user_id, allow_platform_fallback=False)
    except CredentialUnavailable as exc:
        raise DecisionError(
            f'No {impl.label} key is connected for decisions. Add your {impl.label} '
            'API key under Credentials, then try again.') from exc

    started = time.monotonic()
    try:
        resp = await impl.post(key, body)
    except Exception as exc:  # noqa: BLE001
        logger.warning('[Decisions] %s unreachable: %s', model, type(exc).__name__)
        raise DecisionError('Could not reach the decision model. Try again shortly.') from exc
    latency_ms = int((time.monotonic() - started) * 1000)
    if resp.status_code != 200:
        logger.warning('[Decisions] %s answered %s', model, resp.status_code)
        raise DecisionError(_explain_status(resp.status_code, resp.text, model))
    try:
        data = resp.json()
    except ValueError as exc:
        raise DecisionError('The decision model sent a reply that was not JSON.') from exc

    answers = data.get('answers') or {}
    if not isinstance(answers, dict) or not answers:
        raise DecisionError('The decision model answered nothing.')
    usage = data.get('usage') or {}
    decision = Decision(
        provider=provider,
        model=str(data.get('model') or model),
        answers=answers,
        input_tokens=int(usage.get('input_tokens') or 0),
        cost_usd=float(usage.get('cost') or 0.0),
        latency_ms=latency_ms,
        refused=[k for k, a in answers.items() if (a or {}).get('type') == 'refusal'],
    )
    logger.info('[Latency] decision %dms provider=%s model=%s questions=%d tokens=%d',
                latency_ms, provider, decision.model, len(body['questions']), decision.input_tokens)
    return decision


def summarise(decision: Decision) -> list[str]:
    return _summarise(decision.answers)
