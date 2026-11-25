"""
End-to-end tests for one chat turn, with the model scripted at the wire.

These are the tests the old design could not have: with the answer trapped in a
JSON envelope there was nothing to assert about streaming, and with tool results
flattened into prose there was no transcript to check.

The provider is `llm.testing`'s scripted model, so `llm.access` and the
OpenAI-compatible handler run for real; what the model was sent is read from
`model.requests`, as it went over the wire.
"""
from __future__ import annotations

import json
from typing import Any

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from unittest.mock import patch

from chat.turn.events import Event
from chat.models import ChatMessage, ChatSession
from chat.turn.pipeline import TurnError, TurnRequest, context_summary, run_chat_turn
from llm.testing import provider_error, scripted_model, text, tool_call

User = get_user_model()


class Recorder:
    """An `EventSink` that keeps what it was given."""

    def __init__(self) -> None:
        self.events: list[tuple[Event, dict[str, Any]]] = []

    async def __call__(self, event: Event, payload: dict[str, Any]) -> None:
        self.events.append((event, payload))

    def of(self, event: Event) -> list[dict[str, Any]]:
        return [payload for name, payload in self.events if name == event]

    @property
    def streamed_text(self) -> str:
        return "".join(p.get("content", "") for p in self.of(Event.CONTENT_CHUNK))


def tool_then_answer(tool: str, args: dict, answer: str) -> list:
    """First call asks for a tool, second answers. Mirrors a real two-step turn."""
    return [tool_call(tool, args, id="call_1"), text(answer)]


def conversation(messages: list[dict]) -> list[dict]:
    """The user and assistant turns of a request, without system messages."""
    return [m for m in messages if m.get("role") not in ("system", "developer")]


