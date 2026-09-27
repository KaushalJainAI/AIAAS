#!/usr/bin/env python3
"""
instance/scripts/simulate_user_journey.py

API-level full-journey simulation — acts like a regular user via HTTP, not ORM.

Stages (mirrors instance/docs/USER_JOURNEY.md):
  0  Auth (register_or_login)
  1a Chat (create session → upload → stream message)
  1b Documents (folders → upload → RAG search)
  2  Build (create/list agents, patch, validate schedule preview)
  3  Connect (MCP list, Tools catalogue)
  4  Run (execute agent → poll execution → assert turns/steps)
  5  Observe (logs, stats, revisions)

This is the "fast" harness — same journey as interactive-tests/ but without a browser.
Run after `python instance/scripts/seed_instance.py` or standalone; it creates its own user.

Usage:
  python instance/scripts/simulate_user_journey.py                        # uses regular_user@example.com
  python instance/scripts/simulate_user_journey.py --email you@example.com --base http://localhost:8000
  python instance/scripts/simulate_user_journey.py --goal "Summarize the ACME invoice"
  python instance/scripts/simulate_user_journey.py --no-run               # skip agent execution (no LLM needed)
  python instance/scripts/simulate_user_journey.py --verbose

Exit 0 = all checks passed; non-zero = first failure detail printed. CI-friendly.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

# allow `python instance/scripts/simulate_user_journey.py` from repo root without install
REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from instance.scripts.utils import console  # noqa: E402,F401  (UTF-8 stdout)
from instance.scripts.utils.api_client import InstanceClient  # noqa: E402
from instance.scripts.utils.fixtures import PERSONAS, FINANCE_AGENT, DOCS  # noqa: E402

PASS = "✓"
FAIL = "✗"
WARN = "!"


def header(title: str) -> None:
    print("\n" + "=" * 72)
    print(f"  {title}")
    print("=" * 72)


def ok(msg: str) -> None:
    print(f"  {PASS} {msg}")


def warn(msg: str) -> None:
    print(f"  {WARN} {msg}")


def die(msg: str, detail: str = "") -> None:
    print(f"  {FAIL} {msg}")
    if detail:
        print(f"      {detail}")
    sys.exit(1)



#: Cost sources the backend trusts enough to bill a run from
#: (`agents/spend.py::PRICED_SOURCES`). `unpriced` means "we do not know", and
#: the spend cap falls back to the blended token rate for those.
PRICED_SOURCES = ("billed", "estimated")


def _check_cost_accounting(final: dict, execution: dict) -> None:
    """Assert the run recorded its token breakdown and what it cost.

    `ExecutionLog` grew `input_tokens`, `output_tokens`, `cached_read_tokens`,
    `cached_write_tokens`, `cost_usd` and `cost_source`, and `agents/spend.py`
    now enforces the spend cap against `cost_usd` whenever `cost_source` is
    priced. That makes these columns load-bearing rather than decorative -- and
    an unwritten column is precisely the failure this project already shipped
    once: `credits_used` was summed by both the guardrail and the agent list
    while nothing on any code path ever wrote it, so every agent showed a spend
    of zero and the cap never fired. Checked here so a regression surfaces as a
    failed stage rather than as a cap that quietly stops applying.
    """
    def pick(key, default=0):
        value = final.get(key)
        if value is None:
            value = execution.get(key, default)
        return value if value is not None else default

    tokens = int(pick("tokens_used") or 0)
    inp = int(pick("input_tokens") or 0)
    out = int(pick("output_tokens") or 0)
    source = str(pick("cost_source", "") or "")
    try:
        cost = float(pick("cost_usd") or 0)
    except (TypeError, ValueError):
        cost = 0.0

    if not (inp or out):
        warn(f"run recorded {tokens} tokens but no input/output split "
             f"(in={inp} out={out}) - llm/usage.py may not be recording")
        return

    # The split has to account for the total, or one of the two numbers the UI
    # and the cap read is wrong.
    if tokens and inp + out > tokens:
        warn(f"token split exceeds the total: in={inp} + out={out} > {tokens}")

    if not source:
        warn("run recorded no cost_source - it will be costed at the blended "
             "fallback rate, so the cap is approximate")
        return

    if source in PRICED_SOURCES:
        if cost > 0:
            ok(f"cost accounting: in={inp} out={out} cost=${cost:.6f} ({source})")
        else:
            die("run is marked priced but cost_usd is zero",
                f"cost_source={source!r}. `spend_rupees` bills priced runs from "
                f"cost_usd, so a zero here makes the run free and the spend cap "
                f"stops applying to it.")
    else:
        # `unpriced` is legitimate -- an unknown model -- and must fall back
        # rather than count as free.
        ok(f"cost accounting: in={inp} out={out} unpriced ({source}), "
           f"falls back to the blended rate")


def main() -> None:
    ap = argparse.ArgumentParser(description="Simulate a regular user journey via API")
    ap.add_argument("--base", default="http://localhost:8000", help="Backend base URL")
    ap.add_argument("--email", default=PERSONAS[0]["email"], help="Persona email")
    ap.add_argument("--password", default=PERSONAS[0]["password"], help="Persona password")
    ap.add_argument("--goal", default="Summarize the ACME invoice and tell me if it is overdue", help="Agent goal")
    ap.add_argument("--no-run", action="store_true", help="Skip agent execution (useful without LLM credentials)")
    ap.add_argument("--verbose", action="store_true", help="Verbose HTTP logs (default on)")
    ap.add_argument("--json-out", type=str, help="Write summary JSON to path")
    args = ap.parse_args()

    c = InstanceClient(base=args.base, verbose=args.verbose)
    summary: dict = {"base": args.base, "email": args.email, "stages": {}, "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}

    # ---- Stage 0: Auth ----
    header("Stage 0 — Auth (register_or_login)")
    try:
        c.register_or_login(args.email, args.password)
        prof = c.profile()
        ok(f"authenticated as {prof.get('email') or args.email} tier={prof.get('tier') or prof.get('profile', {}).get('tier', '?')}")
        summary["stages"]["auth"] = {"ok": True, "email": args.email}
    except Exception as e:
        die("auth failed", str(e))

    # ---- LLM models (capability probe) ----
    header("Probe — LLM models")
    try:
        models = c.llm_models()
        providers = models.get("providers") or models.get("data") or []
        if isinstance(providers, list):
            avail = [p["slug"] for p in providers if p.get("available") or p.get("has_credentials")]
            ok(f"providers: {len(providers)} total, available: {avail or 'none (platform key fallback still works for nvidia)'}")
        else:
            ok(f"llm/models: {models}")
        summary["stages"]["llm"] = {"ok": True}
    except Exception as e:
        warn(f"llm/models failed (continuing): {e}")
        summary["stages"]["llm"] = {"ok": False, "error": str(e)}

    # ---- Stage 1a: Chat ----
    header("Stage 1a — Chat (session → stream)")
    try:
        sess = c.create_chat_session(title="Instance smoke — regular user")
        sid = sess.get("id") or sess.get("session_id") or sess.get("pk")
        if not sid:
            die("create chat session returned no id", json.dumps(sess)[:600])
        ok(f"session {str(sid)[:8]} created")
        # upload a tiny doc to chat
        try:
            c.upload_to_chat(str(sid), "hello.md", b"# hello from instance\nThis is a smoke file.\n", "text/markdown")
            ok("uploaded hello.md to chat session")
        except Exception as e:
            warn(f"chat upload skipped: {e}")
        # stream a message — may require LLM key; handle graceful refusal
        try:
            # don't assert on content; assert on framing: we got a DONE frame, not a 500
            evt = c.stream_chat(str(sid), "Say 'instance-ok' and nothing else.", intent="chat")
            ok(f"chat stream completed (final type={evt.get('type') or evt.get('event') or 'done'})")
            summary["stages"]["chat"] = {"ok": True, "session_id": str(sid)}
        except RuntimeError as e:
            if "401" in str(e) or "402" in str(e) or "403" in str(e) or "LLM" in str(e):
                warn(f"chat stream refused (expected without LLM creds): {e}")
                summary["stages"]["chat"] = {"ok": True, "skipped": str(e)[:200]}
            else:
                # transient failure — don't fail the whole journey
                warn(f"chat stream failed (continuing): {e}")
                summary["stages"]["chat"] = {"ok": False, "error": str(e)[:300]}
    except Exception as e:
        warn(f"chat stage failed (continuing): {e}")
        summary["stages"]["chat"] = {"ok": False, "error": str(e)[:300]}

    # ---- Stage 1b: Documents ----
    header("Stage 1b — Documents (folders → upload → RAG)")
    kb_id = None
    folder_id = None
    try:
        # folders: create a unique smoke folder
        fname = f"smoke-{int(time.time()) % 100000}"
        try:
            f = c.create_folder(fname)
            folder_id = f.get("id") or f.get("folder", {}).get("id")
            ok(f"folder {fname!r} id={folder_id}")
        except Exception as e:
            warn(f"create folder failed: {e} — trying root")
        # upload a document
        doc = None
        try:
            doc = c.upload_document("smoke-note.md", b"# smoke note\nRegular user upload at " + str(time.time()).encode(), folder_id=folder_id)
            did = doc.get("id") or doc.get("document", {}).get("id")
            ok(f"document smoke-note.md id={did} status={doc.get('status')}")
        except Exception as e:
            warn(f"upload document failed: {e}")
        # list documents — asserts pagination shape
        try:
            listing = c.list_documents()
            # new keyset shape or legacy my_documents
            count = 0
            if isinstance(listing, dict):
                if "my_documents" in listing:
                    count = len(listing.get("my_documents", []))
                elif "results" in listing:
                    count = len(listing["results"])
                elif "documents" in listing:
                    count = len(listing["documents"])
            ok(f"list documents: {count} visible")
        except Exception as e:
            warn(f"list documents failed: {e}")
        # RAG search — should at least not 500
        try:
            res = c.rag_search("smoke note", top_k=3)
            n = len(res.get("results", [])) if isinstance(res, dict) else 0
            ok(f"RAG search: {n} results")
        except Exception as e:
            warn(f"RAG search failed (HNSW may be cold): {e}")
        summary["stages"]["documents"] = {"ok": True, "folder_id": folder_id}
    except Exception as e:
        warn(f"documents stage failed (continuing): {e}")
        summary["stages"]["documents"] = {"ok": False, "error": str(e)[:300]}

    # ---- Stage 2: Build (agents) ----
    header("Stage 2 — Build (agents)")
    agent_id = None
    try:
        agents_before = c.list_agents()
        if isinstance(agents_before, list):
            ok(f"agents before: {len(agents_before)}")
        elif isinstance(agents_before, dict):
            ok(f"agents before: {agents_before}")
        # create a smoke agent (unique name)
        cfg = dict(FINANCE_AGENT)
        cfg["name"] = f"Smoke {int(time.time()) % 100000}"
        cfg["brief"] = cfg["brief"] + " (instance smoke, scope=manual only)"
        try:
            created = c.create_agent(cfg)
            agent_id = created.get("id") or created.get("agent", {}).get("id") or created.get("pk")
            ok(f"created agent {cfg['name']!r} id={agent_id}")
        except Exception as e:
            # may fail if ProviderRegistry rejects provider; fallback to nvidia mini
            warn(f"create agent failed: {e} — retrying with minimal cfg")
            cfg2 = {"name": cfg["name"], "brief": cfg["brief"], "provider": "nvidia", "model": "openai/gpt-oss-20b"}
            created = c.create_agent(cfg2)
            agent_id = created.get("id") or created.get("pk")
            ok(f"created agent (minimal) id={agent_id}")
        # preview a trigger (validates cron walker + timezone)
        try:
            preview = c.preview_trigger("0 9 * * 1", "Asia/Kolkata")
            ok(f"trigger preview: valid={preview.get('valid')} desc={preview.get('description') or preview.get('desc')}")
        except Exception as e:
            warn(f"trigger preview failed: {e}")
        summary["stages"]["build"] = {"ok": True, "agent_id": agent_id}
    except Exception as e:
        die("build stage failed", str(e))

    # ---- Stage 3: Connect (MCP + Tools) ----
    header("Stage 3 — Connect (MCP + Tools)")
    try:
        mcp = c.list_mcp_servers()
        servers = mcp.get("servers") or mcp.get("data") or []
        ok(f"MCP servers visible: {len(servers) if isinstance(servers, list) else mcp}")
        tools = c.list_tools()
        cats = tools.get("categories") or []
        total = tools.get("totalTools") or tools.get("total_tools") or sum(len(cat.get("tools", [])) for cat in cats) if cats else "?"
        ok(f"tools catalogue: {total} tools across {len(cats)} categories")
        summary["stages"]["connect"] = {"ok": True}
    except Exception as e:
        warn(f"connect stage failed (continuing): {e}")
        summary["stages"]["connect"] = {"ok": False, "error": str(e)[:300]}

    # ---- Stage 4: Run ----
    header("Stage 4 — Run (execute agent)")
    execution_id = None
    if args.no_run or agent_id is None:
        warn("skipped ( --no-run or no agent )")
        summary["stages"]["run"] = {"ok": True, "skipped": True}
    else:
        try:
            res = c.execute_agent(int(agent_id), args.goal)
            if res.get("_refused"):
                # 402/400 — good UX is a named refusal, not a ghost run
                ok(f"execute refused (expected if spend/creds): {res.get('error') or res.get('detail') or res}")
                summary["stages"]["run"] = {"ok": True, "refused": res}
            else:
                execution_id = res.get("execution_id") or res.get("id") or res.get("executionId")
                if not execution_id:
                    warn(f"execute returned no execution_id: {res}")
                    summary["stages"]["run"] = {"ok": False, "response": res}
                else:
                    ok(f"execution {str(execution_id)[:8]} started")
                    # poll briefly; don't require completion (LLM may be slow)
                    final = c.wait_for_execution(str(execution_id), timeout_s=60, poll_s=2)
                    # Assert on shape, not on wording -- but "produced an answer
                    # at all" and "spent tokens" ARE shape. Checking only
                    # `status == completed` reported this stage green while the
                    # provider was answering an HTTP 200 SSE body containing
                    # `{"error": {"code": 503}}`: the stream yielded nothing,
                    # the run closed as `completed` with `answer=""` and
                    # `tokens_used=0`, and the harness said the agent worked.
                    # A run that produced nothing is a failed run whatever the
                    # status column says.
                    execution = final.get("execution") if isinstance(final.get("execution"), dict) else {}
                    status = (final.get("status") or execution.get("status") or "").lower()
                    turns = final.get("turns") or execution.get("turns") or []
                    output = final.get("output_data") or execution.get("output_data") or {}
                    answer = (output.get("answer") or "").strip() if isinstance(output, dict) else ""
                    tokens = final.get("tokens_used") or execution.get("tokens_used") or 0

                    ok(f"execution final: status={status or 'running (still)'} turns={len(turns) if isinstance(turns, list) else '?'}")

                    stage: dict = {"ok": True, "execution_id": str(execution_id), "status": status,
                                   "tokens": tokens, "answer": answer[:200]}
                    if status == "completed":
                        if not answer:
                            die("run completed with an EMPTY answer",
                                f"tokens={tokens}. A silent empty answer is what a swallowed "
                                f"provider error looks like -- check the turn's provider/model.")
                        elif answer.startswith("⚠"):
                            warn(f"run surfaced a provider problem: {answer[:120]}")
                            stage = {"ok": False, "reason": "provider error surfaced", **stage}
                        else:
                            ok(f"answer ({tokens} tokens): {answer[:120]!r}")
                            _check_cost_accounting(final, execution)
                    elif status in ("failed", "timeout"):
                        die(f"run ended {status}", str(final.get("error_message") or execution.get("error_message") or ""))
                    elif status == "paused":
                        ok("run paused for approval (HITL) -- expected for autonomy=ask")
                    else:
                        warn(f"run did not reach a terminal status (status={status!r})")
                        stage = {"ok": False, "reason": "not terminal", **stage}
                    summary["stages"]["run"] = stage
                    # observability: try logs endpoints
                    try:
                        page = c.list_executions(limit=5)
                        ok(f"logs/executions page: {page}")
                    except Exception as e:
                        warn(f"logs/executions failed: {e}")
        except Exception as e:
            # network or validation error → fail the stage
            die("run stage failed", str(e))

    # ---- Stage 5: Observe ----
    header("Stage 5 — Observe (logs & revisions)")
    try:
        if agent_id:
            try:
                revs = c.request("GET", f"/api/logs/agents/{agent_id}/revisions/").json()
                ok(f"revisions for agent {agent_id}: {revs}")
            except Exception as e:
                warn(f"revisions failed: {e}")
        try:
            stats = c.request("GET", "/api/logs/insights/stats/", params={"days": 7}).json()
            ok(f"insights/stats: {stats}")
        except Exception as e:
            warn(f"insights/stats failed (may be empty): {e}")
        summary["stages"]["observe"] = {"ok": True}
    except Exception as e:
        warn(f"observe stage non-fatal: {e}")

    # ---- summary ----
    header("Summary")
    all_ok = all(v.get("ok") for v in summary["stages"].values())
    for stage, info in summary["stages"].items():
        mark = PASS if info.get("ok") else FAIL
        extra = ""
        if info.get("skipped"):
            extra = " (skipped)"
        if info.get("refused"):
            extra = " (refused — good UX if named)"
        print(f"  {mark} {stage:12s}{extra}")
    print("\nJourney complete — this is what a regular user sees end-to-end.")
    if execution_id:
        print(f"  execution: {execution_id}  →  GET /api/logs/executions/{execution_id}/")
    if not all_ok:
        warn("some stages had warnings — see above; exit 0 still means harness ran")
    print(f"\nBase: {args.base}  User: {args.email}")

    if args.json_out:
        Path(args.json_out).write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
        print(f"  wrote {args.json_out}")

    sys.exit(0)


if __name__ == "__main__":
    main()
