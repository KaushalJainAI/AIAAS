"""
The one door: which solutions a person may see, from where.

Every reader — the search, the tools, the API, the capture job's dedupe —
starts from `visible(user_id, org_id)`. `test_isolation.py::ChokePointTests`
fails if `Solution.objects` is filtered anywhere else outside this app's
writers, because the org boundary is only as strong as its weakest query.

The rule, in words. From inside org X (a chat whose `org` is X):
  * the org's **shared** solutions — only while you are a member of X,
    checked live on every call;
  * your own **private** solutions **captured in X**.
From a personal chat (no org): only your private solutions with no org.

So nothing captured in one org is ever offered in another, even to the same
person — which is what stops a contractor carrying org A's fixes into org B.
"""
from __future__ import annotations

from django.db.models import Q, QuerySet

from core.orgs import is_manager, is_member

from .models import Solution

#: Statuses a search may return. Superseded rows are reached through their
#: replacement, and retracted ones are gone for everyone but an admin audit.
SEARCHABLE = ('active', 'needs_check')


def visible(user_id, org_id, *, include_inactive: bool = False) -> QuerySet:
    """Solutions this user may read from a context in `org_id` (None = personal)."""
    if not user_id:
        return Solution.objects.none()
    if org_id:
        rule = Q(author_id=user_id, shared=False, org_id=org_id)
        if is_member(user_id, org_id):
            rule |= Q(org_id=org_id, shared=True)
        else:
            # Not (or no longer) a member: not even your own private rows from
            # that org — they were captured from its conversations.
            return Solution.objects.none()
    else:
        rule = Q(author_id=user_id, shared=False, org__isnull=True)
    rows = Solution.objects.filter(rule)
    if not include_inactive:
        rows = rows.filter(status__in=SEARCHABLE)
    return rows


def get_visible(user_id, org_id, solution_id, *, include_inactive: bool = False):
    """One solution, or None. Foreign and unknown ids are indistinguishable."""
    try:
        solution_id = int(solution_id)
    except (TypeError, ValueError):
        return None
    return visible(user_id, org_id, include_inactive=include_inactive).filter(
        id=solution_id,
    ).first()


def can_manage(user_id, solution: Solution) -> bool:
    """May edit, retract or re-share: the author, or an org owner/admin.

    An author who has left the org loses this for its shared rows — those now
    belong to the org — but keeps it for their own private ones.
    """
    if solution.shared and solution.org_id:
        if not is_member(user_id, solution.org_id):
            return False
        return solution.author_id == user_id or is_manager(user_id, solution.org_id)
    return solution.author_id == user_id
