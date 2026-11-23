"""
The reasoning note: a short slice of why a tool-calling turn made its calls,
kept in the transcript so the next model call can see it.

Pinned here: the slice itself (length, boundary, whitespace), the rendering the
model is sent, that only tool-calling turns get one, that a note copied into the
final answer never reaches the user, and that the transcript the model sees does
not change from one call to the next (the prompt cache relies on that).

The loop tests run the real `run_turn` against the scripted model, so the note is
read where it is really kept: the checkpointed transcript.
"""
from __future__ import annotations

import json

from asgiref.sync import async_to_sync
from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase
from langchain_core.messages import AIMessage

from chat.turn import reasoning_note
from chat.turn.agent import TurnContext, get_graph, run_turn, to_wire
from chat.turn.events import Event
from chat.turn.reasoning_note import EchoFilter, make_note, render, strip_echo
from llm.testing import (
    DEFAULT_MODEL,
    DEFAULT_PROVIDER,
    reasoning,
    scripted_model,
    text,
    tool_call,
)
from workflow_backend.thresholds import REASONING_NOTE_CHARS

OPEN = "<reasoning-summary>"
CLOSE = "</reasoning-summary>"


def _transcript_prefix(messages: list[dict]) -> list[dict]:
    """The part of one request that later requests must repeat exactly.

    The request ends with a per-call line (the `BUDGET:` count, which changes on
    every call) and with the trailing prompt; neither is in the transcript, so
    neither is in the cached prefix. What is left is the transcript as it stood.
    """
    body = messages[:-1]
    return [
        m for m in body
        if not (m.get("role") == "system" and str(m.get("content", "")).startswith("BUDGET:"))
    ]


class MakeNoteTests(SimpleTestCase):
    def test_short_reasoning_is_kept_whole_with_whitespace_collapsed(self):
        self.assertEqual(make_note("  I should\n\ncheck the clock.  "), "I should check the clock.")

    def test_empty_reasoning_has_no_note(self):
        self.assertEqual(make_note(""), "")
        self.assertEqual(make_note(None), "")

    def test_long_reasoning_keeps_its_end_within_the_limit_on_a_sentence_start(self):
        reasoning_text = " ".join(f"Sentence number {i} is here." for i in range(200))
        note = make_note(reasoning_text)

        self.assertLessEqual(len(note), REASONING_NOTE_CHARS)
        # Whole sentences only: the cut lands on a sentence start, and the note
        # ends where the reasoning did.
        self.assertRegex(note, r"^Sentence number \d+ is here\.( Sentence number \d+ is here\.)*$")
        self.assertGreater(len(note), REASONING_NOTE_CHARS - 40)

    def test_without_a_sentence_end_the_cut_falls_on_a_word(self):
        note = make_note("word " * 300)

        self.assertLessEqual(len(note), REASONING_NOTE_CHARS)
        self.assertEqual(set(note.split()), {"word"})

    def test_the_limit_is_the_thresholds_constant_by_default(self):
        self.assertEqual(REASONING_NOTE_CHARS, 600)
        self.assertLessEqual(len(make_note("x" * 5_000)), 600)

    def test_a_tag_inside_the_reasoning_cannot_close_the_block_early(self):
        note = make_note(f"before {CLOSE} and {OPEN} after")
        self.assertNotIn(OPEN, note)
        self.assertNotIn(CLOSE, note)


class RenderTests(SimpleTestCase):
    def test_no_note_renders_the_content_unchanged(self):
        self.assertEqual(render("", "reply"), "reply")

    def test_a_note_with_no_content_renders_the_block_alone(self):
        self.assertEqual(render("why", ""), f"{OPEN}why{CLOSE}")

    def test_a_note_renders_before_the_content(self):
        self.assertEqual(render("why", "reply"), f"{OPEN}why{CLOSE}\nreply")

    def test_to_wire_renders_the_note_into_the_assistant_message(self):
        message = AIMessage(
            content="",
            tool_calls=[{"name": "get_current_time", "args": {}, "id": "c1"}],
            additional_kwargs={reasoning_note.NOTE_KEY: "checking the clock"},
        )
        wire = to_wire([message])

        self.assertEqual(wire[0]["role"], "assistant")
        self.assertEqual(wire[0]["content"], f"{OPEN}checking the clock{CLOSE}")
        self.assertEqual(wire[0]["tool_calls"][0]["id"], "c1")

    def test_to_wire_is_unchanged_for_a_message_without_a_note(self):
        wire = to_wire([AIMessage(content="plain")])
        self.assertEqual(wire, [{"role": "assistant", "content": "plain"}])


