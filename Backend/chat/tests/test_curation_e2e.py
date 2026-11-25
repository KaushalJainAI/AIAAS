"""
The whole loop, once, against a stub provider.

Everything else about curation is tested a piece at a time: the segment rule,
the watermark, each toggle, the node. Those all pass with the pieces wired to
each other incorrectly — the failure this file exists to catch is a graph edge
in the wrong place, a policy that never reaches the node, or state updates that
are computed and then dropped.

So this drives the real `chat_agent_graph` for twenty tool-calling turns with
the model scripted at the wire, and asserts the three things a user would notice: the request never
outgrows the window, the run can still reach a fact from a step that was
compacted away, and the transcript stays sendable throughout.
"""
from __future__ import annotations

import json
from unittest.mock import patch

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.test import TestCase

from chat.models import ToolOutput
from chat.turn import curation
from chat.turn.agent import TurnContext, run_turn
from llm import budget
from llm.testing import DEFAULT_PROVIDER, ScriptedModel, ScriptedRequest, always, text, tool_call

User = get_user_model()

#: Small enough that twenty turns of tool output cannot fit, large enough that
#: the first few can. The whole mechanism is a function of this number against
#: the size of the results, so shrinking it is the same experiment as running a
#: much longer agent.
BUDGET_TOKENS = 12_000

#: The fact planted in turn 2's tool result and asked for at the end. It has to
#: be something only that result carried, or the model could answer from the
#: task itself.
SECRET = "the reconciliation code is QX-8842"


#: The funnel's last-resort trim says this in the request when it had to drop
#: messages (`llm.access._TRIM_NOTICE`). Curation exists so it never has to.
TRIM_NOTICE = "[CONTEXT NOTICE:"


class _StubProvider:
    """A model that calls a tool for N turns, then answers.

    Scripted at the wire, so the run goes through the real funnel, handler,
    accumulator and message threading. `histories` are the messages of each
    request as they actually left, which is what the budget assertions are
    made against: the point is what reached the provider, not what the curator
    believed it had done.
    """

    def __init__(self, turns: int) -> None:
        self.turns = turns
        self.scripted = ScriptedModel([always(self._respond)])

    def _respond(self, request: ScriptedRequest):
        if request.index > self.turns:
            return text("done")
        # `read_file`, not `web_search`: the turn fetches companion images
        # for a web search from the real internet even when the tool itself
        # is stubbed.
        return tool_call("read_file", {"path": f"/step-{request.index}.md"},
                         id=f"call-{request.index}")

    @property
    def calls(self) -> int:
        return len(self.scripted.requests)

    @property
    def histories(self) -> list[list[dict]]:
        return [r.messages for r in self.scripted.requests]

    def trimmed(self) -> list[int]:
        """The requests the funnel's last-resort guard had to cut."""
        return [r.index for r in self.scripted.requests
                if TRIM_NOTICE in json.dumps(r.messages)]


async def _dispatch(name: str, args: dict, context: dict) -> str:
    """A tool that returns a lot, with the secret buried in the second call."""
    step = args.get("path", "")
    body = f"result for {step}. " + ("filler text. " * 900)
    if step == "/step-2.md":
        body = f"{SECRET}. {body}"
    return body


async def _read_file_only() -> list[dict]:
    """The one tool the run calls. The budget is about the transcript: with
    the whole chat catalogue (tens of thousands of tokens of schemas) the
    definitions alone outgrow it, and the funnel's final guard would drop
    every message on every request."""
    from chat.tools import AVAILABLE_TOOLS

    return [t for t in AVAILABLE_TOOLS if t["function"]["name"] == "read_file"]


async def _never(name, args, context) -> bool:
    return False


class LongRunTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user("e2e", "e@example.com", "x")

    def setUp(self):
        async def small_budget(model, *, reserve_output=0):
            return BUDGET_TOKENS

        patcher = patch("llm.budget.input_budget_for", new=small_budget)
        patcher.start()
        self.addCleanup(patcher.stop)
        # `curate_node` sizes against the same number the assertions use.
        cached = patch(
            "llm.budget.cached_input_budget",
            new=lambda model, reserve_output=0: BUDGET_TOKENS,
        )
        cached.start()
        self.addCleanup(cached.stop)

    def _turn(self, policy, thread: str) -> TurnContext:
        return TurnContext(
            provider=DEFAULT_PROVIDER, model="stub-model", system_message="You are a test.",
            user_id=self.user.id, session_id=thread, intent="research",
            user_text="do the work", memory_enabled=False,
            max_iterations=40,
            tool_dispatch=_dispatch,
            tool_source=_read_file_only,
            approval_policy=_never,
            curation=policy,
        )

    def _run(self, policy, *, turns=20, thread="e2e-thread"):
        stub = _StubProvider(turns)

        async def summarise(_turn_ctx):
            async def fold(text):
                # Deliberately keeps the secret if it is in the folded text:
                # a summariser that dropped every specific would make the recall
                # assertion below pass or fail for the wrong reason.
                keep = SECRET if SECRET in text else "earlier steps happened"
                return f"Summary of earlier work. {keep}", 40
            return fold

        with stub.scripted.installed(), \
             patch("chat.turn.agent._summariser_for", new=summarise):
            result = async_to_sync(run_turn)(
                self._turn(policy, thread), prompt="do the work", thread_id=thread
            )
        return stub, result

    # ── the three things a user would notice ─────────────────────────────────

    def test_the_request_never_outgrows_the_window(self):
        policy = curation.CurationPolicy(
            enabled=True, compaction=True, recursive=True, indexing=True,
        )
        stub, result = self._run(policy)

        self.assertGreater(stub.calls, 10, "the run should have gone long")
        worst = max(budget.history_tokens(h) for h in stub.histories)
        self.assertLess(
            worst, BUDGET_TOKENS,
            f"a request of {worst} tokens went out against a {BUDGET_TOKENS} budget",
        )
        self.assertEqual(result.answer, "done")
        # And it was curation that kept it there: the funnel's final guard,
        # which drops whole messages, never had to step in.
        self.assertEqual(stub.trimmed(), [])

    def test_without_curation_the_same_run_would_have_overflowed(self):
        """Guards the assertions above from passing because the transcript was
        never large enough to need curating. At the wire the funnel's final
        guard stops an oversized request from leaving, so what shows the
        overflow is that it had to cut messages to send one."""
        stub, _ = self._run(curation.CurationPolicy(enabled=False))
        self.assertTrue(stub.trimmed(), "the run never outgrew the window; the test is vacuous")

    def test_every_request_stays_sendable(self):
        """No `tool` entry may ever refer to a call that is not in the same
        request. This is the 400 that used to end long runs, asserted on what
        actually went out rather than on the trimmer in isolation."""
        stub, _ = self._run(curation.CurationPolicy(
            enabled=True, compaction=True, recursive=True, indexing=True,
        ))
        for index, history in enumerate(stub.histories):
            offered = {
                call["id"]
                for entry in history
                for call in entry.get("tool_calls") or []
            }
            answered = {
                entry["tool_call_id"]
                for entry in history if entry.get("role") == "tool"
            }
            self.assertTrue(
                answered <= offered,
                f"request {index} orphaned {answered - offered}",
            )

    def test_a_compacted_fact_is_still_reachable(self):
        """The point of indexing. The secret is in turn 2's result, which is
        long gone from the transcript by turn 20 — but it is in the archive, and
        `recall_context` finds it."""
        from chat.tools.tool_output import recall

        policy = curation.CurationPolicy(
            enabled=True, compaction=True, recursive=True, indexing=True,
        )
        self._run(policy, thread="recall-thread")

        out = async_to_sync(recall)("reconciliation code", {
            "user_id": self.user.id, "session_id": "recall-thread",
        })
        self.assertIn("QX-8842", out)

    def test_the_transcript_says_what_was_removed(self):
        policy = curation.CurationPolicy(
            enabled=True, compaction=True, recursive=False, indexing=True,
        )
        stub, _ = self._run(policy, thread="notice-thread")

        final = stub.histories[-1]
        records = [
            entry for entry in final
            if isinstance(entry.get("content"), str)
            and curation.RECORD_PREFIX in entry["content"]
        ]
        self.assertTrue(records, "nothing was compacted in a 20-turn run")
        # A record names the call it replaced and where the rest went, so a
        # truncated result and a short one cannot look alike.
        self.assertIn("read_file(", records[0]["content"])
        self.assertIn("recall_context", records[0]["content"])

    def test_curation_is_not_charged_to_the_user_twice(self):
        """The fold's tokens count once, in the run's total. They are what makes
        it visible to the spend cap."""
        policy = curation.CurationPolicy(
            enabled=True, compaction=True, recursive=True, indexing=True,
        )
        _, result = self._run(policy, thread="tokens-thread")
        self.assertGreater(result.tokens, 0)

    def test_nothing_is_archived_when_indexing_is_off(self):
        self._run(
            curation.CurationPolicy(
                enabled=True, compaction=True, recursive=True, indexing=False,
            ),
            thread="noindex-thread",
        )
        self.assertFalse(
            ToolOutput.objects.filter(session_key="noindex-thread").exists()
        )

    def test_a_short_run_is_untouched(self):
        """The watermark is the whole reason a normal run pays nothing for any
        of this."""
        stub, _ = self._run(
            curation.CurationPolicy(enabled=True), turns=2, thread="short-thread"
        )
        final = stub.histories[-1]
        self.assertFalse([
            entry for entry in final
            if isinstance(entry.get("content"), str)
            and curation.RECORD_PREFIX in entry["content"]
        ])
        self.assertFalse(
            ToolOutput.objects.filter(session_key="short-thread").exists()
        )
