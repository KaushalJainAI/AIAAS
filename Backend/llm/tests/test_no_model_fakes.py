"""
No test fakes the model above the wire.

A test that patches `llm.access.stream`, `llm.access.complete`, a judge, or the
request builder skips the code under that seam: credentials, clamping, usage,
the handler's parser, the error classifier. The auto-mode reviewer called a
function that did not exist and raised on every call in production, while
every test passed, because every test replaced the judge as a whole
(DESIGN_HISTORY.md, H-171).

So the model is scripted at the HTTP client (`llm/testing.py`) or replayed from
a recording (`llm/recorded.py`), and this test fails, naming the file and line,
when a fake at a higher seam comes back. See Backend/docs/TESTING.md.
"""
from __future__ import annotations

import re
from pathlib import Path

from django.test import SimpleTestCase

BACKEND = Path(__file__).resolve().parents[2]

#: Seams above the wire. Patching any of them replaces the code a test exists
#: to run.
FORBIDDEN = re.compile(
    r"""patch(?:\.object)?\(\s*(?:
        ['"]llm\.access\.(?:stream|complete|_build_request)['"]     # by dotted name
      | ['"][\w.]*\.llm\.(?:stream|complete)['"]                    # a module's `llm` alias
      | (?:access|llm)\s*,\s*['"](?:stream|complete|_build_request)['"]  # patch.object(access, ...)
      | [\w.]*reviewer\s*,\s*['"]_model_judge['"]                   # the auto-mode judge
      | ['"][\w.]*_model_judge['"]
    )""",
    re.VERBOSE,
)
#: Assigning over the judge, the way a hand-rolled swap does.
ASSIGNED_JUDGE = re.compile(r"\.\s*_model_judge\s*=(?!=)")


def _test_files() -> list[Path]:
    skip = {"venv", ".venv", "node_modules", "sandbox_service"}
    return [
        path for path in BACKEND.rglob("test_*.py")
        if not skip & set(path.relative_to(BACKEND).parts)
        and path.name != Path(__file__).name
    ]


class NoModelFakesTests(SimpleTestCase):
    def test_no_test_patches_the_model_above_the_wire(self):
        offences = []
        for path in _test_files():
            for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                if FORBIDDEN.search(line) or ASSIGNED_JUDGE.search(line):
                    offences.append(f"{path.relative_to(BACKEND)}:{number}: {line.strip()}")
        self.assertEqual(
            offences, [],
            "these tests fake the model above the wire; script it with "
            "llm.testing.scripted_model (or replay a recording with "
            "llm.recorded.replay) instead:\n" + "\n".join(offences),
        )

    def test_the_guard_catches_each_shape(self):
        for line in (
            "with patch('llm.access.stream', fake):",
            'with patch("llm.access.complete", new=fake):',
            "patch.object(access, '_build_request', fake)",
            "patch('inference.extraction.llm.complete', new=fake)",
            "with patch.object(reviewer, '_model_judge', judge):",
            "reviewer._model_judge = judge",
        ):
            with self.subTest(line=line):
                self.assertTrue(FORBIDDEN.search(line) or ASSIGNED_JUDGE.search(line))
        for allowed in (
            "patch('llm.access.preflight', tripwire)",
            "self.real = reviewer._model_judge",
            "with scripted_model(text('ok')):",
        ):
            with self.subTest(allowed=allowed):
                self.assertFalse(FORBIDDEN.search(allowed) or ASSIGNED_JUDGE.search(allowed))
