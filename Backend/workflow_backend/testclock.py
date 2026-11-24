"""
A controllable clock for tests: freeze time, then move it on purpose.

Code that reads the time (`timezone.now()`, `datetime.now()`, `time.time()`,
JWT expiry, `auto_now` fields) cannot be tested by waiting. Waiting makes a
test slow, and on Windows the wall clock ticks every ~15 ms, so two writes in
one test can get the same timestamp: the version-based stale-write guard then
sees no change, and the test fails on one machine and passes on another.

So a test freezes the clock and moves it itself:

    from workflow_backend.testclock import frozen_clock

    with frozen_clock("2026-11-23 09:00") as clock:
        token = issue_token()
        clock.advance(minutes=61)          # past the token's lifetime
        assert is_expired(token)

Inside the block time does not move at all (`tick=False`): every read returns
the same instant until the test calls `advance` or `set`. Two writes therefore
get the *same* timestamp unless the test advances between them, which is the
point: the test says when time passes.

What is frozen: the wall clock (`time.time`, `datetime.now`/`utcnow`,
`timezone.now`, `time.gmtime`/`localtime`). What is not: `time.monotonic` and
`time.perf_counter`, which measure durations and must keep running, and
`asyncio.sleep`, which still waits. A test never sleeps to make time pass; to
wait for a call that is in flight, use the scripted model's `until_requested`.

Backed by `time-machine`, which patches the clock at the C level, so code that
imported `datetime` before the test started is frozen too. Test-only: nothing
in the app imports this module.
"""
from __future__ import annotations

import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone as dt_timezone
from typing import Iterator, Union
from unittest import mock

import time_machine

#: Where a frozen clock starts when the test does not say. A fixed instant, so
#: a test that prints the time prints the same thing everywhere. A Monday,
#: 09:00 UTC, inside office hours, which schedule tests usually want.
DEFAULT_START = datetime(2026, 11, 23, 9, 0, 0, tzinfo=dt_timezone.utc)

When = Union[datetime, str]


def _aware(when: When) -> datetime:
    """A timezone-aware instant. A naive time or a bare string is read as UTC."""
    if isinstance(when, str):
        when = datetime.fromisoformat(when)
    if when.tzinfo is None:
        when = when.replace(tzinfo=dt_timezone.utc)
    return when


class Clock:
    """A frozen clock that the test moves. Use `frozen_clock()` to get one."""

    def __init__(self, coordinates: time_machine.Coordinates) -> None:
        self._coordinates = coordinates

    def now(self) -> datetime:
        """The frozen instant, timezone-aware, in UTC."""
        return datetime.now(dt_timezone.utc)

    def advance(self, delta: timedelta | None = None, **parts: float) -> datetime:
        """Move time forward, e.g. `advance(minutes=5)`. Returns the new instant.

        Moving backwards is refused: a clock that runs back is a different
        test (use `set`), and a negative delta is far more often a typo.
        """
        step = (delta or timedelta()) + timedelta(**parts)
        if step < timedelta(0):
            raise ValueError("advance() moves time forward; use set() to go back")
        self._coordinates.shift(step)
        return self.now()

    def set(self, when: When) -> datetime:
        """Jump to a given instant, forward or back. Returns it."""
        self._coordinates.move_to(_aware(when))
        return self.now()


@contextmanager
def frozen_clock(at: When = DEFAULT_START) -> Iterator[Clock]:
    """Freeze the wall clock at `at` for the block and hand back its controls."""
    with time_machine.travel(_aware(at), tick=False) as coordinates:
        # time-machine also freezes `time.monotonic` on Windows (2.16), and
        # asyncio times every wait with it: `asyncio.sleep(0.1)` and
        # `wait_for(..., timeout=...)` then never end. Durations are not the
        # wall clock, so put the real one back.
        with mock.patch.object(time, "monotonic", time_machine.escape_hatch.time.monotonic), \
                mock.patch.object(time, "monotonic_ns", time_machine.escape_hatch.time.monotonic_ns):
            yield Clock(coordinates)


def freeze_for(testcase, at: When = DEFAULT_START) -> Clock:
    """Freeze the clock for the rest of a unittest-style test, from `setUp`.

    The clock is released by `addCleanup`, so a failing test cannot leave time
    frozen for the next one.
    """
    manager = frozen_clock(at)
    clock = manager.__enter__()
    testcase.addCleanup(manager.__exit__, None, None, None)
    return clock


# ── pytest fixture form ──────────────────────────────────────────────────────
# For plain pytest functions. Import the name into the test module for pytest
# to find it:  `from workflow_backend.testclock import clock`.

try:  # pytest is a dev dependency; the app never imports this module
    import pytest
except ImportError:  # pragma: no cover
    pytest = None

if pytest is not None:

    @pytest.fixture
    def clock():
        """A clock frozen at `DEFAULT_START` for the test."""
        with frozen_clock() as frozen:
            yield frozen
