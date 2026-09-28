"""
The mission chain, end to end without a model: launch detached, settle the
finished run, decide the next step.

Before 2026-09-28 none of this was connected: the sweep passed `mission_id=`
to a function that did not take it (every launch raised), `after_run` had no
caller, the mission tools never saw a mission id, and the sweep ran nowhere
in production because it waited for each run.
"""
from datetime import timedelta
from unittest import mock

from asgiref.sync import async_to_sync
from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone

from agents.agent.runtime import AgentRunRefused, _open_log
from agents.models import SubAgent
from logs.models import ExecutionLog
from missions import sweep as mission_sweep
from missions.models import Mission


class MissionSweepTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='owner', password='pw')
        self.agent = SubAgent.objects.create(user=self.user, name='Scout',
                                             allow_unattended=True)
        self.launched = []

    def _mission(self, **fields):
        defaults = dict(user=self.user, agent=self.agent, goal='Ship it',
                        budget_inr=500, next_wake_at=timezone.now() - timedelta(seconds=1))
        defaults.update(fields)
        return Mission.objects.create(**defaults)

    def _fake_start(self, status='running'):
        async def start(agent, goal, *, user, trigger_type, caller, mission_id):
            self.launched.append({'goal': goal, 'caller': caller, 'mission_id': mission_id})
            log = await _open_log_async(agent, user, goal, mission_id)
            return str(log.execution_id)
        return start

    def _sweep(self, **kw):
        return async_to_sync(mission_sweep.sweep)(**kw)

    def _finish(self, mission, status='completed', **output):
        log = ExecutionLog.objects.get(execution_id=mission.current_execution_id)
        log.status = status
        log.output_data = output
        log.save()
        return log

    def test_a_due_mission_is_launched_detached_with_its_id(self):
        mission = self._mission()
        with mock.patch('agents.agent.runtime.start_agent_run', self._fake_start()):
            counts = self._sweep()
        self.assertEqual(counts.get('fired'), 1)
        mission.refresh_from_db()
        self.assertEqual(self.launched[0]['caller'], 'mission')
        self.assertEqual(self.launched[0]['mission_id'], mission.id)
        self.assertIn('Ship it', self.launched[0]['goal'])
        self.assertIsNone(mission.next_wake_at)
        log = ExecutionLog.objects.get(execution_id=mission.current_execution_id)
        self.assertEqual(log.mission_id, mission.id)

    def test_a_running_mission_is_not_launched_twice(self):
        self._mission()
        with mock.patch('agents.agent.runtime.start_agent_run', self._fake_start()):
            self._sweep()
            self._sweep()
        self.assertEqual(len(self.launched), 1)

    def test_complete_mission_closes_it(self):
        mission = self._mission()
        with mock.patch('agents.agent.runtime.start_agent_run', self._fake_start()):
            self._sweep()
            mission.refresh_from_db()
            self._finish(mission, tool_trace=[
                {'tool': 'complete_mission', 'args': {'summary': 'All shipped.'}}])
            self._sweep()
        mission.refresh_from_db()
        self.assertEqual(mission.status, 'done')
        self.assertEqual(mission.runs_done, 1)
        self.assertEqual(mission.last_report, 'All shipped.')
        self.assertEqual(mission.current_execution_id, '')

    def test_open_todos_start_the_next_run(self):
        mission = self._mission()
        todos = [{'text': 'Draft', 'status': 'done'}, {'text': 'Send', 'status': 'open'}]
        with mock.patch('agents.agent.runtime.start_agent_run', self._fake_start()):
            self._sweep()
            mission.refresh_from_db()
            self._finish(mission, todos=todos)
            self._sweep()
        mission.refresh_from_db()
        self.assertEqual(mission.runs_done, 1)
        self.assertEqual(mission.plan, todos)
        self.assertEqual(len(self.launched), 2)
        self.assertIn('[open] Send', self.launched[1]['goal'])

    def test_wait_for_parks_the_mission(self):
        mission = self._mission()
        with mock.patch('agents.agent.runtime.start_agent_run', self._fake_start()):
            self._sweep()
            mission.refresh_from_db()
            self._finish(mission, todos=[{'text': 'x', 'status': 'open'}], tool_trace=[
                {'tool': 'wait_for', 'args': {'event': 'time', 'timeout': 3600}}])
            self._sweep()
        mission.refresh_from_db()
        self.assertEqual(mission.status, 'waiting')
        self.assertGreater(mission.next_wake_at, timezone.now() + timedelta(minutes=50))

    def test_a_failed_run_retries_later_and_is_not_done(self):
        mission = self._mission()
        with mock.patch('agents.agent.runtime.start_agent_run', self._fake_start()):
            self._sweep()
            mission.refresh_from_db()
            self._finish(mission, status='failed')
            self._sweep()
        mission.refresh_from_db()
        self.assertEqual(mission.status, 'active')
        self.assertEqual(mission.no_progress_runs, 1)
        self.assertGreater(mission.next_wake_at, timezone.now())

    def test_three_failures_pause_it(self):
        mission = self._mission(no_progress_runs=2)
        with mock.patch('agents.agent.runtime.start_agent_run', self._fake_start()):
            self._sweep()
            mission.refresh_from_db()
            self._finish(mission, status='failed')
            self._sweep()
        mission.refresh_from_db()
        self.assertEqual(mission.status, 'paused')

    def test_a_paused_run_is_left_until_it_ends(self):
        mission = self._mission()
        with mock.patch('agents.agent.runtime.start_agent_run', self._fake_start()):
            self._sweep()
            mission.refresh_from_db()
            self._finish(mission, status='paused')
            counts = self._sweep()
        self.assertNotIn('settled', counts)
        mission.refresh_from_db()
        self.assertNotEqual(mission.current_execution_id, '')

    def test_a_refused_start_pauses_with_the_reason(self):
        mission = self._mission()

        async def refuse(*a, **kw):
            raise AgentRunRefused('Spend cap reached')

        with mock.patch('agents.agent.runtime.start_agent_run', refuse):
            counts = self._sweep()
        self.assertEqual(counts.get('refused'), 1)
        mission.refresh_from_db()
        self.assertEqual(mission.status, 'paused')
        self.assertIn('Spend cap reached', mission.last_report)
        self.assertEqual(mission.current_execution_id, '')

    def test_owner_pause_while_running_is_kept(self):
        mission = self._mission()
        with mock.patch('agents.agent.runtime.start_agent_run', self._fake_start()):
            self._sweep()
            mission.refresh_from_db()
            Mission.objects.filter(id=mission.id).update(status='paused')
            self._finish(mission, todos=[{'text': 'x', 'status': 'open'}])
            self._sweep()
        mission.refresh_from_db()
        self.assertEqual(mission.status, 'paused')
        self.assertEqual(mission.runs_done, 1)
        self.assertEqual(len(self.launched), 1)


class MissionIdReachesTheToolsTests(TestCase):
    def test_tool_context_carries_mission_id(self):
        from chat.turn import agent as turn_agent

        self.assertIn('mission_id', {f.name for f in
                                     turn_agent.TurnContext.__dataclass_fields__.values()})
        source = open(turn_agent.__file__, encoding='utf-8').read()
        self.assertIn('"mission_id": turn.mission_id', source)

    def test_the_scheduler_runs_the_mission_sweep(self):
        from agents import scheduler

        self.assertIn('missions.sweep_missions',
                      {job.task for job in scheduler.PERIODIC_JOBS})
        self.assertNotIn('missions.sweep_missions', scheduler.NOT_IN_PROCESS)


async def _open_log_async(agent, user, goal, mission_id):
    # `_open_log` is already wrapped in `sync_to_async`.
    return await _open_log(agent, user, goal, 'api', 't',
                           caller='mission', mission_id=mission_id)
