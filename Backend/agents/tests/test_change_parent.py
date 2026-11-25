"""
A worker's change set hangs under the set of the call that delegated it
(docs/UNDO_PLAN.md D7, §7 Phase 5).

What these pin: each of the three worker-starting tools (`run_agent`,
`invoke_subagent`, `start_tasks`) hands its chat set to the run it starts,
including the detached workers of `start_tasks`, whose spawned task has an
empty context and must get the id as an argument; a run started with a parent
records its change under that parent, so `summary(parent)` counts it; and a
paused worker that resumes keeps its set and its parent link, even when it
paused before writing anything.

The run tests use the same `run_turn` stub as `agents/tests/test_taint_inheritance.py`;
the stub binds the turn's `change_owner` and writes a file the way `_dispatch_one`
would, so the real recording path runs.
"""
from __future__ import annotations

import json
import shutil
import tempfile
from unittest.mock import patch

from asgiref.sync import async_to_sync, sync_to_async
from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from agents.agent import tasks as task_registry
from agents.models import SubAgent
from chat.models import ChatMessage, ChatSession
from chat.turn.agent import TurnResult
from inference import vfs
from llm.models import AIModel, AIProvider
from logs import changes
from logs.models import ChangeSet, ExecutionLog
from workspaces.models import CodeProject

_MEDIA = tempfile.mkdtemp(prefix='change-parent-')


async def no_preflight(**kwargs):
    return None


def _write_under(user, owner: dict, path: str) -> None:
    """Write one file with `owner`'s binding, as `_dispatch_one` binds a call."""
    token = changes.bind(changes.Binding(**owner, tool='write_file', call_id='c1'))
    try:
        vfs.write_file(vfs.build_scope(user, vfs.FULL), path, 'hello')
    finally:
        changes.unbind(token)


