# Orchestrator latency — record

## Status

**Mostly shipped** (verified against the running container 2026-09-18).
`AGENT_CHECKPOINTER=postgres` is now production compose state, so the last
half of Phase 1 (the checkpointer on SQLite) is done. The instrument
`[Latency]` plus §3d's measurements disagree with this plan's original
profiling: tool discovery is 6–35 ms, and the dominant cost is provider
TTFT. Real production measurements exist; see below.

## What it delivered

- **Database migration.** Production runs **PostgreSQL**; `AgentTurn`,
  `AgentStep`, `ExecutionLog` and the LangGraph checkpointer all write to
  it. The old `input_data__thread_id=` JSON-path queries on the resume and
  approval paths were the most expensive interactive queries; `thread_id` is
  now an indexed column (`logs/0018` backfills paused rows first).
- **Tool catalogue floor.** `MCPToolCatalogue` (durable) behind the Redis
  cache: chain is **Redis → database → live handshake**; an empty listing is
  never stored. The connector pool is an LRU with a size cap
  (`MCP_MAX_POOLED_SESSIONS`, default 6) alongside the TTL.
- **Parallel dispatch.** Built-ins declare `parallel=True`; MCP calls
  overlap on `mcp_reads_only` (the same guess approval gating trusts);
  sensitive calls always stay serial. Companion web-search images prefetch
  in the same pass as the search: max(search, images), not the sum.
- **Effort tuning.** Middle loop iterations run one ladder rung below the
  chosen level; first and last stay at the user's choice. Ancillary calls
  (curation fold, follow-ups) pass `effort="none"`.
- **Admission limits env-configurable** (`RUNS_PER_USER_LIMIT`,
  `RUNS_TOTAL_LIMIT`, `ADMISSION_WAIT_SECONDS`).
- **Per-turn memoisation** of MCP descriptors; warm Redis cache with
  background refresh; `[Latency] pre-model` instrumentation.

## Production measurements (2026-09-18, six model calls in 24 h)

- `tools_ms` is 6–35 ms (n=59 descriptors) — never a problem.
- The pre-model segment is ~38 ms total (`preflight=5ms … vision_witness=9ms`)
  — not a problem.
- **`prompt=12003` for a one-line question, all connectors notwithstanding;
  the pre-model hang is provider-side TTFT** (2.0s, 2.6s, 3.2s, 3.7s, 4.2s,
  then 28.7s for `deepseek-v4.1-flash` via OpenRouter). No code phase fixes
  this — it is a provider/routing decision.
- **`cached=0(0%)` on every call** — something in the prefix moves between
  iterations (DeepSeek caches implicitly, so this is a real defect to chase:
  diff the serialized `it=0`/`it=1` requests), and we never send
  `cache_control` (so providers needing explicit breakpoints report zero by
  construction).
- Production runs **no stdio MCP servers** (`MCP_ALLOW_STDIO=False`); the
  cold-`npx` phases matter for local dev only.

## Decisions worth remembering

- **Check the runtime, not the repo.** A compose file in the tree is not
  evidence about a deployed box; read the container's own env.
- **The instrument is the product.** Extending `[Latency]` backwards over
  the pre-model segment is what cleared it of suspicion.
- **Tool discovery was cached all along** — measure before optimising.

## Open

- **Admission-wait telemetry in the run stream** (queued vs executing) —
  the one Phase-5 item not shipped.
- **`cached=0` prefix chase** — diff serialized requests between
  iterations and find what moves.
- **Phase 7 — on-demand loading with speculative warming** — open.
- **Phase 8 Problem B — speculative dispatch** — open.
- **Tool catalogue per-user vs shared question** — rows keyed
  `(server, user)` with a null-user row reserved; whether listings differ
  per user is unverified (a short experiment to run).
- **Phase-2 residue:** none known.
