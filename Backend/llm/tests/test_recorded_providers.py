"""
Provider wire formats, replayed from recordings (`llm/recorded.py`).

Each test sends a real request through the funnel (`llm.access`, or
`llm.decisions.decide`), the real handler parses the recorded bytes, and the
test checks what came out: text, reasoning, tool calls, token counts. Nothing
above the network is patched.

The recordings cover what the scripted model cannot: Ollama's newline-delimited
JSON, the Responses API events behind the ChatGPT plan, OpenRouter's Decisions
API, and OpenRouter's own SSE (comment keep-alives, cost in the usage frame),
which the scripted model only imitates. See each file's `source` and `note`
for where it came from.
"""
from __future__ import annotations

import json
import os
import unittest
from unittest import mock

import httpx
from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import SimpleTestCase, TestCase, override_settings

from llm import access, decisions
from llm.access import StreamAccumulator
from llm.recorded import RECORDINGS_DIR, SECRET_HEADERS, Recorder, RecordingMissing, replay

User = get_user_model()

WEATHER_TOOL = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "The weather in a city.",
        "parameters": {"type": "object", "properties": {"city": {"type": "string"}},
                       "required": ["city"]},
    },
}]


def _stream(**kwargs) -> StreamAccumulator:
    async def collect():
        accumulator = StreamAccumulator()
        async for chunk in access.stream(**kwargs):
            accumulator.add(chunk)
        return accumulator

    return async_to_sync(collect)()


# ── the kit itself ───────────────────────────────────────────────────────────

class ReplayKitTests(SimpleTestCase):
    def _get(self, url):
        async def call():
            from workflow_backend.httpclient import shared_client
            response = await shared_client().get(url)
            return response.json()
        return async_to_sync(call)()

    def _write(self, name, exchanges):
        path = RECORDINGS_DIR / f"{name}.json"
        path.write_text(json.dumps({"source": "test", "exchanges": exchanges}), encoding="utf-8")
        self.addCleanup(path.unlink)

    def test_requests_are_answered_in_order_and_kept(self):
        self._write("_kit_order", [
            {"request": {"method": "GET", "url": "https://example.test/a"},
             "response": {"status": 200, "json": {"n": 1}}},
            {"request": {"method": "GET", "url": "https://example.test/b?x=1"},
             "response": {"status": 200, "json": {"n": 2}}},
        ])
        with replay("_kit_order") as tape:
            self.assertEqual(self._get("https://example.test/a"), {"n": 1})
            self.assertEqual(self._get("https://example.test/b?x=1"), {"n": 2})
        self.assertEqual([r.url for r in tape.requests],
                         ["https://example.test/a", "https://example.test/b?x=1"])

    def test_a_request_the_recording_does_not_have_is_refused(self):
        self._write("_kit_wrong", [
            {"request": {"method": "GET", "url": "https://example.test/a"},
             "response": {"status": 200, "json": {}}},
        ])
        with self.assertRaisesRegex(AssertionError, "the code sent GET https://example.test/other"):
            with replay("_kit_wrong"):
                try:
                    self._get("https://example.test/other")
                except Exception:  # noqa: BLE001 - the code under test may swallow it
                    pass

    def test_an_unused_exchange_fails_the_block(self):
        self._write("_kit_unused", [
            {"request": {"method": "GET", "url": "https://example.test/a"},
             "response": {"status": 200, "json": {}}},
        ])
        with self.assertRaisesRegex(AssertionError, "1 exchange"):
            with replay("_kit_unused"):
                pass

    def test_module_level_httpx_get_is_answered_too(self):
        self._write("_kit_sync", [
            {"request": {"method": "GET", "url": "https://example.test/sync"},
             "response": {"status": 200, "json": {"ok": True}}},
        ])
        with replay("_kit_sync"):
            self.assertEqual(httpx.get("https://example.test/sync").json(), {"ok": True})

    def test_a_missing_recording_skips_locally_and_fails_in_ci(self):
        with mock.patch.dict(os.environ, {"CI": "", "RECORD_PROVIDER_FIXTURES": ""}):
            with self.assertRaises(unittest.SkipTest):
                with replay("_kit_does_not_exist"):
                    pass
        with mock.patch.dict(os.environ, {"CI": "true", "RECORD_PROVIDER_FIXTURES": ""}):
            with self.assertRaises(RecordingMissing):
                with replay("_kit_does_not_exist"):
                    pass

    def test_recording_drops_credentials_and_noisy_headers(self):
        recorder = Recorder("_kit_never_saved")
        request = httpx.Request("POST", "https://example.test/x",
                                headers={"Authorization": "Bearer sk-secret"},
                                json={"q": 1})
        response = httpx.Response(200, headers={
            "content-type": "application/json", "set-cookie": "s=1", "x-request-id": "abc"})
        recorder.keep(request, response, b'{"ok": true}')
        saved = json.dumps(recorder.exchanges)
        self.assertNotIn("sk-secret", saved)
        self.assertNotIn("set-cookie", saved)
        self.assertNotIn("x-request-id", saved)
        self.assertEqual(recorder.exchanges[0]["response"]["json"], {"ok": True})

    def test_every_recording_says_where_it_came_from(self):
        for path in RECORDINGS_DIR.glob("*.json"):
            if path.name.startswith("_kit_"):
                continue
            data = json.loads(path.read_text(encoding="utf-8"))
            with self.subTest(path.name):
                self.assertIn(data.get("source"), {"recorded", "from-docs"})
                self.assertTrue(data.get("note"))
                for exchange in data["exchanges"]:
                    headers = {k.lower() for k in exchange["response"].get("headers", {})}
                    self.assertFalse(headers & SECRET_HEADERS)


