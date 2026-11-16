# Solution memory — record

## Status

**S0–S4 built 2026-09-28** (undeployed): organisations, the `solutions`
app, automatic capture, freshness labels, the "doubtful" flag, the per-chat
share switch, the `/solutions` page. S5 (the benchmark suite and the offline
retrieval set) is not built. All design decisions in the plan are settled;
`ORG_KNOWLEDGE_PLAN.md` (K0–K7) builds on this.

## What it delivered

- **The `solutions` app** — `Solution` records (problem, symptoms, root
  cause, resolution, environment, freshness-typed claims, phrasings, tags,
  status `active / needs_check / superseded / retracted`, `shared`, track
  record). Plus `SolutionSignature`, `SolutionTerm`, `SolutionVector` —
  three small indexes of its own, not a hidden `inference` KB per org.
  Vectors are float16 rows in the database, loaded per scope, filtered by
  the live visible-id set.
- **Automatic capture** — a thumbs-up, or a following message saying it
  worked (a regex, no model cost). A cheap model decides skip / new /
  same_as / replaces and saves straight away (as of K2, as a draft for
  review). Daily caps per user; capture has its own platform setting
  (`SOLUTION_CAPTURE_PROVIDER` / `_MODEL`).
- **Retrieval** — error signature + keywords + vectors, fused, re-scored by
  track record, **abstains** below an evidence bar. Injected only when the
  match is real; otherwise nothing is said.
- **Freshness** — claims carry a freshness kind and a "known true at"
  timestamp; the "is this still safe to say?" answer is computed at read
  time, so stale rows demote themselves. Reuse warns; it does not rewrite.
- **The org boundary** — every solution belongs to exactly one org, fixed at
  capture; one read door (`solutions/access.py::visible`, membership checked
  live on every call); foreign and unknown ids answer the same 404;
  notifications name a solution, never quote it, outside the org.
- **Chat integration** — `search_solutions`, `get_solution`, `save_solution`,
  `review_solution` tools (the org comes from the chat, never from an
  argument); a per-chat share switch (starts at the org's
  `share_by_default`); agent runs from a chat carry that chat's org.
- **The `/solutions` page** — browse, search, review, flag, share, remove.
  "Doubtful" flags lower rank and show on every result.

## Decisions worth remembering

- **A solution is a record, not a chat log.** Capture extracts a small
  structured record; the transcript is dropped.
- **Retrieved solutions are evidence, never instructions.** They arrive as
  attributed, dated tool results; a step in one still goes through the
  reader's own gates.
- **Freshness is decided when read, not when written.** No job rewrites
  rows to mark them stale.
- **An org library needs no KB.** Solutions keep their own indexes so the
  org boundary stays in one app; sharing needed no engine change.
- **Unattended runs read but never write/review** team solutions.

## Open

- **S5 benchmark suite** — retrieval set + 100%-bar isolation guardrails.
  The offline set is also what should tune `search.py`'s first-guess
  thresholds.
- **Per-org capture model/provider choice** — not built; capture uses the
  platform setting.
- **"Completed fix run" capture trigger** — not built.
- **The `/solutions` page has no editing form** (the API supports `PATCH`).
