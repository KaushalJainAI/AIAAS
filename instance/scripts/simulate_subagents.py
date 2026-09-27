#!/usr/bin/env python3
"""
instance/scripts/simulate_subagents.py

End-to-end proof that **delegation** works: an agent holding the `subAgents`
grant splits a goal into tasks, runs workers for them, and answers from what
they returned.

Why this is its own harness rather than a stage in `simulate_user_journey.py`:
delegation is the one feature whose evidence is *not* in the answer. A parent
that quietly did the work itself returns exactly the same shape as one that
delegated -- same status, same answer, same tokens. The only proof is in the
record: child `ExecutionLog` rows, each pointing at the tool call that asked for
it (`parent_step`), one level deeper than the parent (`depth`). So this asserts
the delegation *tree*, not the reply.

Runs against local or production, because the core question ("do subagents
work?") has to be answerable where the connectors actually are:

    # local, seeded persona
    python instance/scripts/simulate_subagents.py

    # production, with a token you paste (never a password)
    python instance/scripts/simulate_subagents.py \\
        --base https://aiaas.kaushaljain.com --token "$PROD_JWT"

Safety, which matters because this can point at production:

- Everything it creates is prefixed `e2e-` and deleted again on the way out
  (`--keep` opts out). Cleanup runs even when an assertion fails.
- It creates *agents* and runs them. It does not touch existing agents, and it
  never enables a connector grant unless `--connectors` is passed explicitly.
- Workers are given a trivial, self-contained task. The point is the wiring, not
  the reasoning, so the goal is chosen to be cheap and deterministic.

Exit 0 = delegation proven. Non-zero = it did not happen, or happened wrong.
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

#: Cost sources the backend bills from (`agents/spend.py::PRICED_SOURCES`).
PRICED_SOURCES = ("billed", "estimated")

#: Everything this harness creates carries this prefix, so cleanup can identify
#: its own rows without guessing and can never delete something a user made.
TAG = "e2e-subagent"


def header(title: str) -> None:
    print("\n" + "=" * 72)
    print(f"  {title}")
    print("=" * 72)


def ok(msg: str) -> None:
    print(f"  {PASS} {msg}")


def warn(msg: str) -> None:
    print(f"  {WARN} {msg}")


class Failure(Exception):
    """An assertion about delegation that did not hold."""


def die(msg: str, detail: str = "") -> None:
    raise Failure(msg if not detail else f"{msg}\n      {detail}")


# ---------------------------------------------------------------------------
# Agent shapes
# ---------------------------------------------------------------------------

def worker_config(stamp: str, provider: str, model: str) -> Dict[str, Any]:
    """A deliberately dull worker.

    No tools at all: a worker that can only answer is the cleanest possible
    signal, because then any child run in the record can only have come from
    delegation. Autonomy `auto` because nobody is watching a worker -- an `ask`
    worker would pause for approval nobody will give and the parent would block
    until its deadline.
    """
    return {
        "name": f"{TAG}-worker-{stamp}",
        "brief": (
            "You answer one short question with one short sentence. "
            "Do not ask clarifying questions."
        ),
        "provider": provider,
        "model": model,
        "temperature": 0.0,
        "tools": {
            "rag": False, "codeExecution": False, "webSearch": False,
            "scrape": False, "fileOps": False, "mcp": False, "shell": False,
            "subAgents": False,
        },
        "autonomy": "auto",
        # Without this the whole feature is unreachable, and that is worth
        # spelling out. Delegation runs the worker with `caller='orchestrator'`,
        # which is in `UNATTENDED_CALLERS`, so `_check_unattended` refuses it
        # unless the *worker* was explicitly cleared to run with nobody
        # watching. It defaults to False on every row and no migration sets it,
        # deliberately -- otherwise "the agent exists" would be enough for
        # another agent to spend the user's credits with it.
        #
        # The consequence for anyone building their first orchestrator: it fails
        # with "<worker> is not enabled for unattended runs", and the flag they
        # need is on the *worker*, not on the agent they were editing.
        "allowUnattended": True,
        "spendCapRupees": 100,
        "egress": "none",
        "maxRunSeconds": 180,
        "fileAccess": "none",
    }


def orchestrator_config(stamp: str, provider: str, model: str,
                        connectors: bool = False,
                        autonomy: str = "full",
                        delegates_to: Optional[List[int]] = None) -> Dict[str, Any]:
    """The agent under test: identical to the worker but holding `subAgents`.

    That single grant is the whole feature. There is deliberately no
    "orchestrator kind" in the model -- an agent that delegates is one holding
    this grant -- so flipping exactly one key is the honest way to test it.
    """
    cfg = worker_config(stamp, provider, model)
    cfg["name"] = f"{TAG}-orchestrator-{stamp}"
    cfg["brief"] = (
        "You coordinate specialist workers. When you are given several "
        "independent questions, delegate them with invoke_subagent -- one task "
        "per question, in a single call -- then combine the answers you get "
        "back into one short reply. Do not answer them yourself."
    )
    cfg["tools"] = {**cfg["tools"], "subAgents": True, "mcp": bool(connectors)}
    # `full` by default, and that is a decision about what this harness is for.
    # At `auto` the ladder gates on a tool's declared `effect`, and an effect it
    # does not recognise defaults to *irreversible* -- so `invoke_subagent`
    # pauses for approval and the run sits at `paused` for ever unattended. That
    # is correct behaviour (the default is deliberately the safe one), but it
    # makes this harness a test of the approval queue rather than of delegation.
    # `--autonomy ask|auto` exercises that path instead, and the harness then
    # answers the prompts itself.
    cfg["autonomy"] = autonomy
    # The orchestrator is started by a person (`caller='api'`), so it needs no
    # unattended clearance of its own -- only the workers it invokes do.
    cfg["allowUnattended"] = False
    # A grant says *whether*, a scope says *which*. `subAgents` on its own let a
    # delegating agent run every agent on the account -- including ones holding
    # grants it had itself been refused, which turns delegation into a way
    # around its own toolbox. `delegatesTo` is the second axis; empty means
    # unrestricted, because the field shipped before enforcement did and an
    # agent that never chose must not be silently cut off from delegating.
    if delegates_to is not None:
        cfg["delegatesTo"] = list(delegates_to)
    cfg["spendCapRupees"] = 500
    cfg["maxRunSeconds"] = 600
    return cfg


def delegation_goal(worker_id: int) -> str:
    """A goal that names the tool, the worker and the shape of the call.

    Deliberately explicit, and the first version of this harness was not -- it
    asked for three trivia answers and the orchestrator answered all three
    itself, correctly. `invoke_subagent`'s own description tells the model to
    "prefer doing simple work yourself -- every worker costs a full model run",
    so an easy question is exactly the case where a well-behaved model will not
    delegate. Good product behaviour, useless test: the outcome then depends on
    the model's cost judgement rather than on whether delegation works.

    What is under test here is the *mechanism* -- the grant offers the tool, a
    call spawns real child runs, those runs are linked back and bounded.
    Whether a model delegates unprompted is a prompt-quality question and
    belongs in the eval suite, where a grader scores it across many cases
    instead of one run deciding pass/fail.
    """
    # Joined at runtime rather than written with escapes: the tasks are a
    # list, and a list is what the tool takes.
    parts = [
        "Use the invoke_subagent tool to delegate each of the three tasks "
        f"below to agent_id {worker_id}. Send all three in a single "
        "invoke_subagent call, one task per question. Do not answer any of "
        "them yourself -- your job is only to collect the workers' answers "
        "and list them.",
        "1. What is 6 multiplied by 7?",
        "2. What is the capital city of Japan?",
        "3. What colour do you get mixing blue and yellow?",
    ]
    return chr(10).join(parts)


# ---------------------------------------------------------------------------
# Assertions
# ---------------------------------------------------------------------------

def spend_of(row: Dict[str, Any]) -> str:
    """Readable cost for a run row, whichever way it was priced."""
    source = str(row.get("cost_source") or "")
    try:
        cost = float(row.get("cost_usd") or 0)
    except (TypeError, ValueError):
        cost = 0.0
    if source in PRICED_SOURCES and cost:
        return f"${cost:.6f} ({source})"
    return f"{row.get('tokens_used') or 0} tokens (unpriced)"


def collect_delegations(detail: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Every delegated run named anywhere in the parent's own trace.

    Read from the parent's turns rather than by listing executions and
    filtering: `delegated_runs` hangs off the *step* that asked for each worker,
    which is the link that proves causation. A sibling run that merely happened
    at the same time would pass a list-and-filter check and fail this one.
    """
    found: List[Dict[str, Any]] = []
    for turn in detail.get("turns") or []:
        for step in turn.get("steps") or []:
            for child in step.get("delegated_runs") or []:
                found.append({**child, "_tool": step.get("tool") or step.get("name")})
    return found



