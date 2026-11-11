"""
The team's insight page (K5.2): what the org searched for, what it found, and
what it has, for its curators. The last 30 days.

Every figure is a count, or a shared solution the curator already sees on the
library page. Nothing names who searched. The search log keeps the user only
for its 90-day retention window (`stale.py`), and this module never reads that
column out.

Solutions are read through `access.visible`, like every other reader (rule 1).
The search log is not a solution, so it is read here directly. The caller is
checked (member, then curator) in the view, before this runs.
"""
from __future__ import annotations

from datetime import timedelta

from django.db.models import Count, Max
from django.db.models.functions import Lower, Trim
from django.utils import timezone

from .access import visible
from .attention import ATTENTION_LOAD, attention_candidates, attention_reasons
from .models import SolutionSearchLog

#: The window every figure on the page covers.
WINDOW = timedelta(days=30)
#: How many rows each list shows.
TOP = 10
#: Shown for a contributor whose author has since left the team (the same
#: words `search.present` uses for `solved_by`).
FORMER_MEMBER = 'a former member'


def _needs_attention(user_id, org_id, now) -> int:
    """Shared rows the attention predicate flags (K4.1). Judged over at most
    `ATTENTION_LOAD` rows, the same cap the library's attention view uses, so a
    very large library is a lower bound rather than a slow page."""
    rows = visible(user_id, org_id).filter(shared=True)
    loaded = list(attention_candidates(rows, now).order_by('valid_as_of', 'id')
                  [:ATTENTION_LOAD])
    return sum(1 for solution in loaded if attention_reasons(solution, now))


def _top_used(user_id, org_id, since) -> list[dict]:
    """The solutions chat answers leaned on most. Ids are counted first and the
    top ten taken; then the problems are loaded through `visible`, so a solution
    retracted or superseded since is dropped rather than shown."""
    counted = list(
        SolutionSearchLog.objects
        .filter(org_id=org_id, created_at__gte=since, source='chat',
                top_solution_id__isnull=False)
        .values('top_solution_id')
        .annotate(n=Count('id'))
        .order_by('-n', '-top_solution_id')[:TOP]
    )
    if not counted:
        return []
    shown = {s.id: s.problem for s in
             visible(user_id, org_id).filter(id__in=[r['top_solution_id'] for r in counted])}
    return [{'id': r['top_solution_id'], 'problem': shown[r['top_solution_id']],
             'uses': r['n']}
            for r in counted if r['top_solution_id'] in shown]


def _gaps(org_id, since) -> list[dict]:
    """Chat questions the org had no answer for, grouped on the normalised text.
    Only the query and its counts: never who asked."""
    rows = (
        SolutionSearchLog.objects
        .filter(org_id=org_id, created_at__gte=since, source='chat', result_count=0)
        .annotate(norm=Lower(Trim('query')))
        .values('norm')
        .annotate(n=Count('id'), last=Max('created_at'))
        .order_by('-n', '-last')[:TOP]
    )
    return [{'query': r['norm'], 'times': r['n'], 'last_asked': r['last'].isoformat()}
            for r in rows]


def _contributors(user_id, org_id, since) -> list[dict]:
    """Who shared the most active solutions in the window, by the name they were
    saved under."""
    rows = (
        visible(user_id, org_id)
        .filter(shared=True, created_at__gte=since)
        .values('author_name')
        .annotate(n=Count('id'))
        .order_by('-n', 'author_name')[:TOP]
    )
    return [{'name': r['author_name'] or FORMER_MEMBER, 'count': r['n']} for r in rows]


def summary(user_id, org_id, *, now=None) -> dict:
    """The insight page's payload. The caller must already be a curator of
    `org_id`; this function does not re-check it."""
    now = now or timezone.now()
    since = now - WINDOW

    # Questions people asked the assistant, not browsing on the page: the
    # tiles answer "how often did team knowledge answer someone".
    logs = SolutionSearchLog.objects.filter(org_id=org_id, created_at__gte=since,
                                            source='chat')
    searches = logs.count()
    answered = logs.filter(result_count__gt=0).count()

    shared = visible(user_id, org_id).filter(shared=True)
    queue = visible(user_id, org_id, include_inactive=True)

    return {
        'searches': searches,
        'answered': answered,
        'unanswered': searches - answered,
        'solutions': {
            'active': shared.count(),
            'needs_attention': _needs_attention(user_id, org_id, now),
            # Drafts are private: only the caller's own are counted, never the
            # org's, since nobody else's unshared text is theirs to know about.
            'drafts': queue.filter(status='draft', author_id=user_id).count(),
            'pending_review': queue.filter(status='pending_review').count(),
        },
        'contributors': _contributors(user_id, org_id, since),
        'top_used': _top_used(user_id, org_id, since),
        'gaps': _gaps(org_id, since),
    }
