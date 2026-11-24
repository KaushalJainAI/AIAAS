"""
The scripted-model kit (`llm/testing.py`) checked on its own, through the real
funnel: `access.complete` / `access.stream` -> handler -> the scripted transport.

These pin what the kit promises other tests: several tool calls in one turn,
usage counted, streamed tool-call deltas reassembled, a run out of steps named
by call number, a failure raised where a broken connection would raise, a hang
that ends only when cancelled, and a seam that is restored afterwards.
"""
from __future__ import annotations

import asyncio

import httpx
from asgiref.sync import async_to_sync
from django.test import TestCase

from llm import access
from llm.access import LLMUserActionable, StreamAccumulator
from llm.handlers import openai_compatible
from llm.testing import (
    DEFAULT_MODEL,
    DEFAULT_PROVIDER,
    TEST_API_KEY,
    fail,
    hang,
    provider_error,
    reasoning,
    scripted,
    scripted_model,
    text,
    tool_call,
    usage,
)

_REAL_SHARED_CLIENT = openai_compatible.shared_client

_TOOLS = [{
    "type": "function",
    "function": {
        "name": "lookup",
        "description": "Look a thing up.",
        "parameters": {"type": "object", "properties": {"q": {"type": "string"}}},
    },
}]


def _complete(**overrides):
    kwargs = dict(
        provider=DEFAULT_PROVIDER, model=DEFAULT_MODEL, prompt="find it",
        system_message="You are a test.", user_id=0, tools=_TOOLS,
    )
    kwargs.update(overrides)
    return async_to_sync(access.complete)(**kwargs)


def _stream_chunks(**overrides):
    kwargs = dict(
        provider=DEFAULT_PROVIDER, model=DEFAULT_MODEL, prompt="find it",
        system_message="You are a test.", user_id=0, tools=_TOOLS,
    )
    kwargs.update(overrides)

    async def collect():
        return [chunk async for chunk in access.stream(**kwargs)]

    return async_to_sync(collect)()


class NonStreamingPathTests(TestCase):
    def test_several_tool_calls_in_one_turn_are_all_parsed(self):
        script = tool_call("lookup", {"q": "a"}) + tool_call("lookup", {"q": "b"})
        with scripted_model(script) as model:
            completion = _complete()

        self.assertEqual([c.arguments for c in completion.tool_calls],
                         [{"q": "a"}, {"q": "b"}])
        self.assertEqual([c.id for c in completion.tool_calls], ["call_1_0", "call_1_1"])
        self.assertFalse(model.requests[0].stream)

    def test_usage_is_counted_through_access(self):
        with scripted_model(text("ok", usage=usage(prompt_tokens=40, completion_tokens=7))):
            completion = _complete()

        self.assertEqual(completion.content, "ok")
        self.assertEqual(completion.tokens, 47)

    def test_the_platform_key_is_the_one_sent(self):
        # No credential exists for user 0, so access.py falls back to the
        # platform key. The kit sets that key; the request carries it.
        with scripted_model(text("ok")) as model:
            _complete()
        self.assertEqual(model.requests[0].api_key, TEST_API_KEY)
        self.assertEqual(model.requests[0].provider, "openrouter")
        self.assertEqual(model.requests[0].model, DEFAULT_MODEL)
        self.assertEqual(model.requests[0].last_user_text(), "find it")
        self.assertEqual(model.requests[0].system_text(), "You are a test.")
        self.assertTrue(model.requests[0].tools_offered)


class StreamingPathTests(TestCase):
    def test_streamed_tool_call_arguments_are_reassembled(self):
        # The kit sends the name and the arguments in separate deltas. Folding
        # the chunks through the real accumulator must join them back.
        with scripted_model(tool_call("lookup", {"q": "streamed"})) as model:
            chunks = _stream_chunks()

        accumulator = StreamAccumulator()
        for chunk in chunks:
            accumulator.add(chunk)
        completion = accumulator.finish()

        self.assertEqual(len(completion.tool_calls), 1)
        self.assertEqual(completion.tool_calls[0].name, "lookup")
        self.assertEqual(completion.tool_calls[0].arguments, {"q": "streamed"})
        self.assertTrue(model.requests[0].stream)

    def test_streamed_content_and_usage_arrive(self):
        with scripted_model(text("hello there", usage=usage(5, 2))):
            chunks = _stream_chunks()

        accumulator = StreamAccumulator()
        for chunk in chunks:
            accumulator.add(chunk)
        completion = accumulator.finish()
        self.assertEqual(completion.content, "hello there")
        self.assertEqual(completion.tokens, 7)

    def test_streamed_reasoning_is_captured_on_the_thinking_channel(self):
        # `_build_request` sets the handler's `thinking` flag, so the reasoning
        # the provider streams comes out as thinking chunks, not as content.
        with scripted_model(reasoning("let me think") + text("answer")):
            chunks = _stream_chunks()

        accumulator = StreamAccumulator()
        for chunk in chunks:
            accumulator.add(chunk)
        completion = accumulator.finish()
        self.assertEqual(completion.thinking, "let me think")
        self.assertEqual(completion.content, "answer")


