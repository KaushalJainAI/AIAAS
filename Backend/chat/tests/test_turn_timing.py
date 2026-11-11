"""What a saved chat turn records about itself (B4) and what the session list
shows about it (B5): how long it took, how many steps, whether it is paused,
and which worker it last delegated to.

The agent loop is replaced at its boundary by `TurnResult`s, so these tests pin
what the pipeline writes, not what the model does.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.test import TestCase

from chat.models import ChatMessage, ChatSession
from chat.turn.agent import TurnResult
from chat.turn.pipeline import TurnRequest, run_chat_turn

User = get_user_model()


class TurnTimingTests(TestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(
            username="timer", email="timer@example.com", password="pw",
        )
        self.session = ChatSession.objects.create(user=self.user, title="Timing")
        # Follow-ups are a separate provider call, and tools reach the network.
        # Neither is under test here.
        self._patch("chat.turn.agent.suggest_follow_ups", self._no_follow_ups)
        self._patch("chat.tools.get_available_tools", self._builtin_tools)

    def _patch(self, target: str, replacement: Any) -> Any:
        patcher = patch(target, replacement)
        mock = patcher.start()
        self.addCleanup(patcher.stop)
        return mock

    @staticmethod
    async def _no_follow_ups(*_args, **_kwargs) -> list[str]:
        return []

    @staticmethod
    async def _builtin_tools(*_args, **_kwargs) -> list[dict]:
        from chat.tools import AVAILABLE_TOOLS

        return list(AVAILABLE_TOOLS)

    @staticmethod
    async def _sink(*_args, **_kwargs) -> None:
        return None

    def _turn(self, result: TurnResult, content: str = "hello") -> ChatMessage:
        """Run one turn whose agent returns `result`; return the saved reply."""
        self._patch("chat.turn.agent.run_turn", AsyncMock(return_value=result))
        outcome = async_to_sync(run_chat_turn)(
            session=self.session,
            user=self.user,
            request=TurnRequest.parse({"content": content}),
            sink=self._sink,
        )
        self.session.refresh_from_db()
        return outcome.assistant_message

    # ── B4: timing on the saved reply ──

    def test_the_reply_records_its_duration_in_milliseconds(self):
        message = self._turn(TurnResult(answer="Done."))
        elapsed = message.metadata["elapsed_ms"]
        self.assertIsInstance(elapsed, int)
        self.assertNotIsInstance(elapsed, bool)
        self.assertGreaterEqual(elapsed, 0)

    def test_the_reply_counts_its_tool_steps(self):
        trace = [{"name": "web_search"}, {"name": "read_url"}, {"name": "write_file"}]
        message = self._turn(TurnResult(answer="Done.", tool_trace=trace))
        self.assertEqual(message.metadata["steps"], 3)
        self.assertEqual(len(message.metadata["tool_trace"]), 3)

    def test_a_reply_with_no_tools_says_zero_steps(self):
        message = self._turn(TurnResult(answer="Just words."))
        self.assertEqual(message.metadata["steps"], 0)

    # ── B5: the paused flag ──

    def test_a_turn_that_pauses_marks_the_session_waiting(self):
        self._turn(TurnResult(answer="", awaiting_approval=True))
        self.assertTrue(self.session.awaiting_approval)

    def test_the_next_ordinary_turn_clears_the_waiting_flag(self):
        ChatSession.objects.filter(pk=self.session.pk).update(awaiting_approval=True)
        self.session.refresh_from_db()
        self._turn(TurnResult(answer="Carrying on."))
        self.assertFalse(self.session.awaiting_approval)

    def test_an_approval_that_resumes_the_run_clears_the_waiting_flag(self):
        ChatMessage.objects.create(session=self.session, role="user", content="send it")
        ChatSession.objects.filter(pk=self.session.pk).update(awaiting_approval=True)
        self.session.refresh_from_db()
        self._patch("chat.turn.agent.approve_tool_call", AsyncMock(return_value=None))
        self._patch("chat.turn.agent.run_turn",
                    AsyncMock(return_value=TurnResult(answer="Sent.")))
        async_to_sync(run_chat_turn)(
            session=self.session,
            user=self.user,
            request=TurnRequest.parse({"approve_tool_call": "call_1"}),
            sink=self._sink,
        )
        self.session.refresh_from_db()
        self.assertFalse(self.session.awaiting_approval)

    def test_the_flag_writes_do_not_reorder_the_history_list(self):
        # The history list is ordered by `updated_at`. The flag is written
        # through the queryset (start of turn) and with `update_fields` that
        # exclude it (end of turn), so a turn must leave the timestamp alone.
        ChatSession.objects.filter(pk=self.session.pk).update(awaiting_approval=True)
        self.session.refresh_from_db()
        before = ChatSession.objects.get(pk=self.session.pk).updated_at
        self._turn(TurnResult(answer="Carrying on."))
        after = ChatSession.objects.get(pk=self.session.pk).updated_at
        self.assertEqual(after, before)

    # ── B5: which worker the conversation last delegated to ──

    def test_the_latest_delegated_worker_becomes_last_agent(self):
        plans = {
            "run-1": {"agent_name": "Scout", "todos": []},
            "run-2": {"agent_name": "Writer", "todos": []},
        }
        self._turn(TurnResult(answer="Done.", metadata={"worker_plans": plans}))
        self.assertEqual(self.session.last_agent, "Writer")

    def test_a_slash_agent_run_names_the_worker_when_nothing_was_delegated(self):
        run_card = {"agent_id": 7, "agent_name": "Reporter", "execution_id": "x"}
        self._turn(TurnResult(answer="Done.", metadata={"agent_run": run_card}))
        self.assertEqual(self.session.last_agent, "Reporter")

    def test_a_turn_that_names_no_worker_keeps_the_last_one(self):
        ChatSession.objects.filter(pk=self.session.pk).update(last_agent="Writer")
        self.session.refresh_from_db()
        self._turn(TurnResult(answer="Plain answer."))
        self.assertEqual(self.session.last_agent, "Writer")

    def test_a_worker_name_is_cut_to_the_column_width(self):
        long_name = "A" * 300
        self._turn(TurnResult(
            answer="Done.",
            metadata={"worker_plans": {"run-1": {"agent_name": long_name}}},
        ))
        self.assertEqual(len(self.session.last_agent), 120)
        self.assertEqual(
            ChatSession.objects.get(pk=self.session.pk).last_agent, "A" * 120)