class ChatTurnTests(TestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(
            username="tester", email="t@example.com", password="pw"
        )
        self.session = ChatSession.objects.create(user=self.user, title="Test")
        # Follow-ups are a separate provider call; silence it unless under test.
        self._patch("chat.turn.agent.suggest_follow_ups", self._no_follow_ups)
        # The real tool list reaches out to the user's MCP servers. These tests
        # are about the loop, not the catalogue, so keep them hermetic.
        self._patch("chat.tools.get_available_tools", self._builtin_tools)
        # Companion media search would hit DuckDuckGo for real.
        self._patch("chat.sources.search.image_search", self._one_image)
        self._patch("chat.sources.search.video_search", self._one_video)
        # Default-deny on tools, so a test that happens to phrase its prompt as a
        # search ("tell me about X") cannot quietly reach the live internet.
        # Tests that care about tools override this with their own `patch`.
        self._patch("chat.tools.execute_tool", self._inert_tool)

    @staticmethod
    async def _inert_tool(name, args, context) -> str:
        return json.dumps({"type": "search_results", "text": "", "sources": []})

    @staticmethod
    async def _one_image(query, *_args, **_kwargs) -> list[dict]:
        return [{"title": query, "image": "http://img", "url": "http://p", "source": "s"}]

    @staticmethod
    async def _one_video(query, *_args, **_kwargs) -> list[dict]:
        return [{"title": query, "url": "http://vid", "description": "", "duration": "",
                 "publisher": ""}]

    def _patch(self, target: str, replacement) -> None:
        patcher = patch(target, replacement)
        patcher.start()
        self.addCleanup(patcher.stop)

    @staticmethod
    async def _no_follow_ups(*_args, **_kwargs) -> list[str]:
        return []

    @staticmethod
    async def _builtin_tools(*_args, **_kwargs) -> list[dict]:
        from chat.tools import AVAILABLE_TOOLS

        return list(AVAILABLE_TOOLS)

    def _run(self, content: str, sink) -> Any:
        return async_to_sync(run_chat_turn)(
            session=self.session,
            user=self.user,
            request=TurnRequest.parse({"content": content}),
            sink=sink,
        )

    # ── Streaming ──

    def test_answer_streams_token_by_token(self):
        # The whole point of dropping the JSON envelope: the user sees the answer
        # as it is produced instead of waiting for a complete parseable blob.
        recorder = Recorder()
        with scripted_model(text("Rust is fast.")) as model:
            outcome = self._run("tell me about rust", recorder)

        self.assertTrue(recorder.of(Event.CONTENT_CHUNK))
        self.assertEqual(recorder.streamed_text, "Rust is fast.")
        self.assertEqual(outcome.assistant_message.content, "Rust is fast.")
        self.assertTrue(model.requests[0].stream)

    def test_answer_is_persisted_as_plain_markdown(self):
        with scripted_model(text("# Title\n\nBody.")):
            outcome = self._run("hi", Recorder())

        stored = ChatMessage.objects.get(id=outcome.assistant_message.id)
        self.assertEqual(stored.content, "# Title\n\nBody.")
        self.assertEqual(stored.role, "assistant")

    def test_user_message_is_saved_before_the_model_runs(self):
        recorder = Recorder()
        with scripted_model(text("ok")):
            outcome = self._run("my question", recorder)

        self.assertEqual(outcome.user_message.content, "my question")
        # The client needs the real id early to reconcile its optimistic message.
        ids = [p.get("user_message_id") for p in recorder.of(Event.STATUS)]
        self.assertIn(outcome.user_message.id, ids)

    # ── Tool loop ──

    def test_tool_results_are_threaded_back_as_tool_messages(self):
        recorder = Recorder()

        async def fake_tool(name, args, context):
            return json.dumps({"type": "search_results", "text": "Team A won.",
                               "sources": [{"url": "http://a", "title": "A"}]})

        with scripted_model(tool_then_answer("web_search", {"query": "who won"}, "Team A won.")) \
                as model, patch("chat.tools.execute_tool", fake_tool):
            outcome = self._run("who won the match", recorder)

        # Second call must carry the assistant tool_calls turn and its `tool`
        # result, linked by id — not a prose summary of what happened.
        second = model.requests[1].messages
        assistant = next(m for m in second if m["role"] == "assistant" and m.get("tool_calls"))
        result = next(m for m in second if m["role"] == "tool")

        self.assertEqual(assistant["tool_calls"][0]["function"]["name"], "web_search")
        self.assertEqual(result["tool_call_id"], assistant["tool_calls"][0]["id"])
        self.assertEqual(result["tool_call_id"], "call_1")
        # Wrapped as untrusted data (provenance.wrap_untrusted); the body is unchanged.
        from core.safety.provenance import unwrap_untrusted
        self.assertEqual(unwrap_untrusted(result["content"]), fake_result_text())
        self.assertEqual(outcome.assistant_message.content, "Team A won.")

    def test_sources_reach_the_client_and_the_stored_message(self):
        recorder = Recorder()

        async def fake_tool(name, args, context):
            return json.dumps({
                "type": "search_results", "text": "...",
                "sources": [{"url": "http://a", "title": "A"}],
            })

        with scripted_model(tool_then_answer("web_search", {"query": "q"}, "Answer.")), \
             patch("chat.tools.execute_tool", fake_tool):
            outcome = self._run("search something", recorder)

        self.assertEqual(recorder.of(Event.SOURCES_UPDATE)[-1]["sources"][0]["url"],
                         "http://a")
        self.assertEqual(outcome.assistant_message.metadata["sources"][0]["url"],
                         "http://a")

    def test_provider_citations_become_the_turn_s_sources(self):
        """A Perplexity-style `citations` frame is the source list.

        This frame used to reach `StreamAccumulator` and stop there: nothing
        read it, so a `[1]` in a Perplexity answer pointed at no source and the
        sources panel stayed empty on a turn that plainly cited things.
        """
        recorder = Recorder()
        cited = text("Team A won [1].",
                     citations=[{"url": "https://a.example/1", "title": "A"}])
        with scripted_model(cited):
            outcome = self._run("who won", recorder)

        self.assertEqual(
            recorder.of(Event.SOURCES_UPDATE)[-1]["sources"][0]["url"],
            "https://a.example/1",
        )
        self.assertEqual(
            outcome.assistant_message.metadata["sources"][0]["title"], "A"
        )

    def test_tool_preamble_is_retracted_from_the_live_buffer(self):
        # A model that says "let me look that up" before calling a tool must not
        # leave that text sitting in the UI as though it were the answer.
        async def fake_tool(*_a, **_k):
            return "noon"

        recorder = Recorder()
        with scripted_model(text("Let me search.") + tool_call("get_current_time", {}, id="c1"),
                            text("It is noon.")), \
             patch("chat.tools.execute_tool", fake_tool):
            outcome = self._run("what time is it", recorder)

        self.assertEqual(len(recorder.of(Event.CONTENT_RESET)), 1)
        self.assertEqual(outcome.assistant_message.content, "It is noon.")

    # ── Explicit intents run their tool ──

    def test_slash_search_always_searches(self):
        # The user picking /search *is* the instruction to search. Leaving it to
        # the model means an explicit search request can come back sourceless.
        seen: list[str] = []

        async def fake_tool(name, args, context):
            seen.append(name)
            return json.dumps({"type": "search_results", "text": "Found it.",
                               "sources": [{"url": "http://a", "title": "A"}]})

        recorder = Recorder()
        with scripted_model(text("Answer.")), \
             patch("chat.tools.execute_tool", fake_tool):
            outcome = self._run("/search rust release date", recorder)

        self.assertIn("web_search", seen)
        self.assertTrue(outcome.assistant_message.metadata["sources"])
        # And the seeded call is visible in the trace, not silently absent.
        self.assertEqual(outcome.assistant_message.metadata["tool_trace"][0]["tool"],
                         "web_search")

    def test_slash_research_runs_deep_research(self):
        seen: list[str] = []

        async def fake_tool(name, args, context):
            seen.append(name)
            return json.dumps({"type": "deep_research", "text": "Corpus.",
                               "queries": ["q"], "sources": [{"url": "http://a"}]})

        with scripted_model(text("Answer.")), \
             patch("chat.tools.execute_tool", fake_tool):
            self._run("/research rust adoption", Recorder())

        self.assertIn("deep_research", seen)

    def test_slash_search_searches_when_commands_are_registered(self):
        # Whether `/search` resolves through the legacy prefix or the slash
        # command registry depends on which command modules happen to be
        # imported — i.e. on test order. Both paths must seed the search, so
        # force the registered path here (importing registers `/search`,
        # which is the state the full suite always reaches first).
        import chat.commands.web  # noqa: F401 — registration side effect

        seen: list[str] = []

        async def fake_tool(name, args, context):
            seen.append(name)
            return json.dumps({"type": "search_results", "text": "Found it.",
                               "sources": [{"url": "http://a", "title": "A"}]})

        with scripted_model(text("Answer.")), \
             patch("chat.tools.execute_tool", fake_tool):
            self._run("/search rust release date", Recorder())

        self.assertIn("web_search", seen)

    # The companion strip is off in test settings (no test may reach the
    # internet, `settings/test.py`). This test is about the strip, so it turns it
    # on; `setUp` stubs `image_search`, so the call stays hermetic.
    @override_settings(CHAT_COMPANION_IMAGES=True)
    def test_web_search_also_fills_the_image_panel(self):
        # A Perplexity-style answer with an empty visual panel reads as broken.
        async def fake_tool(name, args, context):
            return json.dumps({"type": "search_results", "text": "t",
                               "sources": [{"url": "http://a", "title": "A"}]})

        recorder = Recorder()
        with scripted_model(text("Answer.")), \
             patch("chat.tools.execute_tool", fake_tool):
            outcome = self._run("/search kittens", recorder)

        self.assertTrue(recorder.of(Event.IMAGES_UPDATE))
        self.assertTrue(outcome.assistant_message.metadata["images"])

    def test_an_opener_is_never_a_web_search(self):
        # A search intent is seeded: a full web search before the first model
        # call. "what is", "explain" and "compare" used to be read as one, so
        # ordinary questions paid for a search nobody asked for. How a message
        # opens is now only a hint about the turn's pace (`test_pace.py`).
        from chat.turn.pipeline import classify_intent

        for question in ("what is my name", "what did i say earlier",
                         "what is a monad", "explain recursion",
                         "compare rust and go"):
            self.assertEqual(classify_intent(question)[0], "chat", question)

    def test_plain_chat_does_not_search(self):
        # Only explicit intents are seeded; ordinary chat stays model-driven.
        seen: list[str] = []

        async def fake_tool(name, args, context):
            seen.append(name)
            return "{}"

        with scripted_model(text("Hi there.")), \
             patch("chat.tools.execute_tool", fake_tool):
            self._run("say hello", Recorder())

        self.assertEqual(seen, [])

    # ── Memory toggle ──

    def test_memory_off_sends_no_history(self):
        ChatMessage.objects.create(
            session=self.session, role="user", content="my name is Ada"
        )
        ChatMessage.objects.create(
            session=self.session, role="assistant", content="Hello Ada"
        )
        self.session.memory_enabled = False
        self.session.save(update_fields=["memory_enabled"])

        recorder = Recorder()
        with scripted_model(text("ok")) as model:
            self._run("what is my name", recorder)

        # The per-turn context update rides as a trailing `system` message, so
        # "no history" is about conversation, not about the list being short.
        # What must not survive the switch is a prior user or assistant turn;
        # the clock and screen state are not recall.
        sent = model.requests[0].messages
        self.assertEqual([m["role"] for m in conversation(sent)], ["user"])
        self.assertEqual(model.requests[0].last_user_text(), "what is my name")
        self.assertNotIn("Ada", json.dumps(sent))
        self.assertTrue(recorder.of(Event.STATUS))
        self.assertTrue(
            any(p.get("phase") == "memory_off" for p in recorder.of(Event.STATUS))
        )
        # Retention is not recall: the turns must still be in the database.
        self.assertEqual(
            ChatMessage.objects.filter(session=self.session, content="my name is Ada").count(),
            1,
        )

    def test_memory_on_sends_prior_turns(self):
        ChatMessage.objects.create(
            session=self.session, role="user", content="my name is Ada"
        )
        with scripted_model(text("Ada")) as model:
            self._run("what is my name", Recorder())

        self.assertIn("my name is Ada", json.dumps(model.requests[0].messages))

    def test_notes_come_after_the_replayed_history(self):
        # The notes are rewritten after every reply, so they must sit after the
        # replayed messages: at the head they would change the cached prefix on
        # every turn. The per-turn CURRENT STATE message comes last of all.
        from chat.turn import session_notes

        ChatMessage.objects.create(
            session=self.session, role="user", content="my name is Ada"
        )
        ChatMessage.objects.create(
            session=self.session, role="assistant", content="Hello Ada"
        )
        self.session.notes_state = {
            **session_notes.empty_state(), "summary": "Trip planning for Ada.",
        }
        self.session.save(update_fields=["notes_state"])

        with scripted_model(text("ok")) as model:
            self._run("where should I go", Recorder())
        sent = model.requests[0].messages

        def position(marker: str) -> list[int]:
            return [i for i, m in enumerate(sent) if marker in json.dumps(m.get("content"))]

        replayed = position("my name is Ada") + position("Hello Ada")
        notes = position("### CONVERSATION NOTES ###")
        state = position("### CURRENT STATE ###")
        self.assertEqual(len(notes), 1)
        self.assertEqual(len(state), 1)
        self.assertEqual(sent[notes[0]]["role"], "system")
        self.assertLess(max(replayed), notes[0])
        self.assertLess(notes[0], state[0])

    # ── Failure handling ──

    def test_provider_failure_becomes_a_readable_message(self):
        with scripted_model(provider_error(503, '{"error":{"message":"upstream overloaded"}}')):
            outcome = self._run("hello", Recorder())

        # Never the raw provider body, never a class name, never an empty bubble.
        content = outcome.assistant_message.content
        self.assertTrue(content)
        self.assertNotIn("LLMUnavailable", content)
        self.assertNotIn('{"error"', content)

    def test_empty_request_is_rejected(self):
        with self.assertRaises(TurnError):
            TurnRequest.parse({"content": "   "})


def fake_result_text() -> str:
    return json.dumps({"type": "search_results", "text": "Team A won.",
                       "sources": [{"url": "http://a", "title": "A"}]})


class ContextSummaryTests(TestCase):
    def test_prefers_an_explicit_conclusion(self):
        answer = (
            "Lots of detail. " * 50
            + "\n## Conclusion\nUse Postgres here because it scales better than "
              "the alternatives for this write-heavy workload."
        )
        self.assertIn("Postgres", context_summary(answer))

    def test_a_one_line_conclusion_falls_back_to_the_opening(self):
        # Under ~10 words a "conclusion" is usually a heading fragment rather
        # than a summary, and the opening carries more of the answer.
        answer = "Opening statement here. " * 50 + "\n## Conclusion\nUse Postgres."
        self.assertIn("Opening statement", context_summary(answer))

    def test_falls_back_to_the_opening(self):
        self.assertTrue(context_summary("Plain answer with no conclusion. " * 60))

    def test_markdown_is_stripped(self):
        summary = context_summary("**bold** `code` | table |\n" * 60)
        for marker in ("**", "`", "|"):
            self.assertNotIn(marker, summary)

    def test_length_is_bounded(self):
        self.assertLessEqual(len(context_summary("word " * 500).split()), 132)


class SlowTurnFollowUpTests(TestCase):
    """A turn that already ran long skips the follow-up suggestion call.

    Follow-ups are a separate LLM call that `_persist_answer` awaits before
    writing the message row — on a slow turn it delays persistence for three
    questions nobody asked for. The answer is kept; only the extra call is
    dropped (latency plan §4).
    """

    def setUp(self) -> None:
        self.user = User.objects.create_user(
            username="slow", email="s@example.com", password="pw"
        )
        self.session = ChatSession.objects.create(user=self.user, title="Test")

    def _persist(self, elapsed_s: float, follow_mock) -> ChatMessage:
        from chat.turn.agent import TurnContext, TurnResult
        from chat.turn.pipeline import _persist_answer

        turn = TurnContext(
            provider="p", model="m", system_message="s",
            user_id=self.user.id, session_id=str(self.session.id),
            intent="chat", user_text="q",
        )
        result = TurnResult(
            answer="A considered answer. " * 50, metadata={}, tool_trace=[],
        )
        with patch("chat.turn.agent.suggest_follow_ups", follow_mock):
            return async_to_sync(_persist_answer)(
                session=self.session, user=self.user, turn=turn,
                result=result, question="q", intent="chat",
                elapsed_s=elapsed_s,
            )

    @staticmethod
    async def _three(*_args, **_kwargs) -> list[str]:
        return ["a?", "b?", "c?"]

    def test_a_fast_turn_still_suggests_follow_ups(self):
        msg = self._persist(5, self._three)
        self.assertEqual(msg.metadata["follow_ups"], ["a?", "b?", "c?"])

    def test_a_slow_turn_skips_the_extra_call(self):
        from workflow_backend.thresholds import FOLLOW_UPS_SLOW_TURN_SECONDS

        async def _boom(*_args, **_kwargs) -> list[str]:
            raise AssertionError("the follow-up call must not run on a slow turn")

        msg = self._persist(FOLLOW_UPS_SLOW_TURN_SECONDS + 10, _boom)
        self.assertEqual(msg.metadata["follow_ups"], [])


class PreModelLatencyInstrumentTests(ChatTurnTests):
    """The pre-model segment has to be measurable, or it cannot be optimised.

    `agent._log_latency` starts inside `agent_node`, so the 15-20 sequential
    awaits `run_chat_turn` performs before the graph — preflight, the user
    message write, history, memory, attachments, the file scope, recall and
    intent seeding — were invisible to it. Every "current state" number in
    `docs/ORCHESTRATOR_LATENCY_OPTIMIZATION_PLAN.md` was an estimate for that
    reason.

    These pin the instrument itself, not a duration: a threshold would fail on
    a slow CI box and teach everyone to ignore it.
    """

    def test_a_turn_logs_what_it_spent_before_the_model(self):
        recorder = Recorder()
        with scripted_model(text("ok")):
            with self.assertLogs("chat.turn.pipeline", level="INFO") as logs:
                self._run("hello there", recorder)

        line = next(
            (m for m in logs.output if "[Latency] pre-model" in m), None
        )
        self.assertIsNotNone(line, f"no pre-model latency line in {logs.output}")
        self.assertIn("total=", line)
        self.assertIn("intent=chat", line)

    def test_intent_seeding_is_reported_as_pre_model_work(self):
        """The finding this instrument exists to make visible.

        `_seed_intent_tool` runs a full `web_search` *before* the first model
        call. That cost belongs to the pre-model segment and has to show up
        there. It is what showed that `classify_intent` was routing ordinary
        questions ("what is", "how to", "tell me about") into a search; only
        an explicit search is seeded now.
        """
        import asyncio

        async def _slow_tool(name, args, context) -> str:
            await asyncio.sleep(0.05)
            return json.dumps({"type": "search_results", "text": "t", "sources": []})

        recorder = Recorder()
        with patch("chat.tools.execute_tool", _slow_tool):
            with scripted_model(text("ok")):
                with self.assertLogs("chat.turn.pipeline", level="INFO") as logs:
                    self._run("/search rust", recorder)

        line = next(m for m in logs.output if "[Latency] pre-model" in m)
        self.assertIn("intent=search", line)
        self.assertIn("pace=quick", line)
        self.assertIn("intent_seed=", line)

    def test_an_ordinary_question_is_not_seeded(self):
        seen: list[str] = []

        async def _tool(name, args, context) -> str:
            seen.append(name)
            return "{}"

        with patch("chat.tools.execute_tool", _tool):
            with scripted_model(text("ok")):
                with self.assertLogs("chat.turn.pipeline", level="INFO") as logs:
                    self._run("tell me about rust", Recorder())

        self.assertEqual(seen, [])
        line = next(m for m in logs.output if "[Latency] pre-model" in m)
        self.assertIn("intent=chat", line)
        self.assertIn("pace=quick", line)
