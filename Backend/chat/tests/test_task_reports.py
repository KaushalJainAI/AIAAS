"""
Background work reports in by itself, and a lead does not end over work it began.

Three behaviours, each pinned here:

- A worker's finish, failure or pause is reported to its lead once, at the next
  step boundary (`steering_node`), as a `<task-reports>` system message. A
  `wait_tasks` return marks what it returned, so the same change is never told
  twice.
- A lead that answers while a worker is still going waits (`await_reports`) and
  goes on with the report, instead of ending the turn. A lead with nothing live
  ends exactly as before.
- A steer or a user message that lands while the model writes its final answer
  is read at the steering boundary, and a `wait_tasks` in progress returns early
  when one is waiting.

The graph tests drive the real `run_turn` with a scripted model, so they also
prove that LangGraph hands the router its `config`.
"""
from __future__ import annotations

import asyncio
import time
import uuid
from unittest.mock import patch

from asgiref.sync import async_to_sync
from django.test import SimpleTestCase, TestCase
from langchain_core.messages import HumanMessage, SystemMessage

from agents.agent import tasks as task_registry
from chat.tools import tasks as task_tools
from chat.turn import agent as agent_module
from chat.turn import steering
from chat.turn.agent import TurnContext, run_turn
from chat.turn.events import Event
from llm.access import Completion


def _record(handle: str = 't1') -> task_registry.CodeTask:
    return task_registry.CodeTask(
        handle=handle, task_id=handle, title=f'Task {handle}',
        agent_id=None, agent_name='Implementer', label='Implementer #1',
        project_id=None, project_name='api', execution_id='')


def _add(thread: str, record: task_registry.CodeTask) -> task_registry.CodeTask:
    task_registry._bucket(thread)[record.handle] = record
    return record


def _turn(thread: str, **kw) -> TurnContext:
    return TurnContext(
        provider='openrouter', model='test/model', system_message='',
        user_id=1, session_id=thread, intent='chat', user_text='go',
        memory_enabled=False, **kw)


def _config(thread: str) -> dict:
    return {'configurable': {'turn': _turn(thread)}}


def _ctx(thread: str) -> dict:
    return {'session_id': thread, 'user_id': 1}


class _Mailbox(TestCase):
    def setUp(self):
        steering.clear()
        task_registry.clear()
        self.addCleanup(steering.clear)
        self.addCleanup(task_registry.clear)


