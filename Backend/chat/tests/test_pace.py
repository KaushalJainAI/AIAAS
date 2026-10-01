"""
A turn runs at a pace, is told its budget, and is promoted when it plans.

The unit tests pin the rules in `chat/turn/pace.py`. The graph tests drive the
real loop with a stubbed model and assert on what actually left for the
provider and how many calls were made — a budget line nothing sends, or a cap
nothing reads, would pass every unit test here.
"""
from __future__ import annotations

import json
from unittest.mock import patch

from asgiref.sync import async_to_sync
from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase

from chat.turn import pace
from chat.turn.agent import TurnContext, run_turn
from workflow_backend.thresholds import PACE_ITERATIONS


class StartingTierTests(SimpleTestCase):
    def test_a_mode_the_user_picked_states_the_pace(self):
        self.assertEqual(pace.starting_tier("search", "rust release"), pace.QUICK)
        self.assertEqual(pace.starting_tier("research", "rust adoption"), pace.DEEP)

    def test_a_short_lookup_starts_quick(self):
        for text in ("what is a monad", "Who is the CEO of Nvidia?",
                     "latest node version", "define idempotent"):
            self.assertEqual(pace.starting_tier("chat", text), pace.QUICK, text)

    def test_everything_else_starts_standard(self):
        for text in ("hello", "write a haiku about rain",
                     "audit my Q3 invoices and fix the duplicates"):
            self.assertEqual(pace.starting_tier("chat", text), pace.STANDARD, text)

    def test_a_long_or_multi_line_message_is_not_a_lookup(self):
        long = "what is " + "x" * 400
        self.assertEqual(pace.starting_tier("chat", long), pace.STANDARD)
        self.assertEqual(
            pace.starting_tier("chat", "what is this?\nand also fix it"),
            pace.STANDARD,
        )

    def test_an_attachment_is_never_quick(self):
        self.assertEqual(
            pace.starting_tier("chat", "what is this", has_attachments=True),
            pace.STANDARD,
        )

    def test_a_command_that_starts_work_is_deep(self):
        self.assertEqual(
            pace.starting_tier("chat", "what is this", starts_work=True),
            pace.DEEP,
        )

    def test_a_stated_mode_wins_over_the_command_that_set_it(self):
        # `/search` is a command and a quick lookup at once.
        self.assertEqual(
            pace.starting_tier("search", "rust", starts_work=True), pace.QUICK)


class BudgetTests(SimpleTestCase):
    def test_caps_are_ordered_and_bounded_by_the_ceiling(self):
        caps = [pace.cap(tier, 100) for tier in pace.TIERS]
        self.assertEqual(caps, sorted(caps))
        self.assertLess(caps[0], caps[-1])
        self.assertEqual(pace.cap(pace.DEEP, 5), 5)

    def test_no_pace_is_the_callers_own_cap_and_says_nothing(self):
        # Agent runs and evals set no pace and must behave as before.
        self.assertEqual(pace.current({}), "")
        self.assertEqual(pace.cap("", 40), 40)
        self.assertEqual(pace.render("", 0, 40), "")

    def test_the_line_counts_down_and_warns_one_round_early(self):
        limit = pace.cap(pace.STANDARD, 100)
        first = pace.render(pace.STANDARD, 0, limit)
        self.assertIn(f"{limit - 1} tool rounds left", first)
        self.assertNotIn("last tool round", first)

        last = pace.render(pace.STANDARD, limit - 2, limit)
        self.assertIn("1 tool round left", last)
        self.assertIn("last tool round", last)

    def test_quick_and_standard_name_the_way_to_a_bigger_budget(self):
        # A model that cannot tell how to ask for more will either stop short
        # or ignore the budget.
        for tier in (pace.QUICK, pace.STANDARD):
            self.assertIn("update_todos", pace.render(tier, 0, pace.cap(tier, 100)))


class PromotionTests(SimpleTestCase):
    def test_a_plan_or_a_delegation_promotes_to_deep(self):
        for name in ("update_todos", "run_agent", "deep_research"):
            meta = {"pace": pace.start(pace.QUICK)}
            self.assertTrue(pace.promote(meta, ["web_search", name], iteration=1))
            self.assertEqual(pace.current(meta), pace.DEEP)
            self.assertEqual(meta["pace"]["started"], pace.QUICK)
            self.assertEqual(pace.summary(meta), "quick>deep")

    def test_ordinary_calls_do_not_promote(self):
        meta = {"pace": pace.start(pace.QUICK)}
        self.assertFalse(pace.promote(meta, ["web_search", "read_url"], iteration=1))
        self.assertEqual(pace.current(meta), pace.QUICK)

    def test_a_turn_without_a_pace_is_left_alone(self):
        meta: dict = {}
        self.assertFalse(pace.promote(meta, ["update_todos"], iteration=1))
        self.assertNotIn("pace", meta)

    def test_promotion_is_idempotent(self):
        # `interrupt()` re-runs `tools_node` from the top on a resume.
        meta = {"pace": pace.start(pace.STANDARD)}
        pace.promote(meta, ["update_todos"], iteration=2)
        before = dict(meta["pace"])
        self.assertFalse(pace.promote(meta, ["update_todos"], iteration=5))
        self.assertEqual(meta["pace"], before)

    def test_every_promoting_tool_is_a_real_tool(self):
        # A name nothing registers is a promotion that can never happen.
        from chat.tools import schemas

        registered = {t["function"]["name"] for t in schemas()}
        self.assertEqual(pace.PROMOTING_TOOLS - registered, set())


