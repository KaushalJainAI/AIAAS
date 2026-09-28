"""
Automatic capture: a solved problem becomes a saved solution without anyone
writing it up.

**When.** Two signals, both cheap and both from the person, never the model
grading itself:

* a thumbs-up on an assistant answer (`signals.py`, off `logs.Feedback`);
* the person's next message saying it worked ("that fixed it", "works now") —
  a regex over their words, checked after every chat turn at no model cost.

A third path is explicit: the model calls `save_solution` when a problem is
clearly solved (`chat/tools/solutions.py`).

**How.** A detached job (`spawn`), never on the path to the first token:

1. Skip if the answer was already captured, or the exchange read
   instruction-shaped third-party text (a poisoned page must not become an
   org fact — the memory guard's rule).
2. Search the store for similar solutions *in the same scope*.
3. One cheap-model call (`effort="none"`) that decides — `skip`, `new`,
   `same_as <id>` or `replaces <id>` — and extracts the record with each
   claim's kind. Most turns end at "skip".
4. Save through `api.save` (scrub, guards, fixed org), index, and tell the
   person once, quietly, with a link to undo.

The org and the sharing choice come from the **chat**, read at capture time:
a chat with sharing off saves privately, and the org is the chat's own.
"""
from __future__ import annotations

import json
import logging
import re

from asgiref.sync import sync_to_async
from django.conf import settings
from django.db.models import F

logger = logging.getLogger(__name__)

#: The person saying the last answer worked. Anchored to short, plain
#: replies; "it worked before the upgrade but now…" must not count, hence the
#: negative look-ahead on a following "but".
_WORKED = re.compile(
    r"^\W*(?:ok(?:ay)?[,!.\s]+|great[,!.\s]+|thanks?(?: you)?[,!.\s]+|perfect[,!.\s]+|yes[,!.\s]+)*"
    r"(?:(?:that|this|it)(?:'s| has| is)?\s+(?:worked|works|fixed(?: it)?|did it|solved it)"
    r"|works now|working now|fixed(?: it| now)?|solved(?: it)?|that did the trick|problem solved"
    r"|issue (?:is )?resolved)\b(?![^.!?]*\bbut\b)",
    re.IGNORECASE,
)

#: Messages before the answer read for context: the problem is usually stated
#: a few turns up, after some back and forth.
WINDOW = 8
MAX_WINDOW_CHARS = 12_000


def says_it_worked(text: str) -> bool:
    return bool(_WORKED.search((text or '').strip()[:300]))


def _model_choice() -> tuple[str, str]:
    provider = (getattr(settings, 'SOLUTION_CAPTURE_PROVIDER', '')
                or getattr(settings, 'CONTEXT_SUMMARY_PROVIDER', ''))
    model = (getattr(settings, 'SOLUTION_CAPTURE_MODEL', '')
             or getattr(settings, 'CONTEXT_SUMMARY_MODEL', ''))
    return provider, model


# ── Reading the exchange ────────────────────────────────────────────────────

def _load_exchange(answer_id: int):
    """(session, answer, window messages) or None. Sync."""
    from chat.models import ChatMessage

    answer = (ChatMessage.objects.select_related('session', 'session__user')
              .filter(id=answer_id, role='assistant').first())
    if answer is None:
        return None
    before = list(ChatMessage.objects
                  .filter(session=answer.session, created_at__lte=answer.created_at)
                  .exclude(id=answer.id)
                  .order_by('-created_at')[:WINDOW - 1])
    window = list(reversed(before)) + [answer]
    return answer.session, answer, window


def _exposed(window) -> bool:
    """Did any turn in the window read text addressed to an AI?"""
    from core.safety.provenance import instruction_shaped

    for message in window:
        trace = (message.metadata or {}).get('tool_trace') or []
        if trace and instruction_shaped(json.dumps(trace, default=str)[:50_000]):
            return True
    return False


