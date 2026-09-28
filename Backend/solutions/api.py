"""
The public surface of `solutions/`: save, review, supersede, share, retract.

Other apps (the chat tools, the capture job, the views) import this module,
not the models, so every write passes the same guards:

* **no secrets or contact details** — scrubbed before anything is stored,
  because a shared record is read by the whole org;
* **no instructions** — a "fix" that addresses an AI is a poisoning attempt,
  refused like `remember_about_user` refuses one;
* **no momentary facts** — `ephemeral` claims ("the outage is ongoing") are
  dropped, and a record made only of them is not saved;
* **the org is fixed** — taken from where the problem was solved and never
  changed; `shared` can be turned off by the author or a manager, and on only
  for a solution that already has an org.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from core.safety.provenance import instruction_shaped
from core.safety.security import LogSanitizer

from . import freshness
from .access import can_manage, get_visible
from .models import Solution, SolutionReview

MAX_PROBLEM = 500
MAX_TEXT = 8000
MAX_CLAIMS = 12
MAX_PHRASINGS = 5

_EXTRA_SECRETS = [
    (re.compile(r'\bsk-[A-Za-z0-9_-]{20,}'), 'API_KEY'),
    (re.compile(r'\bgh[pousr]_[A-Za-z0-9]{30,}'), 'GITHUB_TOKEN'),
    (re.compile(r'\bxox[abpr]-[A-Za-z0-9-]{10,}'), 'SLACK_TOKEN'),
    (re.compile(r'\bAIza[0-9A-Za-z_-]{35}'), 'GOOGLE_KEY'),
    (re.compile(r'\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'), 'JWT'),
    (re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b'), 'EMAIL'),
    (re.compile(r'(?<!\d)(?:\+?\d{1,3}[-.\s]?)?\d{3}[-.\s]?\d{3}[-.\s]?\d{4}(?!\d)'), 'PHONE'),
]
_SANITIZER = LogSanitizer(mask='redacted')


class SolutionError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def scrub(text: str) -> str:
    """Secrets and contact details out; IPs, ports and hostnames stay — inside
    an org they are the useful part of a config fix."""
    if not text:
        return ''
    text = _SANITIZER.sanitize(text, redact_pii=False)
    for pattern, name in _EXTRA_SECRETS:
        text = pattern.sub(f'[{name}:redacted]', text)
    return text


def _clean_claims(claims) -> list[dict]:
    out = []
    for claim in (claims or [])[:MAX_CLAIMS]:
        if isinstance(claim, str):
            claim = {'text': claim}
        if not isinstance(claim, dict):
            continue
        text = scrub(str(claim.get('text') or '')).strip()[:400]
        kind = freshness.clean_kind(claim.get('kind'))
        if not text or kind == 'ephemeral':
            continue
        row = {'text': text, 'kind': kind}
        if claim.get('depends_on'):
            row['depends_on'] = scrub(str(claim['depends_on']))[:100]
        out.append(row)
    return out


def _clean_env(env) -> dict:
    if not isinstance(env, dict):
        return {}
    return {str(k)[:40]: scrub(str(v))[:80] for k, v in list(env.items())[:12]}


def _author_name(user) -> str:
    if user is None:
        return ''
    try:
        from core.models import UserProfile

        name = (UserProfile.objects.filter(user=user)
                .values_list('display_name', flat=True).first())
    except Exception:  # noqa: BLE001
        name = ''
    return (name or user.get_full_name() or user.username or '')[:150]


@dataclass
class Draft:
    problem: str
    resolution: str
    symptoms: str = ''
    root_cause: str = ''
    environment: dict | None = None
    claims: list | None = None
    phrasings: list | None = None
    tags: list | None = None


def validate(draft: Draft) -> dict:
    """Scrub and check a draft. Raises `SolutionError`; returns the fields."""
    fields = {
        'problem': scrub(draft.problem).strip()[:MAX_PROBLEM],
        'symptoms': scrub(draft.symptoms).strip()[:MAX_TEXT],
        'root_cause': scrub(draft.root_cause).strip()[:MAX_TEXT],
        'resolution': scrub(draft.resolution).strip()[:MAX_TEXT],
    }
    if not fields['problem'] or not fields['resolution']:
        raise SolutionError('A solution needs the problem and what fixed it.')
    for name, value in fields.items():
        if instruction_shaped(value):
            raise SolutionError(
                f'Not saved: the {name.replace("_", " ")} reads as an instruction '
                'to an AI, not a description of a fix.'
            )
    raw_claims = draft.claims or []
    claims = _clean_claims(raw_claims)
    if raw_claims and not claims:
        raise SolutionError('Not saved: every claim was momentary (ephemeral), '
                            'so there is nothing that will still be true later.')
    if not claims:
        claims = [{'text': fields['resolution'][:400], 'kind': 'procedure'}]
    fields.update(
        environment=_clean_env(draft.environment),
        claims=claims,
        volatility=freshness.volatility(claims),
        phrasings=[scrub(str(p))[:200] for p in (draft.phrasings or []) if p][:MAX_PHRASINGS],
        tags=[str(t)[:40] for t in (draft.tags or []) if t][:8],
    )
    return fields


def save(user, *, org_id, share: bool, draft: Draft, captured_by: str = 'tool',
         source_session: str = '', source_message_id=None,
         supersedes_id=None) -> Solution:
    """Store one solution in the org it was solved in. Sync; index separately.

    `share` only means something with an org: a personal chat has no one to
    share with. `supersedes_id` must be a solution the author can see from the
    same org; the old one is marked superseded, not deleted.
    """
    fields = validate(draft)
    if org_id:
        from core.orgs import is_member

        if not is_member(user.id, org_id):
            raise SolutionError('You are not a member of that organisation.', 403)
    now = timezone.now()
    with transaction.atomic():
        solution = Solution.objects.create(
            org_id=org_id or None,
            shared=bool(share and org_id),
            author=user,
            author_name=_author_name(user),
            valid_as_of=now,
            captured_by=captured_by,
            source_session=str(source_session or '')[:64],
            source_message_id=source_message_id,
            **fields,
        )
        if supersedes_id:
            old = get_visible(user.id, org_id, supersedes_id)
            if old is None:
                raise SolutionError('No solution with that id to replace.', 404)
            if can_manage(user.id, old):
                Solution.objects.filter(id=old.id).update(status='superseded',
                                                          superseded_by=solution)
            else:
                # Anyone may *offer* a correction; only the author or an admin
                # may retire the original. Otherwise one member could hide a
                # colleague's fix behind their own. The old one stays findable,
                # flagged, pointing at the new one.
                Solution.objects.filter(id=old.id).update(status='needs_check',
                                                          superseded_by=solution)
                SolutionReview.objects.create(
                    solution=old, kind='contradicted', user=user,
                    reason=f'A colleague saved a corrected fix (solution {solution.id}).',
                )
    return solution


#: Kinds of review and whether a person can repeat them. `confirmed` and
#: `failed` count once per person per solution — a track record that one
#: enthusiastic user can inflate is not a track record.
REVIEW_KINDS = ('confirmed', 'failed', 'doubt', 'cleared', 'verified', 'contradicted')


def review(user, org_id, solution_id, kind: str, *, reason: str = '',
           model: str = '') -> Solution:
    """Record a judgement and apply it. Any reader may review; see REVIEW_KINDS."""
    if kind not in REVIEW_KINDS:
        raise SolutionError(f'kind must be one of {", ".join(REVIEW_KINDS)}.')
    reason = scrub(reason or '').strip()[:500]
    if kind in ('doubt', 'cleared', 'contradicted') and not reason:
        raise SolutionError('Say why — the next reader needs the reason, not just the flag.')
    if reason and instruction_shaped(reason):
        raise SolutionError('Not recorded: the reason reads as an instruction to an AI.')
    solution = get_visible(user.id, org_id, solution_id)
    if solution is None:
        raise SolutionError('No such solution.', 404)

    with transaction.atomic():
        if kind in ('confirmed', 'failed') and SolutionReview.objects.filter(
                solution=solution, user=user, kind=kind).exists():
            return solution
        SolutionReview.objects.create(solution=solution, kind=kind, user=user,
                                      model=(model or '')[:150], reason=reason)
        now = timezone.now()
        updates: dict = {}
        if kind == 'confirmed':
            updates = {'confirmations': F('confirmations') + 1, 'valid_as_of': now}
            if solution.status == 'needs_check':
                updates['status'] = 'active'
        elif kind == 'failed':
            updates = {'failures': F('failures') + 1}
            if solution.failures + 1 >= 2 and solution.failures + 1 > solution.confirmations:
                updates['status'] = 'needs_check'
        elif kind == 'doubt':
            updates = {'doubtful': True, 'doubt_reason': reason}
        elif kind == 'cleared':
            updates = {'doubtful': False, 'doubt_reason': ''}
        elif kind == 'verified':
            updates = {'valid_as_of': now, 'status': 'active'}
        elif kind == 'contradicted':
            updates = {'status': 'needs_check', 'doubtful': True, 'doubt_reason': reason}
        Solution.objects.filter(id=solution.id).update(**updates)
    solution.refresh_from_db()
    return solution


def set_shared(user, solution_id, org_id, shared: bool) -> Solution:
    solution = get_visible(user.id, org_id, solution_id)
    if solution is None:
        raise SolutionError('No such solution.', 404)
    if not can_manage(user.id, solution):
        raise SolutionError('Only the author or an org admin can change sharing.', 403)
    if shared and not solution.org_id:
        raise SolutionError('This solution was not solved in an organisation, '
                            'so there is no one to share it with.')
    Solution.objects.filter(id=solution.id).update(shared=bool(shared))
    solution.refresh_from_db()
    return solution


def edit(user, solution_id, org_id, draft: Draft) -> Solution:
    solution = get_visible(user.id, org_id, solution_id)
    if solution is None:
        raise SolutionError('No such solution.', 404)
    if not can_manage(user.id, solution):
        raise SolutionError('Only the author or an org admin can edit this.', 403)
    fields = validate(draft)
    Solution.objects.filter(id=solution.id).update(valid_as_of=timezone.now(), **fields)
    solution.refresh_from_db()
    return solution


def retract(user, solution_id, org_id, reason: str = '') -> None:
    solution = get_visible(user.id, org_id, solution_id, include_inactive=True)
    if solution is None:
        raise SolutionError('No such solution.', 404)
    if not can_manage(user.id, solution):
        raise SolutionError('Only the author or an org admin can retract this.', 403)
    Solution.objects.filter(id=solution.id).update(status='retracted')
    SolutionReview.objects.create(solution=solution, kind='contradicted', user=user,
                                  reason=scrub(reason or 'Retracted.')[:500])


async def aindex(solution_id: int) -> None:
    from .index import reindex

    await reindex(solution_id)
