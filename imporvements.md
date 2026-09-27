# MCP System — Issues & Suggested Improvements

Scope: `Backend/mcp_integration/` plus the permission/caching layers it depends on
(`chat/tools/permissions.py`, `chat/tools/tool_output.py`, the Connections UI in
`better-n8n-frontend/`). Written 2026-08-19; line numbers refer to that date.

Priority legend: **[HIGH]** = correctness/security/reliability risk now ·
**[MED]** = bites under real multi-user load · **[LOW]** = polish/ops hygiene.

---

## 1. Reliability & Concurrency

### 1.1 No timeout on `call_tool` — a hung server holds one user hostage
- **Where:** `mcp_integration/client.py:261` (`call_tool`). `list_tools` is wrapped
  in `asyncio.wait_for(..., timeout=5)` (`client.py:357`, `views.py:184`,
  `tool_provider.py:108`) but the actual tool **call** has no timeout anywhere.
- **Impact:** if an MCP server hangs mid-call, that user's session lock is held
  indefinitely; their next call to the *same server* waits on `entry.lock`
  (`client.py:149`) with no timeout either. One broken server = one stuck user
  per (server, user) pair. Also a DoS vector under load.
- **Fix:** add a `CALL_TOOL_TIMEOUT` (e.g. 30–60s) around `session.call_tool`, and a
  timeout on lock acquisition. On timeout, evict the session so the next call
  reconnects.
- **Priority:** **[HIGH]**

### 1.2 Pool is unbounded — subprocess count grows with (user × server)
- **Where:** `client.py:71` (`_pool`). Entries expire after `SESSION_TTL` (300s)
  but there is no cap: 50 users on the curated GitHub server = up to 50 live
  `node` subprocesses.
- **Impact:** memory/CPU scales linearly with distinct active (user, server) pairs;
  stdio servers are the expensive kind (`npx` fetches + node runtime).
- **Fix:** cap pool size with LRU eviction (close the least-recently-used entry
  beyond N). Optionally make the cap configurable per server.
- **Priority:** **[MED]**

### 1.3 Guest/anonymous users share one session per server
- **Where:** `client.py:119` — `_coerce_user_id(None)` → key `(server_id, None)`.
- **Impact:** every guest call to a server serializes on one session; a slow guest
  call blocks all other guests. No per-guest isolation.
- **Fix:** give guests a bounded per-session pool keyed by session/request id, or
  accept the serialization and document it. If guest surface grows, per-guest keys
  + a cap (see 1.2) are the better answer.
- **Priority:** **[MED]**

### 1.4 Pool is per-process
- **Where:** `client.py:71` — module-level in-memory dict.
- **Impact:** fine today (Dockerfile runs one `runserver` process), but multiple
  Uvicorn/gunicorn workers or a Celery worker would each open their own duplicate
  sessions to every server.
- **Fix:** document the assumption; if workers are ever added, move the pool behind
  a shared store or accept per-worker pools with the 5-min TTL as the churn bound.
- **Priority:** **[LOW]**

### 1.5 No retry on transient failures
- **Where:** `client.py:188-190`, `223-225` — failures just raise (and evict).
- **Impact:** a single dropped stdio handshake or SSE reconnect fails the whole
  turn even though the failure is transient.
- **Fix:** one bounded retry (e.g. 1 retry) for connection establishment and for
  idempotent/read-only tool calls; never retry state-changing calls.
- **Priority:** **[MED]**

### 1.6 Curated servers run unpinned `npx -y`
- **Where:** `migrations/0005_seed_curated_mcp_servers.py`, `0007_add_slack_server.py`
  — all `command="npx"` with `-y` and no package version.
- **Impact:** `npx -y` fetches the *latest* package each cold start; an upstream
  breaking change or compromised publish silently changes every deployed server.
- **Fix:** pin versions in the seed migrations (`npx -y pkg@1.2.3`) and add a
  freshness check (the `CuratedCatalogIntegrityTests` in
  `tests/test_credential_bridge.py` is the natural home for a "must be pinned"
  assertion).
- **Priority:** **[MED]**

---

## 2. Security

### 2.1 Command allowlist checks only `argv[0]` — args are unrestricted
- **Where:** `serializers.py:86-94`. The bare program must be an allowed launcher
  (`npx`, `node`, `bun`, `python`, `uv`, `pipx`, `docker`, …), but `args` is free
  text.
- **Impact:** `npx -y <arbitrary-package>` runs arbitrary third-party code inside
  the server process with the user's credentials in its env. For a single-tenant
  self-host this is the owner's own risk; if this ever serves untrusted users, any
  registered server is arbitrary code execution. `docker` in the allowlist is the
  same story with extra privileges.
- **Fix:** treat the args the same way the command is treated — reject suspicious
  patterns for user-registered servers, or drop `docker` from the open surface
  (curated servers can still use it via migration). At minimum, document that a
  user-registered stdio server is "run code on the host".
- **Priority:** **[HIGH]** (design decision to make, not necessarily code to write)

### 2.2 No sandbox/containment for stdio subprocesses
- **Where:** `client.py:172-190` (`_connect_stdio`); already flagged in
  `MCP_ARCHITECTURE.md` as a known gap.
- **Impact:** a stdio server sees the host filesystem, env, and network. The
  `RestrictedPython`/`wasmtime` sandbox only covers the `execute_python` tool.
- **Fix (big):** run stdio servers in per-server containers (docker/OCI) — the
  curated Filesystem server's `/tmp` argument is a fake boundary otherwise.
- **Priority:** **[MED]** — defer until multi-tenant; the current one-user-per-install
  deployment makes this an owner-risk trade-off.