def _transcript(window) -> str:
    parts, used = [], 0
    for message in reversed(window):
        text = f'{message.role.upper()}: {message.content.strip()}'
        if used + len(text) > MAX_WINDOW_CHARS:
            text = text[:max(0, MAX_WINDOW_CHARS - used)]
        parts.append(text)
        used += len(text)
        if used >= MAX_WINDOW_CHARS:
            break
    return '\n\n'.join(reversed(parts))


SYSTEM = (
    "You maintain an organisation's library of solved problems. You read one "
    "conversation and decide whether it contains a real, reusable problem that "
    "was solved — something a colleague could hit again (an error, a failing "
    "setup, a how-to with a non-obvious answer). Small talk, writing tasks, "
    "one-off questions, opinions and unsolved problems are NOT solutions. "
    "Never include secrets, passwords, tokens, personal details or anything "
    "about specific people beyond their role. Answer with JSON only."
)

PROMPT = """Conversation (the last ASSISTANT message is the answer that worked):

{transcript}

Existing solutions in the library that may be the same problem:
{similar}

Return exactly this JSON:
{{
  "decision": "skip" | "new" | "same_as" | "replaces",
  "existing_id": <id from the list for same_as/replaces, else null>,
  "problem": "<the problem as someone would ask it, one sentence>",
  "symptoms": "<error text and observed behaviour; keep exact error lines>",
  "root_cause": "<why it happened, if known>",
  "resolution": "<the steps that fixed it, concise and complete>",
  "environment": {{"<system or library>": "<version or value>"}},
  "claims": [{{"text": "<one statement in the fix that could stop being true>",
              "kind": "principle|procedure|versioned|config|time_sensitive|ephemeral",
              "depends_on": "<what it depends on, e.g. 'django version'>"}}],
  "phrasings": ["<3-5 other ways a colleague might ask for this>"],
  "tags": ["<2-5 short topic tags>"]
}}

Kinds: principle = a general rule that does not change; procedure = steps that
stay right until the system changes; versioned = true for certain versions;
config = a setting/address/port that can be changed; time_sensitive = limits,
prices, people, schedules, policies; ephemeral = only true right now.
Use "same_as" when an existing solution already says the same fix, "replaces"
when this fix corrects or updates an existing one, "skip" when nothing reusable
was solved."""


def _parse(text: str) -> dict | None:
    text = (text or '').strip()
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
    except (ValueError, TypeError):
        return None
    return data if isinstance(data, dict) else None


async def _extract(user_id: int, transcript: str, similar: list[dict]) -> tuple[dict | None, int, str]:
    from llm import access

    provider, model = _model_choice()
    if not provider or not model:
        return None, 0, ''
    listing = '\n'.join(
        f'- id {s["id"]}: {s["problem"]} — fix: {s["resolution"][:300]}' for s in similar
    ) or '(none)'
    completion = await access.complete(
        provider=provider, model=model, user_id=user_id,
        system_message=SYSTEM,
        prompt=PROMPT.format(transcript=transcript, similar=listing),
        temperature=0.0, max_tokens=1800, effort='none',
    )
    if completion.error:
        logger.warning('[Solutions] capture model error: %s', completion.error)
        return None, completion.tokens, model
    return _parse(completion.content), completion.tokens, f'{provider}:{model}'


# ── The job ─────────────────────────────────────────────────────────────────

_IN_FLIGHT: set[int] = set()


