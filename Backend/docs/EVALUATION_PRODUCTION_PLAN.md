# Evaluation — plan to production: record

## Status

**Implemented 2026-09-19 (code complete). Paid runs — baseline,
calibration, proof that the smoke deploy gate works — still need the
owner's go-ahead.** Written as an implementation brief; the phases ran in
the order of its §10.

## What it delivered

- **Phase 1 — plumbing.** `caller='eval'` on every eval run (excluded from
  the spend cap and stats; included in `by_caller['eval']` as real money);
  stale `running` sweeps closed by `eval/recovery.py`; sweep cancellation is
  cooperative (checked on the way out of the semaphore).
- **Phase 2 — a baseline.** `benchmark` management command; baselines
  accepted per suite+model (`benchmark accept`); the scorecard shows a
  vs-baseline column.
- **Phase 3 — check the checkers.** `eval_judgecalibration`; judge
  calibration against known labels; `disagreement` queues only
  judge-vs-deterministic splits and uncertain judges (`UNCERTAIN_BAND`
  0.35–0.65).
- **Phase 4 — catch regressions automatically.** `--tier smoke`, a deploy
  gate (guardrail suites hold 100%; capability suites compared against
  baseline with a tolerance), and the pre-build smoke gate in the deploy
  flow.
- **Phase 5 — capture judgement.** One notification per run (never one per
  result); disagreement queue; human-verdict overrides without
  overwriting (`auto_passed` kept, `final_*` computed).
- **Phase 6 — a bad run becomes a test.** Failed run → `EvalCase` seeding;
  eval traces tied to `ExecutionLog`.
- **Phase 8 — external data and benchmarks.** Adapters for public datasets,
  never committed; guardrail suites at 100% bar (`eval/benchmarks/suites/`).
- **`mode='bare'`** — the platform-tax control: one bare `llm.complete` per
  case, no tools, no `ExecutionLog`.
- **Scoring is 0–100** (`score_100`, `final_score_100`, `auto_score_100`);
  guardrail / hallucination / out-of-scope results carry `flags`.

## Decisions worth remembering

- **One door.** Every eval case runs the agent through the same
  `run_agent` users go through. The only exception is the bare control,
  which exists precisely to measure the difference.
- **Deterministic first, judge second.** A judge never decides a case
  alone and fails closed; the judge is never the agent's model.
- **A number that can still move is not final** — `awaiting_review` stays.
- **A human verdict overrides without overwriting.**
- **Money asks first.** Any command that calls a real model needs the
  owner's go-ahead, and unit tests never reach a provider.

## Open

- **Paid runs (owner's go-ahead needed):** the eval baseline, judge
  calibration, and proof that the smoke deploy gate works.
- **τ²-bench** — deferred: needs a simulated-user loop.
- **Phase 7 — score real traffic** — later; needs users.
- **Open decisions** (defaults proposed, never confirmed): deploy-gate
  tolerance (10 points pass@1 per capability suite), smoke retry rule
  (capability retried once; guardrails never), first data-analysis dataset
  (InfiAgent-DABench), AgentDojo as internal guardrail cases, a second model
  under test, and G12 (the sandbox reads files) out of scope.
