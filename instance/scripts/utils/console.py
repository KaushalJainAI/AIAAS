"""
UTF-8 console bootstrap.

Every harness prints box-drawing rules and PASS/FAIL check marks. On Windows the
default console encoding is cp1252, so the first such print raises
UnicodeEncodeError and the harness dies mid-run -- which is how the seeder could
appear to "work" while having written only its first table. Import this before
printing anything.
"""
from __future__ import annotations

import sys


def enable_utf8() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
        except Exception:
            pass


enable_utf8()

# Every harness imports this module before it prints anything, which makes it
# the one place guaranteed to run first -- so `instance/test.env` is loaded
# here rather than in each entry point, where one of them would eventually be
# forgotten.
from . import testenv  # noqa: E402,F401