async def capture_answer(answer_id: int, *, trigger: str) -> dict:
    """Try to turn one assistant answer into a solution. Returns what happened."""
    from . import api
    from .models import Solution
    from .search import search

    if answer_id in _IN_FLIGHT:
        return {'outcome': 'busy'}
    _IN_FLIGHT.add(answer_id)
    try:
        loaded = await sync_to_async(_load_exchange)(answer_id)
        if loaded is None:
            return {'outcome': 'no_answer'}
        session, answer, window = loaded
        user = session.user
        if await Solution.objects.filter(source_message_id=answer.id).aexists():
            return {'outcome': 'already_captured'}
        if await sync_to_async(_exposed)(window):
            logger.info('[Solutions] capture skipped: exchange read instruction-shaped text')
            return {'outcome': 'exposed'}

        org_id = session.org_id
        if org_id:
            from core.orgs import is_member

            if not await sync_to_async(is_member)(user.id, org_id):
                return {'outcome': 'not_member'}
        question = next((m.content for m in window if m.role == 'user'), '')
        found = await search(user.id, org_id, question[:2000], limit=3)
        transcript = await sync_to_async(_transcript)(window)

        data, tokens, model_label = await _extract(user.id, transcript, found['results'])
        if tokens:
            from chat.models import ChatSession

            await ChatSession.objects.filter(id=session.id).aupdate(
                total_tokens_used=F('total_tokens_used') + tokens,
            )
        if not data:
            return {'outcome': 'no_extraction'}
        decision = str(data.get('decision') or 'skip').lower()
        if decision == 'skip':
            return {'outcome': 'skip'}

        existing = data.get('existing_id')
        known_ids = {s['id'] for s in found['results']}
        if decision in ('same_as', 'replaces') and existing not in known_ids:
            decision = 'new'  # the model named an id it was never shown
        if decision == 'same_as':
            await sync_to_async(api.review)(
                user, org_id, existing, 'confirmed',
                reason=f'Worked again ({trigger}).', model=model_label,
            )
            return {'outcome': 'confirmed', 'solution_id': existing}

        draft = api.Draft(
            problem=str(data.get('problem') or ''),
            symptoms=str(data.get('symptoms') or ''),
            root_cause=str(data.get('root_cause') or ''),
            resolution=str(data.get('resolution') or ''),
            environment=data.get('environment') if isinstance(data.get('environment'), dict) else {},
            claims=data.get('claims') if isinstance(data.get('claims'), list) else [],
            phrasings=data.get('phrasings') if isinstance(data.get('phrasings'), list) else [],
            tags=data.get('tags') if isinstance(data.get('tags'), list) else [],
        )
        try:
            solution = await sync_to_async(api.save)(
                user, org_id=org_id, share=session.share_solutions, draft=draft,
                captured_by='auto', source_session=str(session.id),
                source_message_id=answer.id,
                supersedes_id=existing if decision == 'replaces' else None,
            )
        except api.SolutionError as exc:
            logger.info('[Solutions] capture refused: %s', exc)
            return {'outcome': 'refused', 'reason': str(exc)}
        await api.aindex(solution.id)
        await sync_to_async(_tell)(user, solution)
        return {'outcome': 'saved', 'solution_id': solution.id,
                'replaced': existing if decision == 'replaces' else None}
    except Exception:  # noqa: BLE001 — capture is best-effort, never a turn failure
        logger.exception('[Solutions] capture failed for message %s', answer_id)
        return {'outcome': 'error'}
    finally:
        _IN_FLIGHT.discard(answer_id)


def _tell(user, solution) -> None:
    """One quiet notice, linking to where it can be edited or undone."""
    from notifications.utils import create_notification

    where = 'your organisation' if solution.shared else 'your private solutions'
    create_notification(
        user, 'system', 'Saved a solution',
        f'"{solution.problem[:120]}" was saved to {where}. Open it to edit, '
        'change who can see it, or remove it.',
        data={'action_url': f'/solutions?id={solution.id}'},
        send_email=False,
    )


async def after_turn(session_id, user_text: str) -> None:
    """Called after every chat turn. If the person says the previous answer
    worked, capture that answer in the background. No model call here."""
    if not says_it_worked(user_text):
        return
    from chat.models import ChatMessage
    from workflow_backend.background import spawn

    # The newest assistant message answers "that worked"; the one before it is
    # the answer that worked.
    ids = [i async for i in ChatMessage.objects
           .filter(session_id=session_id, role='assistant')
           .order_by('-created_at').values_list('id', flat=True)[1:2]]
    for answer_id in ids:
        spawn(capture_answer(answer_id, trigger='said it worked'),
              name=f'solution-capture-{answer_id}')
