"""The command allowlist (`commands.py`): what it accepts, what it refuses.

Pure policy, no subprocess, so these run on any platform. What the commands
actually do in the container is `test_languages.py`.
"""
from __future__ import annotations

import os
import sys
import unittest

_SVC_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _SVC_DIR not in sys.path:
    sys.path.insert(0, _SVC_DIR)

import commands  # noqa: E402
from commands import CommandRefused, validate  # noqa: E402


def _stage(command, *args):
    return {"command": command, "args": list(args)}


class AllowlistTests(unittest.TestCase):
    def test_a_pipeline_becomes_absolute_argv_lists(self):
        stages = validate([_stage("grep", "-i", "error", "app.log"),
                           _stage("sort"), _stage("uniq", "-c")])
        self.assertEqual(stages, [
            ["/usr/bin/grep", "-i", "error", "app.log"],
            ["/usr/bin/sort"],
            ["/usr/bin/uniq", "-c"],
        ])

    def test_no_shell_or_interpreter_or_launcher_is_on_the_list(self):
        for name in ("sh", "bash", "dash", "zsh", "python", "python3", "node",
                     "perl", "ruby", "env", "xargs", "find", "timeout", "nice",
                     "nohup", "stdbuf", "sqlite3", "tar", "zip", "split",
                     "curl", "wget", "nc", "ssh", "git", "pip", "npm", "npx",
                     "busybox", "script", "watch", "flock", "setsid", "chroot"):
            with self.subTest(name=name):
                self.assertNotIn(name, commands.COMMANDS)
                with self.assertRaises(CommandRefused) as ctx:
                    validate([_stage(name, "-c", "id")])
                self.assertIn("not an allowed command", str(ctx.exception))

    def test_sed_and_awk_always_run_sandboxed(self):
        self.assertEqual(validate([_stage("sed", "-n", "1p")])[0][:2],
                         ["/usr/bin/sed", "--sandbox"])
        # awk is gawk by path, so it can never be an awk with no sandbox mode.
        self.assertEqual(validate([_stage("awk", "{print $1}")])[0][:2],
                         ["/usr/bin/gawk", "--sandbox"])

    def test_sort_compress_program_is_refused_in_every_spelling(self):
        for arg in ("--compress-program=sh", "--compress-program", "--compress",
                    "--comp=bash"):
            with self.subTest(arg=arg):
                with self.assertRaises(CommandRefused):
                    validate([_stage("sort", arg, "x.txt")])
        # A different option sharing a short prefix is still fine.
        validate([_stage("sort", "--check", "x.txt")])

    def test_file_cannot_look_inside_compressed_files(self):
        for args in (["-z", "a.gz"], ["-bz", "a.gz"], ["--uncompress", "a.gz"],
                     ["--unc", "a.gz"]):
            with self.subTest(args=args):
                with self.assertRaises(CommandRefused):
                    validate([_stage("file", *args)])
        # `-m` takes a value: a `z` inside it is that value, not a flag.
        validate([_stage("file", "-mz", "a.txt")])

    def test_after_double_dash_nothing_is_an_option(self):
        validate([_stage("sort", "--", "--compress-program=sh")])

    def test_shell_syntax_is_just_text(self):
        # No shell, so these are literal arguments, not syntax. Accepted by the
        # policy; grep then looks for the literal string.
        stages = validate([_stage("grep", "a; rm -rf / $(id) `id` | sh > x", "f")])
        self.assertEqual(stages[0][1], "a; rm -rf / $(id) `id` | sh > x")

    def test_shape_and_size_limits(self):
        with self.assertRaises(CommandRefused):
            validate([])
        with self.assertRaises(CommandRefused):
            validate("grep x")
        with self.assertRaises(CommandRefused):
            validate([_stage("cat")] * (commands.MAX_STAGES + 1))
        with self.assertRaises(CommandRefused):
            validate([_stage("echo", *["x"] * (commands.MAX_ARGS + 1))])
        with self.assertRaises(CommandRefused):
            validate([_stage("echo", "x" * (commands.MAX_ARG_CHARS + 1))])
        with self.assertRaises(CommandRefused):
            validate([_stage("echo", "a\x00b")])
        with self.assertRaises(CommandRefused):
            validate([{"command": "echo", "args": "not a list"}])
        with self.assertRaises(CommandRefused):
            validate([{"command": "echo", "args": [1, 2]}])

    def test_every_binary_is_an_absolute_path(self):
        for name, spec in commands.COMMANDS.items():
            with self.subTest(name=name):
                self.assertTrue(spec.path.startswith("/usr/bin/"), spec.path)


if __name__ == "__main__":
    unittest.main()
