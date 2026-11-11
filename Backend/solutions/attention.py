"""
"Needs attention" (K4.1): which solutions a person should look at again.

One predicate, `attention_reasons`, decides it, and both the library's
attention view and the weekly stale sweep (`stale.py`) call it, so the page
and the nudge cannot disagree about what counts. A solution needs attention
when any of these holds:

* its status is `needs_check` (a second failure, or a contradicting re-check);
* a person or a model doubted it (`doubtful`);
* one of its claims is past its freshness window (`freshness.claim_state`).

Reading goes through `access.visible`, like every other reader. Which rows a
viewer may see is decided there; this module only narrows them to the ones
that want attention.
"""
from __future__ import annotations

from datetime import timedelta

from django.db.models import Q, QuerySet
from django.utils import timezone

from core.orgs import is_curator

from . import freshness
from .access import visible

#: Most rows an attention view loads before it judges them. Past this the
#: response says `truncated`, because a silently partial list reads as complete.
ATTENTION_LOAD = 500

#: The shortest finite freshness window in `freshness.KINDS` (time_sensitive).
#: A row older than this *may* have a stale claim, so the database can narrow to
#: it before Python checks each claim. Kept in step with KINDS by a test.
SHORTEST_WINDOW = timedelta(days=30)


def attention_reasons(solution, now=None) -> list[str]:
    """Why this solution needs attention, as a list of short words. Empty = it
    does not."""
    reasons = []
    if solution.status == 'needs_check':
        reasons.append('needs_check')
    if solution.doubtful:
        reasons.append('doubtful')
    if any(freshness.claim_state(c.get('kind'), solution.valid_as_of, now=now) == 'check'
           for c in solution.claims or []):
        reasons.append('claims_stale')
    return reasons


def attention_candidates(rows: QuerySet, now=None) -> QuerySet:
    """Narrow `rows` to the ones `attention_reasons` could flag. A superset:
    every flagged row is in it, so the Python check after it is exact.

    `ephemeral` claims would be stale the moment they are stored, but the write
    path drops them (`api._clean_claims`), so no stored claim can need this.
    """
    now = now or timezone.now()
    return rows.filter(
        Q(status='needs_check') | Q(doubtful=True)
        | Q(valid_as_of__lt=now - SHORTEST_WINDOW)
    )


def attention_order(solution) -> tuple:
    """needs_check first, then doubtful, then the oldest `valid_as_of`."""
    return (solution.status != 'needs_check',
            not solution.doubtful,
            solution.valid_as_of)


def attention_for(user_id, org_id, *, now=None) -> tuple[list, bool]:
    """The rows this viewer should look at again, most urgent first, and
    whether the list was cut short.

    A curator sees every shared row plus their own private ones; anyone else
    sees only what they authored. Both come from `visible`, so nothing outside
    the viewer's org is reachable here.
    """
    now = now or timezone.now()
    base = (visible(user_id, org_id, include_inactive=True)
            .filter(status__in=('active', 'needs_check')))
    if not (org_id and is_curator(user_id, org_id)):
        base = base.filter(author_id=user_id)
    loaded = list(attention_candidates(base, now).order_by('valid_as_of', 'id')
                  [:ATTENTION_LOAD + 1])
    truncated = len(loaded) > ATTENTION_LOAD
    flagged = [s for s in loaded[:ATTENTION_LOAD] if attention_reasons(s, now)]
    flagged.sort(key=attention_order)
    return flagged, truncated