@override_settings(MEDIA_ROOT=_MEDIA)
class RunParentTests(TransactionTestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(_MEDIA, ignore_errors=True)

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user('delegator', 'd@example.test', 'pw')
        provider, _ = AIProvider.objects.get_or_create(
            slug='openrouter', defaults={'name': 'OpenRouter'})
        AIModel.objects.get_or_create(
            value='stub/model',
            defaults={'provider': provider, 'name': 'Stub', 'is_active': True})
        self.worker = SubAgent.objects.create(
            user=self.user, name='Researcher', prompt='Research the brief.',
            tool_grants={}, guardrails={}, llm_provider='openrouter',
            llm_model='stub/model', allow_unattended=True)
        self.session = ChatSession.objects.create(user=self.user, title='work')
        self.message = ChatMessage.objects.create(
            session=self.session, role='user', content='go', message_type='chat')
        self.owners: list[dict] = []

    async def _run_writing(self, path, **kwargs):
        """Run the worker; its one turn writes `path` (or nothing, for None)."""
        from agents.agent.runtime import run_agent

        async def writing_turn(turn, *, prompt, thread_id, **_):
            self.owners.append(turn.change_owner)
            if path:
                await sync_to_async(_write_under)(self.user, turn.change_owner, path)
            return TurnResult(answer='done')

        with patch('chat.turn.agent.run_turn', writing_turn), \
                patch('llm.access.preflight', no_preflight):
            return await run_agent(self.worker, 'do the work', user=self.user,
                                   **kwargs)

    async def _parent_set(self):
        return await sync_to_async(ChangeSet.objects.create)(
            user=self.user, owner_kind='chat', chat_message=self.message, status='open')

    # -- the run records under the parent it was given ---------------------------

    async def test_a_run_started_with_a_parent_records_under_it(self):
        parent = await self._parent_set()
        await self._run_writing('/a.md', thread_id='t-child',
                                change_parent_id=parent.pk)

        log = await sync_to_async(ExecutionLog.objects.get)(thread_id='t-child')
        child = await sync_to_async(ChangeSet.objects.get)(execution=log)
        self.assertEqual(child.parent_id, parent.pk)
        self.assertEqual(self.owners[-1]['parent_set_id'], parent.pk)
        counted = await sync_to_async(changes.summary)(parent.pk)
        self.assertEqual(counted['total'], 1)
        self.assertEqual(counted['revertible'], 1)

    async def test_a_run_started_without_a_parent_has_no_parent_set(self):
        await self._run_writing('/a.md', thread_id='t-root')
        log = await sync_to_async(ExecutionLog.objects.get)(thread_id='t-root')
        child = await sync_to_async(ChangeSet.objects.get)(execution=log)
        self.assertIsNone(child.parent_id)

    # -- a resumed worker keeps its set and its parent --------------------------

    async def test_a_resumed_run_keeps_its_set_and_its_parent(self):
        parent = await self._parent_set()
        # The worker pauses before it writes anything. Its set must exist already,
        # or the resumed run would make one with no parent.
        await self._run_writing(None, thread_id='t-paused', change_parent_id=parent.pk)
        log = await sync_to_async(ExecutionLog.objects.get)(thread_id='t-paused')
        self.assertEqual(
            await sync_to_async(ChangeSet.objects.filter(execution=log).count)(), 1)

        # The resume passes no parent, as `resume_agent_run` does.
        await self._run_writing('/a.md', thread_id='t-paused', log=log)

        sets = await sync_to_async(list)(ChangeSet.objects.filter(execution=log))
        self.assertEqual(len(sets), 1)
        self.assertEqual(sets[0].parent_id, parent.pk)
        counted = await sync_to_async(changes.summary)(parent.pk)
        self.assertEqual(counted['total'], 1)


def _ctx(user, thread='lead-thread', **kw):
    base = {
        'user_id': user.id, 'session_id': thread, 'turn_id': 'turn-1', 'depth': 0,
        'delegation_scope': None, 'code_projects': None, 'write_paths': None,
        'command_scope': None, 'tool_permissions': {}, 'file_scope': None,
        'deadline': None,
    }
    base.update(kw)
    return base


class FakeRun:
    def __init__(self):
        self.answer = 'did the thing'
        self.tokens = 10
        self.awaiting_approval = False


def _finished_run(user) -> str:
    now = timezone.now()
    log = ExecutionLog.objects.create(
        user=user, status='completed', trigger_type='api', caller='chat',
        started_at=now, completed_at=now)
    return str(log.execution_id)


class DelegatingToolTests(TransactionTestCase):
    """Each worker-starting tool hands the chat's change set to the run it starts."""

    def setUp(self):
        cache.clear()
        task_registry.clear()
        self.addCleanup(task_registry.clear)
        self.user = User.objects.create_user('lead', 'lead@example.test', 'pw')
        provider, _ = AIProvider.objects.get_or_create(
            slug='openrouter', defaults={'name': 'OpenRouter'})
        AIModel.objects.get_or_create(
            value='stub/model',
            defaults={'provider': provider, 'name': 'Stub', 'is_active': True})
        self.worker = SubAgent.objects.create(
            user=self.user, name='Researcher', prompt='Research the brief.',
            tool_grants={}, guardrails={}, llm_provider='openrouter',
            llm_model='stub/model', allow_unattended=True)
        self.project = CodeProject.objects.create(
            user=self.user, name='api', workspace_path='/home/user/projects/api')
        self.impl = SubAgent.objects.create(
            user=self.user, name='Impl', template_slug='code-implementer',
            tool_grants={'shell': True, 'subAgents': False},
            guardrails={'autonomy': 'auto', 'spendCapRupees': 600},
            agent_context={}, allow_unattended=True)
        self.session = ChatSession.objects.create(user=self.user, title='work')
        self.message = ChatMessage.objects.create(
            session=self.session, role='user', content='go', message_type='chat')

    def _bind_chat(self):
        return changes.bind(changes.Binding(
            user_id=self.user.id, owner_kind='chat', chat_message_id=self.message.id,
            tool='delegate', call_id='c1'))

    async def _chat_set_pk(self) -> int:
        return await sync_to_async(
            lambda: ChangeSet.objects.get(chat_message=self.message, status='open').pk)()

    def test_run_agent_passes_the_chat_set_to_the_run_it_starts(self):
        async def scenario():
            from chat.tools.agents import run_agent as run_agent_tool

            started = {}

            async def fake_start(agent, goal, **kwargs):
                started.update(kwargs)
                return await sync_to_async(_finished_run)(self.user)

            token = self._bind_chat()
            try:
                with patch('agents.agent.runtime.start_agent_run', fake_start):
                    await run_agent_tool(
                        {'agent_id': self.worker.id, 'goal': 'find it', 'wait_seconds': 0},
                        {'user_id': self.user.id, 'session_id': 'chat-1'})
            finally:
                changes.unbind(token)
            return started, await self._chat_set_pk()

        started, chat_set = async_to_sync(scenario)()
        self.assertEqual(started['change_parent_id'], chat_set)

    def test_invoke_subagent_passes_the_chat_set_to_each_worker(self):
        async def scenario():
            from chat.tools.agents import invoke_subagent

            seen = []

            async def capture(turn, *, prompt, thread_id, **_):
                seen.append(turn)
                return TurnResult(answer='done')

            token = self._bind_chat()
            try:
                with patch('chat.turn.agent.run_turn', capture), \
                        patch('llm.access.preflight', no_preflight):
                    await invoke_subagent(
                        {'agent_id': self.worker.id,
                         'tasks': ['find the figures', 'find the dates']},
                        {'user_id': self.user.id, 'session_id': 'parent-thread', 'depth': 0})
            finally:
                changes.unbind(token)
            return seen, await self._chat_set_pk()

        seen, chat_set = async_to_sync(scenario)()
        self.assertEqual(len(seen), 2)
        for turn in seen:
            self.assertEqual(turn.change_owner['parent_set_id'], chat_set)

    def test_start_tasks_hands_the_chat_set_into_the_detached_worker(self):
        async def scenario():
            from chat.tools import tasks as dispatch

            seen, contexts = [], []

            async def fake_run(agent, goal, **kwargs):
                seen.append(kwargs)
                # The spawned task's own context: it must hold no binding, so the
                # id can only have arrived as the argument.
                contexts.append(changes.current())
                return FakeRun()

            task = {'id': 't1', 'title': 'Task t1', 'agent': 'code-implementer',
                    'instructions': 'do it', 'claims': ['src/a.ts'], 'project': 'api'}
            token = self._bind_chat()
            try:
                with patch('agents.agent.runtime.run_agent', side_effect=fake_run):
                    out = json.loads(await dispatch.start_tasks(
                        {'tasks': [task]}, _ctx(self.user)))
                    await dispatch.wait_tasks(
                        {'until': 'all', 'timeout_s': 30}, _ctx(self.user))
            finally:
                changes.unbind(token)
            return out, seen, contexts, await self._chat_set_pk()

        out, seen, contexts, chat_set = async_to_sync(scenario)()
        self.assertEqual(len(out['started']), 1, out)
        self.assertEqual(seen[0]['change_parent_id'], chat_set)
        self.assertEqual(contexts, [None])
