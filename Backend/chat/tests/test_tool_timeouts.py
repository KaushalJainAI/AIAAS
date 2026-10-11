"""
A tool that waits on other agents is not cut off at the loop's flat limit.

The loop gave every tool call 120 seconds. `invoke_subagent` runs its workers
inline and `wait_tasks` may be asked to wait 300, so both were cut off while
the agents behind them were still working, and the model then told the user
the agent had produced nothing.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest import mock

from django.test import SimpleTestCase

from chat.tools import registry
from chat.tools.agents import AGENT_RUN_MAX_WAIT
from chat.tools.tasks import WAIT_TASKS_MAX_SECONDS
from chat.turn import agent
from llm.access import ToolCall
from workflow_backend.thresholds import ADMISSION_WAIT_SECONDS, MAX_RUN_SECONDS


def _batch(dispatch):
    return SimpleNamespace(tool_context={}, answers={}, decided=set(), dispatch=dispatch)


def _call(name: str) -> ToolCall:
    return ToolCall(id="c1", name=name, arguments={})


class DeclaredLimitTests(SimpleTestCase):
    def test_an_undeclared_tool_gets_the_default(self) -> None:
        self.assertEqual(registry.timeout_of("web_search", 120), 120)
        self.assertEqual(registry.timeout_of("mcp__7__anything", 120), 120)

    def test_a_fanout_may_run_as_long_as_its_workers(self) -> None:
        self.assertGreater(registry.timeout_of("invoke_subagent", 120), MAX_RUN_SECONDS)

    def test_a_wait_outlasts_the_longest_wait_it_offers(self) -> None:
        self.assertGreater(registry.timeout_of("wait_tasks", 120), WAIT_TASKS_MAX_SECONDS)

    def test_starting_a_run_covers_the_queue_and_the_wait(self) -> None:
        for name in ("run_agent", "answer_subagent"):
            self.assertGreater(registry.timeout_of(name, 120),
                               ADMISSION_WAIT_SECONDS + AGENT_RUN_MAX_WAIT)


class DispatchLimitTests(SimpleTestCase):
    def test_a_delegation_outlives_the_flat_limit(self) -> None:
        async def slow(name, arguments, ctx):
            await asyncio.sleep(0.2)
            return "the workers' answers"

        async def scenario():
            with mock.patch.object(agent, "TOOL_CALL_TIMEOUT", 0.05):
                return await agent._dispatch_one(
                    _batch(slow), _call("invoke_subagent"), {})

        output, status, _ = asyncio.run(scenario())
        self.assertEqual(status, "completed")
        self.assertEqual(output, "the workers' answers")

    def test_an_ordinary_tool_is_still_cut_off(self) -> None:
        async def slow(name, arguments, ctx):
            await asyncio.sleep(5)

        async def scenario():
            with mock.patch.object(agent, "TOOL_CALL_TIMEOUT", 0.05):
                return await agent._dispatch_one(_batch(slow), _call("web_search"), {})

        output, status, _ = asyncio.run(scenario())
        self.assertEqual(status, "failed")
        self.assertIn("timed out", output)
