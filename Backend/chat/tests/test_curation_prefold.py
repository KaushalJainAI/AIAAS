"""
Context curation, part two: the checkpoint's shape, and folds prepared ahead.

A fold is a model call made the moment the transcript crosses the high mark.
Between the early mark (`PREPARE_AHEAD_RATIO` of the high mark) and that
moment, the fold the next pass will need is started in the background, while
the provider's prompt cache still holds the run's prefix. These tests pin the
rules that make that safe: it is used only for exactly the messages it covers,
it is never used twice, a failed or discarded one falls back to the inline fold,
and every token it spends is billed exactly once.

Numbers: the budget is patched to 4,000 tokens, so the high mark is 2,800, the
early mark 2,380 and the low mark 1,800. A 300-character result is about 96
tokens, so 27 such segments sit at ~2,600: inside the early band and below the
high mark.
"""
from __future__ import annotations

import asyncio
import uuid
from types import SimpleNamespace
from unittest.mock import patch

from asgiref.sync import async_to_sync
from django.test import SimpleTestCase, TestCase
from langchain_core.messages import (
    AIMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)

from chat.turn import curation
from chat.turn.agent import TurnContext, run_turn
from llm.access import Completion
from llm.usage import EMPTY_USAGE, TokenUsage
from workflow_backend import background

BUDGET = 4_000
HIGH = int(BUDGET * curation.CONTEXT_HIGH_WATER_RATIO)  # 2800
EARLY = BUDGET * curation.PREPARE_AHEAD_RATIO * curation.CONTEXT_HIGH_WATER_RATIO

USAGE = TokenUsage(input=1_000, output=100)
CONTEXT = {"user_id": 7, "session_id": "run-prefold", "turn_id": "t1"}
POLICY = curation.CurationPolicy(
    enabled=True, compaction=False, recursive=True, indexing=False,
)


def _transcript(count: int, *, chars: int = 300, prefix: str = "p") -> list:
    """A human message and `count` tool turns, every result `chars` long."""
    messages = [HumanMessage(content="go", id="m0")]
    for index in range(count):
        call = f"{prefix}{index}"
        messages += [
            AIMessage(
                content="",
                tool_calls=[{"name": "web_search", "args": {"query": f"q{index}"}, "id": call}],
                id=f"{call}-call",
            ),
            ToolMessage(
                content="Z" * chars, tool_call_id=call, name="web_search",
                id=f"{call}-result",
            ),
        ]
    return messages


def _real_baseline(messages) -> int:
    """A baseline that puts the transcript just over the high mark."""
    return HIGH + 1 - curation.message_tokens(messages)


class FakeSummariser:
    """Stands in for `chat.turn.agent._summariser_for`: it counts its calls and
    accumulates `usage` the way the real one does."""

    def __init__(self, text: str = "checkpoint", tokens: int = 120, *, fail: bool = False):
        self.text = text
        self.tokens = tokens
        self.fail = fail
        self.calls: list[str] = []
        self.usage = EMPTY_USAGE

    async def __call__(self, text: str) -> tuple[str, int]:
        self.calls.append(text)
        if self.fail:
            raise RuntimeError("provider down")
        self.usage = self.usage + USAGE
        return self.text, self.tokens


class CheckpointShapeTests(SimpleTestCase):
    """7a: the instruction the fold is written against."""

    HEADINGS = (
        "Objective",
        "Requirements and constraints",
        "Decisions",
        "Work state",
        "Next move",
        "Relevant files and ids",
        "Important facts",
    )

    def test_the_instruction_names_every_section_in_order(self):
        instruction = curation.SUMMARY_INSTRUCTION
        positions = [instruction.index(heading) for heading in self.HEADINGS]
        self.assertEqual(positions, sorted(positions))
        self.assertEqual(tuple(curation.SUMMARY_SECTIONS), self.HEADINGS)

    def test_work_state_has_its_three_sub_lines(self):
        for line in ("Completed:", "Active:", "Blocked:"):
            self.assertIn(line, curation.SUMMARY_INSTRUCTION)

    def test_the_rules_are_stated(self):
        instruction = curation.SUMMARY_INSTRUCTION
        self.assertIn("UPDATE it section by section", instruction)
        self.assertIn("do not append a second copy", instruction)
        self.assertIn("at most 15 entries", instruction)
        self.assertIn("never invent", instruction.lower())
        self.assertIn("todo list", instruction)
        self.assertIn("`none`", instruction)
        self.assertIn(
            f"within {curation.CONTEXT_SUMMARY_TARGET_WORDS} words",
            instruction,
        )

    def test_the_old_facts_are_still_asked_for(self):
        instruction = curation.SUMMARY_INSTRUCTION
        self.assertIn("failure", instruction.lower())
        self.assertIn("open questions", instruction.lower())


