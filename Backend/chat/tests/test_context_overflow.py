"""
When the provider says "too long", the run compacts and carries on.

Before this, a provider refusing a request as longer than the model accepts
ended the run with "start a new chat" — even an agent run forty steps in, whose
transcript the curator could have shrunk. Four pieces close it, each tested
here: the refusal is recognised and the real window read out of it
(`llm.access`), that window is remembered and lowers every later budget
(`llm.budget`), tool definitions are counted against the budget at all
(`clamp_input`), and the turn compacts and retries once (`agent_node`).
Compaction also learned to shrink oversized tool-call *arguments*, which used to
ride in every later request untouched.
"""
from __future__ import annotations

import json
from unittest.mock import patch

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from chat.models import ToolOutput
from chat.turn import curation
from chat.turn.agent import TurnContext, run_turn
from llm import budget
from llm.access import clamp_input, is_context_overflow, window_from_error
from llm.testing import ScriptedModel, ScriptedRequest, always, provider_error, text, tool_call

User = get_user_model()


def _forget_learned():
    budget._learned_windows.clear()
    budget._window_cache.clear()


class RecogniseOverflowTests(SimpleTestCase):
    OPENAI = json.dumps({"error": {
        "message": "This model's maximum context length is 131072 tokens. However, "
                   "you requested 140213 tokens (136117 in the messages, 4096 in "
                   "the completion). Please reduce the length of the messages.",
        "code": "context_length_exceeded"}})
    ANTHROPIC = "prompt is too long: 210000 tokens > 200000 maximum"
    OPENROUTER = json.dumps({"error": {"message": "Provider returned error", "metadata": {
        "raw": json.dumps({"error": {"message": "Input is too long for requested model. "
                                               "maximum context length is 32768"}})}}})

    def test_each_provider_shape_is_an_overflow(self):
        for body in (self.OPENAI, self.ANTHROPIC, self.OPENROUTER):
            self.assertTrue(is_context_overflow(400, body), body)
        self.assertTrue(is_context_overflow(413, "Request Entity Too Large"))

    def test_other_failures_are_not(self):
        for body in ("rate limit exceeded", "Provider returned error", "overloaded"):
            self.assertFalse(is_context_overflow(429, body), body)

    def test_the_named_limit_is_read_out(self):
        self.assertEqual(window_from_error(self.OPENAI), 131072)
        self.assertEqual(window_from_error(self.ANTHROPIC), 200000)
        self.assertEqual(window_from_error(self.OPENROUTER), 32768)

    def test_max_tokens_is_never_mistaken_for_the_window(self):
        self.assertIsNone(window_from_error("max_tokens 4096 is too large; input too long"))


class LearnWindowTests(SimpleTestCase):
    def setUp(self):
        _forget_learned()
        self.addCleanup(_forget_learned)

    def test_a_reported_window_lowers_the_budget(self):
        before = budget.cached_input_budget("m")
        budget.learn_window("m", reported=20_000)
        after = budget.cached_input_budget("m")
        self.assertLess(after, before)
        self.assertLessEqual(after, 20_000)

    def test_without_a_number_it_steps_well_under_what_was_sent(self):
        window = budget.learn_window("m", reported=None, sent_tokens=40_000)
        self.assertEqual(window, 30_000)

    def test_it_only_ever_lowers(self):
        budget.learn_window("m", reported=20_000)
        self.assertEqual(budget.learn_window("m", reported=50_000), 20_000)

    def test_it_also_lowers_a_declared_window(self):
        budget._window_cache["m"] = (10**12, 128_000)
        budget.learn_window("m", reported=32_000)
        self.assertLessEqual(budget.cached_input_budget("m"), 32_000)