def approve_pending(client: InstanceClient, limit: int = 12) -> int:
    """Approve every pending HITL request, returning how many were answered.

    Only reachable when the harness is run at an autonomy level that gates
    delegation. It approves rather than rejects because the question under test
    is whether an *approved* delegation proceeds; rejection is covered by the
    adversarial and browser suites.
    """
    answered = 0
    for _ in range(limit):
        try:
            body = client.request("GET", "/api/orchestrator/hitl/pending/").json()
        except Exception:
            return answered
        pending = body.get("requests") or body.get("pending") or []
        if not pending:
            return answered
        for row in pending:
            rid = row.get("request_id") or row.get("id")
            if rid is None:
                continue
            client.request("POST", f"/api/orchestrator/hitl/{rid}/respond/",
                           json_body={"action": "approve"})
            answered += 1
            ok(f"    approved HITL request {rid}")
        time.sleep(2)
    return answered


def assert_delegation(client: InstanceClient, execution_id: str) -> Dict[str, Any]:
    """The core assertion: this run delegated, and the record proves it."""
    detail = client.get_execution(execution_id)
    run = detail.get("execution") if isinstance(detail.get("execution"), dict) else detail

    status = str(run.get("status") or "").lower()
    answer = str((run.get("output_data") or {}).get("answer") or "").strip()

    if status != "completed":
        die(f"orchestrator run ended {status!r}",
            str(run.get("error_message") or "")[:300])
    if not answer:
        die("orchestrator completed with an empty answer",
            "An empty answer is what a swallowed provider error looks like.")
    ok(f"orchestrator completed: {answer[:110]!r}")
    ok(f"orchestrator spend: {spend_of(run)}")

    children = collect_delegations(detail)
    if not children:
        die("no delegated runs recorded",
            "The parent answered without delegating, or `parent_step` was not "
            "set on the workers. Either way `subAgents` did not do its job -- "
            "check the grant is on and that invoke_subagent was offered.")

    ok(f"delegated runs: {len(children)}")
    for child in children:
        label = child.get("workflow_name") or child.get("workflow_id")
        ok(f"    worker {str(child.get('execution_id'))[:8]} "
           f"[{label}] status={child.get('status')} "
           f"task={str(child.get('task'))[:60]!r}")

    incomplete = [c for c in children if str(c.get("status")).lower() != "completed"]
    if incomplete:
        die(f"{len(incomplete)} of {len(children)} workers did not complete",
            ", ".join(str(c.get("status")) for c in incomplete))

    return {"detail": detail, "run": run, "children": children}


