# Evaluation environments — record

## Status

**E-1–E-5 built 2026-09-24; E-6 (paid proof runs) still needs the owner's
go-ahead.** Review fixes (2026-09-25): simulated tools obey connector scope
and per-tool deny; account-touching tools are withheld (`notify_user`
simulated); hidden KBs never reach pickers; non-world cases run outside the
world; sweeps pin their world; blind answers match by id; generation runs
in the background; worlds no longer require file access.

## What it delivered

- **A world is data, owned by the suite.** `EvalWorld` (one per suite,
  versioned, `draft | accepted`): a brief, `surfaces` (which parts exist),
  `fixtures`, **`facts`** (the ground truth the judge planted — the key
  idea), and the creating model. Cases may add files on top of the world;
  they never replace it.
- **Surfaces, each a fake slice of the world:** files (real `vfs` rows in an
  eval-only folder), knowledge base (a hidden eval KB dropped when the
  world changes), mailbox / calendar / drive / sheets (`sim/*.py` over
  fixture JSON, sends go to an outbox), web (a fixed corpus; unknown query
  gets "no results"), `ask_user` (questions recorded as tool calls).
- **World rules, all enforced:** a world changes what the tools *touch*,
  never which code path runs (one door: `run_agent`); if a tool has no fake
  version the agent does not get that tool; the owner's real data never
  enters; the agent's model never writes its own exam.
- **Generation + review.** The judge model (never the agent's) builds the
  world from `facts`, writes cases and reference answers against it;
  everything is a **draft** until accepted **on the Evals page only** —
  chat can make drafts, never accept them.
- **Graders:** `file_*`, `csv_*`, `json_*`, office graders, `cited(doc)`,
  `cited(url)`, `env_sent/env_not_sent/env_label`, `env_event/env_no_event`,
  `env_cell/env_file`, `asked_question`, `requested_approval`.

## Decisions worth remembering

- **The judge writes the world from facts, then writes the cases from the
  world** — so it knows the right answers because it made them.
- **One world per suite, many cases** — cheaper, and cases can refer to the
  same world state.
- **A world never replaces the agent's code path** — only what its tools
  touch.
- **Fail closed.** No fake version → no tool. Never reach the real service.
- **Facts, not prose rubrics** — the judge grades against planted ground
  truth, not a guessed answer.

## Open

- **E-6 — proving it on real agents** (paid, asks first): run suites on
  real agents to see whether the world+cases are good enough to ship as
  regression gates.
