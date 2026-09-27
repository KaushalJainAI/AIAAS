# AIAAS — Short-Term Delivery Objectives

> Created 2026-08-21. Goal: **deliver a demo-able, deployed AIAAS as fast as possible** while
> applying for jobs. Principle: *simple systems, shipped* — every hour goes toward making the
> resume claims true and visible. Nothing outside this list gets touched.

---

## Phase 0 — Stop the bleeding (Day 1)

- [ ] **Commit everything.** The DAG-retirement refactor + extraction merge are uncommitted.
      One disk failure loses months. Commit in logical chunks, no perfectionism.
- [ ] Freeze scope: no new features, no refactors, no BrowserOS work until Phase 3 ships.

## Phase 1 — Make the core path work (Days 1–3)

Walk one path end-to-end locally; fix only what blocks it:

- [ ] Signup → login → create agent → chat with agent → agent runs with a granted tool
- [ ] HITL approval gate: sensitive tool call pauses → approve → continues; reject path works
- [ ] Delegation: an agent with `subAgents` grant fans out to one worker and returns
- [ ] Logs page shows run → turn → step for that run
- [ ] Schedule trigger fires once via `manage.py run_due_triggers`
- [ ] MCP connector: enable a curated server → agent calls one of its tools
- [ ] RAG: upload one document → agent answers from it
- [ ] Sandbox: `execute_python` runs once

**Rule:** anything broken that is NOT on this list gets noted and skipped.

## Phase 2 — Prove the claims (Days 4–5)

- [ ] Run existing e2e scripts (`Backend/tests/e2e/`: smoke, websocket) against local server;
      fix blockers only
- [ ] Run backend test suite (`pytest`); record pass/fail count — do not chase 100%
- [ ] Build the **claim checklist**: every resume bullet gets one working demo moment
      (see table below). Any claim that can't demo gets softened on the resume or fixed.

| Resume claim | Demo moment |
|---|---|
| LangGraph turn loop | Agent answers using a tool |
| Bounded delegation | Orchestrator fans out to workers |
| HITL approval gates | Approval prompt → approve/reject |
| Triggers | Scheduled agent run fires |
| Observability | Logs timeline of a run |
| MCP + credentials | Curated connector tool call |
| RAG | Answer cites uploaded doc |
| Sandbox | Python execution result |

## Phase 3 — Ship it (Days 6–8)

- [ ] Deploy via `docker-compose.prod.yml` to EC2 (reuse the NGU playbook:
      Postgres, Redis, Nginx, domain, HTTPS)
- [ ] Verify deployed URL end-to-end: login, one agent run, one approval gate
- [ ] Root README: what it is, architecture diagram (lift from `Backend/docs/`),
      screenshots/GIF of one run
- [ ] Record a 60–90s demo video (create agent → tool call → approval → logs)

## Phase 4 — Interview readiness (parallel, evenings)

- [ ] Deep-study 3 flows until you can whiteboard them without notes:
      agent turn loop, delegation budgeting, approval-gate two-pass design
- [ ] Rehearse the war story: `CurrentThreadExecutor` bug → `background.spawn()`
- [ ] Prepare the "why we retired the DAG compiler" answer
- [ ] 2–3 tests you can walk through line-by-line

---

## Explicitly deferred (do NOT touch)

BrowserOS polish · imagine app · extraction UI · skills/templates apps · guest chat ·
eval harness · Sentry/metrics · coverage targets · stale docs cleanup ·
`expose_webhook.py` removal (harmless dead file) · langchain/langgraph dependency pruning

## Definition of done

Deployed URL live + all 8 claim-checklist rows pass against it + README published +
demo video recorded. That state is enough to send the resume with confidence.
