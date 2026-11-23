"""
The central bound on tool output, and the way back to what it cut.

The failure this replaces is silent. A tool with no budget of its own — every
MCP tool, since the response comes from a third-party server — returned whatever
it liked into the transcript, and `llm.clamp_input` then trimmed it from the
middle without saying so. A page that had been cut in half and a page that was
genuinely short looked exactly the same to the model.
"""
from __future__ import annotations

import json
from datetime import timedelta
from unittest.mock import patch

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from chat.models import ToolOutput
from chat.tools.tool_output import bound, read
from chat.tools import get_available_tools
from workflow_backend.thresholds import TOOL_OUTPUT_CHAR_LIMIT


class BoundingTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="bounder", email="b@example.test", password="x"
        )
        self.context = {
            "user_id": self.user.id, "session_id": "sess-1", "turn_id": "turn-1",
        }

    def test_output_within_the_limit_is_untouched(self):
        text = "a modest result"
        self.assertEqual(async_to_sync(bound)("web_search", text, self.context), text)
        self.assertEqual(ToolOutput.objects.count(), 0)

    def test_oversized_output_is_bounded_and_stored_whole(self):
        text = "x" * (TOOL_OUTPUT_CHAR_LIMIT + 5_000)
        result = async_to_sync(bound)("mcp_fetch", text, self.context)

        self.assertLess(len(result), len(text))
        row = ToolOutput.objects.get()
        self.assertEqual(row.total_chars, len(text))
        self.assertEqual(row.content, text)
        self.assertEqual(row.tool_name, "mcp_fetch")
        self.assertEqual(row.session_key, "sess-1")

    def test_the_model_is_told_what_was_cut_and_where_it_went(self):
        text = "y" * (TOOL_OUTPUT_CHAR_LIMIT + 5_000)
        result = async_to_sync(bound)("mcp_fetch", text, self.context)
        row = ToolOutput.objects.get()

        # Silence is the bug. The notice has to name the omission and the id.
        self.assertIn("characters omitted", result)
        self.assertIn(row.id, result)
        self.assertIn("read_tool_output", result)

    def test_both_ends_of_a_plain_result_survive(self):
        text = "HEAD" + ("m" * (TOOL_OUTPUT_CHAR_LIMIT + 5_000)) + "TAIL"
        result = async_to_sync(bound)("mcp_fetch", text, self.context)
        self.assertTrue(result.startswith("HEAD"))
        self.assertTrue(result.endswith("TAIL"))

    def test_structured_results_stay_parseable(self):
        # Head-and-tail on a JSON blob would corrupt it into unparseable prose
        # and take the sources with it, which is what the model cites from.
        payload = {
            "type": "search_results",
            "text": "z" * (TOOL_OUTPUT_CHAR_LIMIT + 5_000),
            "sources": ["https://example.test/a", "https://example.test/b"],
        }
        result = async_to_sync(bound)("web_search", json.dumps(payload), self.context)

        parsed = json.loads(result)
        self.assertEqual(parsed["sources"], payload["sources"])
        self.assertEqual(parsed["type"], "search_results")
        self.assertIn("characters omitted", parsed["text"])

    def test_a_failed_spill_still_returns_a_result(self):
        # A tool call that succeeded must stay succeeded. What changes is that
        # the notice stops promising an id it cannot honour.
        text = "q" * (TOOL_OUTPUT_CHAR_LIMIT + 5_000)

        async def _no_storage(*args, **kwargs):
            return None

        with patch("chat.tools.tool_output.spill", _no_storage):
            result = async_to_sync(bound)("mcp_fetch", text, self.context)

        self.assertIn("could not be stored", result)
        self.assertIn("unrecoverable", result)


class ReadBackTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="reader", email="r@example.test", password="x"
        )
        self.other = get_user_model().objects.create_user(
            username="stranger", email="s@example.test", password="x"
        )
        self.row = ToolOutput.objects.create(
            user=self.user, session_key="sess-1", turn_id="t1",
            tool_name="mcp_fetch", content="ABCDE" * 4_000, total_chars=20_000,
            expires_at=timezone.now() + timedelta(hours=1),
        )
        self.context = {"user_id": self.user.id, "session_id": "sess-1"}

    def test_reads_a_window_and_says_where_it_is(self):
        out = async_to_sync(read)(self.row.id, 0, self.context)
        self.assertTrue(out.startswith("ABCDE"))
        self.assertIn("of 20,000", out)
        self.assertIn("offset=", out)

    def test_offset_advances_through_the_text(self):
        first = async_to_sync(read)(self.row.id, 0, self.context)
        second = async_to_sync(read)(self.row.id, 12_000, self.context)
        self.assertNotEqual(first, second)
        self.assertIn("End of output", second)

    def test_offset_past_the_end_says_so(self):
        out = async_to_sync(read)(self.row.id, 99_999, self.context)
        self.assertIn("past the end", out)

    def test_another_user_cannot_read_it(self):
        out = async_to_sync(read)(
            self.row.id, 0, {"user_id": self.other.id, "session_id": "sess-1"}
        )
        self.assertIn("no stored output", out)

    def test_another_session_cannot_read_it(self):
        out = async_to_sync(read)(
            self.row.id, 0, {"user_id": self.user.id, "session_id": "sess-2"}
        )
        self.assertIn("no stored output", out)

    def test_expired_output_reports_expiry_rather_than_emptiness(self):
        self.row.expires_at = timezone.now() - timedelta(minutes=1)
        self.row.save(update_fields=["expires_at"])
        out = async_to_sync(read)(self.row.id, 0, self.context)
        self.assertIn("expired", out)


class AdvertisementTests(TestCase):
    """`read_tool_output` is offered for any session from the first pass.

    It used to be withheld until something was stored, which made the tool
    list grow mid-run — and the tool list is part of the request prefix a
    provider caches, so every request after the first spill was a full cache
    miss (2026-11-17). Without a session there is nothing it could ever read.
    """

    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="advertised", email="a@example.test", password="x"
        )

    def _names(self, **kwargs):
        tools = async_to_sync(get_available_tools)(self.user.id, **kwargs)
        return {t.get("function", {}).get("name") for t in tools}

    def _spill(self, session_key):
        ToolOutput.objects.create(
            user=self.user, session_key=session_key, tool_name="mcp_fetch",
            content="...", total_chars=3,
            expires_at=timezone.now() + timedelta(hours=1),
        )

    def test_not_offered_without_a_session(self):
        self.assertNotIn("read_tool_output", self._names())

    def test_offered_before_anything_has_spilled(self):
        self.assertIn("read_tool_output", self._names(session_key="sess-1"))

    def test_the_list_does_not_change_when_something_spills(self):
        before = self._names(session_key="sess-1")
        self._spill("sess-1")
        self.assertEqual(before, self._names(session_key="sess-1"))


class RetentionTests(TestCase):
    """Stored output outlives a paused run, and expired rows are deleted.

    Before 2026-11-17 it expired after 24 hours — shorter than a run can sit
    paused for approval — and expiry only *hid* a row: nothing ever deleted
    one, so every spill stayed on disk unreadable for ever.
    """

    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="kept", email="k@example.test", password="x"
        )

    def _row(self, session_key, *, hours):
        return ToolOutput.objects.create(
            user=self.user, session_key=session_key, tool_name="t",
            content="x", total_chars=1,
            expires_at=timezone.now() + timedelta(hours=hours),
        )

    def test_retention_is_a_week(self):
        from workflow_backend.thresholds import TOOL_OUTPUT_RETENTION_HOURS
        self.assertGreaterEqual(TOOL_OUTPUT_RETENTION_HOURS, 7 * 24)

    def test_resuming_restarts_the_clock_even_on_an_expired_row(self):
        from chat.tools.tool_output import keep_alive

        stale = self._row("run-1", hours=-5)
        other = self._row("run-2", hours=-5)
        self.assertEqual(async_to_sync(keep_alive)(self.user.id, "run-1"), 1)
        stale.refresh_from_db()
        other.refresh_from_db()
        self.assertGreater(stale.expires_at, timezone.now() + timedelta(days=6))
        self.assertLess(other.expires_at, timezone.now(), "another session is untouched")

    def test_expired_rows_are_actually_deleted(self):
        from chat.tools.tool_output import purge_expired

        self._row("gone-1", hours=-1)
        self._row("gone-2", hours=-1)
        kept = self._row("kept", hours=5)
        self.assertEqual(purge_expired(batch=1), 2)
        self.assertEqual(list(ToolOutput.objects.values_list("id", flat=True)), [kept.id])

    def test_the_purge_runs_in_the_scheduler_and_on_beat(self):
        from django.conf import settings
        from agents.scheduler import PERIODIC_JOBS

        self.assertIn("chat.purge_tool_outputs", {job.task for job in PERIODIC_JOBS})
        self.assertIn("chat.purge_tool_outputs",
                      {entry["task"] for entry in settings.CELERY_BEAT_SCHEDULE.values()})
