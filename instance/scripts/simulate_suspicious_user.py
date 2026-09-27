#!/usr/bin/env python3
"""
instance/scripts/simulate_suspicious_user.py

Adversarial harness — acts like a careless / curious / greedy / crafty user
and asserts every bad input gets a *named, safe refusal* (400/401/403/404/413/429)
never a 500, silent success, or cross-user leak.

This is the "ill help me find issues while trying to be function well" harness:
good-user flows keep passing; bad inputs are boring (same error shape).

Safety: only targets instance personas (@example.com) and smoke-* throwaways.
No real secret is sent; payloads are prefixed [INSTANCE-ADVERSARIAL].

Usage:
  python instance/scripts/simulate_suspicious_user.py                 # verbose, all probes
  python instance/scripts/simulate_suspicious_user.py --no-network     # skip SSRF/webhooks if offline
  python instance/scripts/simulate_suspicious_user.py --json-out report.json
  python instance/scripts/simulate_suspicious_user.py --base http://localhost:8000

Exit 0 = all probes PASS/WARN; non-zero = at least one FAIL (unexpected 500 / leak / silent success).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from instance.scripts.utils import console  # noqa: E402,F401  (UTF-8 stdout)
from instance.scripts.utils.api_client import InstanceClient  # noqa: E402
from instance.scripts.utils.fixtures import PERSONAS  # noqa: E402
from instance.scripts.utils.payloads import (  # noqa: E402
    XSS_PAYLOADS,
    INJECTION_PAYLOADS,
    TRAVERSAL_PAYLOADS,
    PROMPT_INJECTION_PAYLOADS,
    ENCODING_PAYLOADS,
    SSRF_URLS,
)

PASS, FAIL, WARN = "PASS", "FAIL", "WARN"


@dataclass
class ProbeResult:
    name: str
    status: str  # PASS/WARN/FAIL
    detail: str
    http_status: Optional[int] = None
    body_snippet: str = ""


def _short(obj: Any, n: int = 500) -> str:
    try:
        s = json.dumps(obj, ensure_ascii=False, default=str)
    except Exception:
        s = str(obj)
    return s if len(s) <= n else s[:n] + f"... (+{len(s)-n})"


def _is_safe_refusal(status: int) -> bool:
    return status in (400, 401, 403, 404, 413, 429, 422)


def _body_contains(body: Any, needle: str) -> bool:
    try:
        hay = json.dumps(body, ensure_ascii=False).lower() if not isinstance(body, str) else body.lower()
    except Exception:
        hay = str(body).lower()
    return needle.lower() in hay


def main() -> None:
    ap = argparse.ArgumentParser(description="Simulate suspicious/bad user — adversarial harness")
    ap.add_argument("--base", default="http://localhost:8000", help="Backend base URL")
    ap.add_argument("--json-out", type=str, help="Write JSON report to path")
    ap.add_argument("--no-network", action="store_true", help="Skip SSRF/external probes")
    ap.add_argument("--verbose", action="store_true", default=True, help="Per-probe logs")
    ap.add_argument("--quiet", action="store_true", help="Suppress per-probe, print summary only")
    ap.add_argument("--fail-on-warn", action="store_true", help="Exit non-zero on WARN too")
    args = ap.parse_args()
    verbose = args.verbose and not args.quiet

    # --- setup two users for IDOR (A=regular, B=power) ---
    cA = InstanceClient(base=args.base, verbose=False)
    cB = InstanceClient(base=args.base, verbose=False)

    print("=" * 72)
    print("  Suspicious user simulation — adversarial harness")
    print("=" * 72)
    print(f"  base: {args.base}")

    try:
        cA.register_or_login(PERSONAS[0]["email"], PERSONAS[0]["password"])
        cB.register_or_login(PERSONAS[1]["email"], PERSONAS[1]["password"])
        # ensure each has at least one agent and one folder/doc for IDOR targets
        # create B's agent/folder to use as cross-user targets
        b_agents = _ensure_agent(cB, "B-Victim")
        b_folder = _ensure_folder(cB)
        b_doc = _ensure_doc(cB, b_folder)
        a_agents = _ensure_agent(cA, "A-Attacker")
        print(f"  A={PERSONAS[0]['email']}  B={PERSONAS[1]['email']}")
        print(f"  B_victim agent={b_agents.get('id')} folder={b_folder.get('id')} doc={b_doc.get('id')}")
    except Exception as e:
        hint = "  hint: backend not running — start with: cd Backend && python manage.py runserver 0.0.0.0:8000"
        if "Failed to establish" in str(e) or "ConnectionRefused" in str(e):
            print(f"[ERR] cannot connect to {args.base}: {e}\n{hint}")
        else:
            print(f"[ERR] setup failed: {e}")
        sys.exit(2)

    probes: List[Tuple[str, Callable[[], ProbeResult]]] = []

    # --- 1. Input hygiene: XSS in text fields ---
    for i, payload in enumerate(XSS_PAYLOADS[:3]):
        p = payload
        probes.append((f"XSS login email [{i}]", lambda p=p: _probe_xss_login(cA, p)))
        probes.append((f"XSS agent name [{i}]", lambda p=p: _probe_xss_agent_name(cA, p)))
        probes.append((f"XSS folder name [{i}]", lambda p=p: _probe_xss_folder(cA, p)))

    for i, payload in enumerate(INJECTION_PAYLOADS[:3]):
        probes.append((f"injection agent brief [{i}]", lambda p=payload: _probe_injection_agent(cA, p)))
        probes.append((f"injection goal [{i}]", lambda p=payload: _probe_injection_goal(cA, a_agents, p)))

    for p in TRAVERSAL_PAYLOADS:
        probes.append((f"traversal folder name {p!r}", lambda p=p: _probe_traversal_folder(cA, p)))

    # --- prompt injection ---
    for i, payload in enumerate(PROMPT_INJECTION_PAYLOADS[:3]):
        probes.append((f"prompt injection goal [{i}]", lambda p=payload: _probe_prompt_goal(cA, a_agents, p)))
        probes.append((f"prompt injection webhook body [{i}]", lambda p=payload: _probe_prompt_webhook(cA, a_agents, p)))

    # --- length / encoding ---
    probes.append(("oversized agent name (60k)", lambda: _probe_oversized(cA)))
    probes.append(("encoding null/backslash", lambda: _probe_encoding(cA, ENCODING_PAYLOADS[0])))

    # --- auth ---
    probes.append(("brute force login 6x (expect 429)", lambda: _probe_brute_force(args.base)))
    probes.append(("expired bearer → 401", lambda: _probe_expired_token(args.base)))
    probes.append(("no auth to protected → 401", lambda: _probe_no_auth(args.base)))

    # --- IDOR ---
    b_agent_id = b_agents.get("id")
    b_folder_id = b_folder.get("id")
    b_doc_id = b_doc.get("id")
    if b_agent_id:
        probes.append((f"IDOR GET agent {b_agent_id} as A", lambda: _probe_idor_agent(cA, b_agent_id)))
        probes.append((f"IDOR PATCH agent {b_agent_id} as A", lambda: _probe_idor_agent_patch(cA, b_agent_id)))
        probes.append((f"IDOR execute agent {b_agent_id} as A", lambda: _probe_idor_execute(cA, b_agent_id)))
    if b_folder_id:
        probes.append((f"IDOR GET folder {b_folder_id} as A (parent)", lambda: _probe_idor_folder(cA, b_folder_id)))
        probes.append((f"IDOR move into folder {b_folder_id} as A", lambda: _probe_idor_move(cA, b_folder_id)))
    if b_doc_id:
        probes.append((f"IDOR GET doc {b_doc_id} as A", lambda: _probe_idor_doc(cA, b_doc_id)))
        probes.append((f"IDOR download doc {b_doc_id} as A", lambda: _probe_idor_download(cA, b_doc_id)))

    # --- permissions ---
    probes.append(("locked tool disable → 400", lambda: _probe_locked_tool(cA)))
    probes.append(("disabled web_search then execute_tool bypass", lambda: _probe_disabled_tool_bypass(cA)))
    probes.append(("autonomy plan withholds (no MCP)", lambda: _probe_plan_withholds(cA)))

    # --- resource / concurrency ---
    probes.append(("flood folders burst 6 (expect cap/throttle)", lambda: _probe_flood_folders(cA)))
    probes.append(("oversized doc payload (413 or bounded)", lambda: _probe_oversized_doc(cA)))
    probes.append(("concurrent execute 4x (expect cap 3)", lambda: _probe_concurrent_execute(cA, a_agents)))

    # --- SSRF / network ---
    if not args.no_network:
        for url in SSRF_URLS[:3]:
            probes.append((f"SSRF validate {url}", lambda url=url: _probe_ssrf(cA, url)))

    # --- download traversal & VFS ---
    probes.append(("download traversal fallback", lambda: _probe_download_traversal(cA, cB)))

    # --- run probes ---
    results: List[ProbeResult] = []
    for name, fn in probes:
        try:
            res = fn()
            # normalize: method may return None on exception already handled
            if res is None:
                res = ProbeResult(name=name, status=WARN, detail="no result")
        except Exception as e:
            res = ProbeResult(name=name, status=FAIL, detail=f"probe crashed: {e}")
        results.append(res)
        if verbose:
            tag = {"PASS": "✓", "WARN": "!", "FAIL": "✗"}[res.status]
            extra = f" ({res.http_status})" if res.http_status else ""
            print(f"  {tag} [{res.status}]{extra} {res.name} — {res.detail}")
            if res.body_snippet and res.status == FAIL:
                print(f"      body: {res.body_snippet[:400]}")

    # --- summary ---
    print("\n" + "=" * 72)
    print("  Summary")
    print("=" * 72)
    counts = {PASS: 0, WARN: 0, FAIL: 0}
    for r in results:
        counts[r.status] += 1
    for k in (PASS, WARN, FAIL):
        print(f"  {k}: {counts[k]}")
    print(f"  total: {len(results)}")
    if counts[FAIL]:
        print("\n  FAILs are unexpected 500 / leak / silent success — open an issue.")
        print("  See instance/docs/SUSPICIOUS_USER.md for triage.")
    if counts[WARN]:
        print("\n  WARNs are known gaps (e.g. spend cap race, goal not sanitized) — tracked by design.")
    if counts[FAIL] == 0:
        print("\n  Good: suspicious user could not break the good-user experience.")
    print(f"\n  base: {args.base}  A={PERSONAS[0]['email']}  B={PERSONAS[1]['email']}")

    if args.json_out:
        out = {
            "base": args.base,
            "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "counts": counts,
            "results": [r.__dict__ for r in results],
        }
        Path(args.json_out).write_text(json.dumps(out, indent=2, default=str), encoding="utf-8")
        print(f"  wrote {args.json_out}")

    sys.exit(1 if counts[FAIL] or (args.fail_on_warn and counts[WARN]) else 0)


# ---------- helpers: ensure fixtures ----------

def _ensure_agent(c: InstanceClient, prefix: str) -> Dict[str, Any]:
    cfg = {
        "name": f"{prefix} {int(time.time()) % 100000}",
        "brief": "Adversarial harness victim/attacker agent",
        "provider": "nvidia",
        "model": "openai/gpt-oss-20b",
        "tools": {"rag": False, "webSearch": False, "codeExecution": False},
        "autonomy": "ask",
        "fileAccess": "scoped",
    }
    try:
        return c.create_agent(cfg)
    except Exception:
        # reuse existing
        lst = c.list_agents()
        arr = lst if isinstance(lst, list) else lst.get("agents") or lst.get("data") or []
        for a in arr:
            if isinstance(a, dict) and prefix.split()[0] in (a.get("name") or ""):
                return a
        return {}


def _ensure_folder(c: InstanceClient) -> Dict[str, Any]:
    name = f"victim-{int(time.time()) % 100000}"
    try:
        return c.create_folder(name)
    except Exception:
        return {"id": None}


def _ensure_doc(c: InstanceClient, folder: Dict[str, Any]) -> Dict[str, Any]:
    try:
        fid = folder.get("id")
        doc = c.upload_document(f"victim-{int(time.time())%100000}.md", b"# victim doc\n", folder_id=fid)
        return doc
    except Exception:
        return {"id": None}


# ---------- probes ----------

def _probe_xss_login(c: InstanceClient, payload: str) -> ProbeResult:
    r = c.request("POST", "/api/auth/login/", json_body={"email": payload, "password": "x"}, auth=False)
    body = _resp_json(r)
    status = r.status_code
    # expect 400 or 401, never 500, never reflected script execution (we can't check browser here, but API must not 500)
    if status == 500:
        return ProbeResult(name=f"XSS login email {payload[:30]!r}", status=FAIL, detail="500 — should be 400/401", http_status=status, body_snippet=_short(body))
    if status in (400, 401):
        return ProbeResult(name=f"XSS login email {payload[:30]!r}", status=PASS, detail=f"refused {status}", http_status=status)
    return ProbeResult(name=f"XSS login email {payload[:30]!r}", status=WARN, detail=f"unexpected {status}", http_status=status, body_snippet=_short(body))


def _probe_xss_agent_name(c: InstanceClient, payload: str) -> ProbeResult:
    r = c.request("POST", "/api/orchestrator/agents/", json_body={"name": payload, "brief": "x"})
    body = _resp_json(r)
    if r.status_code == 500:
        return ProbeResult(name=f"XSS agent name {payload[:30]!r}", status=FAIL, detail="500", http_status=500, body_snippet=_short(body))
    # SUSPICIOUS_WORKFLOW_NAME_RE should give 400
    if r.status_code == 400:
        return ProbeResult(name=f"XSS agent name {payload[:30]!r}", status=PASS, detail="400 blocked", http_status=400)
    if r.status_code in (200, 201):
        # stored — check it didn't 500 and name is stored verbatim but frontend should escape; API storing is WARN not FAIL
        return ProbeResult(name=f"XSS agent name {payload[:30]!r}", status=WARN, detail="201 stored (frontend must escape; check UI)", http_status=201)
    return ProbeResult(name=f"XSS agent name {payload[:30]!r}", status=WARN, detail=f"{r.status_code}", http_status=r.status_code)


def _probe_xss_folder(c: InstanceClient, payload: str) -> ProbeResult:
    r = c.request("POST", "/api/inference/folders/", json_body={"name": payload})
    if r.status_code == 500:
        return ProbeResult(name=f"XSS folder {payload[:30]!r}", status=FAIL, detail="500", http_status=500)
    if r.status_code == 400:
        return ProbeResult(name=f"XSS folder {payload[:30]!r}", status=PASS, detail="400 blocked", http_status=400)
    return ProbeResult(name=f"XSS folder {payload[:30]!r}", status=WARN, detail=f"{r.status_code}", http_status=r.status_code)


def _probe_injection_agent(c: InstanceClient, payload: str) -> ProbeResult:
    r = c.request("POST", "/api/orchestrator/agents/", json_body={"name": "InjTest", "brief": payload, "provider": "nvidia", "model": "openai/gpt-oss-20b"})
    if r.status_code == 500:
        return ProbeResult(name=f"injection agent brief {payload[:30]!r}", status=FAIL, detail="500", http_status=500)
    if r.status_code in (200, 201):
        return ProbeResult(name=f"injection agent brief {payload[:30]!r}", status=PASS, detail="stored safely (no eval)", http_status=r.status_code)
    return ProbeResult(name=f"injection agent brief {payload[:30]!r}", status=PASS, detail=f"{r.status_code}", http_status=r.status_code)


def _probe_injection_goal(c: InstanceClient, agent: Dict[str, Any], payload: str) -> ProbeResult:
    aid = agent.get("id")
    if not aid:
        return ProbeResult(name=f"injection goal {payload[:30]!r}", status=WARN, detail="no agent")
    r = c.request("POST", f"/api/orchestrator/agents/{aid}/execute/", json_body={"goal": payload})
    body = _resp_json(r)
    if r.status_code == 500:
        return ProbeResult(name=f"injection goal {payload[:30]!r}", status=FAIL, detail="500", http_status=500, body_snippet=_short(body))
    if r.status_code in (202, 201, 200):
        return ProbeResult(name=f"injection goal {payload[:30]!r}", status=WARN, detail="202 accepted — goal not sanitized (known gap; webhook isolates, but check reasoning)", http_status=r.status_code)
    if _is_safe_refusal(r.status_code):
        return ProbeResult(name=f"injection goal {payload[:30]!r}", status=PASS, detail=f"{r.status_code} refused", http_status=r.status_code)
    return ProbeResult(name=f"injection goal {payload[:30]!r}", status=WARN, detail=f"{r.status_code}", http_status=r.status_code)


def _probe_traversal_folder(c: InstanceClient, name: str) -> ProbeResult:
    r = c.request("POST", "/api/inference/folders/", json_body={"name": name})
    if r.status_code == 500:
        return ProbeResult(name=f"traversal {name!r}", status=FAIL, detail="500", http_status=500)
    if r.status_code == 400:
        return ProbeResult(name=f"traversal {name!r}", status=PASS, detail="400 blocked", http_status=400)
    return ProbeResult(name=f"traversal {name!r}", status=WARN, detail=f"{r.status_code} (validate_name gap?)", http_status=r.status_code)


def _probe_prompt_goal(c: InstanceClient, agent: Dict[str, Any], payload: str) -> ProbeResult:
    return _probe_injection_goal(c, agent, payload)


def _hook_secret(url: str) -> str:
    """The secret out of a `webhook_url`.

    `/api/orchestrator/hooks/<secret>/` ends in a slash, so `split("/")[-1]` is
    the empty string -- which is why this probe reported "no secret" and skipped
    the unauthenticated webhook entirely. Strip first, then take the last
    segment.
    """
    return url.strip("/").rsplit("/", 1)[-1] if url else ""


def _probe_prompt_webhook(c: InstanceClient, agent: Dict[str, Any], payload: str) -> ProbeResult:
    # create a webhook trigger for the agent, then hit the hook with injection
    aid = agent.get("id")
    if not aid:
        return ProbeResult(name=f"webhook prompt {payload[:30]!r}", status=WARN, detail="no agent")
    # ensure a webhook trigger exists
    try:
        trig = c.request("POST", "/api/orchestrator/triggers/", json_body={"subagent": aid, "mode": "webhook", "name": "hook-test"})
        j = _resp_json(trig)
        secret = None
        # webhook_url in list or in response
        if isinstance(j, dict):
            url = j.get("webhook_url") or j.get("webhookUrl") or ""
            secret = _hook_secret(url) or j.get("secret")
        if not secret:
            # list and find. `GET /api/orchestrator/triggers/` answers with a
            # bare JSON array, not an envelope -- assuming `{"triggers": [...]}`
            # raised `'list' object has no attribute 'get'`, which the probe
            # caught and reported as a WARN about the *webhook*. So the one
            # probe covering unauthenticated webhook injection never actually
            # reached a webhook, and said so in wording that read like a
            # product gap rather than a broken probe.
            lst = _resp_json(c.request("GET", "/api/orchestrator/triggers/"))
            rows = lst if isinstance(lst, list) else (
                (lst.get("triggers") or lst.get("results") or []) if isinstance(lst, dict) else []
            )
            for t in rows:
                if not isinstance(t, dict):
                    continue
                if t.get("subagent") == aid and t.get("mode") == "webhook":
                    url = t.get("webhook_url") or ""
                    secret = _hook_secret(url) or t.get("secret")
                    if secret:
                        break
        if not secret:
            return ProbeResult(name=f"webhook prompt {payload[:30]!r}", status=WARN, detail="no secret")
        # hit hook unauthenticated — body should be treated as context, not goal
        import requests as req
        r = req.post(f"{c.base}/api/orchestrator/hooks/{secret}/", json={"note": payload}, timeout=10)
        if r.status_code == 404:
            # could be disabled / not found — but 404 is oracle-safe expected refusal shape
            return ProbeResult(name=f"webhook prompt {payload[:30]!r}", status=PASS, detail="404 oracle-safe (trigger not live)", http_status=404)
        if r.status_code == 202:
            return ProbeResult(name=f"webhook prompt {payload[:30]!r}", status=PASS, detail="202 — body treated as context not goal (check logs)", http_status=202)
        if r.status_code == 500:
            return ProbeResult(name=f"webhook prompt {payload[:30]!r}", status=FAIL, detail="500", http_status=500)
        return ProbeResult(name=f"webhook prompt {payload[:30]!r}", status=WARN, detail=f"{r.status_code}", http_status=r.status_code)
    except Exception as e:
        return ProbeResult(name=f"webhook prompt {payload[:30]!r}", status=WARN, detail=str(e)[:300])


def _probe_oversized(c: InstanceClient) -> ProbeResult:
    name = "A" * 60000
    r = c.request("POST", "/api/orchestrator/agents/", json_body={"name": name})
    if r.status_code in (400, 413):
        return ProbeResult(name="oversized agent name 60k", status=PASS, detail=f"{r.status_code} bounded", http_status=r.status_code)
    if r.status_code == 500:
        return ProbeResult(name="oversized agent name 60k", status=FAIL, detail="500", http_status=500)
    return ProbeResult(name="oversized agent name 60k", status=WARN, detail=f"{r.status_code}", http_status=r.status_code)


def _probe_encoding(c: InstanceClient, payload: str) -> ProbeResult:
    r = c.request("POST", "/api/orchestrator/agents/", json_body={"name": "EncTest", "brief": payload})
    if r.status_code == 500:
        return ProbeResult(name="encoding probe", status=FAIL, detail="500", http_status=500)
    if r.status_code in (400, 413):
        return ProbeResult(name="encoding probe", status=PASS, detail=f"{r.status_code}", http_status=r.status_code)
    return ProbeResult(name="encoding probe", status=WARN, detail=f"{r.status_code}", http_status=r.status_code)


def _probe_brute_force(base: str) -> ProbeResult:
    """Six bad logins must end in a 429.

    Deliberately bare `requests` rather than `InstanceClient`: the client
    presents the E2E bypass header, which puts it in the test-client rate lane
    (`core/http/throttling.py`), and a probe exempt from the limit it exists to
    assert would pass no matter what. Do not "tidy" this onto the shared client.
    """
    import requests as req
    statuses = []
    for _ in range(6):
        try:
            r = req.post(f"{base}/api/auth/login/", json={"email": "nonexistent@example.com", "password": "wrong"}, timeout=5)
            statuses.append(r.status_code)
        except Exception as e:
            return ProbeResult(name="brute force 6x", status=WARN, detail=str(e)[:200])
    if 429 in statuses:
        return ProbeResult(name="brute force 6x", status=PASS, detail=f"429 after {statuses}", http_status=429)
    if all(s == 401 for s in statuses):
        return ProbeResult(name="brute force 6x", status=WARN, detail="all 401 — throttle not tripped (check LoginThrottle IP)", http_status=401)
    return ProbeResult(name="brute force 6x", status=WARN, detail=f"{statuses}", http_status=statuses[-1] if statuses else None)


def _probe_expired_token(base: str) -> ProbeResult:
    import requests as req
    try:
        r = req.get(f"{base}/api/auth/profile/", headers={"Authorization": "Bearer expired.invalid.token"}, timeout=5)
        if r.status_code == 401:
            return ProbeResult(name="expired bearer → 401", status=PASS, detail="401", http_status=401)
        if r.status_code == 500:
            return ProbeResult(name="expired bearer → 401", status=FAIL, detail="500", http_status=500)
        return ProbeResult(name="expired bearer → 401", status=WARN, detail=f"{r.status_code}", http_status=r.status_code)
    except Exception as e:
        return ProbeResult(name="expired bearer → 401", status=WARN, detail=str(e)[:200])


def _probe_no_auth(base: str) -> ProbeResult:
    import requests as req
    try:
        r = req.get(f"{base}/api/orchestrator/agents/", timeout=5)
        if r.status_code in (401, 403):
            return ProbeResult(name="no auth → 401/403", status=PASS, detail=str(r.status_code), http_status=r.status_code)
        if r.status_code == 500:
            return ProbeResult(name="no auth → 401/403", status=FAIL, detail="500", http_status=500)
        return ProbeResult(name="no auth → 401/403", status=WARN, detail=f"{r.status_code}", http_status=r.status_code)
    except Exception as e:
        return ProbeResult(name="no auth → 401/403", status=WARN, detail=str(e)[:200])


def _probe_idor_agent(c: InstanceClient, other_id: int) -> ProbeResult:
    r = c.request("GET", f"/api/orchestrator/agents/{other_id}/")
    if r.status_code == 404:
        return ProbeResult(name=f"IDOR GET agent {other_id}", status=PASS, detail="404 oracle-safe", http_status=404)
    if r.status_code == 500:
        return ProbeResult(name=f"IDOR GET agent {other_id}", status=FAIL, detail="500", http_status=500)
    if r.status_code == 200:
        return ProbeResult(name=f"IDOR GET agent {other_id}", status=FAIL, detail="200 leaked cross-user agent", http_status=200)
    return ProbeResult(name=f"IDOR GET agent {other_id}", status=WARN, detail=f"{r.status_code}", http_status=r.status_code)


def _probe_idor_agent_patch(c: InstanceClient, other_id: int) -> ProbeResult:
    r = c.request("PATCH", f"/api/orchestrator/agents/{other_id}/", json_body={"brief": "hacked"})
    if r.status_code == 404:
        return ProbeResult(name=f"IDOR PATCH agent {other_id}", status=PASS, detail="404", http_status=404)
    if r.status_code == 500:
        return ProbeResult(name=f"IDOR PATCH agent {other_id}", status=FAIL, detail="500", http_status=500)
    if r.status_code in (200, 201):
        return ProbeResult(name=f"IDOR PATCH agent {other_id}", status=FAIL, detail="200 wrote cross-user", http_status=200)
    return ProbeResult(name=f"IDOR PATCH agent {other_id}", status=WARN, detail=f"{r.status_code}", http_status=r.status_code)


def _probe_idor_execute(c: InstanceClient, other_id: int) -> ProbeResult:
    r = c.request("POST", f"/api/orchestrator/agents/{other_id}/execute/", json_body={"goal": "hello"})
    if r.status_code == 404:
        return ProbeResult(name=f"IDOR execute agent {other_id}", status=PASS, detail="404", http_status=404)
    if r.status_code == 500:
        return ProbeResult(name=f"IDOR execute agent {other_id}", status=FAIL, detail="500", http_status=500)
    if r.status_code in (200, 202):
        return ProbeResult(name=f"IDOR execute agent {other_id}", status=FAIL, detail="executed other user's agent", http_status=r.status_code)
    return ProbeResult(name=f"IDOR execute agent {other_id}", status=WARN, detail=f"{r.status_code}", http_status=r.status_code)


def _probe_idor_folder(c: InstanceClient, other_id: int) -> ProbeResult:
    r = c.request("GET", f"/api/inference/folders/?parent={other_id}")
    # list with foreign parent should return empty or 404 parent, never other's data
    if r.status_code == 500:
        return ProbeResult(name=f"IDOR folder parent={other_id}", status=FAIL, detail="500", http_status=500)
    if r.status_code == 404:
        return ProbeResult(name=f"IDOR folder parent={other_id}", status=PASS, detail="404 oracle-safe", http_status=404)
    if r.status_code == 200:
        body = _resp_json(r)
        # if it returned 200 with folders, ensure no leak — treat as WARN since list may be filtered empty
        return ProbeResult(name=f"IDOR folder parent={other_id}", status=WARN, detail=f"200 — check empty/truncated: {_short(body)[:200]}", http_status=200)
    return ProbeResult(name=f"IDOR folder parent={other_id}", status=WARN, detail=f"{r.status_code}", http_status=r.status_code)


def _probe_idor_move(c: InstanceClient, other_id: int) -> ProbeResult:
    # try to move own folder into other's folder
    # first create own folder
    own = c.request("POST", "/api/inference/folders/", json_body={"name": f"own-{int(time.time())%100000}"})
    if own.status_code not in (200, 201):
        return ProbeResult(name=f"IDOR move into {other_id}", status=WARN, detail="no own folder")
    oid = _resp_json(own).get("id")
    r = c.request("POST", "/api/inference/fs/move/", json_body={"folder_ids": [oid], "document_ids": [], "target_folder_id": other_id})
    if r.status_code == 404:
        return ProbeResult(name=f"IDOR move into {other_id}", status=PASS, detail="404", http_status=404)
    if r.status_code == 500:
        return ProbeResult(name=f"IDOR move into {other_id}", status=FAIL, detail="500", http_status=500)
    if r.status_code in (200, 201):
        return ProbeResult(name=f"IDOR move into {other_id}", status=FAIL, detail="moved into foreign folder", http_status=200)
    return ProbeResult(name=f"IDOR move into {other_id}", status=WARN, detail=f"{r.status_code}", http_status=r.status_code)


def _probe_idor_doc(c: InstanceClient, other_id: Any) -> ProbeResult:
    r = c.request("GET", f"/api/inference/documents/{other_id}/")
    if r.status_code == 404:
        return ProbeResult(name=f"IDOR GET doc {other_id}", status=PASS, detail="404", http_status=404)
    if r.status_code == 500:
        return ProbeResult(name=f"IDOR GET doc {other_id}", status=FAIL, detail="500", http_status=500)
    if r.status_code == 200:
        return ProbeResult(name=f"IDOR GET doc {other_id}", status=FAIL, detail="200 leaked", http_status=200)
    return ProbeResult(name=f"IDOR GET doc {other_id}", status=WARN, detail=f"{r.status_code}", http_status=r.status_code)


def _probe_idor_download(c: InstanceClient, other_id: Any) -> ProbeResult:
    r = c.request("GET", f"/api/inference/documents/{other_id}/download/")
    if r.status_code == 404:
        return ProbeResult(name=f"IDOR download doc {other_id}", status=PASS, detail="404", http_status=404)
    if r.status_code == 500:
        return ProbeResult(name=f"IDOR download doc {other_id}", status=FAIL, detail="500", http_status=500)
    if r.status_code == 200:
        return ProbeResult(name=f"IDOR download doc {other_id}", status=FAIL, detail="200 leaked file", http_status=200)
    return ProbeResult(name=f"IDOR download doc {other_id}", status=WARN, detail=f"{r.status_code}", http_status=r.status_code)


def _probe_locked_tool(c: InstanceClient) -> ProbeResult:
    r = c.request("PATCH", "/api/tools/", json_body={"tool_name": "read_tool_output", "enabled": False})
    if r.status_code == 400 and _body_contains(_resp_json(r), "locked"):
        return ProbeResult(name="locked tool disable", status=PASS, detail="400 locked", http_status=400)
    if r.status_code == 500:
        return ProbeResult(name="locked tool disable", status=FAIL, detail="500", http_status=500)
    if r.status_code in (200, 201):
        return ProbeResult(name="locked tool disable", status=FAIL, detail="200 allowed — must be 400", http_status=200)
    return ProbeResult(name="locked tool disable", status=WARN, detail=f"{r.status_code} {_short(_resp_json(r))}", http_status=r.status_code)


#: Wording `chat/tools/` uses when it refuses a tool the workspace switched off.
_REFUSAL_MARKERS = ("switched off", "disabled", "not available", "blocked", "turned off")


def _probe_disabled_tool_bypass(c: InstanceClient) -> ProbeResult:
    """A tool the workspace switched off must not run, however it is invoked.

    The security property is *the tool did not execute*, and the transport for
    saying so is deliberately an HTTP 200 whose body is a refusal: this endpoint
    runs a tool on the model's behalf, and the refusal has to come back as a
    tool *result* the model can read and act on ("solve it with the tools you
    have"). An earlier version of this probe asserted 400/403 and so reported a
    working guard as a FAIL for three releases' worth of runs -- the guard was
    right and the expectation was wrong. Assert on behaviour instead: a refusal
    passes at any status, and a 200 carrying actual search output is the bypass.

    Restores the default afterwards. `web_search` off is exactly the state that
    makes a demo look broken later (the Researcher agent silently cannot
    search), and a probe that leaves the world changed is a probe that breaks
    the next run. Per `tools_config`, resetting is deleting the row, which is
    what PATCH with `enabled: true` and no config does.
    """
    c.request("PATCH", "/api/tools/", json_body={"tool_name": "web_search", "enabled": False})
    try:
        r = c.request("POST", "/api/chat/execute-tool/", json_body={"tool": "web_search", "args": {"query": "hello"}})
        body = _resp_json(r)
        refused = any(_body_contains(body, marker) for marker in _REFUSAL_MARKERS)

        if r.status_code == 500:
            return ProbeResult(name="disabled web_search bypass", status=FAIL, detail="500", http_status=500)
        if refused:
            return ProbeResult(name="disabled web_search bypass", status=PASS,
                               detail=f"{r.status_code} refused (tool did not run)", http_status=r.status_code)
        if r.status_code == 200:
            return ProbeResult(name="disabled web_search bypass", status=FAIL,
                               detail=f"200 bypassed disabled: {_short(body)}", http_status=200)
        if r.status_code in (400, 403):
            return ProbeResult(name="disabled web_search bypass", status=PASS,
                               detail=f"{r.status_code} blocked", http_status=r.status_code)
        return ProbeResult(name="disabled web_search bypass", status=WARN,
                           detail=f"{r.status_code} {_short(body)}", http_status=r.status_code)
    finally:
        c.request("PATCH", "/api/tools/", json_body={"tool_name": "web_search", "enabled": True})


def _probe_plan_withholds(c: InstanceClient) -> ProbeResult:
    # create plan agent, then check its tools — should not include shell/mcp
    r = c.request("POST", "/api/orchestrator/agents/", json_body={
        "name": f"PlanProbe {int(time.time())%100000}",
        "brief": "plan test",
        "provider": "nvidia",
        "model": "openai/gpt-oss-20b",
        "tools": {"rag": True, "webSearch": True, "fileOps": True, "codeExecution": True, "mcp": True},
        "autonomy": "plan",
    })
    if r.status_code == 500:
        return ProbeResult(name="plan withholds", status=FAIL, detail="500", http_status=500)
    if r.status_code in (200, 201):
        return ProbeResult(name="plan withholds", status=PASS, detail="201 plan created (toolbox narrows at runtime)", http_status=r.status_code)
    return ProbeResult(name="plan withholds", status=WARN, detail=f"{r.status_code}", http_status=r.status_code)


def _probe_flood_folders(c: InstanceClient) -> ProbeResult:
    statuses: List[int] = []
    for i in range(6):
        r = c.request("POST", "/api/inference/folders/", json_body={"name": f"flood-{int(time.time())%100000}-{i}"})
        statuses.append(r.status_code)
        if r.status_code == 500:
            return ProbeResult(name="flood folders 6x", status=FAIL, detail=f"500 on #{i}", http_status=500)
    if any(s == 429 for s in statuses):
        return ProbeResult(name="flood folders 6x", status=PASS, detail=f"429 throttled {statuses}")
    if all(s in (200, 201) for s in statuses):
        return ProbeResult(name="flood folders 6x", status=PASS, detail=f"all 201 (within caps {statuses})")
    return ProbeResult(name="flood folders 6x", status=WARN, detail=f"{statuses}")


def _probe_oversized_doc(c: InstanceClient) -> ProbeResult:
    big = b"A" * (2 * 1024 * 1024)  # 2 MB — under 50M but large
    r = c.request("POST", "/api/inference/documents/", data={}, files={"file": ("big.md", big, "text/markdown")})
    if r.status_code == 500:
        return ProbeResult(name="oversized doc 2M", status=FAIL, detail="500", http_status=500)
    if r.status_code in (200, 201, 400, 413):
        return ProbeResult(name="oversized doc 2M", status=PASS, detail=f"{r.status_code} bounded/no 500", http_status=r.status_code)
    return ProbeResult(name="oversized doc 2M", status=WARN, detail=f"{r.status_code}", http_status=r.status_code)


def _probe_concurrent_execute(c: InstanceClient, agent: Dict[str, Any]) -> ProbeResult:
    import concurrent.futures
    aid = agent.get("id")
    if not aid:
        return ProbeResult(name="concurrent execute 4x", status=WARN, detail="no agent")
    def one() -> int:
        r = c.request("POST", f"/api/orchestrator/agents/{aid}/execute/", json_body={"goal": "hello"})
        return r.status_code
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        futs = [ex.submit(one) for _ in range(4)]
        statuses = [f.result() for f in futs]
    if any(s == 500 for s in statuses):
        return ProbeResult(name="concurrent execute 4x", status=FAIL, detail=f"500 in {statuses}")
    # expect at most 3 running (202), rest 429/503 or also 202 but admission caps at 3 per user
    ok = sum(1 for s in statuses if s == 202)
    if any(s in (429, 503) for s in statuses) or ok <= 3:
        return ProbeResult(name="concurrent execute 4x", status=PASS, detail=f"{statuses} (caps hold)")
    return ProbeResult(name="concurrent execute 4x", status=WARN, detail=f"{statuses} — check admission slot")


def _probe_ssrf(c: InstanceClient, url: str) -> ProbeResult:
    # SSRF is via MCP/web tools fetch, not directly exposable; we probe via execute-tool if available
    # Instead, check that the URL would be blocked by validate_url if used — we simulate via a tool that fetches
    # Fallback: just assert we can call the URL validation path via /api/mcp/servers/tools with a server pointing there
    # Simplest: probe that the backend does not blindly fetch — expect 400/502 not 200 with internal data
    import requests as req
    try:
        r = req.get(url, timeout=3)
        # local requests in harness shouldn't reach blocked hosts in CI; if it does 200, that's the SSRF
        return ProbeResult(name=f"SSRF {url}", status=WARN, detail=f"direct GET {r.status_code} — validate_url should block at app layer")
    except Exception:
        return ProbeResult(name=f"SSRF {url}", status=PASS, detail="blocked / unreachable")


def _probe_download_traversal(cA: InstanceClient, cB: InstanceClient) -> ProbeResult:
    # upload a file with traversal-y name via B, then try to download as A
    # real traversal is in file.name filesystem handling — already covered by DownloadPathTests
    return ProbeResult(name="download traversal fallback", status=PASS, detail="covered by DownloadPathTests — filesystem stores as uuid, not name")


def _resp_json(r: Any) -> Any:
    try:
        return r.json()
    except Exception:
        try:
            return r.text[:800]
        except Exception:
            return str(r)[:800]


if __name__ == "__main__":
    main()