# ── Ollama: newline-delimited JSON on /api/chat ──────────────────────────────

class OllamaTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user("ollama-user", password="pw")

    def _kwargs(self, **over):
        kwargs = dict(provider="ollama", model="qwen3:8b", prompt="Say hello.",
                      system_message="You are a test.", user_id=self.user.id)
        kwargs.update(over)
        return kwargs

    def test_ollama_streamed_answer_with_reasoning_and_token_counts(self):
        with replay("ollama_chat_stream") as tape:
            result = _stream(**self._kwargs())
        self.assertIsNone(result.error)
        self.assertEqual(result.content, "Hello there.")
        # Ollama sends reasoning in `message.thinking`, in chunks whose
        # content is empty. It must arrive as reasoning, not be dropped.
        self.assertEqual(result.thinking, "The user wants a greeting.")
        # prompt_eval_count + eval_count, as token counts, not durations.
        self.assertEqual(result.usage.input, 26)
        self.assertEqual(result.usage.output, 12)
        body = tape.requests[0].json
        self.assertIs(body["stream"], True)
        self.assertEqual(body["model"], "qwen3:8b")

    def test_ollama_streamed_tool_call_reaches_the_agent(self):
        # Agent turns stream. Before this test the streamed path sent no tools
        # and ignored `tool_calls`, so an Ollama agent could never call one.
        with replay("ollama_chat_stream_tool_call") as tape:
            result = _stream(**self._kwargs(tools=WEATHER_TOOL))
        self.assertIsNone(result.error)
        completion = result.finish()
        self.assertEqual([(c.name, c.arguments) for c in completion.tool_calls],
                         [("get_weather", {"city": "Paris"})])
        self.assertTrue(completion.tool_calls[0].id)
        self.assertEqual([t["function"]["name"] for t in tape.requests[0].json["tools"]],
                         ["get_weather"])
        self.assertEqual(result.usage.total, 135)

    def test_ollama_tool_choice_none_sends_no_tools_when_streaming(self):
        with replay("ollama_chat_stream") as tape:
            result = _stream(**self._kwargs(tools=WEATHER_TOOL, tool_choice="none"))
        self.assertEqual(result.content, "Hello there.")
        self.assertNotIn("tools", tape.requests[0].json)

    def test_ollama_non_streamed_tool_call_with_object_arguments(self):
        with replay("ollama_chat_complete_tool_call") as tape:
            completion = async_to_sync(access.complete)(**self._kwargs(tools=WEATHER_TOOL))
        self.assertEqual([(c.name, c.arguments) for c in completion.tool_calls],
                         [("get_weather", {"city": "Paris"})])
        self.assertEqual(completion.thinking, "I should look up the weather.")
        self.assertEqual(completion.tokens, 135)
        self.assertIs(tape.requests[0].json["stream"], False)


# ── The ChatGPT plan: Responses API events ───────────────────────────────────

@override_settings(CHATGPT_PLAN_ENABLED=True)
class ChatGPTPlanTests(TestCase):
    def setUp(self):
        from credentials import chatgpt as signin
        from llm.models import AIModel, AIProvider

        cache.clear()
        self.user = User.objects.create_user("plan-user", password="pw")
        provider, _ = AIProvider.objects.get_or_create(
            slug="chatgpt", defaults={"name": "ChatGPT plan"})
        AIModel.objects.update_or_create(value="chatgpt/gpt-5.5", defaults={
            "provider": provider, "name": "GPT-5.5", "supports_image_input": True,
            "source": "hand"})
        # A real stored sign-in: the token goes through the real lookup.
        signin._save(
            user_id=self.user.id, client_id="app_x",
            tokens={"access_token": "plan-access-token", "refresh_token": "r",
                    "expires_in": 3600},
            identity={"sub": "s", "email": "me@example.com"})

    def _kwargs(self, **over):
        kwargs = dict(provider="chatgpt", model="chatgpt/gpt-5.5", prompt="Say hello.",
                      system_message="You are a test.", user_id=self.user.id, effort="low")
        kwargs.update(over)
        return kwargs

    def test_chatgpt_streamed_answer_with_its_reasoning_summary_and_usage(self):
        with replay("chatgpt_responses_stream_text") as tape:
            result = _stream(**self._kwargs())
        self.assertIsNone(result.error)
        self.assertEqual(result.content, "Hello there.")
        self.assertEqual(result.thinking, "Greeting the user.")
        self.assertEqual(result.usage.input, 36)
        self.assertEqual(result.usage.output, 87)

        request = tape.requests[0]
        self.assertEqual(request.headers["authorization"], "Bearer plan-access-token")
        body = request.json
        self.assertEqual(body["model"], "gpt-5.5", "the catalogue prefix never reaches the wire")
        self.assertIs(body["store"], False)

    def test_chatgpt_function_call_item_becomes_one_tool_call(self):
        with replay("chatgpt_responses_stream_tool_call") as tape:
            result = _stream(**self._kwargs(tools=WEATHER_TOOL))
        completion = result.finish()
        self.assertEqual([(c.id, c.name, c.arguments) for c in completion.tool_calls],
                         [("call_12345xyz", "get_weather", {"city": "Paris"})])
        self.assertEqual(tape.requests[0].json["tools"][0]["name"], "get_weather")


