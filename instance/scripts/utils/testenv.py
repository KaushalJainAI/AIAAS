"""
Loads `instance/test.env` into the process environment.

Import this before anything reads `os.environ` for an E2E setting. It is
imported by `utils/console.py`'s siblings at the top of each harness entry
point, so in practice every script gets it for free.

Two rules, both deliberate:

- **The real environment wins.** A value already present in `os.environ` is
  never overwritten, so CI (or a one-off `E2E_API_URL=... python ...`) overrides
  the file without editing it. A checked-in file that silently overrode the
  caller's own configuration would be worse than having no file at all.
- **A missing file is not an error.** Every consumer passes a default, so the
  harnesses still run on a machine that has not set one up. The file makes the
  configuration *visible and shared*, not mandatory.
"""
from __future__ import annotations

import os
from pathlib import Path

#: instance/test.env — two levels up from utils/
TEST_ENV_PATH = Path(__file__).resolve().parents[2] / "test.env"


def load_test_env(path: Path | None = None) -> dict[str, str]:
    """Read `test.env` into `os.environ` without clobbering what is already set.

    Returns the values the file declared, whether or not each one was applied,
    so a caller can report what the file *wanted* separately from what is in
    force.
    """
    target = path or TEST_ENV_PATH
    declared: dict[str, str] = {}
    try:
        text = target.read_text(encoding="utf-8")
    except OSError:
        return declared

    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if not key:
            continue
        declared[key] = value
        # Blank in the file means "declared but unset" -- notably E2E_RECORD,
        # which is a flag the recorder turns on. Setting it to "" would make
        # `os.environ.get(...)` return "" rather than None, and "" is falsy
        # anyway, so either is safe; skipping keeps `os.environ` honest.
        if value and key not in os.environ:
            os.environ[key] = value
    return declared


def get(key: str, default: str = "") -> str:
    """An E2E setting, after `load_test_env` has run."""
    return os.environ.get(key, default)


load_test_env()
