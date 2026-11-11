"""
The public surface of `solutions/`: save, review, publish, share, retract.

Other apps (the chat tools, the capture job, the views) import this module,
not the models, so every write passes the same guards:

* **no secrets or contact details** — scrubbed before anything is stored,
  because a shared record is read by the whole org;
* **no instructions** — a "fix" that addresses an AI is a poisoning attempt,
  refused like `remember_about_user` refuses one;
* **no momentary facts** — `ephemeral` claims ("the outage is ongoing") are
  dropped, and a record made only of them is not saved;
* **the org is fixed** — taken from where the problem was solved and never
  changed;
* **nothing reaches the team unchosen** — where a new row starts is decided in
  one place, `starting_state`, from who saved it and the org's settings.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone

from core.models import Organization
from core.orgs import CURATORS, is_curator
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

#: The `solution_draft.resolved` values the chat card can show (K2.7).
RESOLVED_SHARED = 'shared'
RESOLVED_WAITING = 'waiting_review'
RESOLVED_PRIVATE = 'kept_private'
RESOLVED_DISCARDED = 'discarded'
RESOLVED_RETURNED = 'returned'


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


# ── Where a new solution starts ─────────────────────────────────────────────

def starting_state(org, *, captured_by: str, share: bool) -> tuple[str, bool]:
    """(status, shared) for a new solution.

    | who saved it            | org.capture_mode | share | review_policy | → status        | shared |
    |-------------------------|------------------|-------|---------------|-----------------|--------|
    | import (any)            | —                | —     | —             | draft           | False  |
    | personal chat (no org)  | —                | —     | —             | active          | False  |
    | auto / tool             | suggest          | any   | any           | draft           | False  |
    | auto / tool             | auto             | False | any           | active          | False  |
    | auto / tool             | auto             | True  | open          | active          | True   |
    | auto / tool             | auto             | True  | curated       | pending_review  | True   |
    | user (a person clicked) | any              | False | any           | active          | False  |
    | user                    | any              | True  | open          | active          | True   |
    | user                    | any              | True  | curated       | pending_review  | True   |

    `org` is the org the problem was solved in, or None for a personal chat.
    A draft is never shared; `share_requested` on the row records the switch.
    `import` is a draft whatever the org is, because a document is never
    treated as a finished fix until its author has looked at it.
    """
    if captured_by == 'import':
        return 'draft', False
    if org is None:
        return 'active', False
    if captured_by in ('auto', 'tool') and org.capture_mode == 'suggest':
        return 'draft', False
    if not share:
        return 'active', False
    if org.review_policy == 'curated':
        return 'pending_review', True
    return 'active', True


# ── Writes ──────────────────────────────────────────────────────────────────

def save(user, *, org_id, share: bool, draft: Draft, captured_by: str = 'tool',
         source_session: str = '', source_message_id=None,
         supersedes_id=None) -> Solution:
    """Store one solution in the org it was solved in. Sync; index separately.

    The starting state comes from `starting_state`. `share` only means
    something with an org: a personal chat has no one to share with.
    `supersedes_id` must be a solution the author can see from the same org.
    The old one is retired when the new one goes live, not before (see
    `_apply_replacement`), so a correction saved as a draft changes nothing
    for the team until it is shared.
    """
    fields = validate(draft)
    org = None
    if org_id:
        from core.orgs import is_member

        if not is_member(user.id, org_id):
            raise SolutionError('You are not a member of that organisation.', 403)
        org = Organization.objects.filter(id=org_id).first()
        if org is None:
            raise SolutionError('You are not a member of that organisation.', 403)
    status, shared = starting_state(org, captured_by=captured_by, share=share)
    replaced = None
    if supersedes_id:
        replaced = get_visible(user.id, org_id, supersedes_id)
        if replaced is None:
            raise SolutionError('No solution with that id to replace.', 404)
    try:
        with transaction.atomic():
            solution = Solution.objects.create(
                org_id=org_id or None,
                shared=shared,
                status=status,
                share_requested=bool(share) and status == 'draft',
                replaces_id=replaced.id if replaced else None,
                author=user,
                author_name=_author_name(user),
                valid_as_of=timezone.now(),
                captured_by=captured_by,
                source_session=str(source_session or '')[:64],
                source_message_id=source_message_id,
                **fields,
            )
            if status == 'active':
                _apply_replacement(solution, user.id)
    except IntegrityError:
        # The unique constraint on source_message_id: a second worker (or a
        # retry) saved this same answer first. Any other integrity failure is
        # a bug and is re-raised.
        if source_message_id is None:
            raise
        raise SolutionError('Already saved from this answer.', 409) from None
    if status == 'pending_review':
        _ask_curators(solution)
    solution.refresh_from_db()
    return solution


def _apply_replacement(solution: Solution, actor_id) -> None:
    """The row is live now: retire the fix it replaces, if it names one.

    The author of an old fix keeps the right to retire it; anyone else's
    correction only flags it (`needs_check`), so one member cannot hide a
    colleague's fix behind their own. The old row stays findable either way.
    Clears `replaces`, so the replacement is applied once.
    """
    if not solution.replaces_id:
        return
    target_id = solution.replaces_id
    Solution.objects.filter(id=solution.id).update(replaces=None)
    old = Solution.objects.filter(id=target_id).first()
    if old is None or old.status == 'retracted':
        return
    if actor_id and can_manage(actor_id, old):
        Solution.objects.filter(id=old.id).update(status='superseded', superseded_by=solution)
    else:
        Solution.objects.filter(id=old.id).update(status='needs_check', superseded_by=solution)
        SolutionReview.objects.create(
            solution=old, kind='contradicted', user_id=actor_id,
            reason=f'A colleague saved a corrected fix (solution {solution.id}).',
        )


#: Kinds of review and whether a person can repeat them. `confirmed` and
#: `failed` count once per person per solution — a track record that one
#: enthusiastic user can inflate is not a track record.
REVIEW_KINDS = ('confirmed', 'failed', 'doubt', 'cleared', 'verified', 'contradicted', 'edited')


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
    """Share or stop sharing a saved solution.

    Sharing in a curated org sends it to `pending_review` instead of the team.
    Withdrawing a share that is waiting for review returns it to the author's
    own library. A draft is not shared this way: it is published (`publish`).
    """
    solution = get_visible(user.id, org_id, solution_id, include_inactive=True)
    if solution is None or solution.status in ('retracted', 'superseded'):
        raise SolutionError('No such solution.', 404)
    if solution.status == 'draft':
        raise SolutionError('Publish the draft first: it is not shared until you choose.', 400)
    if not can_manage(user.id, solution):
        raise SolutionError('Only the author or an org curator can change sharing.', 403)
    if shared and not solution.org_id:
        raise SolutionError('This solution was not solved in an organisation, '
                            'so there is no one to share it with.')
    if shared:
        if solution.shared:
            return solution
        state, _ = starting_state(solution.org, captured_by='user', share=True)
        if state == 'pending_review' and solution.status in ('active', 'needs_check'):
            Solution.objects.filter(id=solution.id).update(shared=True, status='pending_review')
            solution.refresh_from_db()
            _ask_curators(solution)
            return solution
        Solution.objects.filter(id=solution.id).update(shared=True)
    elif solution.status == 'pending_review':
        Solution.objects.filter(id=solution.id).update(shared=False, status='active')
        solution.refresh_from_db()
        _apply_replacement(solution, user.id)
    else:
        Solution.objects.filter(id=solution.id).update(shared=False)
    solution.refresh_from_db()
    return solution


def edit(user, solution_id, org_id, draft: Draft, *, verified: bool = False) -> Solution:
    """Change a solution's text. Freshness is kept unless the editor says they
    checked it (`verified`): fixing a typo must not make a two-year-old claim
    look freshly confirmed. Every change leaves an `edited` review row.

    Drafts and rows waiting for review can be edited by their author (and a
    curator, for a row waiting for review) before they are published."""
    solution = get_visible(user.id, org_id, solution_id, include_inactive=True)
    if solution is None or solution.status in ('retracted', 'superseded'):
        raise SolutionError('No such solution.', 404)
    if not can_manage(user.id, solution):
        raise SolutionError('Only the author or an org curator can edit this.', 403)
    fields = validate(draft)
    changed = sorted(k for k, v in fields.items() if getattr(solution, k) != v)
    if not changed and not verified:
        return solution
    with transaction.atomic():
        if verified:
            fields['valid_as_of'] = timezone.now()
            if solution.status == 'needs_check':
                fields['status'] = 'active'
        Solution.objects.filter(id=solution.id).update(**fields)
        if changed:
            reason = 'Changed: ' + ', '.join(changed)
            if verified:
                reason += '; checked as still true'
            SolutionReview.objects.create(solution=solution, kind='edited', user=user,
                                          reason=reason[:500])
        else:
            # The text is the same, so the only news is the re-check itself.
            SolutionReview.objects.create(solution=solution, kind='verified', user=user,
                                          reason='Checked as still true (text unchanged).')
    solution.refresh_from_db()
    return solution


def retract(user, solution_id, org_id, reason: str = '') -> None:
    solution = get_visible(user.id, org_id, solution_id, include_inactive=True)
    if solution is None:
        raise SolutionError('No such solution.', 404)
    if not can_manage(user.id, solution):
        raise SolutionError('Only the author or an org curator can retract this.', 403)
    was_draft = solution.status == 'draft'
    Solution.objects.filter(id=solution.id).update(status='retracted')
    SolutionReview.objects.create(solution=solution, kind='contradicted', user=user,
                                  reason=scrub(reason or 'Retracted.')[:500])
    if was_draft:
        _resolve_card(solution, RESOLVED_DISCARDED)


# ── Drafts and review (K2.4) ────────────────────────────────────────────────

def publish(user, solution_id, org_id, *, share: bool) -> Solution:
    """The author turns a draft into a real entry: private, shared, or — in a
    curated org — waiting for a curator. Only the author sees a draft, so
    anyone else gets the same 404 as for an unknown id."""
    solution = get_visible(user.id, org_id, solution_id, include_inactive=True)
    if solution is None or solution.author_id != user.id:
        raise SolutionError('No such solution.', 404)
    if solution.status != 'draft':
        raise SolutionError('Only a draft can be published.', 400)
    status, shared = starting_state(solution.org, captured_by='user', share=bool(share))
    with transaction.atomic():
        Solution.objects.filter(id=solution.id).update(status=status, shared=shared)
        SolutionReview.objects.create(solution=solution, kind='edited', user=user,
                                      reason='Published from a draft')
        if status == 'active':
            solution.refresh_from_db()
            _apply_replacement(solution, user.id)
    solution.refresh_from_db()
    if status == 'pending_review':
        _ask_curators(solution)
        outcome = RESOLVED_WAITING
    else:
        outcome = RESOLVED_SHARED if shared else RESOLVED_PRIVATE
    _resolve_card(solution, outcome)
    return solution


def discard(user, solution_id, org_id) -> Solution:
    """The author drops a draft. The row is kept (retracted), so the chat answer
    it came from stays captured and is not offered again."""
    solution = get_visible(user.id, org_id, solution_id, include_inactive=True)
    if solution is None or solution.author_id != user.id:
        raise SolutionError('No such solution.', 404)
    if solution.status != 'draft':
        raise SolutionError('Only a draft can be discarded.', 400)
    Solution.objects.filter(id=solution.id).update(status='retracted')
    solution.refresh_from_db()
    _resolve_card(solution, RESOLVED_DISCARDED)
    return solution


def approve(user, solution_id, org_id) -> Solution:
    """A curator lets a waiting solution into the library."""
    solution = get_visible(user.id, org_id, solution_id, include_inactive=True)
    if solution is None:
        raise SolutionError('No such solution.', 404)
    if not is_curator(user.id, solution.org_id):
        raise SolutionError('Only a curator can approve a solution.', 403)
    if solution.status != 'pending_review':
        raise SolutionError('Only a solution waiting for review can be approved.', 400)
    with transaction.atomic():
        Solution.objects.filter(id=solution.id).update(status='active')
        SolutionReview.objects.create(solution=solution, kind='cleared', user=user,
                                      reason='Approved for the team')
        solution.refresh_from_db()
        _apply_replacement(solution, user.id)
    solution.refresh_from_db()
    _notify_author(solution, 'Approved for the team',
                   f'A curator approved "{solution.problem[:120]}". Your team can see it now.')
    _resolve_card(solution, RESOLVED_SHARED)
    return solution


def send_back(user, solution_id, org_id, reason: str) -> Solution:
    """A curator returns a waiting solution to its author. It becomes the
    author's private fix again; the reason is required and goes to the author."""
    solution = get_visible(user.id, org_id, solution_id, include_inactive=True)
    if solution is None:
        raise SolutionError('No such solution.', 404)
    if not is_curator(user.id, solution.org_id):
        raise SolutionError('Only a curator can send a solution back.', 403)
    if solution.status != 'pending_review':
        raise SolutionError('Only a solution waiting for review can be sent back.', 400)
    reason = scrub(reason or '').strip()[:500]
    if not reason:
        raise SolutionError('Say why it is sent back; the author needs the reason.')
    if instruction_shaped(reason):
        raise SolutionError('Not recorded: the reason reads as an instruction to an AI.')
    with transaction.atomic():
        Solution.objects.filter(id=solution.id).update(
            status='active', shared=False, doubtful=True, doubt_reason=reason,
        )
        SolutionReview.objects.create(solution=solution, kind='doubt', user=user, reason=reason)
    solution.refresh_from_db()
    _notify_author(solution, 'Sent back to you',
                   f'A curator sent "{solution.problem[:120]}" back: {reason} It is still your '
                   'private fix. Change it and share it again when it is ready.')
    _resolve_card(solution, RESOLVED_RETURNED)
    return solution


