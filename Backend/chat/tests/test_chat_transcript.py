"""
What a chat turn sends the provider about earlier turns.

Two copies of a conversation exist: the `ChatMessage` rows (windowed, summarised,
searchable — what the user sees) and the graph checkpoint keyed by the session
id. Only the first is meant to reach the model for *earlier* turns; the
checkpoint holds the current turn. These tests drive several real turns through
the pipeline and assert on what actually left for the provider, because each
half passes its own unit tests while the two together sent everything twice.
"""
from __future__ import annotations

import json
from typing import Any
from unittest.mock import patch

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.test import TestCase

from chat.models import ChatMessage, ChatSession
from chat.turn.pipeline import TurnRequest, run_chat_turn

User = get_user_model()

TOOL_RESULT = "ZEBRA-TOOL-RESULT-7781"


class _Sink:
    async def __call__(self, event, payload) -> None:
        return None


class _Provider:
    """Records every request; the first call of turn 1 asks for a tool."""

    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self.tool_once = True

    async def __call__(self, **kwargs):
        self.requests.append(kwargs)
        if self.tool_once:
            self.tool_once = False
            yield {"type": "tool_calls", "tool_calls": [{
                "index": 0, "id": "call_z",
                "function": {"name": "web_search",
                             "arguments": json.dumps({"query": "zebras"})},
            }]}
        else:
            yield {"type": "content", "content": "Answer."}
        yield {"type": "metadata", "usage": {"total_tokens": 5}}