### 2.3 No audit trail of MCP tool calls
- **Where:** nowhere. `call_tool` (`client.py:261`) neither logs nor persists
  "who called which tool with what arguments".
- **Impact:** no way to answer "what did the agent do with my Google account" after
  the fact — exactly the question a user asks when an agent runs with their keys.
- **Fix:** a small `MCPCallLog` model (user, server, tool name, args, status,
  duration, outcome); the agent UI can render it. Keep args redacted.
- **Priority:** **[MED]** (goes to the heart of "trust your agent with my creds")

### 2.4 Secrets can leak through error payloads and logs
- **Where:** `client.py:189`, `224` log with `logger.exception`; tool error results
  are re-raised verbatim (`client.py:269`) and can echo env or request content.
- **Impact:** a misbehaving server can surface a credential or internal value in a
  message the model (and UI) renders.
- **Fix:** a redaction helper (regex over known secret shapes + injected env names)
  applied to logged and surfaced payloads; avoid logging full `repr` of results.
- **Priority:** **[MED]**

### 2.5 Read-only exemption is a claim, not a proof
- **Where:** `chat/tools/permissions.py:56-70` — `looks_read_only` matches a verb
  prefix; `list_and_purge` passes as a read.
- **Impact:** by design (`MCP_ARCHITECTURE.md` documents the failure asymmetry), but
  worth stating: the guard narrows what runs unattended, it cannot be the last line
  of defense. The audit log (2.3) is the mitigation.
- **Priority:** **[LOW]** — documented trade-off, keep as is.

---

## 3. Operations & Observability

### 3.1 No per-server health/status signal beyond tool listing
- **Where:** `views.py:184` (list-tools with 5s timeout) and the frontend
  `validateCredentials` call are the only liveness checks.
- **Impact:** a server that connects but never answers tools, or errors on every
  call, looks "Connected" in the UI.
- **Fix:** add a lightweight `check` endpoint (initialize + one call or a ping) and
  surface last-seen / last-error on the server row; show stale state on the
  Connections page.
- **Priority:** **[MED]**

### 3.2 No metrics
- **Where:** none — pool hit/miss rate, evictions, timeouts, per-server latency are
  all invisible.
- **Impact:** performance regressions (e.g. every turn spawning subprocesses) are
  discovered by users, not monitors.
- **Fix:** counters on pool hits/misses, connection failures, timeouts, tool latency
  histogram; a `/api/mcp/metrics/` debug endpoint mirroring the debug endpoints
  already in `views.py`.
- **Priority:** **[LOW]**

### 3.3 Tool cache can serve stale tools for up to 2 minutes after disable
- **Where:** `tool_cache.py` — TTL 120s; `views.py:143` invalidates on preference
  change, but the wildcard path needs `delete_pattern` which LocMem (local dev) and
  some backends lack (`tool_cache.py:53-59`).
- **Impact:** a just-disabled server's tools can still be advertised on the agent
  turn; local dev relies on the TTL silently.
- **Fix:** on preference change also publish an invalidation event the current
  process honors (e.g. drop the key for that user via a direct delete loop), or
  filter by `effective_enabled` at read time as a belt-and-braces check.
- **Priority:** **[LOW]**

### 3.4 No per-user / per-server rate limiting on MCP calls
- **Where:** nothing in `mcp_integration/`; core throttling exists app-wide.
- **Impact:** a runaway agent loop can hammer an external API at the user's expense
  (real money on paid APIs).
- **Fix:** per-user, per-server rate limit / budget near `call_tool`; surface
  remaining budget the same way the LLM quota is surfaced today.
- **Priority:** **[MED]**

---

## 4. UX (frontend, `better-n8n-frontend/`)

### 4.1 `env` is write-only and round-trips silently
- **Where:** `serializers.py:28` (write-only `env`), fixed in the modal
  (`components/mcp/MCPServerModal.tsx` — blank + "leave blank to keep them" hint,
  `env` omitted from PATCH unless changed).
- **Status:** done for the modal. Follow-up: the Connections page "Test" flow and
  any other editor should get the same treatment so the surprise never returns.
- **Priority:** **[LOW]** — keep an eye out for the pattern in new code.

### 4.2 Required credentials vs. linked credentials can still disagree
- **Where:** modal auto-adds a linked credential to `required_credential_types`, but
  existing rows created before the fix may not match.
- **Fix:** on load, reconcile (add any linked type missing from required); the
  backend validation in `validate_credentials` catches the rest.
- **Priority:** **[LOW]**

---

## 5. Suggested roadmap (in order)

1. **[HIGH] 1.1** — timeout on `call_tool` + lock acquisition, evict on timeout.
2. **[HIGH] 2.1** — settle the user-registered-server trust boundary (args policy /
   drop `docker`), document it in `MCP_ARCHITECTURE.md`.
3. **[MED] 1.2 + 1.3** — pool cap with LRU; guest session strategy.
4. **[MED] 1.5** — bounded retry for connection + idempotent calls.
5. **[MED] 2.3** — `MCPCallLog` audit trail + agent-side view.
6. **[MED] 1.6** — pin curated `npx` versions in seed migrations + integrity test.
7. **[MED] 3.1 / 3.4** — per-server health signal; per-user call budget.
8. **[LOW]** — metrics, cache invalidation hardening, redaction helper.

---

## Verification notes

- Backend tests that cover this area and must stay green after any change:
  `python -m pytest mcp_integration tests/integration -q` (143 tests, 2026-08-19).
- Docs to keep in sync (per `CLAUDE.md`): `Backend/docs/MCP_ARCHITECTURE.md`,
  `Backend/docs/MCP_INTEGRATION.md`, `Backend/docs/API.md` (row 312 = `/api/mcp/servers/tools/`).