# Eval expansion — record

## Status

**Partly built.** The 0–100 scoring model, `flags` on results, the judge
pipeline, and the starter kits are live (see `EVALUATION.md`). The plan's
larger ambitions — datasets for every agent type, orchestrator-owned eval
creation, and removing chat from the agent page — are **not built**. The
db is not filled with per-agent suites; seeding still happens by
`manage.py benchmark run`, not on `migrate`.

## What it delivered

- **Scoring: 0–100 with minus, zero for give-up.** Done = positive;
  give-up / "you do it" = 0 (never minus); wrong action, hallucination,
  assumed-what-should-have-been-asked, a tool outside its config, a broken
  guardrail = minus inside the case (case floor 0); suite score is the
  average, always 0–100. Implemented as `score_100`, `final_score_100`,
  `auto_score_100`, plus `flags` (`gave_up`, `guardrail`, `hallucination`,
  `out_of_scope`). Guardrail and unexpected give-up auto-queue for review.
- **Judge pipeline.** Deterministic checks first (strings, files, tools).
  `llm_judge` only for "same meaning, different words" — always with tool
  trace + reasoning as evidence; never decides a case alone; fails closed.
  A human verdict wins over both.
- **Starter kits.** `GET /api/eval/starter-kits/` (with `?agent_id=` to get
  a recommendation) and `POST /api/eval/suites/from-template/` clone a
  kit into a user's own suite — the "create my own dataset" path, minus the
  wizard.

## Decisions worth remembering

- **No new eval engine.** The existing `eval/` engine (Run → Result →
  Review, `caller='eval'`) does it all; the expansion is datasets and flows,
  not plumbing.
- **Give-up must rank above a confident lie** — hence 0, never minus.
- **A score is provisional until a person can be asked** — guardrail and
  give-up cases auto-queue; human review overrides without overwriting.
- **Registration is the schema** — a grader saved is a grader runnable; no
  second list.
- **No chat box on the agent page.** Creation power moves from the builder
  to the orchestrator — chat creates drafts, never active agents or
  accepted cases.

## Open

- **Remove chat from the agent page; orchestrator-owned evals** (§7) — not
  built: Describe → Questions → Proposal → Approve → Install → Eval, driven
  by the orchestrator.
- **Starter kit coverage for every agent type** — partial; no per-agent
  suite is seeded by default.
- **The user-created dataset wizard** (template → goal + what-good-looks-like
  → grader pick → run) — the API pieces exist, the wizard does not.
- **Example test data in §4 was never approved** — the doc's build order
  ("do not fill DB until Section 4 examples are approved") still stands.