class ReportDeliveryTests(_Mailbox):
    def test_a_finished_task_is_reported_once_at_the_steering_boundary(self):
        thread = 'lead-report-once'
        record = _add(thread, _record('t1'))
        task_registry.finish(record, status='done', answer='patched a.py')

        first = async_to_sync(agent_module.steering_node)({}, _config(thread))

        self.assertEqual(len(first['messages']), 1)
        report = first['messages'][0]
        self.assertIsInstance(report, SystemMessage)
        self.assertTrue(report.content.startswith('<task-reports>\n'))
        self.assertTrue(report.content.endswith('\n</task-reports>'))
        self.assertIn('t1 (Task t1): done by Implementer #1 — patched a.py',
                      report.content)
        self.assertEqual(record.reported_status, 'done')

        second = async_to_sync(agent_module.steering_node)({}, _config(thread))
        self.assertEqual(second, {}, 'the same finish must not be reported twice')

    def test_a_report_comes_before_a_steer_and_the_steer_stays_last(self):
        thread = 'lead-report-order'
        task_registry.finish(_add(thread, _record('t1')), status='done', answer='ok')
        steering.post(thread, 'also check pricing')

        out = async_to_sync(agent_module.steering_node)({}, _config(thread))

        kinds = [type(m) for m in out['messages']]
        self.assertEqual(kinds, [SystemMessage, HumanMessage])
        self.assertEqual(out['messages'][-1].content, 'also check pricing')

    def test_each_status_change_is_reported_and_nothing_else(self):
        thread = 'lead-report-changes'
        record = _add(thread, _record('t1'))

        self.assertEqual(async_to_sync(task_tools.take_reports)(thread), '',
                         'a running worker is not news')

        record.status = 'paused'
        paused = async_to_sync(task_tools.take_reports)(thread)
        self.assertIn('paused for approval', paused)
        self.assertEqual(async_to_sync(task_tools.take_reports)(thread), '')

        task_registry.finish(record, status='done', answer='at last')
        done = async_to_sync(task_tools.take_reports)(thread)
        self.assertIn('done by Implementer #1', done)
        self.assertEqual(async_to_sync(task_tools.take_reports)(thread), '')

    def test_a_failure_is_reported_with_its_error(self):
        thread = 'lead-report-failed'
        record = _add(thread, _record('t2'))
        task_registry.finish(record, status='failed', error='tests went red')

        report = async_to_sync(task_tools.take_reports)(thread)

        self.assertIn('t2 (Task t2): failed — tests went red', report)

    def test_a_wait_that_returns_an_event_means_it_is_not_repeated_at_a_boundary(self):
        thread = 'lead-wait-marks'
        record = _add(thread, _record('t1'))
        task_registry.finish(record, status='done', answer='ok')

        waited = async_to_sync(task_tools.wait_tasks)(
            {'until': 'all', 'timeout_s': 5}, _ctx(thread))

        import json
        events = json.loads(waited)['events']
        self.assertTrue(any('done by' in e for e in events), waited)
        self.assertEqual(async_to_sync(task_tools.take_reports)(thread), '')

    def test_a_boundary_that_reported_it_means_a_later_wait_does_not_repeat_it(self):
        import json

        thread = 'lead-boundary-first'
        record = _add(thread, _record('t1'))
        task_registry.finish(record, status='done', answer='ok')
        self.assertIn('done by', async_to_sync(task_tools.take_reports)(thread))

        waited = json.loads(async_to_sync(task_tools.wait_tasks)(
            {'until': 'all', 'timeout_s': 5}, _ctx(thread)))

        self.assertEqual(waited['events'], [])
        self.assertIn('t1:done', waited['progress'])

    def test_a_run_with_no_tasks_reads_nothing_and_creates_no_bucket(self):
        thread = 'lead-no-tasks'

        self.assertEqual(async_to_sync(task_tools.take_reports)(thread), '')
        self.assertNotIn(thread, task_registry._tasks)
        self.assertFalse(task_tools.has_news(thread))
        self.assertFalse(task_tools.has_running(thread))


class WaitTasksEarlyReturnTests(_Mailbox):
    def test_wait_tasks_returns_when_a_steer_arrives_mid_wait(self):
        import json

        thread = 'lead-steer-wait'
        _add(thread, _record('t1'))

        async def scenario():
            loop = asyncio.get_running_loop()
            loop.call_later(0.2, steering.post, thread, 'stop after this file')
            started = time.monotonic()
            raw = await task_tools.wait_tasks(
                {'until': 'all', 'timeout_s': 60}, _ctx(thread))
            return json.loads(raw), time.monotonic() - started

        out, elapsed = async_to_sync(scenario)()

        self.assertEqual(out.get('note'), task_tools.STEER_WAITING_NOTE)
        self.assertLess(elapsed, 30, 'a steer must not wait out the window')

    def test_a_pending_change_notice_also_ends_the_wait(self):
        import json

        thread = 'lead-notice-wait'
        _add(thread, _record('t1'))
        steering.post_notice(thread, 'a.py changed while you waited')

        raw = async_to_sync(task_tools.wait_tasks)(
            {'until': 'all', 'timeout_s': 60}, _ctx(thread))

        self.assertEqual(json.loads(raw).get('note'), task_tools.STEER_WAITING_NOTE)

    def test_a_wait_with_nothing_happening_times_out(self):
        thread = 'lead-quiet'
        record = _add(thread, _record('t1'))

        reason = async_to_sync(task_tools.wait_for_news)(
            thread, [record], until='any', timeout=0, steer_key=thread)

        self.assertEqual(reason, 'timeout')