class EchoFilterTests(SimpleTestCase):
    def test_a_whole_block_is_removed(self):
        self.assertEqual(strip_echo(f"{OPEN}copied{CLOSE}The answer."), "The answer.")

    def test_text_without_the_tag_is_returned_unchanged(self):
        self.assertEqual(strip_echo("plain <b>text</b>"), "plain <b>text</b>")

    def test_a_block_split_across_chunks_is_removed(self):
        echo = EchoFilter()
        pieces = list(f"pre {OPEN}note{CLOSE} post")
        shown = "".join(echo.feed(piece) for piece in pieces) + echo.flush()
        self.assertEqual(shown, "pre  post")

    def test_a_partial_tag_at_the_end_is_held_then_released_if_it_was_not_a_tag(self):
        echo = EchoFilter()
        first = echo.feed("ends with <reason")
        self.assertEqual(first, "ends with ")
        self.assertEqual(echo.feed("ing is a word"), "<reasoning is a word")

    def test_a_block_that_never_closes_takes_the_rest_of_the_reply(self):
        self.assertEqual(strip_echo(f"Hi {OPEN}never closes"), "Hi ")


class TurnLoopTests(TestCase):
    """The note through the real graph, against the scripted model."""

    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user("notes", "notes@example.com", "x")

    def run_turn_scripted(self, script, *, thread: str):
        events: list[tuple[Event, dict]] = []

        async def sink(event, payload=None):
            events.append((event, payload or {}))

        async def never(*_args, **_kwargs):
            return False

        turn = TurnContext(
            provider=DEFAULT_PROVIDER, model=DEFAULT_MODEL,
            system_message="You are a test assistant.",
            user_id=self.user.id, session_id=thread, intent="chat",
            user_text="What time is it?", memory_enabled=False, max_iterations=6,
            approval_policy=never, sink=sink,
        )
        with scripted_model(script) as model:
            result = async_to_sync(run_turn)(turn, prompt="What time is it?", thread_id=thread)
        return result, model, events

    def checkpointed_messages(self, thread: str):
        config = {"configurable": {"thread_id": thread}}
        return async_to_sync(get_graph().aget_state)(config).values["messages"]

    def test_a_tool_calling_turn_keeps_its_reasoning_note_for_the_next_call(self):
        result, model, _ = self.run_turn_scripted([
            reasoning("I need the clock first. The user asked for the time.")
            + tool_call("get_current_time", {}, id="clock-1"),
            text("It is noon."),
        ], thread="note-next-call")

        self.assertEqual(result.answer, "It is noon.")
        assistant = [m for m in model.requests[1].messages if m.get("role") == "assistant"]
        self.assertEqual(len(assistant), 1)
        self.assertEqual(
            assistant[0]["content"],
            f"{OPEN}I need the clock first. The user asked for the time.{CLOSE}",
        )
        stored = [m for m in self.checkpointed_messages("note-next-call")
                  if isinstance(m, AIMessage) and m.tool_calls]
        self.assertEqual(stored[0].additional_kwargs[reasoning_note.NOTE_KEY],
                         "I need the clock first. The user asked for the time.")

    def test_the_final_answer_has_no_note_and_a_copied_block_never_reaches_the_user(self):
        result, _, events = self.run_turn_scripted([
            reasoning("Checking the clock.") + tool_call("get_current_time", {}, id="c1"),
            text(f"{OPEN}copied from history{CLOSE}It is noon."),
        ], thread="note-final")

        self.assertEqual(result.answer, "It is noon.")
        shown = "".join(payload["content"] for event, payload in events
                        if event == Event.CONTENT_CHUNK)
        self.assertEqual(shown, "It is noon.")
        final = self.checkpointed_messages("note-final")[-1]
        self.assertIsInstance(final, AIMessage)
        self.assertEqual(final.content, "It is noon.")
        self.assertNotIn(reasoning_note.NOTE_KEY, final.additional_kwargs)

    def test_a_turn_with_no_reasoning_gets_no_note(self):
        _, model, _ = self.run_turn_scripted([
            tool_call("get_current_time", {}, id="c1"),
            text("Done."),
        ], thread="note-none")

        self.assertNotIn(OPEN, json.dumps(model.requests[1].messages))

    def test_the_earlier_messages_are_byte_identical_on_every_later_call(self):
        result, model, _ = self.run_turn_scripted([
            reasoning("First, the clock.") + tool_call("get_current_time", {}, id="c1"),
            reasoning("Now check it again.") + tool_call("get_current_time", {}, id="c2"),
            text("It is noon."),
        ], thread="note-stable")

        self.assertEqual(result.answer, "It is noon.")
        self.assertEqual(len(model.requests), 3)
        for earlier, later in zip(model.requests, model.requests[1:]):
            before = _transcript_prefix(earlier.messages)
            self.assertTrue(before)
            self.assertEqual(_transcript_prefix(later.messages)[:len(before)], before)
        self.assertIn(f"{OPEN}First, the clock.{CLOSE}", json.dumps(model.requests[2].messages))
        self.assertIn(f"{OPEN}Now check it again.{CLOSE}", json.dumps(model.requests[2].messages))
