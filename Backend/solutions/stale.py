"""
The weekly nudge (K4.2): tell people which team solutions may be out of date.

Who is told what, per org:

* each **curator** gets one summary: how many shared solutions in the org need
  attention (they can see all of them);
* each other **member** gets one count, for the shared solutions they wrote;
* a **removed member** gets nothing about that org, because they have no
  membership to address.

Personal solutions (no org) are one count, to their author.

The same sweep also drops team search logs past their 90-day retention
(K5.1, `purge_search_logs`).

The same rule as the page's attention view (`attention.py`), so the number in
the notification is the number on the screen. Nobody is told twice in six
days: a digest records its scope (`org:<id>` or `personal`) and a new one is
not sent while a recent one with that scope exists.

Run by the in-process scheduler (`agents/scheduler.py::PERIODIC_JOBS`), the
Celery beat task `solutions.sweep_stale`, and `manage.py solutions_stale_sweep`.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone

from core.models import Membership, Organization
from core.orgs import CURATORS

from .access import sweep_rows
from .attention import attention_candidates, attention_reasons

logger = logging.getLogger(__name__)
User = get_user_model()

#: A person hears about one org's stale solutions at most this often.
DIGEST_GAP = timedelta(days=6)


def _recently_told(user_id: int, scope: str, now) -> bool:
    from notifications.models import Notification

    return Notification.objects.filter(
        user_id=user_id, data__kind='solution_stale_digest', data__scope=scope,
        created_at__gte=now - DIGEST_GAP,
    ).exists()


def _action_url(scope: str) -> str:
    """The attention list, opened in the digest's own org (`org:<id>`)."""
    from .api import page_link

    org_id = int(scope.split(':', 1)[1]) if scope.startswith('org:') else None
    return page_link(org_id, tab='library', attention=1)


def _tell(user, scope: str, count: int, org_name: str | None, now) -> bool:
    """One digest, unless one with this scope went out recently. True if sent."""
    from notifications.utils import create_notification

    if _recently_told(user.id, scope, now):
        return False
    where = f'{org_name}: ' if org_name else ''
    create_notification(
        user, 'system',
        f'{where}team solutions to check' if org_name else 'Your solutions to check',
        f'{count} of your {"team " if org_name else ""}solutions may be out of date. '
        'Check them, and say whether each one is still true.',
        data={'kind': 'solution_stale_digest', 'scope': scope, 'count': count,
              'action_url': _action_url(scope)},
        send_email=False,
    )
    return True


#: How long a logged search is kept for the insight page (K5.1).
SEARCH_LOG_RETENTION = timedelta(days=90)


def purge_search_logs(now=None) -> int:
    """Delete team search-log rows older than `SEARCH_LOG_RETENTION`. Returns
    how many. Runs inside the weekly sweep, so a row may live up to a week past
    the window."""
    from .models import SolutionSearchLog

    now = now or timezone.now()
    deleted, _ = SolutionSearchLog.objects.filter(
        created_at__lt=now - SEARCH_LOG_RETENTION,
    ).delete()
    return deleted


def run_stale_sweep(now=None) -> dict:
    """Send this week's digests, and drop search logs past their retention.
    Returns counts for the log."""
    now = now or timezone.now()
    logs_purged = purge_search_logs(now)
    flagged = [s for s in attention_candidates(sweep_rows(), now)
               if attention_reasons(s, now)]

    by_org: dict[int, list] = defaultdict(list)
    personal: dict[int, list] = defaultdict(list)
    for solution in flagged:
        if solution.org_id:
            by_org[solution.org_id].append(solution)
        else:
            personal[solution.author_id].append(solution)

    sent = skipped = 0
    for org_id, rows in by_org.items():
        org = Organization.objects.filter(id=org_id).first()
        if org is None:
            continue
        for membership in Membership.objects.filter(org_id=org_id).select_related('user'):
            if membership.role in CURATORS:
                count = len(rows)
            else:
                count = sum(1 for s in rows if s.author_id == membership.user_id)
            if not count:
                continue
            if _tell(membership.user, f'org:{org_id}', count, org.name, now):
                sent += 1
            else:
                skipped += 1

    for author_id, rows in personal.items():
        if author_id is None:
            continue
        user = User.objects.filter(id=author_id).first()
        if user is None:
            continue
        if _tell(user, 'personal', len(rows), None, now):
            sent += 1
        else:
            skipped += 1

    result = {'orgs': len(by_org), 'notified': sent, 'skipped_recent': skipped,
              'flagged': len(flagged), 'search_logs_purged': logs_purged}
    logger.info('[Solutions] stale sweep: %s', result)
    return result
