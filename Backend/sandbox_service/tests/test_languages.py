"""JavaScript, TypeScript and command pipelines, run for real.

These need the sidecar image: Node at /usr/local/bin/node, the allowlisted
binaries, pyseccomp and a Linux kernel. They skip anywhere else (local Windows
dev). Run them in the image:

    docker build -t aiaas-sandbox Backend/sandbox_service
    docker run --rm --read-only --tmpfs /tmp --cap-drop ALL \
        --security-opt no-new-privileges --network none \
        -v "$PWD/Backend/sandbox_service/tests:/srv/tests:ro" \
        aiaas-sandbox python -m unittest discover -s tests -v
"""
from __future__ import annotations

import os
import sys
import unittest

_SVC_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _SVC_DIR not in sys.path:
    sys.path.insert(0, _SVC_DIR)

import executor  # noqa: E402
from commands import CommandRefused  # noqa: E402

try:
    import pyseccomp  # noqa: F401
    _HAS_SECCOMP = True
except Exception:  # noqa: BLE001
    _HAS_SECCOMP = False

_IN_IMAGE = (os.name == "posix" and os.access(executor.NODE, os.X_OK)
             and _HAS_SECCOMP)
_needs_image = unittest.skipUnless(_IN_IMAGE, "needs the sandbox sidecar image")


def _cmd(command, *args):
    return {"command": command, "args": list(args)}


@_needs_image
class JavaScriptTests(unittest.TestCase):
    def test_prints_come_back(self):
        env = executor.execute("console.log(6 * 7)", language="javascript")
        self.assertTrue(env["success"], env)
        self.assertEqual(env["output"].strip(), "42")
        # The backend uses this echo to tell a current image from an old one.
        self.assertEqual(env["language"], "javascript")

    def test_commonjs_and_es_modules_both_work(self):
        env = executor.execute("const os = require('node:os'); console.log(typeof os.EOL)",
                               language="javascript")
        self.assertTrue(env["success"], env)
        env = executor.execute("import { EOL } from 'node:os'; console.log(typeof EOL)",
                               language="javascript")
        self.assertTrue(env["success"], env)

    def test_typescript_types_and_enums(self):
        code = ("enum Colour { Red, Green }\n"
                "interface P { x: number }\n"
                "const p: P = { x: 41 };\n"
                "console.log(p.x + Colour.Green)")
        env = executor.execute(code, language="typescript")
        self.assertTrue(env["success"], env)
        self.assertEqual(env["output"].strip(), "42")
        self.assertNotIn("ExperimentalWarning", env["stderr"])

    def test_a_thrown_error_is_a_failure_with_its_message(self):
        env = executor.execute("throw new Error('boom')", language="javascript")
        self.assertFalse(env["success"])
        self.assertIn("boom", env["error"])

    def test_child_process_is_refused(self):
        env = executor.execute(
            "require('node:child_process').execSync('id')", language="javascript")
        self.assertFalse(env["success"])
        self.assertIn("child-process", env["error"])

    def test_files_outside_the_run_are_refused(self):
        env = executor.execute(
            "require('node:fs').readFileSync('/etc/passwd')", language="javascript")
        self.assertFalse(env["success"])
        self.assertIn("allow-fs-read", env["error"])

    def test_network_is_refused(self):
        code = ("require('node:net').connect(80, '1.1.1.1')"
                ".on('error', e => { console.log('blocked', e.code); });")
        env = executor.execute(code, language="javascript")
        self.assertIn("blocked", env["output"])

    def test_files_in_and_out(self):
        code = ("const fs = require('node:fs');"
                "const n = fs.readFileSync('in.txt', 'utf8').trim().split('\\n').length;"
                "fs.writeFileSync('count.txt', String(n));")
        env = executor.execute(code, language="javascript",
                               files={"in.txt": b"a\nb\nc\n"}, collect=["count.txt"])
        self.assertTrue(env["success"], env)
        self.assertEqual(env["files_out"], {"count.txt": b"3"})

    def test_memory_cap_holds(self):
        code = "const a = []; while (true) a.push(new Array(1e6).fill(1));"
        env = executor.execute(code, language="javascript",
                               mem_bytes=128 * 1024 * 1024, wall_seconds=20)
        self.assertFalse(env["success"])
        self.assertFalse(env["timed_out"], env)

    def test_runaway_loop_is_killed(self):
        env = executor.execute("while (true) {}", language="javascript", wall_seconds=2)
        self.assertTrue(env["timed_out"])

    def test_unknown_language_is_refused(self):
        with self.assertRaises(executor.FileSpecError):
            executor.execute("puts 1", language="ruby")


