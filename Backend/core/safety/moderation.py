"""
A model second opinion on the content floor, for the two places the platform
itself makes something public or permanent: image prompts and published pages.

`content_policy.py` is patterns. It is fast, free and deterministic, and it
misses anything reworded past its word lists. This module asks a small
policy-following classifier (`openai/gpt-oss-safeguard-20b` on OpenRouter,
~1 s, a fraction of a paisa per call) the same question, **after** the
patterns have passed. Four rules:

* **It can only refuse more, never less.** The pattern check runs first and a
  pattern refusal stands whatever the model says.
* **It is our policy, not the model's.** The system prompt names our three
  categories (`csam`, `ncii`, `cbrn`) and what is allowed; a general safety
  model's own taxonomy flagged "nude lipstick" and filed a nerve-agent recipe
  under defamation when this was measured (2026-09-28).
* **It fails open.** No key, a timeout, an error or an unreadable answer is
  logged and passes: the pattern floor already ran, and an outage at the
  moderation provider must not stop every image and every page.
* **Only where it earns its cost.** Image prompts and published pages, not
  every chat message — a second model call on every turn would cost latency
  on the path users wait on most.

The platform's own key pays for it (`OPENROUTER_API_KEY`), because the duty is
the platform's. Blank `CONTENT_MODERATION_MODEL` switches it off.
"""
from __future__ import annotations

import hashlib
import logging

from django.conf import settings
from django.core.cache import cache

from .content_policy import Violation, _MESSAGES

logger = logging.getLogger(__name__)

POLICY = """You classify content against this policy. Answer with exactly one label and nothing else.

VIOLATES (label the category):
- csam: sexual or sexualised content involving anyone under 18, including fictional or AI-generated.
- ncii: sexual, nude or intimate content depicting a real, identifiable person (a named person, a celebrity, "my ex", "my coworker"), including deepfakes.
- cbrn: instructions, recipes or operational help to make, acquire or deploy chemical, biological, radiological or nuclear weapons.

ALLOWED (label safe): everything else, including history, news, education, policy discussion, medical and sex education, fiction without the above, adult content about fictional adults, and ordinary requests.

Output one of: safe, csam, ncii, cbrn"""

#: Characters sent. A page body can be long; the start carries the subject.
MAX_CHARS = 8_000
#: How long a verdict is remembered, so a retried publish is not billed twice.
CACHE_SECONDS = 600
ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'


def _enabled() -> tuple[str, str]:
    model = str(getattr(settings, 'CONTENT_MODERATION_MODEL', '') or '').strip()
    key = str(getattr(settings, 'OPENROUTER_API_KEY', '') or '').strip()
    return (model, key) if model and key else ('', '')


def classify(text: str) -> str | None:
    """The model's label for `text` (`safe`, `csam`, `ncii`, `cbrn`), or None
    when there is no verdict (switched off, failed, unreadable)."""
    model, key = _enabled()
    if not model or not (text or '').strip():
        return None
    text = text[:MAX_CHARS]
    cache_key = 'moderation:' + hashlib.sha256(f'{model}\0{text}'.encode()).hexdigest()
    try:
        cached = cache.get(cache_key)
    except Exception:  # noqa: BLE001
        cached = None
    if cached:
        return cached

    import httpx

    try:
        response = httpx.post(
            ENDPOINT, timeout=float(getattr(settings, 'CONTENT_MODERATION_TIMEOUT_S', 4)),
            headers={'Authorization': f'Bearer {key}'},
            json={
                'model': model, 'temperature': 0, 'max_tokens': 600,
                'reasoning': {'effort': 'low'},
                'messages': [{'role': 'system', 'content': POLICY},
                             {'role': 'user', 'content': text}],
            },
        )
        response.raise_for_status()
        content = ((response.json().get('choices') or [{}])[0].get('message') or {}).get('content')
    except Exception as exc:  # noqa: BLE001 — fail open, the patterns already ran
        logger.warning('[Moderation] no verdict (%s): %s', type(exc).__name__, exc)
        return None
    label = str(content or '').strip().lower().split()[:1]
    label = label[0].strip('.:') if label else ''
    if label not in ('safe', 'csam', 'ncii', 'cbrn'):
        logger.warning('[Moderation] unreadable verdict %r', (content or '')[:80])
        return None
    try:
        cache.set(cache_key, label, CACHE_SECONDS)
    except Exception:  # noqa: BLE001
        pass
    return label


def check(text: str, *, where: str) -> Violation | None:
    """A `Violation` when the model places `text` in one of our categories."""
    label = classify(text)
    if label in (None, 'safe'):
        return None
    logger.warning('[Moderation] refused %s in %s', label, where)
    return Violation(label, _MESSAGES[label])