class RoutingTests(SimpleTestCase):
    """The routers, given states and configs directly. No model, no graph."""

    def setUp(self):
        steering.clear()
        task_registry.clear()
        self.addCleanup(steering.clear)
        self.addCleanup(task_registry.clear)
        self.thread = f'route-{uuid.uuid4()}'
        self.config = _config(self.thread)

    def _final(self, **extra):
        from langchain_core.messages import AIMessage
        return {'messages': [AIMessage(content='answer')], **extra}

    def test_a_tool_call_still_goes_to_tools(self):
        from langchain_core.messages import AIMessage
        state = {'messages': [AIMessage(content='', tool_calls=[
            {'name': 'web_search', 'args': {}, 'id': 'c1'}])]}
        self.assertEqual(agent_module._next_step(state, self.config), 'tools')

    def test_a_final_answer_with_nothing_live_ends_as_before(self):
        from langgraph.graph import END
        self.assertEqual(agent_module._next_step(self._final(), self.config), END)

    def test_a_steer_pending_at_the_final_answer_goes_to_steering(self):
        steering.post(self.thread, 'also pricing')
        self.assertEqual(agent_module._next_step(self._final(), self.config), 'steering')

    def test_an_unreported_finish_goes_to_steering_so_the_model_hears_it(self):
        record = _add(self.thread, _record('t1'))
        task_registry.finish(record, status='done', answer='ok')
        self.assertEqual(agent_module._next_step(self._final(), self.config), 'steering')

    def test_a_running_worker_holds_the_answer_open(self):
        _add(self.thread, _record('t1'))
        self.assertEqual(
            agent_module._next_step(self._final(), self.config), 'await_reports')

    def test_a_paused_worker_holds_the_answer_open_until_its_approval(self):
        record = _add(self.thread, _record('t1'))
        record.status = 'paused'
        record.reported_status = 'paused'
        self.assertEqual(
            agent_module._next_step(self._final(), self.config), 'await_reports')

    def test_a_worker_that_finished_after_its_approval_lets_the_lead_end(self):
        from langgraph.graph import END
        record = _add(self.thread, _record('t1'))
        record.status = 'paused'
        record.reported_status = 'paused'
        task_registry.set_resumed(record)
        task_registry.finish(record, status='done', answer='ok')
        record.reported_status = 'done'
        self.assertEqual(agent_module._next_step(self._final(), self.config), END)

    def test_the_round_budget_ends_the_wait(self):
        from langgraph.graph import END
        _add(self.thread, _record('t1'))
        state = self._final(await_rounds=agent_module.MAX_AWAIT_ROUNDS)
        self.assertEqual(agent_module._next_step(state, self.config), END)

    def test_a_failed_model_call_does_not_wait(self):
        from langgraph.graph import END
        _add(self.thread, _record('t1'))
        state = self._final(provider_error='upstream refused')
        self.assertEqual(agent_module._next_step(state, self.config), END)

    def test_a_run_out_of_time_does_not_wait(self):
        from langgraph.graph import END

        class _Wrapping:
            wrapping_up = True

        _add(self.thread, _record('t1'))
        config = {'configurable': {'turn': _turn(self.thread, deadline=_Wrapping())}}
        self.assertEqual(agent_module._next_step(self._final(), config), END)

    def test_a_wait_that_heard_news_goes_to_steering(self):
        self.assertEqual(
            agent_module._after_await({'await_idle': False}, self.config), 'steering')

    def test_a_silent_window_waits_again_while_work_is_running(self):
        _add(self.thread, _record('t1'))
        state = {'await_idle': True, 'await_rounds': 1}
        self.assertEqual(
            agent_module._after_await(state, self.config), 'await_reports')

    def test_a_silent_window_with_the_budget_spent_ends(self):
        from langgraph.graph import END
        _add(self.thread, _record('t1'))
        state = {'await_idle': True, 'await_rounds': agent_module.MAX_AWAIT_ROUNDS}
        self.assertEqual(agent_module._after_await(state, self.config), END)


