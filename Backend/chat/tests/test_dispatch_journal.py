"""
What one tool call adds to the change log (chat/turn/agent.py::_dispatch_one,
docs/UNDO_PLAN.md D8, D9, D18), and the flags the registry carries for it.

What these pin: a call that did something the log did not see becomes one
"can't be undone from here" row; a read call, a `journal=False` call, a failed
call and a call whose result says it failed add nothing; a call that recorded
its own change adds no second row; a call with no owner runs with no binding,
and a parent's binding comes back after it; and the registry's `journal` flags
name exactly the tools the design lists, none of which is a read tool.

The dispatch tests are sync methods that drive the async call with
`async_to_sync`, so their ORM reads stay outside the event loop.
"""
from __future__ import annotations

import json
from types import SimpleNamespace
from unittest import mock

from asgiref.sync import async_to_sync, sync_to_async
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone

from chat.tools import registry
from chat.turn import agent as turn_agent
from logs import changes
from logs.models import Change, ExecutionLog

User = get_user_model()


def _tool(name, **kwargs):
    return registry.Tool(name=name, schema={}, run=None, **kwargs)


FAKE_TOOLS = {
    'test_send_mail': _tool('test_send_mail', effect='irreversible', external=True,
                            action_label='Send email'),
    'test_read': _tool('test_read', effect='read'),
    'test_note': _tool('test_note', effect='reversible', journal=False),
    'test_reversible': _tool('test_reversible', effect='reversible'),
}


class _Call:
    def __init__(self, name, call_id='c-1'):
        self.name = name
        self.id = call_id


class DispatchCase(TestCase):
    def setUp(self):
        cache.clear()
        patcher = mock.patch.dict(registry._REGISTRY, FAKE_TOOLS)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.user = User.objects.create_user('owner', 'owner@example.com', 'pw')
        self.log = ExecutionLog.objects.create(
            user=self.user, status='running', trigger_type='manual', caller='api',
            started_at=timezone.now(),
        )
        self.owner = {'user_id': self.user.id, 'owner_kind': 'run',
                      'execution_id': str(self.log.execution_id), 'parent_set_id': None}

    def batch(self, dispatch, owner='default'):
        context = {'change_owner': self.owner if owner == 'default' else owner}
        return SimpleNamespace(tool_context=context, answers={}, decided=set(),
                               dispatch=dispatch)

    def run_call(self, name, output, *, args=None, owner='default', call_id='c-1'):
        """Dispatch one call whose tool returns `output` (or raises it)."""
        async def dispatch(tool_name, arguments, ctx):
            if isinstance(output, Exception):
                raise output
            return output

        return async_to_sync(turn_agent._dispatch_one)(
            self.batch(dispatch, owner=owner), _Call(name, call_id), args or {})

    def rows(self):
        return Change.objects.filter(change_set__execution=self.log)


class UntrackedRowTests(DispatchCase):
    def test_an_untracked_irreversible_call_is_one_row(self):
        status = self.run_call('test_send_mail', '{"sent": true}',
                               args={'to': 'ana@example.com', 'subject': 'Hi'})[1]
        self.assertEqual(status, 'completed')
        [row] = self.rows()
        self.assertEqual(row.target_type, '')
        self.assertFalse(row.revertible)
        self.assertEqual(row.label, 'Send email: ana@example.com')
        self.assertTrue(row.reason.startswith('Left the app'))
        self.assertEqual(row.tool, 'test_send_mail')
        self.assertEqual(row.call_id, 'c-1')

    def test_an_unregistered_tool_counts_as_external(self):
        self.run_call('mcp__drive__delete_file', '{"ok": true}', args={'path': '/old.md'})
        [row] = self.rows()
        self.assertTrue(row.reason.startswith('Left the app'))
        self.assertEqual(row.label, 'mcp__drive__delete_file: /old.md')

    def test_a_reversible_tool_with_no_label_uses_its_name(self):
        self.run_call('test_reversible', 'done')
        [row] = self.rows()
        self.assertEqual(row.label, 'test_reversible')
        self.assertTrue(row.reason.startswith('Not tracked here'))

    def test_a_call_that_recorded_its_own_change_gets_no_second_row(self):
        async def dispatch(tool_name, arguments, ctx):
            await sync_to_async(changes.record_untracked)(
                label='its own row', external=False, effect='reversible')
            return 'done'

        async_to_sync(turn_agent._dispatch_one)(
            self.batch(dispatch), _Call('test_reversible'), {})
        [row] = self.rows()
        self.assertEqual(row.label, 'its own row')