class PrepareAheadTests(SimpleTestCase):
    """7b: when a fold is started, and when it is used."""

    def setUp(self):
        curation.reset_prepared_state()
        self.addCleanup(curation.reset_prepared_state)

        patcher = patch("llm.budget.input_budget_for", new=self._budget)
        patcher.start()
        self.addCleanup(patcher.stop)

        # Every spawned task is recorded, so a test can await or inspect it.
        self.tasks: list[asyncio.Task] = []
        real_spawn = background.spawn

        def recording_spawn(coro, **kwargs):
            task = real_spawn(coro, **kwargs)
            self.tasks.append(task)
            return task

        spawn_patch = patch.object(background, "spawn", side_effect=recording_spawn)
        self.spawn = spawn_patch.start()
        self.addCleanup(spawn_patch.stop)

    @staticmethod
    async def _budget(model, *, reserve_output=0):
        return BUDGET

    async def _curate(self, messages, summariser, *, baseline=0, context=None, policy=None):
        return await curation.curate(
            messages,
            policy=policy or POLICY,
            model="test-model",
            reserve_output=1_000,
            baseline_tokens=baseline,
            context=CONTEXT if context is None else context,
            summarise=summariser,
        )

    def _run(self, scenario):
        """Run `scenario` on one loop and let every prepared task finish first.

        A prepared fold outlives the pass that started it, so the loop must not
        close while one is still in flight.
        """
        async def wrapper():
            try:
                return await scenario()
            finally:
                pending = [task for task in self.tasks if not task.done()]
                if pending:
                    await asyncio.gather(*pending, return_exceptions=True)
                await asyncio.sleep(0)

        return async_to_sync(wrapper)()

    # ── when a fold is started ───────────────────────────────────────────────

    def test_crossing_the_early_mark_starts_one_fold_and_applies_nothing(self):
        messages = _transcript(27)
        tokens = curation.message_tokens(messages)
        self.assertTrue(EARLY < tokens <= HIGH, tokens)

        async def scenario():
            return await self._curate(messages, FakeSummariser())

        result = self._run(scenario)
        self.assertEqual(self.spawn.call_count, 1)
        self.assertFalse(result.curated)
        self.assertEqual(result.updates, [])

    def test_below_the_early_mark_nothing_is_prepared(self):
        messages = _transcript(20)
        self.assertLess(curation.message_tokens(messages), EARLY)

        async def scenario():
            return await self._curate(messages, FakeSummariser())

        self._run(scenario)
        self.assertEqual(self.spawn.call_count, 0)

    def test_the_same_block_is_not_prepared_twice(self):
        messages = _transcript(27)

        async def scenario():
            await self._curate(messages, FakeSummariser())
            await self._curate(messages, FakeSummariser())

        self._run(scenario)
        self.assertEqual(self.spawn.call_count, 1)

    def test_no_fold_is_prepared_when_the_policy_does_not_fold(self):
        messages = _transcript(27)
        policy = curation.CurationPolicy(
            enabled=True, compaction=False, recursive=False, indexing=False,
        )

        async def scenario():
            return await self._curate(messages, FakeSummariser(), policy=policy)

        self._run(scenario)
        self.assertEqual(self.spawn.call_count, 0)

    def test_no_fold_is_prepared_without_a_run_to_key_it_by(self):
        messages = _transcript(27)

        async def scenario():
            return await self._curate(messages, FakeSummariser(), context={})

        self._run(scenario)
        self.assertEqual(self.spawn.call_count, 0)

    def test_no_fold_is_prepared_when_compaction_alone_will_reach_the_low_mark(self):
        """Large old results compact to records; once that is counted, no fold is
        coming, so nothing is spent on one."""
        messages = [HumanMessage(content="go", id="m0")]
        messages += _transcript(5, chars=1_900, prefix="big")[1:]
        messages += _transcript(3, chars=300, prefix="small")[1:]
        policy = curation.CurationPolicy(
            enabled=True, compaction=True, recursive=True, indexing=False,
        )
        tokens = curation.message_tokens(messages)
        self.assertTrue(EARLY < tokens <= HIGH, tokens)

        async def scenario():
            return await self._curate(messages, FakeSummariser(), policy=policy)

        self._run(scenario)
        self.assertEqual(self.spawn.call_count, 0)

    # ── when the fold is needed ──────────────────────────────────────────────

    def test_a_matching_fingerprint_uses_the_prepared_summary_and_calls_once(self):
        messages = _transcript(27)
        prepared = FakeSummariser("prepared checkpoint", 120)
        inline = FakeSummariser("inline checkpoint", 120)

        async def scenario():
            await self._curate(messages, prepared)  # the early mark
            return await self._curate(messages, inline, baseline=_real_baseline(messages))

        result = self._run(scenario)

        self.assertEqual(len(prepared.calls), 1)
        self.assertEqual(inline.calls, [], "the inline fold must not run again")
        self.assertGreater(result.steps_folded, 0)
        note = next(m for m in result.updates if isinstance(m, SystemMessage))
        self.assertIn("prepared checkpoint", note.content)
        self.assertNotIn("inline checkpoint", note.content)

    def test_usage_of_a_used_fold_is_billed_once_on_the_pass_that_uses_it(self):
        messages = _transcript(27)
        prepared = FakeSummariser("prepared checkpoint", 120)
        inline = FakeSummariser("inline checkpoint", 120)

        async def scenario():
            await self._curate(messages, prepared)
            return await self._curate(messages, inline, baseline=_real_baseline(messages))

        result = self._run(scenario)

        # One call's worth, on the summariser the pass prices. The prepared
        # call's own accumulator is not added to the total a second time.
        self.assertEqual(inline.usage, USAGE)
        self.assertEqual(result.summary_tokens, 120)

    def test_a_changed_fingerprint_folds_inline_and_still_bills_the_discard(self):
        messages = _transcript(27)
        # The oldest tool call is a different message now, so the prepared fold
        # no longer describes what the pass would fold.
        changed = [
            m.model_copy(update={"id": "p0-call-edited"}) if m.id == "p0-call" else m
            for m in messages
        ]
        prepared = FakeSummariser("prepared checkpoint", 120)
        inline = FakeSummariser("inline checkpoint", 120)

        async def scenario():
            await self._curate(messages, prepared)
            # Let the prepared call finish first, so its discard is booked at once
            # and this test does not depend on task scheduling.
            await asyncio.gather(*self.tasks)
            return await self._curate(changed, inline, baseline=_real_baseline(changed))

        result = self._run(scenario)

        self.assertEqual(len(prepared.calls), 1)
        self.assertEqual(len(inline.calls), 1, "a mismatch folds inline")
        note = next(m for m in result.updates if isinstance(m, curation.SystemMessage))
        self.assertIn("inline checkpoint", note.content)
        # The discarded call was spent, so it is billed too: once, on this pass.
        self.assertEqual(result.summary_tokens, 120 + 120)
        self.assertEqual(inline.usage, USAGE + USAGE)

    def test_a_failed_prepared_fold_falls_back_to_an_inline_fold(self):
        messages = _transcript(27)
        prepared = FakeSummariser(fail=True)
        inline = FakeSummariser("inline checkpoint", 120)

        async def scenario():
            await self._curate(messages, prepared)
            return await self._curate(messages, inline, baseline=_real_baseline(messages))

        result = self._run(scenario)

        self.assertEqual(len(inline.calls), 1)
        self.assertGreater(result.steps_folded, 0)
        note = next(m for m in result.updates if isinstance(m, SystemMessage))
        self.assertIn("inline checkpoint", note.content)

    def test_a_prepared_fold_still_running_past_the_wait_folds_inline(self):
        messages = _transcript(27)
        prepared = FakeSummariser("prepared checkpoint", 120)
        inline = FakeSummariser("inline checkpoint", 120)

        async def scenario():
            await self._curate(messages, prepared)
            with patch.object(curation, "PREPARED_WAIT_SECONDS", 0.0):
                return await self._curate(
                    messages, inline, baseline=_real_baseline(messages),
                )

        result = self._run(scenario)

        self.assertEqual(len(inline.calls), 1)
        note = next(m for m in result.updates if isinstance(m, SystemMessage))
        self.assertIn("inline checkpoint", note.content)

    # ── bounds ───────────────────────────────────────────────────────────────

    def test_the_prepared_table_is_bounded(self):
        for index in range(curation.PREPARED_KEEP_RUNS + 40):
            key = f"run-{index}"
            curation._PREPARED[key] = curation._Prepared(key=key, fingerprint=())
        curation._bound_prepared()
        self.assertEqual(len(curation._PREPARED), curation.PREPARED_KEEP_RUNS)
        self.assertIn(f"run-{curation.PREPARED_KEEP_RUNS + 39}", curation._PREPARED)

    def test_the_unbilled_table_is_bounded(self):
        for index in range(curation.PREPARED_KEEP_RUNS + 40):
            curation._book(curation._Prepared(
                key=f"run-{index}", fingerprint=(), tokens=10, usage=USAGE,
            ))
        self.assertEqual(len(curation._UNBILLED), curation.PREPARED_KEEP_RUNS)


