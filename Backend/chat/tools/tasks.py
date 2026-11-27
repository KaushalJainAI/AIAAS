"""
Detached coding tasks: what the coding lead calls instead of `invoke_subagent`.

`invoke_subagent` blocks until every worker finishes, so a lead that uses it
has no turn in which to steer or stop anyone. These six tools split starting
from waiting: `start_tasks` returns handles immediately, and `wait_tasks`
returns on the first *event* (a finish, a failure, a pause for approval, or a
refusal), the pattern P7's `wait_for` uses for missions.

Reports do not need a loop. Each finish, failure or pause is delivered to the
lead by itself at its next step (`take_reports`, from the steering node), and a
lead that answers while a worker still runs waits for it (`wait_on_lead`, from
the `await_reports` node). Both waits, and `wait_tasks`, share one helper
(`wait_for_news`), so they agree on what counts as news.

Offered only with the `subAgents` grant, like the delegation tools — and
workers never hold that grant, so depth stays 1 for code: a debugger that
wants help says so in its `patch` followups and the lead decides.
"""
from __future__ import annotations

import asyncio
import json
import logging
import shlex
import time
from typing import Any, Dict

from .agents import worker_caller
from .registry import tool

from workflow_backend.background import release_db

logger = logging.getLogger(__name__)

#: Tools that write a project file. A task whose worker can reach any of
#: these must carry non-empty `claims` — otherwise there is nothing to lease
#: and nothing to sequence on.
_WRITING_TOOLS = ('ws_write', 'ws_edit', 'ws_apply_patch')

#: The longest one `wait_tasks` call may wait, as its schema tells the model.
WAIT_TASKS_MAX_SECONDS = 300

#: While a lead waits on its workers, how often the user is told what they are
#: waiting for. Read at call time, so a test can patch it short.
WAIT_HEARTBEAT_SECONDS = 15.0

#: How often a worker paused for an approval checks whether the approval came
#: through. Slow on purpose: a paused worker can wait for hours.
APPROVAL_POLL_SECONDS = 10.0


def _task_list(args: Dict) -> list[dict]:
    tasks = args.get('tasks')
    if isinstance(tasks, dict):
        tasks = [tasks]
    if not isinstance(tasks, list):
        return []
    return [t for t in tasks if isinstance(t, dict)]


async def _resolve_worker(args_agent: Any, user, delegation_scope) -> tuple[Any, str]:
    """The saved agent a task names, or an error written for the lead.

    Accepts a numeric id (checked against the lead's `delegatesTo`, like
    `invoke_subagent`), a template slug (`code-implementer`) resolving to the
    caller's installed row, or a name. A missing row is refused with the fix —
    install the code pack — not with a bare "not found".
    """
    from agents.models import SubAgent

    if args_agent is None or (isinstance(args_agent, str) and not args_agent.strip()):
        return None, (
            'Give the `agent` for each task: a saved agent id, its template '
            'slug (e.g. "code-implementer"), or its name.')
    if isinstance(args_agent, int) or (isinstance(args_agent, str) and args_agent.strip().isdigit()):
        agent_id = int(args_agent)
        if delegation_scope is not None and agent_id not in delegation_scope:
            return None, (
                f'Agent {agent_id} is not one this lead may delegate to. '
                f'Call search_agents to see the ones it can.')
        row = await SubAgent.objects.filter(id=agent_id, user_id=user.id).afirst()
        if row is None:
            return None, f'No agent {agent_id} belongs to this user.'
        return row, ''
    slug = str(args_agent).strip()
    row = await SubAgent.objects.filter(
        user_id=user.id, template_slug=slug).afirst()
    if row is None:
        row = await SubAgent.objects.filter(
            user_id=user.id, name__iexact=slug).afirst()
    if row is None:
        return None, (
            f'No agent "{slug}" is installed. Install the code pack '
            f'(template {slug}) or pass a saved agent id from search_agents.')
    if delegation_scope is not None and row.id not in delegation_scope:
        return None, (
            f'Agent "{slug}" is not one this lead may delegate to. '
            f'Call search_agents to see the ones it can.')
    return row, ''


async def _resolve_project(args_project: Any, context: Dict, user) -> tuple[Any, str]:
    """The `CodeProject` a task runs in, or an error written for the lead."""
    from workspaces.models import CodeProject

    name = str(args_project or context.get('code_project') or '').strip()
    if not name:
        # The lead's own scope when it names exactly one project; otherwise
        # the task must say which.
        scope = context.get('code_projects')
        if isinstance(scope, (list, tuple)) and len(scope) == 1:
            row = await CodeProject.objects.filter(
                user_id=user.id, id=scope[0]).afirst()
            if row is not None:
                return row, ''
        return None, 'Give the `project` for each task.'
    row = await CodeProject.objects.filter(user_id=user.id, name=name).afirst()
    if row is None:
        return None, f'No project {name!r} belongs to this user.'
    scope = context.get('code_projects')
    if scope is not None and row.id not in scope:
        return None, f'Project {name!r} is not selected for this run.'
    return row, ''


def _normalise_claims(raw: Any) -> list[str]:
    from workspaces.leases import normalize_pattern

    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list):
        return []
    return [p for p in (normalize_pattern(p) for p in raw) if p]


def _can_write(worker) -> bool:
    """Whether the worker's toolbox can write a project file."""
    from agents.agent.runtime import tool_scope_for
    from agents.grants import GRANT_TOOLS

    scope = tool_scope_for(worker)
    # `toolScope` is the older axis: empty means everything its grants unlock.
    effective = set(scope) if scope else set(GRANT_TOOLS.get('shell', ()))
    return any(t in effective for t in _WRITING_TOOLS)


