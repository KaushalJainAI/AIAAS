"""
The mission sweep: settle finished runs, then start the ones that are due.

A mission is a chain of ordinary runs. Each sweep does two things:

1. **Settle.** A mission with `current_execution_id` set has a run out. If
   that run has ended, read it back (plan, `complete_mission`, `wait_for`,
   spend) and let `service.after_run` decide the next step. A paused run (it
   asked a question or needs approval) is left alone until someone answers —
   the resumed run keeps its execution id, so it is settled here once it ends.
2. **Launch.** A mission whose `next_wake_at` has passed gets its next run,
   started **detached** (`start_agent_run`), so the sweep never waits for it.

Detached is what lets this run inside the web server's scheduler loop
(`agents/scheduler.py::PERIODIC_JOBS`). It used to wait for each run with
`start_agent_run_and_wait` — up to two hours on a web-server thread — so it
ran nowhere in production and a mission never advanced.

Three entry points: the scheduler loop (`sweep()`, detached), and the Celery
beat task `missions.sweep_missions` and `manage.py run_missions`
(`run_mission_sweep()`, which waits, because a spawn on a temporary event loop
dies with it — see `runtime.start_agent_run_and_wait`). Mission runs are
unattended (`caller='mission'`), so the agent needs `allow_unattended`.
"""
from __future__ import annotations

import logging
from datetime import timedelta

from asgiref.sync import sync_to_async
from django.utils import timezone

logger = logging.getLogger(__name__)

#: Run statuses that mean the run is over and can be read back.
FINISHED = ('completed', 'failed', 'timeout', 'cancelled')

#: A launch claims its mission with this placeholder before the run exists.
#: If the process dies in between, the claim is dropped after this long.
STARTING = 'starting'
STALE_CLAIM = timedelta(minutes=10)


def due_missions(now=None):
    from missions.models import Mission

    now = now or timezone.now()
    return (
        Mission.objects
        .filter(status__in=('active', 'waiting'), current_execution_id='')
        .filter(next_wake_at__isnull=False, next_wake_at__lte=now)
        .select_related('agent', 'user')
    )


def goal_for(mission) -> str:
    """The goal one run of the chain is given: the mission, its plan so far,
    and how to hand control back. Each run starts from zero, so everything it
    needs to continue has to be in here or in the notebook."""
    lines = [mission.goal.strip(), '',
             f'This run is step {(mission.runs_done or 0) + 1} of mission '
             f'#{mission.id} (at most {mission.max_runs or 20} runs).']
    plan = [t for t in (mission.plan or []) if isinstance(t, dict)]
    if plan:
        lines.append('The plan so far:')
        for item in plan[:30]:
            status = str(item.get('status') or 'open')
            lines.append(f'- [{status}] {str(item.get("text") or item.get("title") or "")[:200]}')
    if mission.last_report:
        lines.append(f'Last report: {mission.last_report[:500]}')
    lines += [
        '',
        'Keep the plan current with update_todos. Call complete_mission with '
        'a summary when the goal is met, or wait_for to pause until something '
        'happens. Use report_progress to leave a note for the owner.',
    ]
    return '\n'.join(lines)


def _run_result(mission, log) -> dict:
    """What `service.after_run` needs, read from a finished run."""
    from agents.spend import aggregate_rupees
    from logs.models import ExecutionLog

    output = log.output_data or {}
    trace = output.get('tool_trace') or []
    result: dict = {
        'todos': output.get('todos') or list(mission.plan or []),
        'spend_inr': aggregate_rupees(ExecutionLog.objects.filter(pk=log.pk)),
    }
    for call in trace:
        name = call.get('tool') or call.get('name')
        args = call.get('args') or {}
        if name == 'complete_mission' and str(args.get('summary') or '').strip():
            result['completed'] = True
            result['summary'] = str(args['summary']).strip()
        elif name == 'wait_for' and str(args.get('event') or '').strip():
            result['wait_for'] = {'event': str(args['event']).strip(),
                                  'filter': args.get('filter') or {}}
            result['wait_timeout_s'] = int(args.get('timeout') or 86400)
    progressed = (
        result['todos'] != list(mission.plan or [])
        or bool(output.get('files'))
        or result.get('completed') or result.get('wait_for')
    )
    result['no_progress_streak'] = 0 if progressed else (mission.no_progress_runs or 0) + 1
    return result