@_needs_image
class CommandTests(unittest.TestCase):
    def test_a_pipeline_over_an_input_file(self):
        log = b"ok\nERROR disk\nok\nERROR net\nERROR disk\n"
        env = executor.execute_commands(
            [_cmd("grep", "ERROR", "app.log"), _cmd("sort"), _cmd("uniq", "-c"),
             _cmd("sort", "-rn")],
            files={"app.log": log})
        self.assertTrue(env["success"], env)
        self.assertEqual(env["exit_codes"], [0, 0, 0, 0])
        self.assertEqual(env["output"].split(), ["2", "ERROR", "disk", "1", "ERROR", "net"])

    def test_stdin_and_jq(self):
        env = executor.execute_commands([_cmd("jq", "-r", ".items[].name")],
                                        stdin='{"items": [{"name": "a"}, {"name": "b"}]}')
        self.assertTrue(env["success"], env)
        self.assertEqual(env["output"].split(), ["a", "b"])

    def test_no_match_is_an_exit_code_not_a_failure(self):
        env = executor.execute_commands([_cmd("grep", "zzz")], stdin="abc\n")
        self.assertTrue(env["success"], env)
        self.assertEqual(env["exit_codes"], [1])

    def test_shell_syntax_is_inert(self):
        env = executor.execute_commands([_cmd("echo", "$(id); `id` | sh")])
        self.assertEqual(env["output"].strip(), "$(id); `id` | sh")

    def test_sed_cannot_execute(self):
        env = executor.execute_commands([_cmd("sed", "1e id")], stdin="x\n")
        self.assertNotEqual(env["exit_codes"], [0])
        self.assertIn("sandbox", env["stderr"])
        self.assertNotIn("uid=", env["output"])

    def test_awk_cannot_execute_or_pipe(self):
        for program in ('BEGIN { system("id") }', 'BEGIN { "id" | getline x; print x }',
                        'BEGIN { print "x" | "sh" }'):
            with self.subTest(program=program):
                env = executor.execute_commands([_cmd("awk", program)])
                self.assertNotEqual(env["exit_codes"], [0])
                self.assertNotIn("uid=", env["output"])

    def test_a_second_execve_is_denied_by_the_guard(self):
        # gawk without --sandbox would run system(); call it through the
        # launcher directly, bypassing commands.py, to prove the exec guard
        # alone stops a second program.
        import json
        import subprocess
        request = {"stages": [["/usr/bin/gawk", 'BEGIN { r = system("id"); print "rc=" r }']],
                   "stdin": "", "max_output": 10_000}
        proc = subprocess.run([sys.executable, "-I", "-B", executor.LAUNCHER],
                              input=json.dumps(request).encode(), capture_output=True,
                              timeout=20)
        env = json.loads(proc.stdout)
        self.assertTrue(env["success"], env)
        self.assertNotIn("uid=", env["output"])
        self.assertIn("rc=", env["output"])

    def test_refused_command_raises(self):
        with self.assertRaises(CommandRefused):
            executor.execute_commands([_cmd("bash", "-c", "id")])

    def test_runaway_is_killed(self):
        env = executor.execute_commands([_cmd("tail", "-f", "/dev/null")], wall_seconds=2)
        self.assertTrue(env["timed_out"])


@_needs_image
class PythonCannotStartProgramsTests(unittest.TestCase):
    def test_subprocess_is_denied(self):
        env = executor.execute(
            "import subprocess\n"
            "try:\n"
            "    subprocess.run(['/bin/sh', '-c', 'id'], capture_output=True)\n"
            "    result = 'ran'\n"
            "except OSError as e:\n"
            "    result = 'denied'\n")
        self.assertTrue(env["success"], env)
        self.assertEqual(env["result"], "denied")

    def test_numpy_and_pandas_still_import(self):
        env = executor.execute("import numpy, pandas\nresult = int(numpy.arange(4).sum())")
        self.assertTrue(env["success"], env)
        self.assertEqual(env["result"], 6)


if __name__ == "__main__":
    unittest.main()