# Worker-control tools are `journal=False` (docs/UNDO_PLAN.md D9), like the
# delegation tools in `chat/tools/agents.py`: each worker's own changes go into
# its own change set (D7), so a row for the control call would only repeat them.
#   start_tasks: starts detached workers.
#   steer_task:  sends a worker a new instruction.
#   stop_task:   stops a worker.
# `wait_tasks` and `task_status` are `read`, so they are never journaled anyway.
@tool({
    'type': 'function',
    'function': {
        'name': 'start_tasks',
        'description': (
            'Start coding tasks as detached workers and return their handles '
            'immediately. Each task names `agent` (a saved id, template slug '
            'or name), `instructions`, `claims` (file globs it will write — '
            'required when its agent can write), `reads`, `depends_on` '
            '(earlier task ids) and `project`. Ready tasks start now; tasks '
            'whose dependencies are unfinished are refused, naming them; '
            'tasks whose claims overlap each other or a live lease are '
            'refused, naming the holder. At most 3 workers run at once. '
            'Follow with wait_tasks to hear back.'
        ),
        'parameters': {
            'type': 'object',
            'properties': {
                'tasks': {
                    'type': 'array',
                    'items': {'type': 'object'},
                    'description': '`code_plan` task objects to start.',
                },
                'briefing': {
                    'type': 'string',
                    'description': 'Shared background (the plan goal) sent to every worker once.',
                },
            },
            'required': ['tasks'],
            'additionalProperties': False,
        },
    },
}, sensitive=True, effect='reversible', journal=False)
async def start_tasks(args: Dict, context: Dict) -> str:
    from django.contrib.auth import get_user_model

    from agents.agent import tasks as _tasks
    from agents.agent.orchestrator import check_depth, DelegationRefused

    user_id = context.get('user_id')
    if not user_id:
        return json.dumps({'error': 'No user context.'})
    depth = int(context.get('depth', 0) or 0)
    try:
        check_depth(depth)
    except DelegationRefused as exc:
        return json.dumps({'error': str(exc), 'refused': True})

    items = _task_list(args)
    if not items:
        return json.dumps({'error': "Give `tasks` as a non-empty list of task objects."})
    if len(items) > _tasks.MAX_TASKS_PER_CALL:
        return json.dumps({'error': (
            f'{len(items)} tasks is more than the {_tasks.MAX_TASKS_PER_CALL} one '
            f'start_tasks call may carry. Split the plan and start what is ready.')})

    user = await get_user_model().objects.filter(id=user_id).afirst()
    if user is None:
        return json.dumps({'error': 'User not found.'})

    parent_thread = str(context.get('session_id') or 'run')
    bucket = _tasks._bucket(parent_thread)
    done_ids = {t.task_id for t in bucket.values() if t.status == 'done'}
    briefing = str(args.get('briefing') or '').strip()
    parent_paths = context.get('write_paths')
    parent_commands = context.get('command_scope')
    # The lead's change set, read here where the binding is live. The workers
    # run in detached tasks whose context is empty, so they get it as an
    # argument, never by asking for it (docs/UNDO_PLAN.md D7).
    from logs import changes

    change_parent_id = await changes.acurrent_set_id(create=True)
    # Whoever is watching the lead sees worker frames live from here on.
    _tasks.set_sink(parent_thread, context.get('sink'))

    started: list[dict] = []
    refused: list[dict] = []
    # Claims taken by tasks started *in this call*, so two siblings claiming
    # the same file cannot both start: the second is refused with the first
    # named, exactly as a live lease refusal reads.
    batch_claims: list[tuple[str, str, str]] = []

    for index, item in enumerate(items):
        task_id = str(item.get('id') or item.get('task_id') or f't{index + 1}')
        title = str(item.get('title') or task_id)[:200]
        # Dependencies unfinished → refused, naming them. The lead waits and
        # starts these when `wait_tasks` reports their blockers done.
        deps = item.get('depends_on') or item.get('dependsOn') or []
        if isinstance(deps, str):
            deps = [deps]
        missing = [str(d) for d in deps
                   if str(d) and str(d) not in done_ids]
        if missing:
            refused.append({'task_id': task_id, 'title': title,
                            'refused': f'Dependencies unfinished: {", ".join(missing)}. '
                                       f'Start these after wait_tasks reports them done.'})
            continue
        if _tasks.live_count(parent_thread) >= _tasks.MAX_CODE_WORKERS:
            refused.append({'task_id': task_id, 'title': title,
                            'refused': (
                                f'{_tasks.MAX_CODE_WORKERS} workers are already running; '
                                f'wait for one with wait_tasks, then start this.')})
            continue

        worker, error = await _resolve_worker(
            item.get('agent'), user, context.get('delegation_scope'))
        if worker is None:
            refused.append({'task_id': task_id, 'title': title, 'refused': error})
            continue
        project, error = await _resolve_project(
            item.get('project'), context, user)
        if project is None:
            refused.append({'task_id': task_id, 'title': title, 'refused': error})
            continue
        claims = _normalise_claims(item.get('claims'))
        if _can_write(worker) and not claims:
            refused.append({'task_id': task_id, 'title': title,
                            'refused': (
                                f'Task {task_id} has no `claims` but its agent '
                                f'({worker.name}) can write. Name the file globs it '
                                f'will write so they can be leased and sequenced.')})
            continue
        # Overlap inside this batch, before anything starts.
        clash = _batch_clash(claims, batch_claims)
        if clash:
            other_task, other_pattern = clash
            refused.append({'task_id': task_id, 'title': title,
                            'refused': (
                                f'Claims {claims} overlap task {other_task}\'s '
                                f'claim on {other_pattern} started in this same call; '
                                f'sequence them through depends_on.')})
            continue

        outcome = await _launch_one(
            parent_thread=parent_thread, bucket=bucket, task_id=task_id,
            title=title, item=item, worker=worker, project=project,
            claims=claims, briefing=briefing, context=context, user=user,
            depth=depth, parent_paths=parent_paths,
            parent_commands=parent_commands,
            share_index=len(started), share_total=len(items),
            change_parent_id=change_parent_id)
        if outcome.get('handle'):
            started.append(outcome)
            batch_claims.extend((c, task_id, outcome['handle']) for c in claims)
        else:
            refused.append({'task_id': task_id, 'title': title,
                            'refused': outcome.get('error', 'Could not start.')})

    return json.dumps({'started': started, 'refused': refused})


def _batch_clash(claims: list[str],
                 batch: list[tuple[str, str, str]]) -> tuple[str, str] | None:
    """`(task_id, pattern)` of the first batch claim overlapping `claims`."""
    from workspaces.leases import overlaps

    for claim in claims:
        for pattern, task_id, _handle in batch:
            if overlaps(pattern, claim):
                return task_id, pattern
    return None


async def _read_run(execution_id: str) -> dict | None:
    """A worker's run row, as the lead needs it. None when it cannot be read this
    time (the caller tries again); `{'status': 'missing'}` when there is no row."""
    from asgiref.sync import sync_to_async

    from logs.models import ExecutionLog

    def _row():
        row = ExecutionLog.objects.filter(execution_id=execution_id).values(
            'status', 'output_data', 'tokens_used', 'error_message').first()
        return row if row is not None else {'status': 'missing'}

    try:
        return await sync_to_async(_row)()
    except Exception:  # noqa: BLE001 — a failed read is a skipped lap, not a failed worker
        logger.warning('[Tasks] Could not read run %s', execution_id, exc_info=True)
        return None


async def _follow_approval(record, parent_thread: str, *, read_run=None,
                           poll_seconds: float | None = None) -> dict | None:
    """Stay with a worker that paused for approval until its run ends.

    The approval is given in the Inbox, which resumes the run on the same
    execution id (`agents/agent/runtime.py::resume_agent_run`). Meanwhile the
    record is live: this polls the run row, marks the record running again when
    the run runs, and paused again if it pauses again. Returns the row the run
    ended with, or None when someone else finished the record first (a stop
    over HTTP), in which case there is nothing left to report.
    """
    from agents.agent import tasks as _tasks

    read = read_run or _read_run
    while not record.done.is_set():
        await asyncio.sleep(APPROVAL_POLL_SECONDS if poll_seconds is None else poll_seconds)
        if record.done.is_set():
            return None
        row = await read(record.execution_id)
        if row is None:
            continue
        status = row.get('status')
        if status in ('running', 'pending', 'paused'):
            want = 'paused' if status == 'paused' else 'running'
            if record.status != want:
                if want == 'paused':
                    _tasks.set_paused(record)
                else:
                    _tasks.set_resumed(record)
                await _emit_task(parent_thread, record, force=True)
            continue
        return row
    return None


async def _finish_from_run(record, row: dict, context: Dict) -> None:
    """Close a record from the run row its approval-follow ended on."""
    from agents.agent import tasks as _tasks

    status = row.get('status')
    if status == 'completed':
        output = row.get('output_data') or {}
        raw = output.get('answer') if isinstance(output, dict) else ''
        answer = await _bound_answer(str(raw or ''), context, record.handle)
        _tasks.finish(record, status='done', answer=answer,
                      tokens=int(row.get('tokens_used') or 0))
    elif status == 'cancelled':
        _tasks.finish(record, status='cancelled', error='Stopped.')
    else:
        _tasks.finish(record, status='failed', error=str(
            row.get('error_message') or f'The run ended as {status}.'))