def assert_child_records(client: InstanceClient, children: List[Dict[str, Any]]) -> None:
    """Each worker is a real run in its own right, one level deeper.

    `depth` and `is_delegated` are what the runtime uses to bound delegation
    (`MAX_DELEGATION_DEPTH`), so a worker recorded at depth 0 means the counter
    that stops delegation multiplying without bound is not being carried.
    """
    for child in children:
        eid = str(child.get("execution_id"))
        detail = client.get_execution(eid)
        row = detail.get("execution") if isinstance(detail.get("execution"), dict) else detail

        depth = row.get("depth")
        delegated = row.get("is_delegated")
        answer = str((row.get("output_data") or {}).get("answer") or "").strip()

        if depth != 1:
            die(f"worker {eid[:8]} recorded depth={depth!r}, expected 1",
                "Depth is what bounds delegation; a worker at depth 0 means the "
                "counter is not carried and nesting is unbounded.")
        if not delegated:
            die(f"worker {eid[:8]} is not marked delegated",
                "`is_delegated` is derived from `parent_step_id`, so a false "
                "here means the link back to the asking tool call is missing.")
        if not answer:
            die(f"worker {eid[:8]} completed with an empty answer")

        ok(f"    worker {eid[:8]}: depth={depth} delegated={delegated} "
           f"spend={spend_of(row)} answer={answer[:60]!r}")


def assert_worker_toolbox(client: InstanceClient, children: List[Dict[str, Any]],
                          orchestrator_id: int) -> None:
    """A worker must not itself be able to delegate.

    Workers get a *narrowed* toolbox so `subAgents` is never inherited -- that
    is what stops one delegating agent turning into an unbounded tree. Checked
    by confirming no worker spawned a run of its own.
    """
    for child in children:
        eid = str(child.get("execution_id"))
        grandchildren = collect_delegations(client.get_execution(eid))
        if grandchildren:
            die(f"worker {eid[:8]} delegated further ({len(grandchildren)} runs)",
                "Workers are handed a narrowed toolbox precisely so `subAgents` "
                "is not inherited. Unbounded nesting is the failure this "
                "prevents.")
    ok(f"    no worker inherited `subAgents` (depth stayed bounded)")