class SlowSummariser(FakeSummariser):
    """A fold that is still running when its run ends. Its usage is on the
    accumulator from the moment the provider call is made, as in the real one."""

    def __init__(self, delay: float, tokens: int = 120):
        super().__init__("checkpoint", tokens)
        self.delay = delay

    async def __call__(self, text: str) -> tuple[str, int]:
        self.calls.append(text)
        self.usage = self.usage + USAGE
        await asyncio.sleep(self.delay)
        return self.text, self.tokens


class SettleTests(SimpleTestCase):
    """A run that ends owes whatever its curation spent: a prepared fold still in
    flight, a discarded one, or spend in `_UNBILLED`. `settle` bills it once."""

    KEY = curation.run_key(CONTEXT)

    def setUp(self):
        curation.reset_prepared_state()
        self.addCleanup(curation.reset_prepared_state)
        patcher = patch("llm.budget.input_budget_for", new=self._budget)
        patcher.start()
        self.addCleanup(patcher.stop)

    @staticmethod
    async def _budget(model, *, reserve_output=0):
        return BUDGET

    async def _prepare(self, summariser) -> None:
        """Cross the early mark once, so one prepared fold is started for the run."""
        await curation.curate(
            _transcript(27),
            policy=POLICY,
            model="test-model",
            reserve_output=1_000,
            context=CONTEXT,
            summarise=summariser,
        )

    def test_settle_awaits_a_prepared_fold_still_in_flight_and_bills_it(self):
        summariser = SlowSummariser(delay=0.05)

        async def scenario():
            await self._prepare(summariser)
            in_flight = not curation._PREPARED[self.KEY].task.done()
            return in_flight, await curation.settle(self.KEY)

        in_flight, spend = async_to_sync(scenario)()

        self.assertTrue(in_flight, "the fold must still be running when the run ends")
        self.assertEqual(spend.tokens, 120)
        self.assertEqual(spend.usage, USAGE)
        self.assertNotIn(self.KEY, curation._PREPARED)

    def test_a_fold_that_outlives_the_wait_is_cancelled_and_its_usage_booked(self):
        summariser = SlowSummariser(delay=30)

        async def scenario():
            await self._prepare(summariser)
            task = curation._PREPARED[self.KEY].task
            with patch.object(curation, "SETTLE_WAIT_SECONDS", 0.01):
                spend = await curation.settle(self.KEY)
            return task, spend

        task, spend = async_to_sync(scenario)()

        self.assertTrue(task.cancelled())
        # The provider call was made, so its usage is billed; it never returned
        # a token count, so none is added.
        self.assertEqual(spend.usage, USAGE)
        self.assertEqual(spend.tokens, 0)
        self.assertNotIn(self.KEY, curation._PREPARED)

    def test_a_failed_prepared_fold_settles_without_raising(self):
        summariser = FakeSummariser(fail=True)

        async def scenario():
            await self._prepare(summariser)
            return await curation.settle(self.KEY)

        spend = async_to_sync(scenario)()

        self.assertEqual(spend.tokens, 0)
        self.assertTrue(spend.usage.is_empty)

    def test_settle_bills_what_is_in_the_unbilled_ledger(self):
        curation._UNBILLED[self.KEY] = curation.Spend(50, USAGE)

        spend = async_to_sync(curation.settle)(self.KEY)

        self.assertEqual(spend.tokens, 50)
        self.assertEqual(spend.usage, USAGE)
        self.assertNotIn(self.KEY, curation._UNBILLED)

    def test_a_second_settle_bills_nothing(self):
        summariser = SlowSummariser(delay=0.01)
        curation._UNBILLED[self.KEY] = curation.Spend(50, USAGE)

        async def scenario():
            await self._prepare(summariser)
            first = await curation.settle(self.KEY)
            second = await curation.settle(self.KEY)
            return first, second

        first, second = async_to_sync(scenario)()

        self.assertEqual(first.tokens, 170)
        self.assertEqual(second.tokens, 0)
        self.assertTrue(second.usage.is_empty)

    def test_settle_without_a_key_or_a_run_bills_nothing(self):
        self.assertEqual(async_to_sync(curation.settle)(None).tokens, 0)
        spend = async_to_sync(curation.settle)("1:never-started")
        self.assertEqual(spend.tokens, 0)
        self.assertTrue(spend.usage.is_empty)


