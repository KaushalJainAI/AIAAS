"""
Anthropic prompt-cache breakpoints on OpenRouter requests.

Anthropic caches only what is marked with `cache_control`, so for `anthropic/`
models the request carries two marks: the system prompt and the last settled
message. Every other provider caches automatically and gets no marks at all.
The helper must never mutate what the caller passed in.
"""
from __future__ import annotations

import copy

from django.test import SimpleTestCase

from llm.handlers.llm_providers import OpenRouterNode, _with_cache_breakpoints

EPHEMERAL = {"type": "ephemeral"}
ANTHROPIC = "anthropic/claude-sonnet-5.5"
DEEPSEEK = "deepseek/deepseek-v4.1-flash"


def _marks(messages):
    """(index, role) of every message that carries a cache_control anywhere."""
    found = []
    for i, m in enumerate(messages):
        content = m.get("content")
        if isinstance(content, list) and any(
            "cache_control" in part for part in content if isinstance(part, dict)
        ):
            found.append((i, m["role"]))
    return found


def _conversation():
    return [
        {"role": "system", "content": "You are the assistant. Stable rules."},
        {"role": "user", "content": "first question"},
        {"role": "assistant", "content": "first answer"},
        {"role": "user", "content": "second question"},
        {"role": "system", "content": "Context update: the clock says 10:00."},
    ]


class MarksTests(SimpleTestCase):
    def test_marks_the_system_message_and_the_last_settled_message(self):
        out = _with_cache_breakpoints(_conversation())
        # index 0 is the system prompt, index 3 the last user turn; index 4 is
        # the volatile trailing context message and is skipped.
        self.assertEqual(_marks(out), [(0, "system"), (3, "user")])
        self.assertEqual(
            out[0]["content"],
            [{"type": "text", "text": "You are the assistant. Stable rules.",
              "cache_control": EPHEMERAL}],
        )
        self.assertEqual(out[3]["content"][0]["cache_control"], EPHEMERAL)
        self.assertEqual(out[3]["content"][0]["text"], "second question")

    def test_trailing_system_context_message_is_skipped(self):
        out = _with_cache_breakpoints(_conversation())
        self.assertEqual(out[4], _conversation()[4])
        self.assertNotIn("cache_control", str(out[4]))

    def test_assistant_with_tool_calls_and_no_content_is_skipped(self):
        messages = [
            {"role": "system", "content": "sys"},
            {"role": "user", "content": "look it up"},
            {"role": "assistant", "content": None, "tool_calls": [
                {"id": "c1", "type": "function",
                 "function": {"name": "search", "arguments": "{}"}},
            ]},
        ]
        out = _with_cache_breakpoints(messages)
        self.assertEqual(_marks(out), [(0, "system"), (1, "user")])
        self.assertIsNone(out[2]["content"])
        self.assertIs(out[2], messages[2])

    def test_list_content_gets_the_mark_on_its_last_text_part(self):
        messages = [
            {"role": "system", "content": "sys"},
            {"role": "user", "content": [
                {"type": "text", "text": "describe this"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}},
                {"type": "text", "text": "and this"},
            ]},
        ]
        out = _with_cache_breakpoints(messages)
        parts = out[1]["content"]
        self.assertEqual(parts[0], {"type": "text", "text": "describe this"})
        self.assertEqual(parts[1], messages[1]["content"][1])
        self.assertEqual(
            parts[2], {"type": "text", "text": "and this", "cache_control": EPHEMERAL},
        )

    def test_list_without_a_text_part_is_skipped_and_the_walk_continues(self):
        messages = [
            {"role": "system", "content": "sys"},
            {"role": "user", "content": "earlier text"},
            {"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}},
            ]},
        ]
        out = _with_cache_breakpoints(messages)
        self.assertEqual(_marks(out), [(0, "system"), (1, "user")])
        self.assertIs(out[2], messages[2])

    def test_no_system_message_marks_only_the_last_settled_message(self):
        messages = [
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "hi"},
        ]
        out = _with_cache_breakpoints(messages)
        self.assertEqual(_marks(out), [(1, "assistant")])

    def test_empty_messages_list_is_returned_as_an_empty_list(self):
        self.assertEqual(_with_cache_breakpoints([]), [])


class ImmutabilityTests(SimpleTestCase):
    def test_callers_list_and_dicts_are_unchanged(self):
        messages = _conversation()
        before = copy.deepcopy(messages)
        out = _with_cache_breakpoints(messages)
        self.assertEqual(messages, before)
        self.assertIsNot(out, messages)
        self.assertIsNot(out[0], messages[0])
        self.assertIsNot(out[3], messages[3])

    def test_list_content_is_copied_not_edited_in_place(self):
        parts = [{"type": "text", "text": "hello"}]
        messages = [
            {"role": "system", "content": "sys"},
            {"role": "user", "content": parts},
        ]
        out = _with_cache_breakpoints(messages)
        self.assertIsNot(out[1]["content"], parts)
        self.assertEqual(parts, [{"type": "text", "text": "hello"}])
        self.assertNotIn("cache_control", parts[0])

    def test_unchanged_messages_are_the_same_objects(self):
        messages = _conversation()
        out = _with_cache_breakpoints(messages)
        self.assertIs(out[1], messages[1])
        self.assertIs(out[2], messages[2])
        self.assertIs(out[4], messages[4])


class PayloadTests(SimpleTestCase):
    def _payload(self, model, messages):
        return OpenRouterNode().chat_payload(
            model=model, messages=messages, config={}, stream=False,
        )

    def test_anthropic_model_gets_breakpoints_in_the_request_body(self):
        payload = self._payload(ANTHROPIC, _conversation())
        self.assertEqual(_marks(payload["messages"]), [(0, "system"), (3, "user")])

    def test_model_id_match_is_case_insensitive(self):
        payload = self._payload("Anthropic/Claude-Sonnet-5.5", _conversation())
        self.assertEqual(_marks(payload["messages"]), [(0, "system"), (3, "user")])

    def test_non_anthropic_model_gets_no_cache_control_anywhere(self):
        payload = self._payload(DEEPSEEK, _conversation())
        self.assertEqual(payload["messages"], _conversation())
        self.assertNotIn("cache_control", str(payload))