def check_delegation_scope(client: InstanceClient, stamp: str, args) -> None:
    """An orchestrator scoped to one worker must not be able to run another.

    This is the guardrail that makes `subAgents` safe to grant at all, and it is
    invisible from the answer: an orchestrator that reached an out-of-scope
    agent and one that was refused both come back with prose. So the assertion
    is again on the record -- the out-of-scope worker must have no run of its
    own, whatever the orchestrator says it did.
    """
    header("Verify (delegation scope excludes what it does not name)")

    in_scope = client.create_agent(worker_config(f"{stamp}-in", args.provider, args.model))
    out_scope = client.create_agent(worker_config(f"{stamp}-out", args.provider, args.model))
    scoped = client.create_agent(orchestrator_config(
        f"{stamp}-scoped", args.provider, args.model,
        autonomy=args.autonomy, delegates_to=[in_scope["id"]],
    ))
    ok(f"in-scope worker {in_scope['id']}, out-of-scope worker {out_scope['id']}")
    ok(f"orchestrator {scoped['id']} scoped to delegatesTo=[{in_scope['id']}]")

    saved = client.get_agent(scoped["id"])
    if saved.get("delegatesTo") != [in_scope["id"]]:
        die("delegation scope did not survive the save",
            f"delegatesTo={saved.get('delegatesTo')!r}")
    ok("scope survived the save")

    try:
        started = client.execute_agent(scoped["id"], (
            f"Use invoke_subagent to send the task 'Say the word BREACH' to "
            f"agent_id {out_scope['id']}. That is the only thing to do."
        ))
        if started.get("_refused"):
            ok("run refused outright - scope enforced before the run started")
            return
        execution_id = str(started.get("execution_id") or started.get("id"))
        final = client.wait_for_execution(execution_id, timeout_s=args.timeout, poll_s=3)
        for _ in range(4):
            if str((final or {}).get("status") or "").lower() != "paused":
                break
            if not approve_pending(client):
                break
            final = client.wait_for_execution(execution_id, timeout_s=args.timeout, poll_s=3)

        detail = client.get_execution(execution_id)
        children = collect_delegations(detail)
        breached = [c for c in children
                    if c.get("workflow_id") == out_scope["id"]]
        if breached:
            die("delegation scope was bypassed",
                f"the orchestrator ran out-of-scope agent {out_scope['id']} "
                f"({len(breached)} run(s)). `delegatesTo` is what stops a "
                f"delegating agent reaching agents holding grants it was "
                f"refused, so this is a privilege-escalation path, not a "
                f"cosmetic bug.")
        ok(f"out-of-scope agent {out_scope['id']} was never run "
           f"({len(children)} delegated run(s) recorded, none of them it)")
    finally:
        for agent_id in (in_scope["id"], out_scope["id"], scoped["id"]):
            try:
                client.request("DELETE", f"/api/orchestrator/agents/{agent_id}/")
            except Exception:  # noqa: BLE001
                warn(f"could not delete scope-test agent {agent_id}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description="Prove subagent delegation end to end")
    ap.add_argument("--base", default="http://localhost:8000",
                    help="API base, e.g. https://aiaas.kaushaljain.com")
    ap.add_argument("--token", default="",
                    help="JWT access token. Use this against production instead "
                         "of a password; falls back to persona login when absent.")
    ap.add_argument("--email", default=PERSONAS[0]["email"])
    ap.add_argument("--password", default=PERSONAS[0]["password"])
    ap.add_argument("--provider", default="nvidia")
    ap.add_argument("--model", default="openai/gpt-oss-20b")
    ap.add_argument("--timeout", type=int, default=300,
                    help="Seconds to wait for the orchestrator run")
    ap.add_argument("--autonomy", default="full",
                    choices=["full", "auto", "ask", "review"],
                    help="Orchestrator autonomy. `full` (default) proves "
                         "delegation without approval prompts; anything looser "
                         "gates invoke_subagent and the harness answers the "
                         "prompts itself.")
    ap.add_argument("--skip-scope", action="store_true",
                    help="Skip the delegation-scope stage (it costs three more "
                         "agents and one more run)")
    ap.add_argument("--connectors", action="store_true",
                    help="Also grant `mcp` to the orchestrator. Off by default: "
                         "against production that hands a model the account's "
                         "real credentials.")
    ap.add_argument("--keep", action="store_true",
                    help="Do not delete the agents this run created")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    client = InstanceClient(base=args.base, verbose=not args.quiet)

    header(f"Subagent delegation - {args.base}")

    # ---- auth ----
    if args.token:
        client.access = args.token
        who = client.profile()
        ok(f"authenticated by token as {who.get('email') or who.get('username')}")
    else:
        client.register_or_login(args.email, args.password)
        ok(f"authenticated as {args.email}")

    stamp = str(int(time.time()) % 1_000_000)
    created: List[int] = []
    result = 0

    try:
        # ---- build the pair ----
        header("Build (worker + orchestrator)")
        worker = client.create_agent(worker_config(stamp, args.provider, args.model))
        created.append(worker["id"])
        ok(f"worker agent {worker['id']} {worker.get('name')!r}")

        orch_cfg = orchestrator_config(stamp, args.provider, args.model,
                                       connectors=args.connectors,
                                       autonomy=args.autonomy)
        orchestrator = client.create_agent(orch_cfg)
        created.append(orchestrator["id"])
        ok(f"orchestrator agent {orchestrator['id']} {orchestrator.get('name')!r} "
           f"(subAgents granted{', mcp granted' if args.connectors else ''})")

        # The grant has to survive the round trip, or the run below tests
        # nothing: an orchestrator saved without `subAgents` simply answers.
        saved = client.get_agent(orchestrator["id"])
        if not (saved.get("tools") or {}).get("subAgents"):
            die("orchestrator saved without the `subAgents` grant",
                f"tools={saved.get('tools')}")
        ok("`subAgents` grant survived the save")

        # ---- run ----
        header("Run (delegate three independent questions)")
        started = client.execute_agent(
            orchestrator["id"], delegation_goal(worker["id"]))
        if started.get("_refused"):
            die("run refused before it started",
                str(started.get("error") or started.get("detail")))
        execution_id = started.get("execution_id") or started.get("id")
        if not execution_id:
            die("execute returned no execution_id", str(started)[:300])
        ok(f"execution {str(execution_id)[:8]} started")

        final = client.wait_for_execution(str(execution_id),
                                          timeout_s=args.timeout, poll_s=3)

        # A gated level pauses on the delegation call; answer it and let the run
        # continue. Looped because each approved batch can raise the next one.
        for _ in range(6):
            status_now = str((final or {}).get("status") or "").lower()
            if status_now != "paused":
                break
            if not approve_pending(client):
                break
            final = client.wait_for_execution(str(execution_id),
                                              timeout_s=args.timeout, poll_s=3)

        # ---- assert ----
        header("Verify (the record, not the reply)")
        found = assert_delegation(client, str(execution_id))

        header("Verify (each worker is a real, bounded run)")
        assert_child_records(client, found["children"])
        assert_worker_toolbox(client, found["children"], orchestrator["id"])

        if not args.skip_scope:
            check_delegation_scope(client, stamp, args)

        header("Result")
        ok(f"delegation proven: {len(found['children'])} workers ran under "
           f"execution {str(execution_id)[:8]}")
        print(f"\n  trace: GET {args.base}/api/logs/executions/{execution_id}/")

    except Failure as exc:
        print(f"\n  {FAIL} {exc}")
        result = 1
    except Exception as exc:  # noqa: BLE001 - report, then always clean up
        print(f"\n  {FAIL} {type(exc).__name__}: {exc}")
        result = 2
    finally:
        # Cleanup runs even on failure. A harness that can point at production
        # must not leave rows behind because an assertion tripped -- that is
        # exactly when someone stops paying attention to it.
        if created and not args.keep:
            header("Cleanup")
            for agent_id in created:
                try:
                    client.request("DELETE", f"/api/orchestrator/agents/{agent_id}/")
                    ok(f"deleted agent {agent_id}")
                except Exception as exc:  # noqa: BLE001
                    warn(f"could not delete agent {agent_id}: {exc}")
            print("\n  Runs are kept on purpose: they are the evidence, and they "
                  "cost nothing to leave.")
        elif created:
            header("Cleanup skipped (--keep)")
            print(f"  agents left behind: {created}")

    return result


if __name__ == "__main__":
    sys.exit(main())
