# Coding agents — record

## Status

**Built 2026-09-22** (C1 → C2 → C4 → C3 → C6 → C5 → C7, in that order).
Depends on `shell` workspace tools and the missions `wait_for` pattern.
The whole roster runs on the same agent loop — no coding runtime exists.
**`/code` (the workspace page) is not built**; a mission can only be
started through tools.

## What it delivered

- **C1 — the roster.** Gallery templates differing in grants, tools,
  guardrails and playbook: `code-scout` (map, `plan`), `code-implementer`
  (`shell`, write), `code-integrator` (the **only** role holding
  `git_commit`/`git_push`/`open_pull_request`), plus `reviewer`/`repo-assistant`.
  The `shell` grant tools are in `chat/tools/code.py` (`ws_*`, `git_*`).
- **C2 — file leases.** `CodeLease` rows claimed atomically at write and at
  dispatch; the stale-write guard refuses a write whose `before_hash` no
  longer matches; most-restrictive-wins on worker permissions; leases
  released on terminal paths and by the recovery sweep. Guardrail cases run
  at 100%.
- **C3 — change awareness.** An agent that read a file and then had it
  changed under it is told (a notice); the stale-write refusal is the
  correctness boundary, the notice is a courtesy.
- **C4 — the lead can start, watch, steer and stop.** `coding-lead`
  template; `start_tasks`, `wait_tasks`, `task_status`, `steer_task`,
  `stop_task`, `revert_task` — a lead no longer blocks inside one fan-out
  call while workers run.
- **C5 — user controls permissions.** Pack install matrix, per-worker
  autonomy switch, approvals naming the worker.
- **C6 — plan panel.** An OpenCode-style side panel: the lead's todos with
  owner chips, worker rows (label, status, current todo, last tool step,
  spend), and actions (Steer, Pause/autonomy, Stop, Open run).
- **C7 — evaluation.** The `work-code-team` benchmark suite (guardrails at
  100%, scorecard vs `repo-assistant`).

## Decisions worth remembering

- **Configuration, not code paths.** Every coding agent is a gallery
  template — no `kind` column, no "coder" runtime. The lead is an agent
  holding `subAgents`, as today.
- **The model proposes, code enforces.** Leases, stale-write checks,
  most-restrictive-wins and budget division are dispatch code, never prompt.
- **Refuse with a reason, never drop silently** — a refusal names the holder
  and the fix.
- **Correctness comes from hashes; notices are a courtesy.**
- **Never widen.** A worker never holds more than its template allows or
  more than its parent holds.
- **The box is small.** Workers run in-process; the workspace runs in the
  remote engine. Default parallelism for code is 3, not 8.

## Open

- **`work-code-team` benchmark never run** — it needs the workspace engine
  and paid tokens.
- **`/code` page** — not built (see PLATFORM_CAPABILITIES_PLAN).
