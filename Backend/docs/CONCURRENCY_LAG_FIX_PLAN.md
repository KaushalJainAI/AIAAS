# Concurrency lag — record

## Status

**Phases 0–5 built 2026-09-24. Phase 6 (more than one process) is
conditional on post-deploy measurements and is deliberately not designed
yet.** The plan predates the move to the current GCP e2-medium box (2 vCPU,
4 GB, shared with the NGU project) — its "913 MB / t3.micro / 1 GB swap"
premise is stale; the DB-pool, checkpoint and loop-lag fixes were measured
in that context.

## What it delivered

- **Phase 0 — measure first.** `workflow_backend/loopwatch.py` logs
  `[Latency] loop-lag` and pool stats (`pool_size`, `pool_available`,
  `requests_waiting`, `requests_wait_ms`, `requests_errors`) once a minute.
- **Phase 1 — DB connections released at long waits (G1).** `spawn()`ed
  tasks no longer pin a pooled connection while waiting on a model; the
  scheduler, in-flight turns, SSE streams and agent runs stopped exhausting
  the pool for single users with 3 chats + a lead.
- **Phase 2 — Postgres checkpointer (G2).** `AGENT_CHECKPOINTER=postgres` —
  LangGraph super-steps no longer serialise the whole transcript through
  one SQLite writer on the event loop.
- **Phase 3 — slow work off the run's thread and the loop (G5, G6).**
  Downloads, image generation and office renders stopped blocking the
  shared `ThreadPoolExecutor(max_workers=1)`; Channels consumers use their
  own executor, not `single_thread_executor` for everything.
- **Phase 4 — chat checkpoint pruning (G7).** A sweep keeps the working set
  bounded on Postgres.
- **Phase 5 — the box (G4).** Config only (instance resize + `up -d`); it
  only helps once the server is actually resized.

## Decisions worth remembering

- **Measure before you fix, and record the numbers in the plan.** Phase 0
  exists because the plan came from reading code, not from box
  measurements.
- **Phases 1–2 are one deploy; they are expected to remove most of the
  lag.** DB-wait stalls look like a slow model, not like a pool timeout
  (they surface as stalls, never errors).
- **The loop-lag line is the direct answer to "is something blocking the
  loop?"** — G2 and G3 both showed up there.
- **Phase 3 is conditional**: only if loop-lag still spikes after Phase 2.

## Open

- **Phase 6 — more than one process (G3)** — only if post-Phase-5
  measurements call for it; not designed yet (needs the in-process state
  addressed first: `chat/turn/runs.py`, the steering mailbox,
  `agents/agent/tasks.py`).
- **Phase 5's benefit only lands once the server is resized** — until then
  the extra headroom is not there.
