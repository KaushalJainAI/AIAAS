"""JavaScript and `run_command`: offered only on the sidecar, wired to one grant.

The sidecar's own behaviour (Node's permission model, the command allowlist,
the exec guard) is tested in the image: `sandbox_service/tests/`. These pin
the backend half: availability at both doors, the grant, the approval sets,
the envelope the tools turn into text, and that the command list the model
reads is the list the sidecar enforces.
"""
from __future__ import annotations

import json
import os
import sys
from unittest import mock

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase, override_settings

from agents.agent.runtime import AgentToolbox, sensitive_tools_for
from agents.grants import GRANT_TOOLS, SANDBOX_RUN_TOOLS, SIDECAR_ONLY_TOOLS
from chat.tools import get_available_tools
from chat.tools import sandbox as sandbox_tools
from inference import vfs

_SVC_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))), 'sandbox_service')


def _names(tools) -> set[str]:
    return {t['function']['name'] for t in tools}


class CommandListParityTests(SimpleTestCase):
    def test_the_tool_lists_exactly_what_the_sidecar_allows(self):
        sys.path.insert(0, _SVC_DIR)
        try:
            import commands as sidecar_commands
        finally:
            sys.path.remove(_SVC_DIR)
        self.assertEqual(sorted(sandbox_tools.RUN_COMMAND_NAMES),
                         sorted(sidecar_commands.COMMANDS))


class GrantWiringTests(SimpleTestCase):
    def test_both_tools_ride_the_code_execution_grant(self):
        for name in ('execute_javascript', 'run_command'):
            self.assertIn(name, GRANT_TOOLS['codeExecution'])
        self.assertLessEqual(SIDECAR_ONLY_TOOLS, set(GRANT_TOOLS['codeExecution']))

    def test_unattended_ask_and_review_pause_before_any_code_runs(self):
        box = AgentToolbox(grants={'codeExecution': True}, user_id=1)
        for level in ('ask', 'review'):
            with self.subTest(level=level):
                self.assertLessEqual(SANDBOX_RUN_TOOLS, sensitive_tools_for(level, box))

    def test_without_the_grant_dispatch_refuses(self):
        box = AgentToolbox(grants={}, user_id=1)
        for name in ('execute_javascript', 'run_command'):
            reply = async_to_sync(box.dispatch)(name, {'code': '1'}, {})
            self.assertIn('code execution', reply)


class AvailabilityTests(SimpleTestCase):
    @override_settings(SANDBOX_ENGINE='inprocess')
    def test_withheld_from_an_agent_without_the_sidecar(self):
        box = AgentToolbox(grants={'codeExecution': True}, user_id=1)
        self.assertIn('execute_python', box.allowed_names)
        self.assertFalse(SIDECAR_ONLY_TOOLS & box.allowed_names)

    @override_settings(SANDBOX_ENGINE='service')
    def test_offered_to_an_agent_with_the_sidecar(self):
        box = AgentToolbox(grants={'codeExecution': True}, user_id=1)
        self.assertLessEqual(SIDECAR_ONLY_TOOLS, box.allowed_names)

    @override_settings(SANDBOX_ENGINE='inprocess')
    def test_withheld_from_chat_without_the_sidecar(self):
        names = _names(async_to_sync(get_available_tools)(None, memory_enabled=False))
        self.assertIn('execute_python', names)
        self.assertFalse(SIDECAR_ONLY_TOOLS & names)

    @override_settings(SANDBOX_ENGINE='service')
    def test_chat_holds_both_because_both_are_read_only(self):
        names = _names(async_to_sync(get_available_tools)(None, memory_enabled=False))
        self.assertLessEqual(SIDECAR_ONLY_TOOLS, names)


@override_settings(SANDBOX_ENGINE='inprocess')
class InProcessEngineRefusesTests(SimpleTestCase):
    """Called directly anyway, the dev engine refuses; it never runs Node or a
    native program unconfined."""

    def test_javascript(self):
        from sandbox.engine import arun_code
        env = async_to_sync(arun_code)('console.log(1)', language='javascript')
        self.assertFalse(env['success'])
        self.assertIn('sandbox service', env['error'])

    def test_commands(self):
        from sandbox.engine import arun_commands
        env = async_to_sync(arun_commands)([{'command': 'echo', 'args': ['x']}])
        self.assertFalse(env['success'])
        self.assertIn('sandbox service', env['error'])