class _Lead:
    """A lead run with a scripted model. `on_call(index, thread)` may act on the
    world between model calls, as a worker or a person would."""

    def __init__(self, *answers: Completion, on_call=None):
        self.answers = list(answers)
        self.prompts: list[str] = []
        self.histories: list[list] = []
        self.on_call = on_call
        self.thread = f'lead-{uuid.uuid4()}'

    async def model(self, turn, *, prompt, history, tools, **_):
        self.prompts.append(prompt)
        self.histories.append(list(history))
        if self.on_call is not None:
            self.on_call(len(self.prompts), self.thread)
        return self.answers.pop(0) if self.answers else Completion(content='done')

    async def dispatch(self, name, args, context):
        return f'{name} ran'

    async def tools(self):
        return []

    def run(self):
        turn = TurnContext(
            provider='openrouter', model='test/model', system_message='',
            user_id=1, session_id=self.thread, intent='chat',
            user_text='go', memory_enabled=False,
            tool_source=self.tools, tool_dispatch=self.dispatch,
            sensitive_tools=frozenset(),
        )
        with patch('chat.turn.agent._run_model', self.model):
            return async_to_sync(run_turn)(turn, prompt='go', thread_id=self.thread)


class LeadGraphTests(_Mailbox):
    def test_a_lead_answering_while_a_worker_runs_waits_then_reports(self):
        """The answer is not final while the worker is going: the run waits,
        takes the report, and only then answers again."""
        record = None

        def finish_soon(index, thread):
            if index == 1:
                # `call_later` takes positional arguments only, so the finish
                # goes through a lambda: a kwargs call here raised inside the
                # model call and left the worker unfinished for the whole wait.
                asyncio.get_running_loop().call_later(
                    0.1, lambda: task_registry.finish(
                        record, status='done', answer='patched a.py'))

        lead = _Lead(
            Completion(content='Started the work; I will report back.'),
            Completion(content='Done: patched a.py.'),
            on_call=finish_soon,
        )
        record = _add(lead.thread, _record('t1'))

        result = lead.run()

        self.assertEqual(len(lead.prompts), 2,
                         'the first answer must not end the run while a worker runs')
        reports = [m for m in lead.histories[1]
                   if m.get('role') == 'system' and '<task-reports>' in str(m.get('content'))]
        self.assertEqual(len(reports), 1)
        self.assertIn('patched a.py', reports[0]['content'])
        self.assertIn('Done: patched a.py.', result.answer)
        self.assertEqual(record.reported_status, 'done')

    def test_a_lead_with_nothing_live_answers_once_and_ends(self):
        lead = _Lead(Completion(content='ok'))

        result = lead.run()

        self.assertEqual(result.answer, 'ok')
        self.assertEqual(len(lead.prompts), 1)

    def test_a_lead_whose_reports_were_already_delivered_ends_at_once(self):
        lead = _Lead(Completion(content='ok'))
        record = _add(lead.thread, _record('t1'))
        task_registry.finish(record, status='done', answer='ok')
        async_to_sync(task_tools.take_reports)(lead.thread)

        result = lead.run()

        self.assertEqual(result.answer, 'ok')
        self.assertEqual(len(lead.prompts), 1)

    def test_a_steer_sent_while_the_model_writes_its_answer_is_read_there(self):
        def steer_during_answer(index, thread):
            if index == 1:
                steering.post(thread, 'also check pricing')

        lead = _Lead(
            Completion(content='First draft.'),
            Completion(content='Checked pricing too.'),
            on_call=steer_during_answer,
        )

        result = lead.run()

        self.assertEqual(len(lead.prompts), 2,
                         'a steer that arrived during the answer must reach the model')
        self.assertEqual(lead.prompts[1], 'also check pricing')
        self.assertIn('Checked pricing too.', result.answer)
        self.assertEqual(steering.stats(lead.thread)['queued'], 0)


async def _no_release() -> None:
    """Stands in for `release_db`, which would close the test's DB connection."""


class _Waiting(_Mailbox):
    """Waits that run for real but fast: short laps, a short window, no DB release."""

    def setUp(self):
        super().setUp()
        for patcher in (
            patch.object(task_registry, 'WAIT_POLL_SECONDS', 0.005),
            patch.object(task_tools, 'release_db', _no_release),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)


def _worker(handle: str, label: str, *, age_s: float = 0.0, status: str = 'running'):
    record = _record(handle)
    record.label = label
    record.started_at_ms = int(time.time() * 1000) - int(age_s * 1000)
    record.status = status
    return record


