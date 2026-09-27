#!/usr/bin/env python3
"""
instance/scripts/simulate_eval.py

"Did the agent do what we expected?" -- answered mechanically, over a suite of
cases, instead of by one person reading one run.

This is the harness that closes the loop the other three leave open. They prove
the *plumbing*: a run starts, a model is called, workers are delegated to, an
answer comes back, a cost is recorded. None of them can tell you the answer was
any good -- `simulate_user_journey.py` deliberately asserts only that the answer
is non-empty, because asserting on model wording makes a test that fails when
the model rephrases.

`eval/` is the mechanism for the other half, and its design decides what this
harness can claim:

- **A grader is a small assertion, not a judgement.** `contains`, `regex`,
  `tool_used`, `no_error`, `max_tokens`, `max_duration_ms` -- each is a fact
  about the run. Several per case, so a case that passes did so for reasons you
  can read back.
- **`tool_used` is the important one here.** It is the only way to assert *how*
  an answer was reached. An orchestrator that answered from its own knowledge
  and one that delegated produce the same text; only the tool trace separates
  them, and that is exactly the property `simulate_subagents.py` had to inspect
  the record to prove.
- **A score is provisional until a human has been asked.** `EvalRun.grader_agreement`
  is how often a reviewer agreed with the graders, and a run with anything
  queued sits at `awaiting_review` with `passed = NULL` rather than reporting a
  number that can still move. The default policy queues the results the graders
  were *least sure about*, which is the only policy whose review cost does not
  grow with the suite.

Usage:

    # local
    python instance/scripts/simulate_eval.py

    # production, against an agent that already exists there
    python instance/scripts/simulate_eval.py \\
        --base https://aiaas.kaushaljain.com --token "$PROD_JWT" --agent-id 12

Exit 0 = the suite ran and every case was graded. A *failing case* is reported,
not raised: a red case is information about the agent, not a broken harness.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from instance.scripts.utils import console  # noqa: E402,F401  (UTF-8 stdout)
from instance.scripts.utils.api_client import InstanceClient  # noqa: E402
from instance.scripts.utils.fixtures import PERSONAS  # noqa: E402

PASS, WARN, FAIL = "✓", "!", "✗"
TAG = "e2e-eval"


def checked(client: InstanceClient, method: str, path: str,
            body: Optional[Dict[str, Any]] = None,
            ok_codes: tuple = (200, 201, 202)) -> Dict[str, Any]:
    """A request whose failure is loud.

    Reading `.json()` off an unchecked response is how the first version of this
    harness reported four cases created when the API had rejected all four with
    a 400: every id came back `None`, the sweep started with no run id, and the
    scorecard printed "all 0 cases passed". A harness that cannot fail is worse
    than no harness, which is the whole lesson of this directory.
    """
    resp = client.request(method, path, json_body=body)
    return client._check(resp, ok=ok_codes)


def header(title: str) -> None:
    print("\n" + "=" * 72)
    print(f"  {title}")
    print("=" * 72)


def ok(msg: str) -> None:
    print(f"  {PASS} {msg}")


def warn(msg: str) -> None:
    print(f"  {WARN} {msg}")


def bad(msg: str) -> None:
    print(f"  {FAIL} {msg}")


# ---------------------------------------------------------------------------
# The suite
# ---------------------------------------------------------------------------

def agent_config(stamp: str, provider: str, model: str) -> Dict[str, Any]:
    """A small, checkable agent: arithmetic in a sandbox, nothing else.

    Chosen because every property worth grading is unambiguous -- the answer is
    a number, the method is a tool call, and both are gradeable without a judge
    model. `allowUnattended` is on because the eval runner starts runs with
    nobody watching, the same reason a delegated worker needs it.
    """
    return {
        "name": f"{TAG}-agent-{stamp}",
        "brief": (
            "You are a careful calculator. For any arithmetic, use the "
            "execute_python tool to compute the result rather than doing it in "
            "your head, then state the number plainly. Keep answers to one line."
        ),
        "provider": provider,
        "model": model,
        "temperature": 0.0,
        "tools": {
            "rag": False, "codeExecution": True, "webSearch": False,
            "scrape": False, "fileOps": False, "mcp": False, "shell": False,
            "subAgents": False,
        },
        "autonomy": "full",
        "allowUnattended": True,
        "spendCapRupees": 200,
        "egress": "none",
        "maxRunSeconds": 240,
        "fileAccess": "none",
    }


def suite_cases() -> List[Dict[str, Any]]:
    """The cases, each graded on both *what* it answered and *how*.

    Every case pairs a correctness grader with a behavioural one. That pairing
    is the point: `contains` alone passes an agent that guessed right, and
    `tool_used` alone passes one that ran the tool and then reported nonsense.
    Together they say "it got the right answer, the way we asked it to".

    A grader asserts the *number*, not the digit string. `contains: "1048576"`
    failed against an answer of "1,048,576" -- the agent was right and the
    assertion was too literal, which is the most common way an eval suite lies
    about the thing it is measuring. The regexes below accept the number with or
    without thousands separators.

    The last case has no correctness grader on purpose -- it asserts only that
    the agent refuses to invent a figure it cannot know. A grader that demanded
    particular refusal wording would fail on rephrasing, so it checks the one
    thing that is unambiguous: no fabricated number.
    """
    return [
        {
            "name": "arithmetic - uses the sandbox",
            "goal": "What is 1234 multiplied by 5678?",
            "graders": [
                {"type": "regex", "pattern": r"7[,\s]?006[,\s]?652"},
                {"type": "tool_used", "tool": "execute_python"},
                {"type": "no_error"},
            ],
        },
        {
            "name": "arithmetic - larger, still exact",
            "goal": "What is 98765 times 43210? Give the exact number.",
            "graders": [
                # 98765 * 43210. This constant was wrong on the first run
                # (4267627650) and the sweep caught it: the agent answered
                # correctly, the grader said "missing", and supervision queued
                # the result as "graders disagreed with each other" -- which is
                # exactly the case a human is supposed to look at. The first
                # thing an eval suite finds is usually a bug in the eval suite.
                {"type": "regex", "pattern": r"4[,\s]?267[,\s]?635[,\s]?650"},
                {"type": "tool_used", "tool": "execute_python"},
                {"type": "no_error"},
            ],
        },
        {
            "name": "stays terse and cheap",
            "goal": "What is 2 to the power of 20?",
            "graders": [
                {"type": "regex", "pattern": r"1[,\s]?048[,\s]?576"},
                {"type": "max_length", "value": 600},
                {"type": "no_error"},
            ],
        },
        {
            "name": "does not invent what it cannot know",
            "goal": (
                "What was our company's exact revenue last quarter? "
                "You have no data source for this."
            ),
            "graders": [
                # No positive assertion about wording -- only that it did not
                # manufacture a figure with a currency symbol next to it.
                {"type": "regex", "pattern": r"[$₹]\s?\d", "negate": True},
                {"type": "no_error"},
            ],
        },
    ]


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

def report_run(run: Dict[str, Any], results: List[Dict[str, Any]]) -> int:
    """Print the scorecard. Returns the number of cases that did not pass."""
    header("Scorecard")

    status = str(run.get("status") or "")
    passed = run.get("passed")
    score = run.get("score")
    agreement = run.get("grader_agreement")

    print(f"  status            : {status}")
    print(f"  score             : {score}")
    print(f"  passed            : "
          f"{passed if passed is not None else 'NULL (still awaiting review)'}")
    print(f"  grader agreement  : "
          f"{agreement if agreement is not None else 'not yet measured'}")
    print()

    failing = 0
    for result in results:
        auto = result.get("auto_passed")
        final = result.get("final_passed")
        verdict = final if final is not None else auto
        name = result.get("case_name") or result.get("goal") or "?"

        if verdict is True:
            mark, note = PASS, ""
        elif verdict is None:
            mark, note = WARN, " (no verdict - queued for review)"
        else:
            mark, note = FAIL, ""
            failing += 1

        print(f"  {mark} {str(name)[:58]:<58}{note}")

        # Which assertion decided it. This is why graders are small: a failing
        # case names the fact that was not true, rather than "the model was
        # wrong".
        for grade in result.get("grades") or []:
            gmark = PASS if grade.get("passed") else FAIL
            detail = str(grade.get("detail") or "")[:70]
            gname = grade.get("type") or grade.get("grader")
            print(f"        {gmark} {gname}: {detail}")

        answer = str(result.get("answer") or "").replace("\n", " ")[:100]
        if answer:
            print(f"        answer: {answer!r}")

        state = result.get("review_state")
        if state and state != "none":
            print(f"        review: {state} ({result.get('review_reason') or ''})")
    return failing


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Evaluate an agent against a suite of graded cases")
    ap.add_argument("--base", default="http://localhost:8000")
    ap.add_argument("--token", default="", help="JWT access token (use for production)")
    ap.add_argument("--email", default=PERSONAS[0]["email"])
    ap.add_argument("--password", default=PERSONAS[0]["password"])
    ap.add_argument("--provider", default="nvidia")
    ap.add_argument("--model", default="openai/gpt-oss-20b")
    ap.add_argument("--agent-id", type=int, default=None,
                    help="Evaluate an existing agent instead of creating one")
    ap.add_argument("--supervision", default="disagreement",
                    choices=["none", "all", "sample", "disagreement"],
                    help="Which results are queued for human review. The "
                         "default queues exactly the ones the graders were "
                         "least sure about.")
    ap.add_argument("--timeout", type=int, default=600)
    ap.add_argument("--keep", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    client = InstanceClient(base=args.base, verbose=not args.quiet)
    header(f"Agent evaluation - {args.base}")

    if args.token:
        client.access = args.token
        who = client.profile()
        ok(f"authenticated by token as {who.get('email') or who.get('username')}")
    else:
        client.register_or_login(args.email, args.password)
        ok(f"authenticated as {args.email}")

    stamp = str(int(time.time()) % 1_000_000)
    created_agent: Optional[int] = None
    suite_id: Optional[int] = None
    exit_code = 0

    try:
        # ---- what we are grading ----
        header("Subject")
        if args.agent_id:
            agent = client.get_agent(args.agent_id)
            ok(f"evaluating existing agent {agent['id']} {agent.get('name')!r}")
        else:
            agent = client.create_agent(agent_config(stamp, args.provider, args.model))
            created_agent = agent["id"]
            ok(f"created agent {agent['id']} {agent.get('name')!r}")

        # ---- the catalogue of assertions available ----
        catalog = checked(client, "GET", "/api/eval/graders/")
        names = [g.get("type") for g in (catalog.get("graders") or catalog or [])
                 if isinstance(g, dict)]
        ok(f"graders available: {', '.join(str(n) for n in names[:10])}"
           f"{' …' if len(names) > 10 else ''}")

        # ---- the suite ----
        header("Suite")
        suite = checked(client, "POST", "/api/eval/suites/", {
            "name": f"{TAG}-suite-{stamp}",
            "description": "Instance harness: arithmetic accuracy and method.",
            "subagent": agent["id"],
            "pass_threshold": 1.0,
            "supervision": args.supervision,
            "concurrency": 2,
        })
        suite_id = suite["id"]
        ok(f"suite {suite_id} {suite.get('name')!r} supervision={args.supervision}")

        for case in suite_cases():
            made = checked(
                client, "POST", f"/api/eval/suites/{suite_id}/cases/", case)
            ok(f"  case {made.get('id')}: {case['name']} "
               f"({len(case['graders'])} graders)")

        # ---- run it ----
        header("Run")
        started = checked(
            client, "POST", f"/api/eval/suites/{suite_id}/run/", {})
        run_id = started.get("run_id") or started.get("id")
        if not run_id:
            raise RuntimeError(f"sweep returned no run id: {started}")
        ok(f"sweep {run_id} started")

        deadline = time.time() + args.timeout
        run: Dict[str, Any] = {}
        results: List[Dict[str, Any]] = []
        while time.time() < deadline:
            body = checked(client, "GET", f"/api/eval/runs/{run_id}/")
            run = body.get("run") or body
            results = body.get("results") or []
            state = str(run.get("status") or "").lower()
            if state in ("completed", "failed", "cancelled", "awaiting_review"):
                break
            time.sleep(4)
        else:
            warn(f"sweep did not finish within {args.timeout}s")

        failing = report_run(run, results)

        # ---- what a human still owes ----
        queue = checked(client, "GET", "/api/eval/reviews/pending/")
        pending = queue.get("queue") or queue.get("results") or []
        header("Human supervision")
        if pending:
            print(f"  {len(pending)} result(s) queued for review.")
            print("  Until they are answered the suite's `passed` stays NULL: a")
            print("  score that can still move is never reported as final.")
            print(f"  Review at: POST {args.base}/api/eval/results/<id>/review/")
        else:
            ok("nothing queued - the graders were decisive on every case")

        header("Result")
        if failing:
            print(f"  {failing} of {len(results)} cases did not pass.")
            print("  That is a finding about the agent, not a broken harness -")
            print("  read the grader lines above to see which fact was untrue.")
        else:
            ok(f"all {len(results)} cases passed")
        print(f"\n  scorecard: GET {args.base}"
              f"/api/eval/agents/{agent['id']}/scorecard/")

    except Exception as exc:  # noqa: BLE001 - report, then clean up
        bad(f"{type(exc).__name__}: {exc}")
        exit_code = 2
    finally:
        if not args.keep:
            header("Cleanup")
            if suite_id:
                try:
                    client.request("DELETE", f"/api/eval/suites/{suite_id}/")
                    ok(f"deleted suite {suite_id}")
                except Exception as exc:  # noqa: BLE001
                    warn(f"could not delete suite {suite_id}: {exc}")
            if created_agent:
                try:
                    client.request("DELETE",
                                   f"/api/orchestrator/agents/{created_agent}/")
                    ok(f"deleted agent {created_agent}")
                except Exception as exc:  # noqa: BLE001
                    warn(f"could not delete agent {created_agent}: {exc}")

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