def settle(mission) -> str:
    """Read back the mission's finished run, if it has one. Returns what
    happened: 'running' (still out), or the mission's new status."""
    from agents.spend import aggregate_rupees
    from logs.models import ExecutionLog
    from missions import service

    execution_id = mission.current_execution_id
    if execution_id == STARTING:
        if timezone.now() - mission.updated_at < STALE_CLAIM:
            return 'running'
        log = None
    else:
        log = ExecutionLog.objects.filter(execution_id=execution_id).first()
    if log is not None and log.status not in FINISHED:
        return 'running'

    mission.current_execution_id = ''
    mission.save(update_fields=['current_execution_id', 'updated_at'])
    if mission.status not in ('active', 'waiting'):
        # Paused or cancelled by the owner while the run was out: count the
        # run and its spend, and leave the status they chose.
        if log is not None:
            mission.runs_done = (mission.runs_done or 0) + 1
            mission.spent_inr = (mission.spent_inr or 0) + aggregate_rupees(
                ExecutionLog.objects.filter(pk=log.pk))
            mission.save(update_fields=['runs_done', 'spent_inr', 'updated_at'])
        return mission.status
    if log is None:
        return service.after_failed_run(mission, 0, 'the run never started')
    if log.status == 'cancelled':
        # A person pressed stop on the run. Pause the mission rather than
        # start the next link behind their back.
        mission.runs_done = (mission.runs_done or 0) + 1
        mission.status = 'paused'
        mission.next_wake_at = None
        mission.save(update_fields=['runs_done', 'status', 'next_wake_at', 'updated_at'])
        return 'paused'
    if log.status in ('failed', 'timeout'):
        return service.after_failed_run(
            mission, aggregate_rupees(ExecutionLog.objects.filter(pk=log.pk)),
            log.error_message or log.status)
    return service.after_run(mission, _run_result(mission, log))


def _claim(mission_id: int, now) -> bool:
    """Take the mission for one launch. A conditional UPDATE, so two sweeps
    running at once (the loop during a deploy, a manual command) start one run."""
    from missions.models import Mission

    return bool(
        Mission.objects
        .filter(id=mission_id, current_execution_id='',
                next_wake_at__isnull=False, next_wake_at__lte=now)
        .update(current_execution_id=STARTING, next_wake_at=None,
                updated_at=timezone.now())
    )


def _record_launch(mission_id: int, execution_id: str) -> None:
    from missions.models import Mission

    Mission.objects.filter(id=mission_id).update(
        current_execution_id=execution_id, status='active',
        updated_at=timezone.now())


def _release(mission_id: int, *, pause_reason: str = '') -> None:
    """A launch that did not happen: hand the claim back (retry after the
    backoff), or pause with the reason when retrying cannot help."""
    from missions import service
    from missions.models import Mission

    mission = Mission.objects.filter(id=mission_id).first()
    if mission is None:
        return
    mission.current_execution_id = ''
    if pause_reason:
        mission.status = 'paused'
        mission.next_wake_at = None
        mission.last_report = pause_reason[:2000]
    else:
        mission.next_wake_at = timezone.now() + service.FAILED_RUN_BACKOFF
    mission.save(update_fields=['current_execution_id', 'status', 'next_wake_at',
                                'last_report', 'updated_at'])
    if pause_reason:
        try:
            service._notify(mission, 'Mission paused', pause_reason)
        except Exception:  # noqa: BLE001
            pass


def _pause_past_deadline(mission) -> None:
    mission.status = 'paused'
    mission.next_wake_at = None
    mission.save(update_fields=['status', 'next_wake_at', 'updated_at'])


async def sweep(now=None, *, wait: bool = False) -> dict[str, int]:
    """Settle finished runs, then launch due missions. Returns counts.

    `wait=False` (the scheduler loop) starts each run detached and returns.
    `wait=True` (Celery, the management command) waits for each run and
    settles it straight away, because those callers have no loop that
    outlives the call.
    """
    from agents.agent.runtime import (
        AgentRunRefused, start_agent_run, start_agent_run_and_wait,
    )
    from missions.models import Mission

    now = now or timezone.now()
    counts: dict[str, int] = {}

    def bump(key: str) -> None:
        counts[key] = counts.get(key, 0) + 1

    in_flight = await sync_to_async(list)(
        Mission.objects.exclude(current_execution_id='')
    )
    for mission in in_flight:
        outcome = await sync_to_async(settle)(mission)
        if outcome != 'running':
            bump('settled')

    # Settling may have just set `next_wake_at = now` for a mission whose run
    # left open work; launch it in this same sweep rather than a minute later.
    now = max(now, timezone.now())
    for mission in await sync_to_async(list)(due_missions(now)):
        if mission.deadline and now > mission.deadline:
            await sync_to_async(_pause_past_deadline)(mission)
            bump('paused')
            continue
        if not (mission.goal or '').strip():
            bump('skipped')
            continue
        if not await sync_to_async(_claim)(mission.id, now):
            bump('busy')
            continue
        start = start_agent_run_and_wait if wait else start_agent_run
        try:
            execution_id = await start(
                mission.agent, goal_for(mission), user=mission.user,
                trigger_type='api', caller='mission', mission_id=mission.id,
            )
        except AgentRunRefused as exc:
            # A spent cap, an agent not allowed to run unattended: retrying
            # every sweep would only repeat the refusal, so the owner is told.
            await sync_to_async(_release)(mission.id, pause_reason=f'Could not start: {exc}')
            bump('refused')
            continue
        except Exception:  # noqa: BLE001
            logger.exception('[Missions] mission %s failed to start', mission.id)
            await sync_to_async(_release)(mission.id)
            bump('failed')
            continue
        await sync_to_async(_record_launch)(mission.id, execution_id)
        bump('fired')
        if wait:
            fresh = await sync_to_async(Mission.objects.get)(id=mission.id)
            await sync_to_async(settle)(fresh)
    return counts


def run_mission_sweep(now=None) -> dict[str, int]:
    """Sync entry for Celery and `manage.py run_missions`: waits for runs."""
    from asgiref.sync import async_to_sync

    return async_to_sync(sweep)(now, wait=True)