class PausedWorkerTests(_Waiting):
    """A worker waiting on an approval keeps its lead open, is news once when it
    pauses, and is followed to its end so its report reaches the lead."""

    def test_a_paused_worker_is_live_so_the_lead_is_still_waiting_on_it(self):
        thread = 'lead-paused-live'
        record = _add(thread, _record('t1'))
        task_registry.set_paused(record)

        self.assertFalse(record.done.is_set())
        self.assertTrue(task_tools.has_running(thread))

    def test_a_pause_is_news_once_and_then_the_lead_keeps_waiting(self):
        thread = 'lead-pause-news'
        record = _add(thread, _record('t1'))
        task_registry.set_paused(record)

        first = async_to_sync(task_tools.wait_for_news)(
            thread, [record], until='any', timeout=0.05, steer_key=thread)
        self.assertEqual(first, 'news')
        report = async_to_sync(task_tools.take_reports)(thread)
        self.assertIn('paused for approval', report)

        second = async_to_sync(task_tools.wait_for_news)(
            thread, [record], until='any', timeout=0.05, steer_key=thread)
        self.assertEqual(second, 'timeout', 'a paused worker must not end the wait')

    def test_wait_tasks_until_all_still_returns_on_a_pause(self):
        thread = 'lead-pause-all'
        record = _add(thread, _record('t1'))
        task_registry.set_paused(record)

        reason = async_to_sync(task_tools.wait_for_news)(
            thread, [record], until='all', timeout=0.05, steer_key=thread)

        self.assertEqual(reason, 'done')

    def test_the_approval_resumes_the_worker_and_its_report_reaches_the_lead(self):
        thread = 'lead-approval'
        record = _add(thread, _record('t1'))
        task_registry.set_paused(record)
        seen: list[str] = []
        rows = iter([
            {'status': 'paused'},
            {'status': 'running'},
            {'status': 'completed', 'output_data': {'answer': 'patched a.py'},
             'tokens_used': 42, 'error_message': ''},
        ])

        async def read_run(execution_id):
            seen.append(record.status)
            return next(rows)

        with patch.object(task_tools, 'APPROVAL_POLL_SECONDS', 0.0):
            row = async_to_sync(task_tools._follow_approval)(
                record, thread, read_run=read_run)
            async_to_sync(task_tools._finish_from_run)(
                record, row, {'session_id': thread, 'user_id': 1})

        self.assertEqual(seen, ['paused', 'paused', 'running'])
        self.assertEqual(record.status, 'done')
        self.assertTrue(record.done.is_set())
        self.assertEqual(record.tokens, 42)
        report = async_to_sync(task_tools.take_reports)(thread)
        self.assertIn('t1 (Task t1): done by Implementer #1 — patched a.py', report)

    def test_a_second_pause_after_a_resume_is_news_again(self):
        thread = 'lead-second-pause'
        record = _add(thread, _record('t1'))
        task_registry.set_paused(record)
        record.reported_status = 'paused'  # the first pause was already told
        rows = iter([
            {'status': 'running'},   # approved: running again
            {'status': 'paused'},    # asks again
            {'status': 'completed', 'output_data': {'answer': 'ok'}, 'tokens_used': 0},
        ])
        seen: list[tuple[str, bool]] = []

        async def read_run(execution_id):
            seen.append((record.status, task_tools._has_unreported([record])))
            return next(rows)

        with patch.object(task_tools, 'APPROVAL_POLL_SECONDS', 0.0):
            row = async_to_sync(task_tools._follow_approval)(
                record, thread, read_run=read_run)
            async_to_sync(task_tools._finish_from_run)(
                record, row, {'session_id': thread, 'user_id': 1})

        self.assertEqual(seen, [
            ('paused', False),   # the first pause, already reported
            ('running', False),  # resumed: nothing new to say yet
            ('paused', True),    # the second pause is news to the lead
        ])
        self.assertEqual(record.status, 'done')

    def test_a_worker_stopped_while_paused_finishes_its_record(self):
        thread = 'lead-stop-paused'
        record = _add(thread, _record('t1'))
        task_registry.set_paused(record)
        record.execution_id = 'exec-stop'

        task_registry.finish_execution('exec-stop', status='cancelled', error='Stopped.')

        self.assertEqual(record.status, 'cancelled')
        self.assertTrue(record.done.is_set())
        self.assertFalse(task_tools.has_running(thread))