# ── OpenRouter: the real SSE, beyond what the scripted model imitates ────────

class OpenRouterStreamTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user("or-user", password="pw")

    def _kwargs(self, **over):
        kwargs = dict(provider="openrouter", model="deepseek/deepseek-v4.1-flash",
                      prompt="Capital of France?", system_message="Be brief.",
                      user_id=self.user.id)
        kwargs.update(over)
        return kwargs

    def test_openrouter_chat_comment_lines_reasoning_and_usage(self):
        with mock.patch.dict(os.environ, {"OPENROUTER_API_KEY": "sk-or-test"}), \
                replay("openrouter_chat_stream") as tape:
            result = _stream(**self._kwargs())
        self.assertIsNone(result.error)
        self.assertEqual(result.content, "Paris is the capital.")
        self.assertEqual(result.usage.total, 23)
        self.assertEqual(tape.requests[0].headers["authorization"], "Bearer sk-or-test")

    def test_openrouter_chat_tool_call_fragments_are_joined(self):
        with mock.patch.dict(os.environ, {"OPENROUTER_API_KEY": "sk-or-test"}), \
                replay("openrouter_chat_stream_tool_call"):
            result = _stream(**self._kwargs(tools=WEATHER_TOOL))
        completion = result.finish()
        self.assertEqual([(c.id, c.name, c.arguments) for c in completion.tool_calls],
                         [("call_0_abc", "get_weather", {"city": "Paris"})])


# ── OpenRouter Decisions API ─────────────────────────────────────────────────

QUESTIONS = [
    {"name": "team", "type": "choice", "instructions": "Which team owns it?",
     "options": [{"name": "payments", "description": "billing"}, {"name": "frontend"}]},
    {"name": "is_bug", "type": "noul", "instructions": "Is it a defect?"},
    {"name": "urgency", "type": "score", "levels": ["can wait", "this week", "blocking"]},
]


@override_settings(DECISION_PROVIDER="openrouter", DECISION_MODEL="~typesafe/jev-latest")
class DecisionTests(TestCase):
    def setUp(self):
        from credentials.models import Credential, CredentialType
        from credentials.resolution import slugs_for

        cache.clear()
        self.user = User.objects.create_user("decider", password="pw")
        kind = CredentialType.objects.filter(slug__in=slugs_for("openrouter")).first()
        credential = Credential.objects.create(
            user=self.user, credential_type=kind, name="My OpenRouter",
            is_verified=True, is_active=True)
        credential.set_credential_data({"apiKey": "sk-or-users-own"})
        credential.save()

    def test_decision_call_answers_are_read_and_the_users_key_is_sent(self):
        with replay("openrouter_decision") as tape:
            decision = async_to_sync(decisions.decide)(
                self.user.id, '{"ticket": "blank screen"}', QUESTIONS)
        self.assertEqual(decision.model, "typesafe/jev-1.14-20261014")
        self.assertEqual(decision.input_tokens, 380)
        self.assertEqual(decisions.summarise(decision), [
            "team: payments (confidence 0.85)", "is_bug: P(yes) = 0.86",
            'urgency: 1.99 ≈ "blocking"'])

        request = tape.requests[0]
        self.assertEqual(request.headers["authorization"], "Bearer sk-or-users-own")
        self.assertEqual(request.json["model"], "~typesafe/jev-latest")
        self.assertEqual(request.json["state"], {"ticket": "blank screen"})

    def test_decision_models_listing_is_read_from_the_live_catalogue(self):
        with replay("openrouter_decision_models"):
            rows = decisions.PROVIDERS["openrouter"].fetch_models()
        self.assertTrue(rows, "the listing named no decision model")
        for row in rows:
            self.assertTrue(row["id"])
            self.assertIsInstance(row["input_modalities"], list)