class ChatTranscriptTests(TestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(
            username="transcript", email="tr@example.com", password="pw")
        self.session = ChatSession.objects.create(user=self.user, title="T")
        for target, repl in (
            ("chat.turn.agent.suggest_follow_ups", self._none),
            ("chat.tools.get_available_tools", self._tools),
            ("chat.sources.search.image_search", self._empty),
            ("chat.sources.search.video_search", self._empty),
            ("chat.tools.execute_tool", self._tool),
        ):
            p = patch(target, repl)
            p.start()
            self.addCleanup(p.stop)

    @staticmethod
    async def _none(*_a, **_k):
        return []

    @staticmethod
    async def _empty(*_a, **_k):
        return []

    @staticmethod
    async def _tools(*_a, **_k):
        from chat.tools import AVAILABLE_TOOLS

        return list(AVAILABLE_TOOLS)

    @staticmethod
    async def _tool(name, args, context) -> str:
        return json.dumps({"type": "search_results", "text": TOOL_RESULT,
                           "sources": []})

    def _turn(self, text: str, provider: _Provider) -> None:
        with patch("llm.access.stream", provider):
            async_to_sync(run_chat_turn)(
                session=self.session, user=self.user,
                request=TurnRequest.parse({"content": text}), sink=_Sink(),
            )

    def _payload(self, request: dict[str, Any]) -> str:
        return json.dumps(request.get("history") or []) + "\n" + str(
            request.get("prompt") or "")

    def test_earlier_turns_are_sent_once_and_without_their_tool_results(self):
        provider = _Provider()
        self._turn("first question about zebras-alpha", provider)
        self._turn("second question about lions-beta", provider)
        before = len(provider.requests)
        self._turn("third question about owls-gamma", provider)

        sent = self._payload(provider.requests[before])
        self.assertEqual(sent.count("first question about zebras-alpha"), 1, sent)
        self.assertEqual(sent.count("second question about lions-beta"), 1, sent)
        self.assertEqual(sent.count("third question about owls-gamma"), 1, sent)
        # An earlier turn's tool result lives in the checkpoint only; the
        # database history carries the answer, never the tool traffic.
        self.assertNotIn(TOOL_RESULT, sent)

    def test_earlier_turns_do_not_use_up_this_turns_tool_budget(self):
        # The iteration counter reads the checkpoint's assistant messages, so a
        # session that kept them withheld tools from every turn after enough
        # earlier ones — the model was told it had hit the limit on turn one.
        provider = _Provider()
        with patch("chat.turn.agent.iteration_limit", lambda intent: 2):
            for n in range(4):
                provider.tool_once = True
                self._turn(f"question number {n}", provider)
            before = len(provider.requests)
            provider.tool_once = True
            self._turn("last question", provider)
        self.assertTrue(provider.requests[before].get("tools"))

    def test_a_long_chat_turn_compacts_old_tool_results(self):
        # Chat is the orchestrator now, so one turn can run many tool calls.
        # It gets the free half of curation: old results become records naming
        # an archive id, and the text stays reachable.
        from chat.turn.curation import RECORD_PREFIX

        budget = 9_000

        async def small_budget(model, *, reserve_output=0):
            return budget

        calls = {"n": 0}

        async def provider(**kwargs):
            calls["n"] += 1
            requests.append(kwargs)
            if calls["n"] <= 8:
                yield {"type": "tool_calls", "tool_calls": [{
                    "index": 0, "id": f"call_{calls['n']}",
                    "function": {"name": "web_search",
                                 "arguments": json.dumps({"query": f"q{calls['n']}"})},
                }]}
            else:
                yield {"type": "content", "content": "Done."}
            yield {"type": "metadata", "usage": {"total_tokens": 5}}

        async def big_tool(name, args, context) -> str:
            return json.dumps({"type": "search_results",
                               "text": f"{args.get('query')} " + "fact " * 2_000,
                               "sources": []})

        requests: list[dict[str, Any]] = []
        with patch("llm.budget.input_budget_for", new=small_budget), \
             patch("llm.budget.cached_input_budget",
                   new=lambda model, reserve_output=0: budget), \
             patch("chat.tools.execute_tool", big_tool), \
             patch("llm.access.stream", provider):
            async_to_sync(run_chat_turn)(
                session=self.session, user=self.user,
                request=TurnRequest.parse({"content": "gather a lot"}),
                sink=_Sink(),
            )
        self.assertIn(RECORD_PREFIX, json.dumps(requests[-1].get("history") or []))

    def test_a_long_earlier_answer_arrives_as_its_summary(self):
        provider = _Provider()
        provider.tool_once = False
        self._turn("warm up", provider)
        answer = ChatMessage.objects.filter(
            session=self.session, role="assistant").latest("created_at")
        answer.content = "LONGANSWER " * 400
        answer.metadata = {**(answer.metadata or {}), "summary": "short summary"}
        answer.save(update_fields=["content", "metadata"])

        before = len(provider.requests)
        self._turn("next", provider)
        sent = self._payload(provider.requests[before])
        self.assertIn("short summary", sent)
        self.assertNotIn("LONGANSWER LONGANSWER", sent)

    def test_the_message_after_a_stop_starts_a_new_turn(self):
        # Stop cancels the run's task wherever it is, so the checkpoint keeps
        # nodes still to run. `run_turn` read that as "paused for an approval"
        # and resumed: the new message never entered the graph, the model
        # carried on with the stopped task, and its whole transcript went to
        # the provider again (production 2026-09-28: a steer re-sent after
        # Stop arrived as `it=4` of the old turn).
        import asyncio
        import contextlib

        async def cancelled_tool(name, args, context) -> str:
            raise asyncio.CancelledError  # what Stop does to the run's task

        provider = _Provider()
        with patch("chat.tools.execute_tool", cancelled_tool), \
             contextlib.suppress(asyncio.CancelledError):
            self._turn("stopped question about zebras-alpha", provider)

        provider.tool_once = False
        before = len(provider.requests)
        self._turn("fresh question about owls-gamma", provider)

        sent = self._payload(provider.requests[before])
        self.assertIn("fresh question about owls-gamma", sent)
        self.assertEqual(sent.count("stopped question about zebras-alpha"), 1, sent)
        self.assertNotIn("call_z", sent)