def _ok(**fields):
    env = {'success': True, 'result': None, 'output': '', 'stderr': '',
           'error': None, 'timed_out': False}
    env.update(fields)
    return env


class ExecuteJavascriptToolTests(SimpleTestCase):
    def _run(self, args, outcome):
        with mock.patch('sandbox.engine.arun_code',
                        mock.AsyncMock(return_value=outcome)) as run:
            reply = async_to_sync(sandbox_tools.execute_javascript)(args, {})
        return reply, run

    def test_stdout_comes_back_and_language_is_passed(self):
        reply, run = self._run({'code': 'console.log(42)', 'language': 'typescript'},
                               _ok(output='42\n'))
        self.assertEqual(json.loads(reply)['stdout'], '42\n')
        self.assertEqual(run.await_args.kwargs['language'], 'typescript')

    def test_failure_is_an_error_string(self):
        reply, _ = self._run({'code': 'throw 1'},
                             {'success': False, 'error': 'Error: boom', 'stderr': ''})
        self.assertTrue(reply.startswith('Error: '))
        self.assertIn('boom', reply)

    def test_an_unknown_language_is_refused_before_running(self):
        reply, run = self._run({'code': 'x', 'language': 'ruby'}, _ok())
        self.assertTrue(reply.startswith('Error: '))
        run.assert_not_awaited()


class RunCommandToolTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='piper', email='p@example.test', password='x')
        self.scope = vfs.chat_scope(self.user)

    def _run(self, args, outcome, scope='default'):
        context = {'user_id': self.user.id,
                   'file_scope': self.scope if scope == 'default' else scope}
        with mock.patch('sandbox.engine.arun_commands',
                        mock.AsyncMock(return_value=outcome)) as run:
            reply = async_to_sync(sandbox_tools.run_command)(args, context)
        return reply, run

    def test_inputs_are_read_from_the_workspace_by_file_name(self):
        vfs.write_file(self.scope, '/Chat/app.log', 'ERROR a\nok\n')
        pipeline = [{'command': 'grep', 'args': ['ERROR', 'app.log']}]
        reply, run = self._run({'pipeline': pipeline, 'inputs': ['/Chat/app.log']},
                               _ok(output='ERROR a\n', exit_codes=[0]))
        out = json.loads(reply)
        self.assertEqual(out['stdout'], 'ERROR a\n')
        self.assertEqual(out['exit_codes'], [0])
        self.assertEqual(run.await_args.args[0], pipeline)
        self.assertEqual(run.await_args.kwargs['files'], {'app.log': b'ERROR a\nok\n'})

    def test_no_match_is_reported_as_an_exit_code_with_a_note(self):
        reply, _ = self._run({'pipeline': [{'command': 'grep', 'args': ['zzz']}],
                              'stdin': 'abc'},
                             _ok(output='', exit_codes=[1]))
        out = json.loads(reply)
        self.assertEqual(out['exit_codes'], [1])
        self.assertIn('grep exits 1', out['note'])

    def test_the_sidecars_refusal_reaches_the_model(self):
        reply, _ = self._run({'pipeline': [{'command': 'bash', 'args': ['-c', 'id']}]},
                             {'success': False,
                              'error': 'Sandbox error: "bash" is not an allowed command.'})
        self.assertIn('not an allowed command', reply)

    def test_inputs_without_a_scope_are_refused_before_running(self):
        reply, run = self._run({'pipeline': [{'command': 'cat', 'args': ['a.txt']}],
                                'inputs': ['/Chat/a.txt']}, _ok(), scope=None)
        self.assertIn('stdin', reply)
        run.assert_not_awaited()

    def test_oversized_stdin_is_refused_not_cut(self):
        big = 'x' * (sandbox_tools.MAX_COMMAND_STDIN_BYTES + 1)
        reply, run = self._run({'pipeline': [{'command': 'wc', 'args': ['-c']}],
                                'stdin': big}, _ok())
        self.assertIn("'inputs'", reply)
        run.assert_not_awaited()

    def test_a_missing_input_is_named(self):
        reply, run = self._run({'pipeline': [{'command': 'cat', 'args': ['nope.txt']}],
                                'inputs': ['/Chat/nope.txt']}, _ok())
        self.assertIn('No such file', reply)
        run.assert_not_awaited()
