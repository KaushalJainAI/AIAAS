"""
After a mission run ends: decide done / waiting / next run / paused.

A run ends; `after_run` decides: the agent called
`complete_mission(summary)` with all todos done -> done; the agent called
`wait_for(event, filter, timeout)` -> waiting; open todos, budget left,
under max_runs -> next run now; budget, deadline or max_runs exhausted ->
paused, and the user is notified with what is left.

Safety: max_runs (default 20), budget_inr (required), deadline (default 7
days), and a no-progress detector (three consecutive runs with no todo
change and no new file -> pause and ask the user).
"""
from __future__ import annotations

import logging
from datetime import timedelta

from django.utils import timezone

logger = logging.getLogger(__name__)

#: Consecutive runs with no todo change and no new file before pausing.
NO_PROGRESS_RUNS = 3


def after_run(mission, run_result: dict) -> str:
    """Decide the mission's next state after one run. Returns the new status."""
    from missions.models import Mission

    mission.runs_done = (mission.runs_done or 0) + 1
    mission.spent_inr = (mission.spent_inr or 0) + int(run_result.get('spend_inr') or 0)
    todos = run_result.get('todos') or []
    mission.plan = todos

    if run_result.get('completed'):
        mission.status = 'done'
        mission.last_report = str(run_result.get('summary') or '')[:2000]
        mission.save(update_fields=[
            'runs_done', 'spent_inr', 'plan', 'status', 'last_report',
            'updated_at'])
        return 'done'

    if run_result.get('wait_for'):
        mission.wait_for = run_result['wait_for'] or {}
        timeout = run_result.get('wait_timeout_s') or 86400
        mission.status = 'waiting'
        mission.next_wake_at = timezone.now() + timedelta(seconds=timeout)
        mission.save(update_fields=[
            'runs_done', 'spent_inr', 'plan', 'status', 'wait_for',
            'next_wake_at', 'updated_at'])
        return 'waiting'

    open_todos = [t for t in todos
                  if str(t.get('status') or 'open').lower() not in ('done', 'blocked')]
    exhausted = (
        (mission.runs_done or 0) >= (mission.max_runs or 20)
        or (mission.budget_inr and mission.spent_inr >= mission.budget_inr)
        or (mission.deadline and timezone.now() > mission.deadline)
    )
    if not open_todos and not run_result.get('wait_for'):
        mission.status = 'done'
        mission.save(update_fields=[
            'runs_done', 'spent_inr', 'plan', 'status', 'updated_at'])
        return 'done'
    if exhausted:
        mission.status = 'paused'
        mission.save(update_fields=[
            'runs_done', 'spent_inr', 'plan', 'status', 'updated_at'])
        try:
            _notify(mission, 'Mission paused',
                    'Budget, deadline or run limit reached with work left.')
        except Exception:  # noqa: BLE001
            pass
        return 'paused'

    no_progress = int(run_result.get('no_progress_streak') or 0)
    mission.no_progress_runs = no_progress
    if no_progress >= NO_PROGRESS_RUNS:
        mission.status = 'paused'
        mission.save(update_fields=[
            'runs_done', 'spent_inr', 'plan', 'status', 'no_progress_runs',
            'updated_at'])
        try:
            _notify(mission, 'Mission paused',
                    f'{NO_PROGRESS_RUNS} runs in a row made no progress. '
                    'Check the plan, then resume it.')
        except Exception:  # noqa: BLE001
            pass
        return 'paused'

    mission.status = 'active'
    mission.next_wake_at = timezone.now()
    mission.wait_for = {}
    mission.save(update_fields=[
        'runs_done', 'spent_inr', 'plan', 'status', 'next_wake_at',
        'wait_for', 'no_progress_runs', 'updated_at'])
    return 'active'


#: How long a mission waits before retrying after a run failed.
FAILED_RUN_BACKOFF = timedelta(minutes=10)


def after_failed_run(mission, spend_inr: int, error: str) -> str:
    """A run ended failed or timed out: count it, then retry later or pause.

    Not `after_run`: a failed run's empty plan would read as "no open todos",
    which `after_run` treats as done — a mission would be marked finished by
    the first provider outage. A failure counts as a run with no progress, so
    three in a row pause the mission and tell the owner why.
    """
    mission.runs_done = (mission.runs_done or 0) + 1
    mission.spent_inr = (mission.spent_inr or 0) + int(spend_inr or 0)
    mission.no_progress_runs = (mission.no_progress_runs or 0) + 1
    mission.last_report = f'Last run failed: {error}'[:2000]
    exhausted = (
        (mission.runs_done or 0) >= (mission.max_runs or 20)
        or (mission.budget_inr and mission.spent_inr >= mission.budget_inr)
        or (mission.deadline and timezone.now() > mission.deadline)
        or mission.no_progress_runs >= NO_PROGRESS_RUNS
    )
    if exhausted:
        mission.status = 'paused'
        mission.next_wake_at = None
    else:
        mission.status = 'active'
        mission.next_wake_at = timezone.now() + FAILED_RUN_BACKOFF
    mission.save(update_fields=[
        'runs_done', 'spent_inr', 'no_progress_runs', 'last_report', 'status',
        'next_wake_at', 'updated_at'])
    if exhausted:
        try:
            _notify(mission, 'Mission paused', mission.last_report)
        except Exception:  # noqa: BLE001
            pass
    return mission.status


def _notify(mission, title: str, message: str) -> None:
    from notifications.utils import create_notification

    create_notification(mission.user, 'mission_update', title, message,
                        data={'mission_id': mission.id}, send_email=False)