class RunEndSettleTests(TestCase):
    """`run_turn` adds what curation still owes to the run's own totals, on every
    way a run can end that still returns a result."""

    def setUp(self):
        curation.reset_prepared_state()
        self.addCleanup(curation.reset_prepared_state)
        # An agent run's thread: its curation key dies with the run, so a
        # prepared fold is awaited and billed at the end.
        self.thread = f"agent-1-{uuid.uuid4()}"
        self.key = curation.run_key({"user_id": 1, "session_id": self.thread})

    def test_a_chat_turn_leaves_its_prepared_fold_for_the_next_turn(self):
        # A chat session's key outlives the turn: the turn must not wait for
        # the fold or drop it, only bill what is already owed.
        self.thread = f"chat-{uuid.uuid4()}"
        self.key = curation.run_key({"user_id": 1, "session_id": self.thread})
        curation._PREPARED[self.key] = curation._Prepared(
            key=self.key, fingerprint=(), tokens=120, usage=USAGE)
        curation._UNBILLED[self.key] = curation.Spend(30, USAGE)

        result = self._run()

        self.assertEqual(result.tokens, 30)
        self.assertIn(self.key, curation._PREPARED)
        self.assertNotIn(self.key, curation._UNBILLED)

    def _run(self):
        async def model(turn, *, prompt, history, tools, **_):
            return Completion(content="done")

        async def tools():
            return []

        async def dispatch(name, args, context):
            return ""

        turn = TurnContext(
            provider="openrouter", model="test/model", system_message="",
            user_id=1, session_id=self.thread, intent="chat", user_text="go",
            memory_enabled=False, tool_source=tools, tool_dispatch=dispatch,
            sensitive_tools=frozenset(),
        )
        with patch("chat.turn.agent._run_model", model):
            return async_to_sync(run_turn)(turn, prompt="go", thread_id=self.thread)

    def test_a_finished_run_with_a_prepared_fold_pending_bills_it(self):
        curation._PREPARED[self.key] = curation._Prepared(
            key=self.key, fingerprint=(), tokens=120, usage=USAGE)

        result = self._run()

        self.assertEqual(result.answer, "done")
        self.assertEqual(result.tokens, 120)
        self.assertEqual(result.usage, USAGE)
        self.assertNotIn(self.key, curation._PREPARED)

    def test_a_run_that_errors_still_bills_its_curation(self):
        curation._UNBILLED[self.key] = curation.Spend(30, USAGE)

        class _Broken:
            async def aget_state(self, config):
                return SimpleNamespace(values={}, next=())

            async def ainvoke(self, *args, **kwargs):
                raise RuntimeError("upstream exploded")

        with patch("chat.turn.agent.get_graph", return_value=_Broken()):
            result = self._run()

        self.assertTrue(result.error)
        self.assertEqual(result.tokens, 30)
        self.assertEqual(result.usage, USAGE)
        self.assertNotIn(self.key, curation._UNBILLED)

    def test_a_cancelled_run_still_settles_its_fold(self):
        curation._PREPARED[self.key] = curation._Prepared(
            key=self.key, fingerprint=(), tokens=120, usage=USAGE)

        class _Cancelled:
            async def aget_state(self, config):
                return SimpleNamespace(values={}, next=())

            async def ainvoke(self, *args, **kwargs):
                raise asyncio.CancelledError()

        # A cancelled run has no result to return, so the spend is settled and
        # dropped from the table; `settle` is what keeps it from lingering.
        with patch("chat.turn.agent.get_graph", return_value=_Cancelled()):
            with self.assertRaises(asyncio.CancelledError):
                self._run()

        self.assertNotIn(self.key, curation._PREPARED)

    def test_a_settle_failure_does_not_break_the_run(self):
        with patch.object(curation, "settle", side_effect=RuntimeError("db gone")):
            result = self._run()

        self.assertEqual(result.answer, "done")
        self.assertEqual(result.tokens, 0)