# ── The real loop ────────────────────────────────────────────────────────────

_PROBE = [{"type": "function", "function": {
    "name": "probe", "description": "A harmless read.",
    "parameters": {"type": "object", "properties": {}},
}}]


class _Model:
    """Calls `probe` for as long as tools are offered, then answers.

    `plan_on` is the 1-based model call on which it writes a plan instead.
    Records the trailing system messages of every request it receives.
    """

    def __init__(self, *, plan_on: int | None = None):
        self.plan_on = plan_on
        self.calls = 0
        self.system_lines: list[list[str]] = []

    def __call__(self, **kwargs):
        self.calls += 1
        index = self.calls
        offered = bool(kwargs.get("tools"))
        self.system_lines.append([
            str(m.get("content") or "") for m in kwargs.get("history") or []
            if m.get("role") == "system"
        ])

        async def chunks():
            if offered:
                name = "update_todos" if index == self.plan_on else "probe"
                args = ({"todos": [{"text": "step one", "status": "in_progress"}]}
                        if name == "update_todos" else {})
                yield {"type": "tool_calls", "tool_calls": [{
                    "index": 0, "id": f"call-{index}",
                    "function": {"name": name, "arguments": json.dumps(args)},
                }]}
            else:
                yield {"type": "content", "content": "Here is what I found."}
            yield {"type": "metadata", "usage": {"total_tokens": 3}}

        return chunks()

    def budget_line(self, call: int) -> str:
        return next(
            (line for line in self.system_lines[call - 1] if line.startswith("PACE:")),
            "",
        )


async def _never(*_args, **_kwargs) -> bool:
    return False


async def _sink(*_args, **_kwargs) -> None:
    return None


async def _tools() -> list[dict]:
    return _PROBE


async def _dispatch(name, args, context) -> str:
    return "ok"


class PaceInTheLoopTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user("pace", "pace@example.com", "x")

    def run_with(self, model, thread: str, tier: str | None):
        turn = TurnContext(
            provider="stub", model="stub-model", system_message="test",
            user_id=self.user.id, session_id=thread, intent="chat", user_text="go",
            memory_enabled=False, max_iterations=PACE_ITERATIONS[pace.DEEP],
            approval_policy=_never, sensitive_tools=frozenset(), sink=_sink,
            tool_source=_tools, tool_dispatch=_dispatch,
        )
        metadata = {"pace": pace.start(tier)} if tier else {}
        with patch("llm.access.stream", new=model):
            return async_to_sync(run_turn)(
                turn, prompt="go", thread_id=thread, metadata=metadata)

    def test_a_quick_turn_answers_within_its_cap(self):
        model = _Model()
        result = self.run_with(model, "pace-quick", pace.QUICK)

        self.assertEqual(result.error, "")
        self.assertEqual(result.answer, "Here is what I found.")
        self.assertEqual(model.calls, PACE_ITERATIONS[pace.QUICK])
        self.assertEqual(pace.summary(result.metadata), "quick")

    def test_the_model_is_told_its_budget_and_warned_before_the_end(self):
        model = _Model()
        self.run_with(model, "pace-told", pace.QUICK)

        self.assertIn("PACE: QUICK", model.budget_line(1))
        self.assertNotIn("last tool round", model.budget_line(1))
        self.assertIn("last tool round", model.budget_line(2))
        # The last pass has no tools; the continuation nudge speaks there.
        self.assertEqual(model.budget_line(3), "")

    def test_a_plan_promotes_the_turn_and_lifts_the_cap(self):
        model = _Model(plan_on=1)
        result = self.run_with(model, "pace-promote", pace.QUICK)

        self.assertEqual(result.error, "")
        self.assertEqual(model.calls, PACE_ITERATIONS[pace.DEEP])
        self.assertEqual(pace.summary(result.metadata), "quick>deep")
        self.assertEqual(result.metadata["pace"]["promoted_by"], "update_todos")
        self.assertIn("PACE: DEEP", model.budget_line(2))

    def test_a_turn_with_no_pace_runs_as_before(self):
        model = _Model()
        result = self.run_with(model, "pace-none", None)

        self.assertEqual(model.calls, PACE_ITERATIONS[pace.DEEP])
        self.assertNotIn("pace", result.metadata)
        self.assertTrue(all(model.budget_line(n) == "" for n in range(1, model.calls + 1)))