async def _launch_one(*, parent_thread, bucket, task_id, title, item, worker,
                      project, claims, briefing, context, user, depth,
                      parent_paths, parent_commands,
                      share_index, share_total,
                      change_parent_id: int | None = None) -> dict:
    """Open the worker's log, lease its claims, spawn its run. One task."""
    from asgiref.sync import sync_to_async

    from agents import budget
    from agents.agent import tasks as _tasks
    from agents.agent.orchestrator import divide_budget, worker_grants, worker_thread_id
    from agents.agent.runtime import (
        command_scope_for,
        intersect_command_scope,
        intersect_write_paths,
        run_agent,
        write_paths_for,
    )
    from workspaces import leases as _leases
    from workflow_backend.background import spawn

    # Narrowed toolbox: never the parent's, minus the right to delegate —
    # workers are depth+1 and cannot start tasks of their own.
    worker.tool_grants = worker_grants(worker.tool_grants or {})
    parent_permissions = context.get('tool_permissions') or {}
    if isinstance(parent_permissions, dict) and parent_permissions:
        from agents.agent.runtime import merge_tool_permissions, tool_permissions_for

        merged = merge_tool_permissions(
            parent_permissions, tool_permissions_for(worker))
        if merged != tool_permissions_for(worker):
            worker.agent_context = dict(
                worker.agent_context or {}, toolPermissions=merged)
    narrowed_paths = intersect_write_paths(parent_paths, write_paths_for(worker))
    narrowed_commands = intersect_command_scope(parent_commands, command_scope_for(worker))
    # The task's claims narrow the write set further: an implementer may only
    # write what its task claimed, even if its template allows more.
    effective_paths = _intersect_claims(narrowed_paths, claims)

    # The spend share is reserved before the first worker starts: sibling
    # workers all read "under the cap" otherwise, and all proceed on it.
    cap = (worker.guardrails or {}).get('spendCapRupees')
    if cap:
        worker.guardrails = dict(worker.guardrails or {},
                                 spendCapRupees=divide_budget(cap, max(1, share_total)))

    parent_deadline = context.get('deadline')
    worker_deadline = None
    if parent_deadline is not None:
        try:
            worker_deadline = parent_deadline.child(budget.limit_for(worker))
        except budget.OutOfTime as exc:
            return {'error': str(exc)}

    handle = _tasks.make_handle(task_id, bucket)
    label = _tasks.make_label(worker.name, bucket)
    thread_id = _tasks.new_thread_id(parent_thread)
    instructions = str(item.get('instructions') or item.get('title') or title)
    if len(instructions) > 8000:
        return {'error': (
            f'Task {task_id} is {len(instructions):,} characters, over the 8,000 '
            f'limit. Put shared background in `briefing` and keep each task to '
            f'what that worker alone must do.')}

    # The log first, so the execution id exists before the run does anything —
    # and so the leases have a holder to name.
    from agents.agent.runtime import _open_log

    try:
        log = await _open_log(
            worker, user, instructions, 'api', thread_id,
            caller=worker_caller(context)[0], depth=depth + 1,
            parent_step_id=await _parent_step(context),
            delegation_task=instructions, delegation_index=share_index,
            chat_session_key=parent_thread,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception('[Tasks] Could not open log for task %s', task_id)
        return {'error': f'Could not open the run: {exc}'}

    # Leases before the spawn, atomically: a task whose claims overlap a live
    # lease does not start, and the lead is told who holds it.
    try:
        def _take():
            return _leases.acquire(
                project, log, claims, holder_label=label, task_id=task_id)

        if claims:
            await sync_to_async(_take)()
    except Exception as exc:  # noqa: BLE001 — LeaseConflict names the holder
        await sync_to_async(log.delete)()
        return {'error': _lease_reason(exc)}

    # Who is asking, for the approval rows this worker may open: the Inbox
    # reads "Implementer #2 (task t3: add retry) wants to run …" from here
    # rather than a bare tool call.
    try:
        def _stamp():
            log.input_data = {
                **(log.input_data or {}),
                'worker_label': label,
                'task_id': task_id,
                'task_title': title,
            }
            log.save(update_fields=['input_data', 'updated_at'])

        await sync_to_async(_stamp)()
    except Exception:  # noqa: BLE001 — the label is courtesy, not record
        pass

    record = _tasks.CodeTask(
        handle=handle, task_id=task_id, title=title,
        agent_id=worker.id, agent_name=worker.name, label=label,
        project_id=project.id, project_name=project.name,
        claims=tuple(claims), thread_id=thread_id,
        execution_id=str(log.execution_id))
    bucket[handle] = record
    # The lane appears in the panel now, not when the first wait lands.
    await _emit_task(parent_thread, record)
    await _emit_leases(parent_thread, project.id)

    parent_scope = context.get('file_scope')
    workspace = tuple(getattr(parent_scope, 'write_prefix', None) or ())

    async def _run() -> None:
        try:
            run = await run_agent(
                worker, instructions, user=user, thread_id=thread_id,
                trigger_type='api', caller=worker_caller(context)[0],
                gated_calls=worker_caller(context)[1], depth=depth + 1,
                log=log,
                parent_step_id=await _parent_step(context),
                delegation_task=instructions, delegation_index=share_index,
                deadline=worker_deadline,
                briefing=briefing or str(item.get('goal') or ''),
                parent_session_key=str(context.get('session_id') or ''),
                workspace=workspace,
                task_claims=tuple(claims), task_id=task_id, worker_label=label,
                write_paths=effective_paths, command_scope=narrowed_commands,
                parent_autonomy=str(context.get('autonomy') or ''),
                # The chat's org, so a worker reads and feeds the same solution
                # library the conversation does (`runtime._remember_org`).
                org_id=context.get('org_id'),
                share_solutions=bool(context.get('share_solutions')),
                # A worker started from a tainted turn starts tainted too.
                inherited_taint=context.get('tainted_by') or None,
                change_parent_id=change_parent_id,
            )
            if run.awaiting_approval:
                # Still live: the lead keeps waiting for this worker, and the
                # approval is followed to the run's end rather than reported as
                # the end. Without that, nothing would ever tell the lead the
                # work resumed or finished.
                _tasks.set_paused(record)
                await _emit_task(parent_thread, record, force=True)
                row = await _follow_approval(record, parent_thread)
                if row is not None:
                    await _finish_from_run(record, row, context)
            else:
                answer = await _bound_answer(run.answer or '', context, handle)
                _tasks.finish(record, status='done', answer=answer, tokens=run.tokens)
        except asyncio.CancelledError:
            # `cancel_agent_run` closes the log; the record just marks it.
            _tasks.finish(record, status='cancelled', error='Stopped.')
            raise
        except Exception as exc:  # noqa: BLE001
            logger.exception('[Tasks] Worker %s failed', handle)
            _tasks.finish(record, status='failed', error=str(exc))
        finally:
            # Terminal state always arrives (no throttle): the panel must not
            # need a wait to learn a worker ended, and the lock list clears
            # with the leases `_close_log` just released.
            await _emit_task(parent_thread, record, force=True)
            if record.project_id:
                await _emit_leases(parent_thread, record.project_id)
        # A lead whose turn is over hears nothing at its "next step": the
        # result goes into the chat instead, as a run_agent result does (H-187).
        # Not reached on a stop: `CancelledError` re-raises above.
        await _deliver_late(record, parent_thread, context.get('user_id'))

    spawn(_run(), name=f'code-task:{record.execution_id}')
    return {'handle': handle, 'task_id': task_id, 'title': title,
            'agent': worker.name, 'label': label,
            'execution_id': record.execution_id, 'claims': claims}


def _intersect_claims(narrowed: tuple[str, ...] | None,
                      claims: list[str]) -> tuple[str, ...] | None:
    """The worker's write set: its narrowed `writePaths` ∩ the task's claims.

    No claims means the template scope stands on its own (a reviewer reads; it
    simply never writes). Otherwise only claims the scope already covers are
    kept, glob-aware — a claim outside the scope would widen the worker past
    its lead, so it is dropped here and the write is refused as outside
    `writePaths` with its reason. Both axes stay enforced at every write.
    """
    if not claims:
        return narrowed
    if narrowed is None:
        return tuple(claims)
    if not narrowed:
        return ()
    from workspaces.leases import subsumes

    return tuple(c for c in claims if any(subsumes(p, c) for p in narrowed))


def _lease_reason(exc: BaseException) -> str:
    from workspaces.leases import LeaseConflict

    if isinstance(exc, LeaseConflict):
        return str(exc)
    cause = getattr(exc, '__cause__', None)
    if isinstance(cause, LeaseConflict):
        return str(cause)
    text = str(exc)
    if 'overlap' in text and 'lease' in text:
        return text
    return f'Could not take the file leases: {text}'


async def _emit_task(parent_thread: str, record, *, force: bool = False) -> None:
    """One `task_update` frame to whoever is watching the lead."""
    from agents.agent import tasks as _tasks
    from chat.turn.events import Event

    await _tasks.emit(
        parent_thread, Event.TASK_UPDATE, _tasks.task_frame(record),
        throttle_key=f'{parent_thread}:{record.handle}',
        throttle_seconds=0.0 if force else _tasks.TASK_UPDATE_THROTTLE_SECONDS)


async def _emit_leases(parent_thread: str, project_id: int) -> None:
    """The current `lease_update` frame for one project."""
    from asgiref.sync import sync_to_async

    from agents.agent import tasks as _tasks
    from chat.turn.events import Event
    from workspaces.models import CodeLease

    try:
        rows = await sync_to_async(list)(CodeLease.objects.filter(
            project_id=project_id).order_by('acquired_at').values(
                'pattern', 'holder_label', 'task_id'))
    except Exception:  # noqa: BLE001
        return
    await _tasks.emit(parent_thread, Event.LEASE_UPDATE, {
        'project': project_id,
        'leases': [{'pattern': r['pattern'],
                    'holder_label': r['holder_label'] or '',
                    'task_id': r['task_id'] or ''} for r in rows],
    })


async def _parent_step(context: Dict):
    from chat.tools.agents import _parent_step_id

    try:
        return await _parent_step_id(context)
    except Exception:  # noqa: BLE001
        return None


async def _bound_answer(answer: str, context: Dict, handle: str) -> str:
    """Cap a worker's answer the way fan-out results are capped, archiving the
    full text so `read_tool_output` can fetch it. What is cut stays reachable."""
    from agents.agent.orchestrator import WORKER_ANSWER_CHAR_LIMIT

    if len(answer) <= WORKER_ANSWER_CHAR_LIMIT:
        return answer
    full = answer
    try:
        from chat.tools.tool_output import spill

        output_id = await spill(f'task:{handle}', full, context)
    except Exception:  # noqa: BLE001
        output_id = None
    if output_id is None:
        return full[:WORKER_ANSWER_CHAR_LIMIT] + (
            '\n\n[trimmed to %d characters; the rest could not be kept]'
            % WORKER_ANSWER_CHAR_LIMIT)
    return full[:WORKER_ANSWER_CHAR_LIMIT] + (
        '\n\n[trimmed to %d characters. The full answer is stored — call '
        'read_tool_output with id "%s" to read the rest.]'
        % (WORKER_ANSWER_CHAR_LIMIT, output_id))


@tool({
    'type': 'function',
    'function': {
        'name': 'wait_tasks',
        'description': (
            'Block until something happens on the given tasks (or all of them): '
            'a task finished, failed, or paused for approval, or the user wrote '
            'a message. Returns one line per event plus progress for the rest. '
            'Also returns on timeout (at most 300s), reporting progress. You do '
            'not need to call this in a loop: each finish, failure or pause is '
            'reported to you by itself at your next step, as a <task-reports> '
            'block. Call this only to wait on purpose, for example before '
            'starting a task that depends on one still running.'
        ),
        'parameters': {
            'type': 'object',
            'properties': {
                'handles': {
                    'type': 'array', 'items': {'type': 'string'},
                    'description': 'Handles from start_tasks. Omit for all of this run\'s tasks.',
                },
                'until': {
                    'type': 'string',
                    'description': '`any` (the first event) or `all` (every task done, failed or paused).',
                },
                'timeout_s': {
                    'type': 'integer',
                    'description': 'Seconds to wait, at most 300.',
                },
            },
            'additionalProperties': False,
        },
    },
    # Above the 300s a caller may ask for, so the wait ends with its own
    # progress report rather than the loop's bare "timed out" at 120s, which
    # read as failed tasks while every worker was still going.
}, effect='read', timeout=WAIT_TASKS_MAX_SECONDS + 30)
async def wait_tasks(args: Dict, context: Dict) -> str:
    from agents.agent import tasks as _tasks

    parent_thread = str(context.get('session_id') or 'run')
    bucket = _tasks._bucket(parent_thread)
    wanted = [str(h) for h in (args.get('handles') or []) if str(h).strip()]
    _tasks.set_sink(parent_thread, context.get('sink'))
    if wanted:
        unknown = [h for h in wanted if h not in bucket]
        if unknown:
            return json.dumps({'error': (
                f'Unknown task handles: {", ".join(unknown)}. '
                f'Yours are: {", ".join(sorted(bucket)) or "none"}.')})
        records = [bucket[h] for h in wanted]
    else:
        records = list(bucket.values())
    if not records:
        return json.dumps({'events': [], 'progress': 'No tasks have been started.'})

    until = str(args.get('until') or 'any').strip().lower()
    if until not in ('any', 'all'):
        return json.dumps({'error': '`until` is "any" or "all".'})
    try:
        timeout = max(1, min(int(args.get('timeout_s') or 60), WAIT_TASKS_MAX_SECONDS))
    except (TypeError, ValueError):
        return json.dumps({'error': '`timeout_s` must be a number.'})

    _tasks.prune(parent_thread)
    reason = await wait_for_news(
        parent_thread, records, until=until, timeout=timeout,
        steer_key=parent_thread)
    events = _take_events(records, parent_thread)
    if reason == 'timeout':
        lines = [f'{r.handle} ({r.title}): still {r.status}' for r in records
                 if not r.done.is_set()]
        return json.dumps(_report(records, events, note=(
            f'Timed out after {timeout}s. ' + (' '.join(lines) or 'Everything finished.'))))
    if reason == 'steer':
        return json.dumps(_report(records, events, note=STEER_WAITING_NOTE))
    return json.dumps(_report(records, events))


#: What `wait_tasks` says when it returns because the user has written.
STEER_WAITING_NOTE = 'A message from the user is waiting.'


def _settled(record, until: str) -> bool:
    """Whether a record has stopped being work the lead waits on for `until`.

    A paused worker is still live, so `any` keeps the lead waiting on it (its
    pause is news once, and its approval resumes it). `all` returns on a pause,
    as `wait_tasks` promises: "every task done, failed or paused".
    """
    return record.done.is_set() or (until == 'all' and record.status == 'paused')


async def wait_for_news(parent_thread: str, records: list, *, until: str = 'any',
                        timeout: float, steer_key: str = '', progress=None,
                        heartbeat_seconds: float | None = None) -> str:
    """Block until something on this lead's work needs its attention.

    The one wait behind both `wait_tasks` and the `await_reports` graph node,
    so the two cannot disagree about what counts as news. Returns:

    - `'steer'`: a user steer or change notice is waiting for `steer_key`.
      Checked first, and on every lap, so a message from the user never waits
      out the rest of a window (the mailbox is read by the graph, not here).
    - `'news'`: an unreported task event or a queued lead event. Only when
      `until='any'`; `until='all'` waits for every record to finish instead.
    - `'done'`: every record has finished (or, for `until='all'`, is paused).
    - `'timeout'`: none of the above within `timeout` seconds.

    `progress`, when given, is `async (records) -> None`, called on entry and
    then every `heartbeat_seconds` (default `WAIT_HEARTBEAT_SECONDS`) while the
    wait lasts, so a silent wait can still say what it is waiting for. It rides
    the same lap as the status refresh: there is no second loop.

    Reads the events without consuming them; the caller takes them.
    """
    from chat.turn import steering

    from agents.agent import tasks as _tasks

    beat_every = WAIT_HEARTBEAT_SECONDS if heartbeat_seconds is None else heartbeat_seconds
    next_beat: float | None = None  # None: beat on the first lap, i.e. on entry
    deadline = time.monotonic() + max(0.0, float(timeout))
    while True:
        await _refresh_statuses(records)
        for r in records:
            # Lanes move while the lead waits: throttled to one frame per
            # second per task, so waiting does not flood the panel.
            await _emit_task(parent_thread, r)
        if progress is not None and (next_beat is None or time.monotonic() >= next_beat):
            next_beat = time.monotonic() + beat_every
            await progress(records)
        if steer_key and (steering.pending(steer_key) or steering.has_notices(steer_key)):
            return 'steer'
        if until == 'any' and (_has_unreported(records) or _tasks.pending_events(parent_thread)):
            return 'news'
        if records and all(_settled(r, until) for r in records):
            return 'done'
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return 'timeout'
        # The wait below is on worker events, not the database. Hand the
        # lead's pooled connection back each lap, or a lead waiting on workers
        # pins one for the whole delegation (G1). The status refresh above
        # re-takes one per lap in microseconds.
        await release_db()
        waiters = [asyncio.ensure_future(r.done.wait()) for r in records
                   if not r.done.is_set()]
        lap = min(_tasks.WAIT_POLL_SECONDS, remaining)
        if not waiters:
            # No record to wait on (none started): only a steer or the window ends this.
            await asyncio.sleep(lap)
            continue
        try:
            await asyncio.wait(waiters, timeout=lap, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for waiter in waiters:
                waiter.cancel()


async def wait_on_lead(parent_thread: str, *, progress=None) -> str:
    """The lead's wait at a final answer: all of its tasks, any news, a steer,
    or one window of `WAIT_TASKS_MAX_SECONDS`. Returns `wait_for_news`'s reason.
    `progress` is passed through to `wait_for_news` (see there)."""
    from agents.agent import tasks as _tasks

    return await wait_for_news(
        parent_thread, _tasks.records_for(parent_thread), until='any',
        timeout=WAIT_TASKS_MAX_SECONDS, steer_key=parent_thread, progress=progress)


def _elapsed(record, now_ms: int) -> str:
    """How long a worker has been on the job, as a short word: `45s`, `3m`, `1h 5m`."""
    seconds = max(0, now_ms - record.started_at_ms) // 1000
    if seconds < 60:
        return f'{seconds}s'
    minutes = seconds // 60
    if minutes < 60:
        return f'{minutes}m'
    return f'{minutes // 60}h {minutes % 60}m'


def _lanes(records: list, now_ms: int, state: str) -> str:
    """`label (state elapsed)` for up to four workers, then `+N more`."""
    shown = records[:4]
    parts = [f'{r.label or r.title} ({state + " " if state else ""}{_elapsed(r, now_ms)})'
             for r in shown]
    if len(records) > len(shown):
        parts.append(f'+{len(records) - len(shown)} more')
    return ', '.join(parts)


def wait_status_message(records: list, now_ms: int | None = None) -> str:
    """What the user reads while a lead waits on its workers. '' when none is live.

    Paused workers come first, because they are the ones that need the user:
    `Waiting for your approval in the Inbox: implementer (paused 4m). Running:
    tester (2m)`. Without any paused worker: `Waiting on 2 workers: implementer
    (running 3m), tester (running 1m)`.
    """
    import time as _time

    now = int(_time.time() * 1000) if now_ms is None else now_ms
    live = [r for r in records if not r.done.is_set()]
    if not live:
        return ''
    paused = [r for r in live if r.status == 'paused']
    running = [r for r in live if r.status != 'paused']
    if paused and running:
        return (f'Waiting for your approval in the Inbox: {_lanes(paused, now, "paused")}. '
                f'Running: {_lanes(running, now, "")}')
    if paused:
        return f'Waiting for your approval in the Inbox: {_lanes(paused, now, "paused")}'
    noun = 'worker' if len(running) == 1 else 'workers'
    return f'Waiting on {len(running)} {noun}: {_lanes(running, now, "running")}'


def _take_events(records: list, parent_thread: str) -> list[str]:
    """Consume what a `wait_tasks` return is about, and mark it reported.

    Marking happens here, at the return, and not in `_collect_events`: a lap
    that collects lines and then keeps waiting must not lose them.
    """
    from agents.agent import tasks as _tasks

    events = _collect_events(records)
    # File changes touching another task's reads (C3): the lead may re-steer
    # a worker whose target just changed shape.
    events.extend(_tasks.drain_events(parent_thread))
    _mark_reported(records)
    return events


def _has_unreported(records: list) -> bool:
    from agents.agent import tasks as _tasks

    return any(r.status in _tasks.REPORTED_STATUSES and r.status != r.reported_status
               for r in records)


def _mark_reported(records: list) -> None:
    from agents.agent import tasks as _tasks

    for r in records:
        if r.status in _tasks.REPORTED_STATUSES:
            r.reported_status = r.status


async def take_reports(parent_thread: str) -> str:
    """The `<task-reports>` block for this lead, or '' when nothing is new.

    The steering boundary's delivery. Each status change is reported once:
    whatever is returned here is marked, so a later `wait_tasks` does not
    repeat it. The database is read (to notice a pause) only when a task is
    still live, so a run with no tasks pays two dict lookups.
    """
    from agents.agent import tasks as _tasks

    records = _tasks.records_for(parent_thread)
    if not records and not _tasks.pending_events(parent_thread):
        return ''
    if any(not r.done.is_set() for r in records):
        await _refresh_statuses(records)
    lines = _collect_events(records)
    lines.extend(_tasks.drain_events(parent_thread))
    if not lines:
        return ''
    _mark_reported(records)
    return '<task-reports>\n' + '\n'.join(lines) + '\n</task-reports>'


def has_news(parent_thread: str) -> bool:
    """Whether this lead has anything it has not been told (no DB, no wait)."""
    from agents.agent import tasks as _tasks

    return (_has_unreported(_tasks.records_for(parent_thread))
            or _tasks.pending_events(parent_thread))


def has_running(parent_thread: str) -> bool:
    """Whether a worker is still live: running, or paused for an approval. A paused
    worker is still the lead's work, so the lead waits for it; its approval
    resumes it and its report comes back to the lead like any other."""
    from agents.agent import tasks as _tasks

    return any(not r.done.is_set() for r in _tasks.records_for(parent_thread))


async def _refresh_statuses(records: list) -> None:
    """Mark records paused/completed from their worker rows.

    A worker paused for approval has no live task — `interrupt()` returned —
    so its record would read `running` for ever without this: the row is the
    only thing that knows. Terminal statuses arrive through `finish` in the
    wrapper; this only ever moves `running` → `paused`.
    """
    from asgiref.sync import sync_to_async

    from logs.models import ExecutionLog

    for record in records:
        if record.done.is_set() or not record.execution_id:
            continue
        try:
            status = await sync_to_async(ExecutionLog.objects.filter(
                execution_id=record.execution_id
            ).values_list('status', flat=True).first)()
        except Exception:  # noqa: BLE001
            continue
        if status == 'paused':
            record.status = 'paused'


def _collect_events(records: list) -> list[str]:
    """One line per status change the lead has not been told about.

    Pure: nothing is marked here. `_take_events` and `take_reports` mark what
    they return, so a collection that is looked at and then discarded loses
    nothing.
    """
    from agents.agent import tasks as _tasks

    return [_event_line(r) for r in records
            if r.status in _tasks.REPORTED_STATUSES and r.status != r.reported_status]


def _event_line(r) -> str:
    if r.kind == 'agent_run':
        return _agent_run_line(r)
    if r.status == 'done':
        return (f'{r.handle} ({r.title}): done by {r.label}'
                + (f' — {r.answer[-500:]}' if r.answer else ''))
    if r.status == 'failed':
        return f'{r.handle} ({r.title}): failed — {r.error[:500]}'
    if r.status == 'paused':
        return (f'{r.handle} ({r.title}): paused for approval — '
                f'answer it in the Inbox and the run goes on from there.')
    return f'{r.handle} ({r.title}): stopped.'


def _report(records: list, events: list[str], note: str = '') -> dict:
    progress = ' '.join(
        f'{r.handle}:{r.status}' for r in records) or 'No tasks.'
    out: dict[str, Any] = {'events': events, 'progress': progress}
    if note:
        out['note'] = note
    return out


@tool({
    'type': 'function',
    'function': {
        'name': 'task_status',
        'description': (
            'A snapshot of one task (or all): status, worker, leases held, '
            'spend so far, and the result or error when finished.'
        ),
        'parameters': {
            'type': 'object',
            'properties': {
                'handle': {'type': 'string', 'description': 'Handle from start_tasks. Omit for all.'},
            },
            'additionalProperties': False,
        },
    },
}, effect='read', parallel=True)
async def task_status(args: Dict, context: Dict) -> str:
    from asgiref.sync import sync_to_async

    from agents.agent import tasks as _tasks
    from logs.models import ExecutionLog
    from workspaces.models import CodeLease

    parent_thread = str(context.get('session_id') or 'run')
    bucket = _tasks._bucket(parent_thread)
    handle = str(args.get('handle') or '').strip()
    if handle:
        record = bucket.get(handle)
        if record is None:
            return json.dumps({'error': f'Unknown task handle {handle!r}.'})
        records = [record]
    else:
        records = list(bucket.values())

    out = []
    for r in records:
        tokens = r.tokens
        status = r.status
        try:
            row = await sync_to_async(ExecutionLog.objects.filter(
                execution_id=r.execution_id).values(
                    'status', 'tokens_used').first)()
            if row:
                status = r.status if r.done.is_set() else row['status']
                tokens = row['tokens_used'] or tokens
        except Exception:  # noqa: BLE001
            pass
        try:
            leases = await sync_to_async(list)(CodeLease.objects.filter(
                holder__execution_id=r.execution_id
            ).values_list('pattern', flat=True))
        except Exception:  # noqa: BLE001
            leases = []
        out.append({
            'handle': r.handle, 'task_id': r.task_id, 'title': r.title,
            'agent': r.agent_name, 'label': r.label, 'status': status,
            'execution_id': r.execution_id, 'claims': list(r.claims),
            'leases': list(leases), 'tokens': tokens,
            'answer_tail': r.answer[-1000:] if r.answer else '',
            'error': r.error[:500] if r.error else '',
        })
    return json.dumps({'tasks': out})


@tool({
    'type': 'function',
    'function': {
        'name': 'steer_task',
        'description': (
            'Send an instruction to a running worker. It lands at its next '
            'tool boundary, like steering a chat turn mid-run. Same queue and '
            'caps as a user steer.'
        ),
        'parameters': {
            'type': 'object',
            'properties': {
                'handle': {'type': 'string'},
                'message': {'type': 'string'},
            },
            'required': ['handle', 'message'],
            'additionalProperties': False,
        },
    },
}, effect='reversible', journal=False)
async def steer_task(args: Dict, context: Dict) -> str:
    from agents.agent import tasks as _tasks
    from chat.turn import steering

    parent_thread = str(context.get('session_id') or 'run')
    record = _tasks.get(parent_thread, str(args.get('handle') or ''))
    if record is None:
        return json.dumps({'error': f'Unknown task handle {args.get("handle")!r}.'})
    if record.done.is_set():
        return json.dumps({'error': f'{record.handle} already finished ({record.status}).'})
    message = str(args.get('message') or '').strip()
    if not message:
        return json.dumps({'error': 'Give the message to send.'})
    steering.post(record.thread_id, message)
    stats = steering.stats(record.thread_id)
    return json.dumps({'steered': record.handle, **stats})


@tool({
    'type': 'function',
    'function': {
        'name': 'stop_task',
        'description': (
            'Stop a worker mid-task. Its leases are released and its file '
            'changes stay for the lead to keep or revert with revert_task.'
        ),
        'parameters': {
            'type': 'object',
            'properties': {
                'handle': {'type': 'string'},
                'reason': {'type': 'string'},
            },
            'required': ['handle'],
            'additionalProperties': False,
        },
    },
}, effect='reversible', journal=False)
async def stop_task(args: Dict, context: Dict) -> str:
    from asgiref.sync import sync_to_async

    from agents.agent import tasks as _tasks
    from logs.models import ExecutionLog

    parent_thread = str(context.get('session_id') or 'run')
    record = _tasks.get(parent_thread, str(args.get('handle') or ''))
    if record is None:
        return json.dumps({'error': f'Unknown task handle {args.get("handle")!r}.'})
    if record.done.is_set():
        return json.dumps({'error': f'{record.handle} already finished ({record.status}).'})
    try:
        log = await sync_to_async(ExecutionLog.objects.filter(
            execution_id=record.execution_id).first)()
    except Exception:  # noqa: BLE001
        log = None
    if log is None:
        _tasks.finish(record, status='cancelled', error='Run record gone.')
        return json.dumps({'stopped': record.handle, 'status': 'cancelled'})
    try:
        status = await _cancel_detached(log)
    except Exception as exc:  # noqa: BLE001 — names the fix
        return json.dumps({'error': str(exc)})
    _tasks.finish(record, status='cancelled',
                  error=str(args.get('reason') or 'Stopped by the lead.'))
    _tasks.prune(parent_thread)
    return json.dumps({'stopped': record.handle, 'status': status})


async def _cancel_detached(log) -> str:
    """Stop a detached code worker.

    `cancel_agent_run` refuses any run with a `parent_step_id` — a delegated
    worker runs *inside* its parent's task, so stopping it alone would leave
    the parent waiting on a result that never comes. A code task is different:
    it runs in its own spawned task (`code-task:<id>`), while the lead waits
    in `wait_tasks`, which returns on the cancel. Stopping it alone is safe,
    so this mirrors `cancel_agent_run`'s two in-process branches without the
    delegation guard. Leases release through `_close_log`, as everywhere else.
    """
    import asyncio as _asyncio

    from asgiref.sync import sync_to_async

    from agents.agent.runtime import CANCEL_WAIT_SECONDS

    from agents.agent import tasks as _tasks

    execution_id = str(log.execution_id)
    if log.status not in ('running', 'pending', 'paused'):
        return log.status
    if log.status == 'paused':
        # A worker waiting on an approval has a live wrapper, but nothing running
        # to cancel: close the run here, then finish the record now, so the lead
        # hears of the stop at once rather than at the wrapper's next poll.
        from agents.agent.runtime import _cancel_pending_hitl, _close_log
        from chat.turn.agent import forget_thread

        await _cancel_pending_hitl(log)
        thread_id = (log.input_data or {}).get('thread_id')
        if thread_id:
            await forget_thread(thread_id)
        await _close_log(log, status='cancelled', result={}, tokens=0,
                         error='Run cancelled while waiting for approval.')
        _tasks.finish_execution(execution_id, status='cancelled', error='Stopped.')
        return 'cancelled'
    try:
        live = [t for t in _asyncio.all_tasks()
                if t.get_name() == f'code-task:{execution_id}' and not t.done()]
    except RuntimeError:
        live = []
    if live:
        live[0].cancel()
        try:
            await _asyncio.wait_for(_asyncio.shield(live[0]), CANCEL_WAIT_SECONDS)
        except (_asyncio.CancelledError, _asyncio.TimeoutError,  # noqa: BLE001
                TimeoutError, Exception):
            # Cancelled (the path working as intended), timed out waiting for
            # the unwind, or failed while unwinding — the log below says how
            # the run actually ended either way.
            pass
        await sync_to_async(log.refresh_from_db)()
        return log.status
    raise RuntimeError(
        'This worker is not running in this server process. If it has stopped '
        'responding it will be closed automatically.')


@tool({
    'type': 'function',
    'function': {
        'name': 'revert_task',
        'description': (
            'Revert a finished or stopped worker\'s file changes, newest '
            'first. Refuses any file someone else changed since — that file '
            'is listed, not reverted. Pauses for a human first.'
        ),
        'parameters': {
            'type': 'object',
            'properties': {
                'handle': {'type': 'string'},
            },
            'required': ['handle'],
            'additionalProperties': False,
        },
    },
}, sensitive=True, effect='reversible')
async def revert_task(args: Dict, context: Dict) -> str:
    from asgiref.sync import sync_to_async

    from agents.agent import tasks as _tasks
    from workspaces.models import CodeChange, CodeProject

    parent_thread = str(context.get('session_id') or 'run')
    record = _tasks.get(parent_thread, str(args.get('handle') or ''))
    if record is None:
        return json.dumps({'error': f'Unknown task handle {args.get("handle")!r}.'})
    if not record.done.is_set():
        return json.dumps({'error': f'{record.handle} is still {record.status}; stop it first.'})

    project = await CodeProject.objects.filter(
        user_id=context.get('user_id'), id=record.project_id).afirst()
    if project is None:
        return json.dumps({'error': 'The task\'s project is gone.'})
    changes = await sync_to_async(list)(
        CodeChange.objects.filter(run__execution_id=record.execution_id).order_by('-id'))

    from workspaces import engine as _engine

    reverted: list[str] = []
    refused: list[str] = []
    for change in changes:
        path = (change.path or '').strip()
        if not path or path == '(patch)':
            continue
        outcome = await _revert_one(_engine, context, project, change, path)
        (reverted if outcome is None else refused).append(
            path if outcome is None else f'{path}: {outcome}')
    return json.dumps({'reverted': reverted, 'refused': refused})


async def _revert_one(engine, context, project, change, path: str) -> str | None:
    """Revert one file. Returns None on success, the reason on refusal."""
    import hashlib

    from workspaces.engine import WorkspaceError

    full = _join(project, path)
    try:
        ws = await _workspace_of(context)
        try:
            current = bytes(await engine.read(ws, full))
        except WorkspaceError:
            current = None
    except WorkspaceError as exc:
        return str(exc)
    if current is not None and change.after_hash:
        if hashlib.sha256(current).hexdigest() != change.after_hash:
            return ('changed since by someone else; re-read it before deciding '
                    'what it should be')
    try:
        if not change.before_hash:
            # The worker created this file: remove what it made.
            # `shlex.quote`, never `{path!r}`: Python quoting puts a path
            # holding `'` in double quotes, where `$(...)` runs. `--` stops a
            # path starting with `-` being read as a flag.
            await engine.exec(
                ws, f'rm -- {shlex.quote(path)}', cwd=project.workspace_path, timeout=60)
        else:
            # A tracked edit: restore what git had. New-but-committed files
            # land here too, which is also correct — HEAD is what was there.
            out = await engine.exec(
                ws, f'git checkout -- {shlex.quote(path)}',
                cwd=project.workspace_path, timeout=60)
            if int(out.get('exit_code') or 0) != 0:
                return 'git checkout refused it (untracked or ignored?)'
    except WorkspaceError as exc:
        return str(exc)
    return None


def _join(project, path: str) -> str:
    base = (project.workspace_path or '').rstrip('/')
    rel = str(path or '').strip().lstrip('/')
    return f'{base}/{rel}' if rel else base


async def _workspace_of(context: Dict):
    from django.contrib.auth import get_user_model

    from asgiref.sync import sync_to_async
    from workspaces import engine as _engine

    user = await get_user_model().objects.filter(
        id=context.get('user_id')).afirst()
    if user is None:
        raise _engine.WorkspaceError('No user context.')
    return await sync_to_async(_engine.ensure)(user)


# ── Runs started by `run_agent` that outlived their wait (H-185) ─────────────
#
# `run_agent` waits for its run and hands the answer back in the same call. A
# run longer than that wait used to be left to the model to poll, and a model
# that gave up before the run ended told the user "no output yet" while the
# answer landed in /runs, where nobody looked. Now the run is adopted into the
# lead's task records, so the machinery `start_tasks` already has applies: the
# lead's answer is held open while it runs (`await_reports`), its end is
# reported at the next step (`take_reports`), and if the lead's turn is over by
# then the result is posted into the conversation (`_deliver_late`).

#: How often an adopted run's row is read. The lead's turn may be held open on
#: it, so this is the most a finished run waits before the lead hears.
ADOPTED_RUN_POLL_SECONDS = 3.0

#: How long a finished run's result waits for a lead turn that is still going
#: to take it before it is posted into the chat regardless. Above any turn's
#: own limit, so it only ends a wait on a turn that has lost track of its end.
LATE_DELIVERY_MAX_WAIT_SECONDS = 3 * 60 * 60

#: A posted answer longer than this is cut, and the message says where the rest is.
LATE_ANSWER_CHARS = 50_000

#: Run status -> record status.
_RECORD_STATUS = {'completed': 'done', 'cancelled': 'cancelled'}


def _adopted(parent_thread: str, execution_id: str):
    from agents.agent import tasks as _tasks

    for record in _tasks.records_for(parent_thread):
        if record.execution_id == execution_id:
            return record
    return None


async def adopt_run(context: Dict, *, execution_id: str, agent_name: str = '',
                    title: str = ''):
    """Follow a `run_agent` run its caller stopped waiting on. Idempotent."""
    from agents.agent import tasks as _tasks
    from workflow_backend.background import spawn

    parent_thread = str(context.get('session_id') or 'run')
    record = _adopted(parent_thread, execution_id)
    if record is not None:
        return record
    bucket = _tasks._bucket(parent_thread)
    name = agent_name or 'Agent'
    short = ' '.join(str(title or '').split())
    record = _tasks.CodeTask(
        handle=_tasks.make_handle(f'run-{execution_id[:8]}', bucket),
        task_id=f'run-{execution_id[:8]}',
        title=(short[:117] + '...') if len(short) > 120 else (short or name),
        agent_id=None, agent_name=name,
        label=_tasks.make_label(name, bucket),
        project_id=None, project_name='',
        execution_id=execution_id, kind='agent_run',
    )
    bucket[record.handle] = record
    if context.get('sink') is not None:
        _tasks.set_sink(parent_thread, context.get('sink'))
    await _emit_task(parent_thread, record, force=True)
    spawn(_follow_adopted(record, parent_thread, context),
          name=f'agent-run-follow:{execution_id}')
    return record


def mark_heard(context: Dict, execution_id: str, status: str) -> None:
    """The lead read this run's outcome itself (`get_agent_run`): not news any more."""
    from agents.agent import tasks as _tasks

    record = _adopted(str(context.get('session_id') or 'run'), execution_id)
    if record is None:
        return
    if status in ('completed', 'failed', 'cancelled', 'timeout'):
        _tasks.finish(record, status=_RECORD_STATUS.get(status, 'failed'))
    elif status == 'paused' and record.status != 'paused':
        _tasks.set_paused(record)
    if record.status in _tasks.REPORTED_STATUSES:
        record.reported_status = record.status


async def _follow_adopted(record, parent_thread: str, context: Dict) -> None:
    from agents.agent import tasks as _tasks

    try:
        row = await _follow_approval(record, parent_thread,
                                     poll_seconds=ADOPTED_RUN_POLL_SECONDS)
        if row is not None:
            await _finish_from_run(record, row, context)
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception('[Tasks] Lost track of run %s', record.execution_id)
        _tasks.finish(record, status='failed', error=f'Lost track of the run: {exc}')
    finally:
        await _emit_task(parent_thread, record, force=True)
    await _deliver_late(record, parent_thread, context.get('user_id'))


async def _deliver_late(record, parent_thread: str, user_id) -> None:
    """Post a finished run's result into the chat if no lead turn heard it.

    A lead turn that is still going takes it at its next step (`take_reports`
    marks it reported), so this waits while one runs. When no turn is going,
    because it was stopped, ran out of time or never waited, the result is
    written into the conversation and the person is notified: "no output yet"
    must never be the last word on a run that finished.
    """
    from chat.turn import runs as chat_runs

    deadline = time.monotonic() + LATE_DELIVERY_MAX_WAIT_SECONDS
    while record.reported_status != record.status:
        live = chat_runs.get(parent_thread)
        if live is None or live.status != 'running' or time.monotonic() >= deadline:
            break
        await asyncio.sleep(ADOPTED_RUN_POLL_SECONDS)
    if record.reported_status == record.status:
        return
    # Claimed before the write: a turn starting meanwhile must not report it too.
    record.reported_status = record.status
    try:
        from asgiref.sync import sync_to_async

        posted = await sync_to_async(post_run_result)(
            parent_thread, user_id, record.execution_id,
            agent_name=record.agent_name, title=record.title)
    except Exception:  # noqa: BLE001
        logger.exception('[Tasks] Could not post the result of %s', record.execution_id)
        posted = False
    if not posted:
        # Not a chat (an agent lead), or the write failed: leave it for the
        # lead's next step.
        record.reported_status = ''


def late_result_text(*, agent_name: str, title: str, status: str,
                     answer: str, error: str) -> str:
    """The chat message for a run whose result arrived after its turn."""
    who = agent_name or 'The agent'
    task = f' on "{title}"' if title and title != agent_name else ''
    if len(answer) > LATE_ANSWER_CHARS:
        answer = answer[:LATE_ANSWER_CHARS] + '\n\n[Cut here. The whole answer is on /runs.]'
    if status == 'completed':
        body = answer or '(It returned no text.)'
        return f'**{who} finished**{task}. Here is its answer:\n\n{body}'
    if status == 'cancelled':
        head = f'**{who} was stopped**{task} before it finished.'
    else:
        head = f'**{who} stopped before finishing**{task}: {error or status}.'
    found = f'\n\nWhat it had written so far:\n\n{answer}' if answer else ''
    return (f'{head}{found}\n\nEverything it did is kept on /runs, and I can read '
            f'its transcript and tell you what it found if you ask.')


def post_run_result(session_id: str, user_id, execution_id: str, *,
                    agent_name: str = '', title: str = '') -> bool:
    """Write a delegated run's result into its chat and notify the owner. Sync.

    False when `session_id` is not this user's chat (an agent lead's thread,
    or a deleted chat). The message carries `delegated_run`, which history
    replays as a pointer, not as the worker's text: that text is third-party
    data and reaches the model only through `get_agent_run`, inside the
    untrusted envelope.
    """
    from django.contrib.auth import get_user_model
    from django.core.exceptions import ValidationError
    from django.utils import timezone

    from chat.models import ChatMessage, ChatSession
    from logs.models import ExecutionLog
    from notifications.utils import create_notification

    if not user_id:
        return False
    try:
        session = ChatSession.objects.filter(id=session_id, user_id=user_id).first()
    except (ValueError, ValidationError):
        return False
    if session is None:
        return False
    if ChatMessage.objects.filter(
            session=session,
            metadata__delegated_run__execution_id=execution_id).exists():
        # Already posted: by the in-process follower, or by crash recovery.
        return True
    row = (ExecutionLog.objects.filter(execution_id=execution_id, user_id=user_id)
           .values('status', 'output_data', 'error_message').first())
    if row is None:
        return False
    output = row['output_data'] if isinstance(row['output_data'], dict) else {}
    status = row['status']
    content = late_result_text(
        agent_name=agent_name, title=title, status=status,
        answer=str(output.get('answer') or ''), error=row['error_message'] or '')
    ChatMessage.objects.create(
        session=session, role='assistant', content=content,
        metadata={'delegated_run': {
            'execution_id': execution_id, 'agent_name': agent_name,
            'status': status, 'title': title,
        }, ChatMessage.RECORD_KEY: True},
    )
    ChatSession.objects.filter(pk=session.pk).update(updated_at=timezone.now())

    finished = status == 'completed'
    where = f': {title}' if title else ''
    create_notification(
        user=get_user_model().objects.filter(id=user_id).first(),
        type='agent_update',
        title=f'{agent_name or "Agent"} {"finished" if finished else "stopped"}',
        message=(f'Its result is in your chat{where}.' if finished
                 else 'It stopped before finishing. Open the chat to see why.'),
        data={'session_id': str(session.pk), 'execution_id': execution_id,
              'action_url': f'/ai-chat?session={session.pk}'},
        # Email belongs to the digest; this is a live nudge.
        send_email=False,
    )
    return True


def _agent_run_line(r) -> str:
    """The report line for an adopted run. Points at the answer, never inlines
    it: reports reach the model as system text, outside the untrusted envelope,
    and the worker's answer is built from third-party pages."""
    head = f'{r.handle}: {r.agent_name} run {r.execution_id}'
    if r.status == 'done':
        return (f'{head} finished. Read its answer now with get_agent_run '
                f'(execution_id {r.execution_id}, wait_seconds 0) and give the '
                f'user what they asked for.')
    if r.status == 'failed':
        return (f'{head} failed: {r.error[:500]}. Call get_agent_run with its '
                f'execution_id; it returns the worker transcript, so you can '
                f'still tell the user what it found before it failed.')
    if r.status == 'paused':
        return (f'{head} paused and is waiting on you. Call get_agent_run to see '
                f'what it asks (waiting_on), then answer it with answer_subagent.')
    return f'{head} was stopped. get_agent_run returns what it did before that.'