class WaitStatusTests(_Waiting):
    """What the user reads while a lead waits on its workers."""

    def test_paused_workers_are_named_first_and_running_ones_after_them(self):
        paused = _worker('t1', 'Implementer #1', age_s=240, status='paused')
        running = _worker('t2', 'Tester #1', age_s=120)

        message = task_tools.wait_status_message([paused, running])

        self.assertEqual(
            message,
            'Waiting for your approval in the Inbox: Implementer #1 (paused 4m). '
            'Running: Tester #1 (2m)')

    def test_running_workers_only(self):
        first = _worker('t1', 'Implementer #1', age_s=180)
        second = _worker('t2', 'Tester #1', age_s=60)

        message = task_tools.wait_status_message([first, second])

        self.assertEqual(
            message,
            'Waiting on 2 workers: Implementer #1 (running 3m), Tester #1 (running 1m)')

    def test_a_single_worker_is_singular_and_seconds_are_short(self):
        only = _worker('t1', 'Implementer #1', age_s=45)

        self.assertEqual(
            task_tools.wait_status_message([only]),
            'Waiting on 1 worker: Implementer #1 (running 45s)')

    def test_more_than_four_are_cut_with_a_count(self):
        records = [_worker(f't{i}', f'Worker #{i}', age_s=10) for i in range(6)]

        message = task_tools.wait_status_message(records)

        self.assertIn('Worker #3 (running 10s), +2 more', message)
        self.assertNotIn('Worker #4', message)

    def test_nothing_live_means_no_message(self):
        done = _worker('t1', 'Implementer #1')
        task_registry.finish(done, status='done', answer='ok')

        self.assertEqual(task_tools.wait_status_message([done]), '')

    def test_a_wait_announces_itself_on_entry(self):
        thread = 'lead-announce'
        _add(thread, _worker('t1', 'Implementer #1', age_s=180))
        frames: list[tuple] = []

        async def sink(event, payload):
            frames.append((event, payload))

        turn = _turn(thread, sink=sink)
        with patch.object(task_tools, 'WAIT_TASKS_MAX_SECONDS', 0.05), \
                patch.object(task_tools, 'WAIT_HEARTBEAT_SECONDS', 60.0):
            out = async_to_sync(agent_module.await_reports_node)(
                {'await_rounds': 0}, {'configurable': {'turn': turn}})

        statuses = [payload for event, payload in frames if event == Event.STATUS]
        self.assertTrue(statuses, 'a wait must say what it waits for at once')
        self.assertEqual(statuses[0]['phase'], 'waiting_on_workers')
        self.assertIn('Waiting on 1 worker: Implementer #1 (running', statuses[0]['message'])
        self.assertTrue(out['await_idle'], 'a window that heard nothing is idle')

    def test_a_wait_beats_again_while_it_lasts(self):
        thread = 'lead-heartbeat'
        record = _add(thread, _record('t1'))
        beats: list[int] = []

        async def progress(records):
            beats.append(len(records))

        reason = async_to_sync(task_tools.wait_for_news)(
            thread, [record], until='any', timeout=0.05, steer_key=thread,
            progress=progress, heartbeat_seconds=0.001)

        self.assertEqual(reason, 'timeout')
        self.assertGreater(len(beats), 1, 'the heartbeat must fire more than once')

    def test_the_default_interval_is_not_a_flood(self):
        thread = 'lead-heartbeat-default'
        record = _add(thread, _record('t1'))
        beats: list[int] = []

        async def progress(records):
            beats.append(len(records))

        async_to_sync(task_tools.wait_for_news)(
            thread, [record], until='any', timeout=0.05, steer_key=thread,
            progress=progress)

        self.assertEqual(len(beats), 1, 'a short wait beats once, on entry')