class ModelWindowTests(SimpleTestCase):
    """The budget is the model's own window; curation starts at 70% of it."""

    def setUp(self):
        _forget_learned()
        self.addCleanup(_forget_learned)

    def test_a_large_window_is_no_longer_capped_at_96k(self):
        self.assertGreater(budget.budget_for("big", 1_000_000), 900_000)

    def test_the_window_less_the_reply_and_margin(self):
        self.assertEqual(budget.budget_for("m", 128_000, reserve_output=8_000),
                         128_000 - 8_000 - budget._WINDOW_SAFETY_TOKENS)

    def test_an_unknown_window_keeps_the_flat_budget(self):
        from workflow_backend.thresholds import MAX_LLM_INPUT_TOKENS
        self.assertEqual(budget.budget_for("m", 0), MAX_LLM_INPUT_TOKENS)

    def test_the_optional_ceiling_caps_spend(self):
        with patch("llm.budget.LLM_INPUT_TOKEN_CEILING", 200_000):
            self.assertEqual(budget.budget_for("big", 1_000_000), 200_000)

    def test_switching_to_a_smaller_model_replays_less_history(self):
        from chat.turn.history import history_budget
        large = history_budget(budget.budget_for("a", 1_000_000))
        small = history_budget(budget.budget_for("b", 32_000))
        self.assertLess(small, large)
        # Never more than the share curation cuts back to.
        self.assertLessEqual(small, int(32_000 * curation.CONTEXT_LOW_WATER_RATIO))


class ToolDefinitionsAreCountedTests(SimpleTestCase):
    def test_reserved_tokens_take_room_from_history(self):
        history = [{"role": "user", "content": "x" * 4_000} for _ in range(10)]
        _, _, without = clamp_input("q", "s", history, 12_000)
        _, _, with_tools = clamp_input("q", "s", history, 12_000, reserved_tokens=6_000)
        self.assertLess(len(with_tools), len(without))

    def test_tools_are_sized(self):
        tools = [{"type": "function", "function": {"name": "t", "description": "d" * 400}}]
        self.assertGreater(budget.tools_tokens(tools), 100)
        self.assertEqual(budget.tools_tokens(None), 0)


class ArgumentCompactionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user("args", "a@example.com", "x")

    def _transcript(self):
        big = "line of a long report\n" * 600
        return [
            HumanMessage(content="write it", id="h"),
            AIMessage(content="", id="a1", tool_calls=[
                {"name": "write_file", "args": {"path": "/r.md", "content": big}, "id": "c1"}]),
            ToolMessage(content="wrote /r.md", tool_call_id="c1", id="t1", name="write_file"),
            *[m for n in range(2, 6) for m in (
                AIMessage(content="", id=f"a{n}", tool_calls=[
                    {"name": "read_file", "args": {"path": f"/{n}"}, "id": f"c{n}"}]),
                ToolMessage(content="ok", tool_call_id=f"c{n}", id=f"t{n}", name="read_file"),
            )],
        ]

    def _curate(self, messages, **kw):
        async def tiny(model, *, reserve_output=0):
            return 2_000
        with patch("llm.budget.input_budget_for", new=tiny):
            return async_to_sync(curation.curate)(
                messages,
                policy=curation.CurationPolicy(enabled=True, recursive=False),
                model="m", context={"user_id": self.user.id, "session_id": "s"},
                **kw,
            )

    def test_a_large_argument_is_shrunk_and_archived(self):
        result = self._curate(self._transcript())
        shrunk = [m for m in result.updates if isinstance(m, AIMessage)]
        self.assertEqual(len(shrunk), 1)
        call = shrunk[0].tool_calls[0]
        # Same message id and call id: the result answering it still matches.
        self.assertEqual((shrunk[0].id, call["id"], call["name"]), ("a1", "c1", "write_file"))
        self.assertEqual(call["args"]["path"], "/r.md")
        self.assertLess(len(call["args"]["content"]), 600)
        self.assertIn(curation.ARGS_MARKER, call["args"]["content"])
        self.assertTrue(ToolOutput.objects.filter(
            tool_name__contains="arguments:write_file").exists())

    def test_a_shrunk_turn_is_not_shrunk_again(self):
        first = self._curate(self._transcript())
        again = [first.updates[0] if m.id == "a1" else m for m in self._transcript()]
        second = self._curate(again)
        self.assertFalse(any(isinstance(m, AIMessage) for m in second.updates))

    def test_force_ignores_the_watermark(self):
        small = [
            HumanMessage(content="q", id="h"),
            AIMessage(content="", id="a1", tool_calls=[{"name": "web_search", "args": {}, "id": "c1"}]),
            ToolMessage(content="r" * 3_000, tool_call_id="c1", id="t1", name="web_search"),
            AIMessage(content="", id="a2", tool_calls=[{"name": "web_search", "args": {}, "id": "c2"}]),
            ToolMessage(content="ok", tool_call_id="c2", id="t2", name="web_search"),
        ]

        async def roomy(model, *, reserve_output=0):
            return 1_400
        with patch("llm.budget.input_budget_for", new=roomy):
            run = lambda **kw: async_to_sync(curation.curate)(  # noqa: E731
                small, policy=curation.CurationPolicy(enabled=True, recursive=False),
                model="m", context={"user_id": self.user.id}, **kw)
            self.assertFalse(run().curated, "under the high-water mark: left alone")
            self.assertTrue(run(force=True).curated)