class ReasoningCaptureTests(TestCase):
    """Reasoning reaches `Completion.thinking` through the real funnel, on both paths."""

    def test_reasoning_field_is_captured_without_streaming(self):
        with scripted_model(reasoning("let me think") + text("answer")):
            completion = _complete()
        self.assertEqual(completion.thinking, "let me think")
        self.assertEqual(completion.content, "answer")

    def test_think_tags_are_split_out_of_the_content_without_streaming(self):
        with scripted_model(text("<think>x</think>answer")):
            completion = _complete()
        self.assertEqual(completion.content, "answer")
        self.assertEqual(completion.thinking, "x")

    def test_think_tags_are_split_out_of_the_content_when_streamed(self):
        with scripted_model(text("<think>x</think>answer")):
            chunks = _stream_chunks()
        accumulator = StreamAccumulator()
        for chunk in chunks:
            accumulator.add(chunk)
        completion = accumulator.finish()
        self.assertEqual(completion.content, "answer")
        self.assertEqual(completion.thinking, "x")

    def test_the_thinking_flag_is_on_for_hosted_providers_and_off_for_ollama(self):
        # Ollama's handler turns the flag into a JSON-output request for models
        # that do not reason natively, so it keeps its old behaviour.
        def built(provider):
            return async_to_sync(access._build_request)(
                provider=provider, model="m", prompt="p", system_message="s",
                user_id=0, temperature=0.7, max_tokens=64, effort=None,
                tools=None, history=None, attachments=None,
            ).config

        # The block sets the platform key, which `_build_request` needs for a
        # hosted provider when the user has no credential of their own.
        with scripted_model():
            self.assertIs(built(DEFAULT_PROVIDER)["thinking"], True)
            self.assertIs(built("ollama")["thinking"], False)


class ScriptRunsOutTests(TestCase):
    def test_running_out_of_steps_names_the_call_that_had_none(self):
        with self.assertRaisesRegex(AssertionError, "model call 2"):
            with scripted_model(text("one")):
                _complete()
                _complete()

    def test_unused_steps_are_reported_on_request(self):
        with scripted_model(text("one"), text("two")) as model:
            _complete()
        with self.assertRaisesRegex(AssertionError, "never used"):
            model.assert_consumed()

    def test_a_call_to_a_route_the_script_does_not_answer_fails_the_block(self):
        async def get_models():
            return await openai_compatible.shared_client().get(
                "https://openrouter.ai/api/v1/models")

        with self.assertRaisesRegex(AssertionError, "route the script does not answer"):
            with scripted_model(text("x")):
                async_to_sync(get_models)()


class FailureTests(TestCase):
    def test_a_broken_connection_is_a_provider_failure_not_a_reply(self):
        with scripted_model(fail(httpx.ReadError("connection reset"))) as model:
            with self.assertRaises(RuntimeError):
                _complete()
        self.assertEqual(len(model.requests), 1)

    def test_an_http_error_from_the_provider_is_classified(self):
        # 401 is a key the user must fix: access.py raises its typed error, not a
        # sentence about the upstream failure.
        with scripted_model(provider_error(401, "invalid api key")):
            with self.assertRaises(LLMUserActionable):
                _complete()


class HangTests(TestCase):
    def test_a_hanging_provider_holds_the_call_until_it_is_cancelled(self):
        """No sleep and no timeout: the test waits for the request, then cancels."""
        outcome: dict[str, object] = {}

        async def scenario(model):
            task = asyncio.ensure_future(_async_complete())
            await model.until_requested(1)
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                outcome["cancelled"] = True

        async def _async_complete():
            return await access.complete(
                provider=DEFAULT_PROVIDER, model=DEFAULT_MODEL, prompt="wait",
                system_message="s", user_id=0,
            )

        with scripted_model(hang()) as model:
            async_to_sync(scenario)(model)
        self.assertTrue(outcome.get("cancelled"))
        self.assertEqual(len(model.requests), 1)


class BadArgumentTests(TestCase):
    def test_an_unknown_step_is_refused_up_front(self):
        with self.assertRaisesRegex(TypeError, "not a scripted step"):
            with scripted_model("just a string"):
                pass

    def test_a_provider_the_kit_cannot_answer_for_is_refused(self):
        with self.assertRaisesRegex(ValueError, "ollama"):
            with scripted_model(text("x"), provider="ollama"):
                pass


class AlwaysAndCitationTests(TestCase):
    def test_always_answers_every_call_from_what_it_was_sent(self):
        from llm.testing import always

        def respond(request):
            return text(f"call {request.index}, tools offered: {request.tools_offered}")

        with scripted_model(always(respond)) as model:
            first = _complete()
            second = _complete(tools=None)
        self.assertEqual(first.content, "call 1, tools offered: True")
        self.assertEqual(second.content, "call 2, tools offered: False")
        model.assert_consumed()  # open-ended: never counts as unused

    def test_always_must_come_last(self):
        from llm.testing import always

        with self.assertRaisesRegex(TypeError, "must come last"):
            with scripted_model(always(lambda r: text("x")), text("never")):
                pass

    def test_cited_sources_reach_the_accumulator(self):
        with scripted_model(text("See [1].", citations=[{"url": "https://a.example/1",
                                                          "title": "A"}])):
            chunks = _stream_chunks()
        accumulator = StreamAccumulator()
        for chunk in chunks:
            accumulator.add(chunk)
        self.assertEqual([c["url"] for c in accumulator.citations], ["https://a.example/1"])


# ── the pytest fixture form, for plain pytest functions (no database) ───────

def test_the_fixture_installs_the_seam_for_the_test(scripted):
    scripted.push(text("from the fixture"))

    async def post():
        response = await openai_compatible.shared_client().post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": "Bearer k"},
            json={"model": DEFAULT_MODEL, "messages": [{"role": "user", "content": "hi"}]},
        )
        return response.json()

    body = asyncio.run(post())
    assert body["choices"][0]["message"]["content"] == "from the fixture"
    assert len(scripted.requests) == 1


def test_the_seam_is_restored_after_the_block():
    assert openai_compatible.shared_client is _REAL_SHARED_CLIENT
