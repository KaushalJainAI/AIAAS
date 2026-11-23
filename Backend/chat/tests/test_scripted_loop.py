"""
One agent turn through the real graph, with the model scripted at the wire.

`run_turn` runs the real agent loop: `agent -> tools -> curate -> steering`,
the real tool dispatch, the real checkpointer. The provider's answers come from
`llm.testing`, so `llm.access` (credentials, clamping, usage, error
classification) and the OpenAI-compatible handler run too. Only the network is
replaced.
"""
from __future__ import annotations

import json

from asgiref.sync import async_to_sync
from django.contrib.auth.models import User
from django.test import TestCase

from chat.turn.agent import TurnContext, run_turn
from llm.testing import (
    DEFAULT_MODEL,
    DEFAULT_PROVIDER,
    fail,
    provider_error,
    scripted_model,
    text,
    tool_call,
)


async def _never(*_args, **_kwargs) -> bool:
    return False


async def _sink(*_args, **_kwargs) -> None:
    return None


class ScriptedLoopTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user("scripted", "scripted@example.com", "x")

    def run_once(self, script, *, thread: str):
        turn = TurnContext(
            provider=DEFAULT_PROVIDER, model=DEFAULT_MODEL,
            system_message="You are a test assistant.",
            user_id=self.user.id, session_id=thread, intent="chat",
            user_text="What time is it?", memory_enabled=False, max_iterations=4,
            approval_policy=_never, sink=_sink,
        )
        with scripted_model(script) as model:
            result = async_to_sync(run_turn)(
                turn, prompt="What time is it?", thread_id=thread,
            )
        return result, model

    def test_a_tool_runs_and_its_result_is_sent_back_to_the_model(self):
        result, model = self.run_once([
            tool_call("get_current_time", {}, id="clock-1"),
            text("It is the time you asked about."),
        ], thread="loop-tool")

        self.assertEqual(result.answer, "It is the time you asked about.")
        self.assertEqual(result.error, "")
        self.assertEqual(len(model.requests), 2)

        # The tool really ran: the second call carries its result, keyed to the
        # call id the model was given. The value is wall-clock, so only its
        # shape is asserted.
        results = model.requests[1].tool_results()
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["tool_call_id"], "clock-1")
        self.assertIn("current_time", json.loads(results[0]["content"]))
        self.assertEqual([entry["tool"] for entry in result.tool_trace], ["get_current_time"])

        # The system prompt does not move between calls.
        self.assertEqual(model.requests[0].system_text(), "You are a test assistant.")
        self.assertEqual(model.requests[0].system_text(), model.requests[1].system_text())
        self.assertTrue(all(r.stream for r in model.requests))
        self.assertEqual(result.tokens, 6)

    def test_a_provider_error_reaches_the_user_as_a_failed_turn(self):
        result, model = self.run_once(
            [provider_error(503, "Service temporarily unavailable")],
            thread="loop-provider-error",
        )

        # The provider's raw body is never the answer. The turn records the
        # failure, and the answer is a sentence about it, marked as such.
        self.assertTrue(result.error)
        self.assertEqual(result.answer, f"⚠️ {result.error}")
        self.assertEqual(len(model.requests), 1, "a failed call must not be retried in a loop")

    def test_a_dropped_connection_is_a_failed_turn_too(self):
        result, model = self.run_once(
            [fail(RuntimeError("socket closed by peer"))],
            thread="loop-dropped",
        )

        self.assertTrue(result.error)
        self.assertTrue(result.answer.startswith("⚠️"))
        self.assertEqual(len(model.requests), 1)
