"""Model-supplied values reach the workspace shell as one quoted word each.

`{x!r}` is Python quoting, not shell quoting: a value holding `'` comes out
in double quotes, where `$(...)` and backticks run. A prompt injection can
choose these values, so every one is `shlex.quote`d.
"""
import asyncio
import shlex
from types import SimpleNamespace
from unittest import TestCase, mock

from chat.tools import code, tasks

HOSTILE = "fix it'$(touch /tmp/pwned)`id`\"; rm -rf ."


class GitToolQuotingTests(TestCase):
    def _capture(self, fn, args):
        seen = {}

        async def fake_git(_args, _context, cmd):
            seen['cmd'] = cmd
            return '{}'

        with mock.patch.object(code, '_git', fake_git):
            asyncio.run(fn(args, {}))
        return seen['cmd']

    def test_commit_message_is_one_shell_word(self):
        cmd = self._capture(code.git_commit, {'message': HOSTILE})
        words = shlex.split(cmd)
        self.assertEqual(words[-1], HOSTILE)
        self.assertEqual(words[-2], '-m')

    def test_branch_is_one_shell_word(self):
        cmd = self._capture(code.git_push, {'branch': 'main;id'})
        self.assertEqual(shlex.split(cmd), ['git', 'push', 'origin', 'main;id'])

    def test_branch_cannot_be_a_flag(self):
        async def fail(*_a):
            raise AssertionError('must not run')

        with mock.patch.object(code, '_git', fail):
            out = asyncio.run(code.git_push({'branch': '--force'}, {}))
        self.assertIn('cannot start with', out)


class RevertQuotingTests(TestCase):
    def test_revert_quotes_the_path(self):
        commands = []

        class Engine:
            async def read(self, ws, path):
                return b''

            async def exec(self, ws, cmd, **kw):
                commands.append(cmd)
                return {'exit_code': 0}

        async def fake_ws(_context):
            return object()

        project = SimpleNamespace(workspace_path='/w')
        for before_hash in ('', 'abc'):
            change = SimpleNamespace(after_hash='', before_hash=before_hash)
            with mock.patch.object(tasks, '_workspace_of', fake_ws):
                self.assertIsNone(asyncio.run(
                    tasks._revert_one(Engine(), {}, project, change, HOSTILE)))

        self.assertEqual(shlex.split(commands[0]), ['rm', '--', HOSTILE])
        self.assertEqual(shlex.split(commands[1]), ['git', 'checkout', '--', HOSTILE])