#: What the stub "provider" really accepts. The app is told nothing about it up
#: front — the catalogue has no row for the model — and must learn it from the
#: refusal, exactly as with a real model whose window the catalogue has wrong.
PROVIDER_LIMIT = 60_000


class _RefusingProvider:
    """Calls a tool `turns` times, then answers; refuses any request longer
    than PROVIDER_LIMIT with an OpenAI-style context error.

    The model is scripted at the wire, so the funnel's own final clamp has
    already run on every request it measures (this used to re-implement that
    clamp, and a copy can drift from the original). Size is counted as real
    providers count it: the messages, the tool definitions and the reply's
    `max_tokens`.
    """

    def __init__(self, turns: int) -> None:
        self.turns = turns
        self.steps = 0
        self.refusals = 0
        self.accepted: list[int] = []
        self.scripted = ScriptedModel([always(self._respond)])

    def _respond(self, request: ScriptedRequest):
        max_tokens = int(request.body.get("max_tokens")
                         or request.body.get("max_completion_tokens") or 0)
        size = (budget.history_tokens(request.messages)
                + budget.tools_tokens(request.tools) + max_tokens)
        if size > PROVIDER_LIMIT:
            self.refusals += 1
            return provider_error(400, f"This model's maximum context length is "
                                       f"{PROVIDER_LIMIT} tokens. However, you "
                                       f"requested {size} tokens.")
        self.accepted.append(size)
        self.steps += 1
        if self.steps > self.turns:
            return text("done")
        # `read_file`, not `web_search`: the latter fetches companion images
        # from the real internet after the (stubbed) tool runs.
        return tool_call("read_file", {"path": f"/step-{self.steps}.md"},
                         id=f"call-{self.steps}")


async def _big_result(name, args, context):
    return f"contents of {args.get('path')}. " + ("filler text. " * 3_000)


async def _never(name, args, context):
    return False


class OverflowRecoveryTests(TestCase):
    """The run drives itself into the provider's limit and must get out."""

    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user("overflow", "o@example.com", "x")

    def setUp(self):
        _forget_learned()
        self.addCleanup(_forget_learned)

    def _run(self, policy, thread):
        stub = _RefusingProvider(turns=10)
        turn = TurnContext(
            provider="openrouter", model="stub-unknown-window", system_message="You are a test.",
            user_id=self.user.id, session_id=thread, intent="research",
            user_text="do the work", memory_enabled=False, max_iterations=40,
            tool_dispatch=_big_result, approval_policy=_never, curation=policy,
        )
        with stub.scripted.installed():
            result = async_to_sync(run_turn)(turn, prompt="do the work", thread_id=thread)
        return stub, result

    def test_a_refused_request_is_compacted_and_retried(self):
        stub, result = self._run(curation.CurationPolicy(enabled=False), "overflow-1")

        self.assertGreaterEqual(stub.refusals, 1, "the run never hit the limit; test is vacuous")
        self.assertEqual(result.answer, "done")
        self.assertFalse(result.error)
        # Once learned, the limit is respected: it is refused once, not per step.
        self.assertEqual(stub.refusals, 1)
        self.assertTrue(all(size <= PROVIDER_LIMIT for size in stub.accepted))
        # Compaction ran (with indexing), so what it cut is reachable.
        self.assertTrue(ToolOutput.objects.filter(session_key="overflow-1").exists())

    def test_without_recovery_the_same_run_would_have_failed(self):
        """Guards the test above: switch the retry off and the run ends on the
        refusal, so the recovery is what made the difference."""
        async def no_compaction(turn, messages, *, extra_tokens):
            return []

        with patch("chat.turn.agent._compact_after_overflow", new=no_compaction), \
             patch("llm.budget.learn_window", new=lambda *a, **k: 0):
            stub, result = self._run(curation.CurationPolicy(enabled=False), "overflow-2")
        self.assertGreaterEqual(stub.refusals, 2)
        self.assertTrue(result.error)