# ── Notifications and the chat card ─────────────────────────────────────────

def _ask_curators(solution: Solution) -> None:
    """One queue notification per curator. A curator who already has an unread
    one for this org is not sent another: the queue is one place, not a stack."""
    from notifications.models import Notification
    from notifications.utils import create_notification

    if not solution.org_id:
        return
    from core.models import Membership

    org_id = solution.org_id
    memberships = (Membership.objects.filter(org_id=org_id, role__in=CURATORS)
                   .select_related('user'))
    for membership in memberships:
        pending = Notification.objects.filter(
            user_id=membership.user_id, is_read=False,
            data__kind='solution_review_queue', data__org_id=org_id,
        ).exists()
        if pending:
            continue
        create_notification(
            membership.user, 'system', 'Solutions waiting for review',
            f'"{solution.problem[:120]}" is waiting for a curator before your team can see '
            'it. Open the review queue to approve it or send it back.',
            data={'kind': 'solution_review_queue', 'org_id': org_id,
                  'action_url': page_link(org_id, tab='queue')},
            send_email=False,
        )


def page_link(org_id, **params) -> str:
    """A link into the Team knowledge page, scoped to the org the row lives in.

    The page otherwise opens in the reader's *selected* org, so a notification
    about org B read while A is selected would show "not available".
    """
    from urllib.parse import urlencode

    params['org'] = org_id or 'personal'
    return '/solutions?' + urlencode(params)


def _notify_author(solution: Solution, title: str, message: str) -> None:
    from notifications.utils import create_notification

    if solution.author_id is None:
        return
    create_notification(solution.author, 'system', title, message,
                        data={'action_url': page_link(solution.org_id, id=solution.id)},
                        send_email=False)


def _resolve_card(solution: Solution, outcome: str) -> None:
    """Record on the chat answer the draft came from what became of it, so the
    card in the transcript shows the outcome and does not offer the buttons
    again. Only the author's own chat is touched; a row with no source message
    (saved by a tool or a document) has no card."""
    if not solution.source_message_id or not solution.author_id:
        return
    from chat.models import ChatMessage

    message = (ChatMessage.objects
               .filter(id=solution.source_message_id, session__user_id=solution.author_id)
               .first())
    if message is None:
        return
    metadata = dict(message.metadata or {})
    card = metadata.get('solution_draft')
    if not isinstance(card, dict) or card.get('id') != solution.id:
        return
    metadata['solution_draft'] = {**card, 'resolved': outcome}
    ChatMessage.objects.filter(id=message.id).update(metadata=metadata)


async def aindex(solution_id: int) -> None:
    from .index import reindex

    await reindex(solution_id)