class NothingJournaledTests(DispatchCase):
    def test_a_read_call_adds_nothing(self):
        self.run_call('test_read', '{"items": []}')
        self.assertEqual(self.rows().count(), 0)

    def test_a_journal_false_call_adds_nothing(self):
        self.run_call('test_note', 'saved')
        self.assertEqual(self.rows().count(), 0)

    def test_a_result_that_says_error_adds_nothing(self):
        self.run_call('test_send_mail', json.dumps({'error': 'Recipient not allowed.'}))
        self.assertEqual(self.rows().count(), 0)

    def test_a_failed_call_adds_nothing(self):
        status = self.run_call('test_send_mail', RuntimeError('smtp down'))[1]
        self.assertEqual(status, 'failed')
        self.assertEqual(self.rows().count(), 0)


class BindingAtDispatchTests(DispatchCase):
    def test_the_call_runs_bound_to_its_own_owner_and_tool(self):
        seen = []

        async def dispatch(tool_name, arguments, ctx):
            binding = changes.current()
            seen.append((binding.owner_kind, binding.tool, binding.call_id))
            return 'done'

        async_to_sync(turn_agent._dispatch_one)(
            self.batch(dispatch), _Call('test_reversible', 'c-9'), {})
        self.assertEqual(seen, [('run', 'test_reversible', 'c-9')])

    def test_a_call_with_no_owner_runs_with_no_binding(self):
        # D18: an eval, or an inline child run, must not write into a parent's set.
        seen = []

        async def dispatch(tool_name, arguments, ctx):
            seen.append(changes.current())
            return 'done'

        async_to_sync(turn_agent._dispatch_one)(
            self.batch(dispatch, owner=None), _Call('test_send_mail'), {})
        self.assertEqual(seen, [None])
        self.assertEqual(self.rows().count(), 0)

    def test_the_parent_binding_comes_back_after_the_call(self):
        parent = changes.Binding(user_id=self.user.id, owner_kind='run',
                                 execution_id=str(self.log.execution_id), tool='parent')
        token = changes.bind(parent)
        try:
            self.run_call('test_reversible', 'done', owner=None)
            self.assertIs(changes.current(), parent)
        finally:
            changes.unbind(token)
        self.assertIsNone(changes.current())


class ErrorShapeTests(TestCase):
    """Real result strings from three tools and from the loop itself."""

    def test_the_results_that_mean_failure(self):
        real_failures = [
            # steer_task: chat/tools/tasks.py
            json.dumps({'error': "Unknown task handle 't1'."}),
            # the file tools: chat/tools/files.py on a VfsError
            json.dumps({'error': 'notes.md has no version 3. Call file_versions to list them.'}),
            # the loop's own failure strings: chat/turn/agent.py::_dispatch_one
            'Error running write_file: boom',
            'Error: run_agent timed out after 90s.',
            json.dumps({'status': 'error', 'detail': 'x'}),
        ]
        for output in real_failures:
            with self.subTest(output=output):
                self.assertTrue(turn_agent._looks_like_error(output))

    def test_the_results_that_mean_success(self):
        real_successes = [
            # write_file: chat/tools/files.py
            json.dumps({'path': '/a.md', 'document_id': 3, 'created': True}),
            # steer_task on success
            json.dumps({'steered': 't1', 'queued': 0}),
            json.dumps({'error': None, 'ok': True}),
            'Sent.',
            # Plain text that begins with the word, but says nothing failed.
            'Errors found: none',
        ]
        for output in real_successes:
            with self.subTest(output=output):
                self.assertFalse(turn_agent._looks_like_error(output))


class JournalFlagRegistryTests(TestCase):
    """The `journal=False` list, checked against the registry itself."""

    # Every tool that starts, answers, steers or stops other work, plus the
    # notes writer. Adding to this list needs a reason in the code (agents.py,
    # tasks.py, conversation.py).
    JOURNAL_OFF = {
        'run_agent', 'answer_subagent', 'invoke_subagent',
        'start_tasks', 'steer_task', 'stop_task',
        'update_conversation_notes',
    }

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        import chat.tools  # noqa: F401 — registers every built-in tool

    def test_every_journal_off_name_is_a_registered_tool(self):
        for name in self.JOURNAL_OFF:
            with self.subTest(tool=name):
                self.assertIsNotNone(registry.get(name), name)

    def test_no_journal_off_tool_is_a_read_tool(self):
        for name in self.JOURNAL_OFF:
            with self.subTest(tool=name):
                self.assertNotEqual(registry.effect_of(name), 'read', name)

    def test_the_registry_has_no_other_journal_off_tool(self):
        off = {t.name for t in registry.all_tools() if not t.journal}
        self.assertEqual(off, self.JOURNAL_OFF)

    def test_an_unknown_name_is_journaled(self):
        self.assertTrue(registry.journal_of('mcp__somewhere__do_thing'))
