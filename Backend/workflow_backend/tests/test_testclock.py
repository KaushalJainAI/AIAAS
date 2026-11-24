"""
The controllable clock (`workflow_backend/testclock.py`), and the three places
the testing plan named as needing it: the clock tool, session expiry, and
schedules. Each runs the real code with time moved by the test, so none of
them waits and none depends on how fast the machine is.
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timedelta, timezone as dt_timezone
from unittest.mock import patch

from asgiref.sync import async_to_sync
from django.conf import settings
from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from workflow_backend.testclock import DEFAULT_START, freeze_for, frozen_clock


class ClockTests(SimpleTestCase):
    def test_time_stands_still_until_the_test_moves_it(self):
        with frozen_clock() as clock:
            first = timezone.now()
            second = timezone.now()
            self.assertEqual(first, second)
            self.assertEqual(first, DEFAULT_START)
            self.assertEqual(clock.now(), DEFAULT_START)
            self.assertEqual(time.time(), DEFAULT_START.timestamp())

    def test_advance_moves_every_reader_together(self):
        with frozen_clock("2026-01-01 00:00") as clock:
            after = clock.advance(minutes=90)
            self.assertEqual(after, datetime(2026, 1, 1, 1, 30, tzinfo=dt_timezone.utc))
            self.assertEqual(timezone.now(), after)
            self.assertEqual(datetime.now(dt_timezone.utc), after)

    def test_advance_refuses_to_go_back_and_set_may(self):
        with frozen_clock() as clock:
            with self.assertRaises(ValueError):
                clock.advance(seconds=-1)
            earlier = clock.set("2020-02-29 12:00")
            self.assertEqual(timezone.now(), earlier)
            self.assertEqual(earlier.year, 2020)

    def test_time_runs_again_after_the_block(self):
        with frozen_clock("2001-01-01 00:00"):
            pass
        self.assertGreater(timezone.now().year, 2001)

    def test_freeze_for_is_released_by_cleanup(self):
        case = TestCase("run")
        clock = freeze_for(case, "1999-12-31 23:59")
        self.assertEqual(timezone.now(), clock.now())
        case.doCleanups()
        self.assertGreater(timezone.now().year, 1999)

    def test_durations_and_asyncio_waits_keep_running(self):
        # monotonic is not frozen: timeouts measured with it still expire, and
        # the event loop, which times every wait with it, still wakes up.
        import asyncio

        with frozen_clock():
            start = time.monotonic()
            time.sleep(0.05)
            self.assertGreater(time.monotonic(), start)
            asyncio.run(asyncio.wait_for(asyncio.sleep(0.01), timeout=5))


class ClockToolTests(SimpleTestCase):
    def test_get_current_time_reports_the_frozen_instant(self):
        from chat.tools.clock import get_current_time

        with frozen_clock("2026-11-24 15:30"):
            out = json.loads(async_to_sync(get_current_time)({}, {}))
        self.assertTrue(out["current_time"].startswith("Tuesday, November 24, 2026 03:30 PM"),
                        out["current_time"])


class SessionExpiryTests(TestCase):
    """An access token works until its lifetime is up, and not a second after."""

    def setUp(self):
        self.user = User.objects.create_user("expiring", "e@example.com", "pw")
        self.client = APIClient()
        self.url = reverse("profile")

    def _get_with(self, token):
        return self.client.get(self.url, HTTP_AUTHORIZATION=f"Bearer {token}")

    def test_a_token_expires_at_its_lifetime(self):
        lifetime = settings.SIMPLE_JWT["ACCESS_TOKEN_LIFETIME"]
        with frozen_clock() as clock:
            token = str(AccessToken.for_user(self.user))
            self.assertEqual(self._get_with(token).status_code, 200)

            clock.advance(lifetime - timedelta(seconds=1))
            self.assertEqual(self._get_with(token).status_code, 200)

            clock.advance(seconds=2)
            self.assertEqual(self._get_with(token).status_code, 401)


class ScheduleClockTests(TestCase):
    """A daily schedule fires when the clock reaches it, and then again next day.

    The sweep reads `timezone.now()` itself here (no `now=` passed), which is
    how the in-process scheduler calls it.
    """

    def setUp(self):
        from agents.models import SubAgent, Trigger

        self.user = User.objects.create_user("scheduler", password="pw")
        self.agent = SubAgent.objects.create(
            user=self.user, name="Morning", prompt="Do the thing.",
            allow_unattended=True, llm_provider="nvidia", llm_model="m",
        )
        self.clock = freeze_for(self, "2026-11-23 08:59")
        self.trigger = Trigger.objects.create(
            subagent=self.agent, mode="schedule", config={"cron": "0 9 * * *"},
            goal="Morning report.",
            next_due_at=datetime(2026, 11, 23, 9, 0, tzinfo=dt_timezone.utc),
        )

    def _sweep(self):
        from agents import sweep

        started = []

        async def fake_start(agent, goal, **kwargs):
            started.append(timezone.now())
            return f"exec-{len(started)}"

        with patch("agents.agent.runtime.start_agent_run", fake_start):
            sweep.run_trigger_sweep()
        return started

    def test_it_waits_for_nine_then_fires_once_a_day(self):
        self.assertEqual(self._sweep(), [], "a minute early is not due")

        self.clock.advance(minutes=1)
        self.assertEqual(self._sweep(), [datetime(2026, 11, 23, 9, 0, tzinfo=dt_timezone.utc)])
        self.assertEqual(self._sweep(), [], "the same minute does not fire twice")

        self.trigger.refresh_from_db()
        self.assertEqual(self.trigger.next_due_at,
                         datetime(2026, 11, 24, 9, 0, tzinfo=dt_timezone.utc))

        self.clock.advance(hours=12)
        self.assertEqual(self._sweep(), [], "nine in the evening is not nine in the morning")

        self.clock.set("2026-11-24 09:00")
        self.assertEqual(len(self._sweep()), 1)
