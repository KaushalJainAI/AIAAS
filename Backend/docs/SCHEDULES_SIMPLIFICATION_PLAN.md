# Schedules — record

## Status

**Phases 1–4 built (2026-09-22). Phase 5 (optional, same claim-then-run fix
for the other sweeps) not started. Acceptance checklist not ticked.** The
core fix: schedules fire with zero setup, because the backend process runs
its own scheduler loop under a database lease.

## What it delivered

- **The scheduler moved in-process.** `agents/scheduler.py` runs the
  trigger sweep (and every other periodic job) inside the backend process —
  Daphne in production, `runserver` locally — under a `SchedulerLease` and
  a per-slot claim (`sweep.prepare`, one conditional UPDATE). No crontab,
  no Celery, no per-minute Django process. A leftover crontab or beat can
  coexist safely: only the lease holder sweeps, one slot can never fire
  twice.
- **Schedules fire with zero setup.** Production no longer depends on a
  host crontab; local dev has the same behaviour as prod.
- **The card tells the truth.** `TriggerSerializer` carries `status` /
  `status_message` computed on the server (e.g. `agent_paused` → "{agent} is
  paused, so this is skipped until you resume it."), with one fix button
  where a fix exists, one status line instead of five warning boxes, and a
  delete confirmation.
- **Simpler to set up.** The builder's schedule editor and the Schedules
  page no longer disagree; the card shows the timezone once; the route is
  consistent.
- **Tests** for the status table (`agents/tests/test_scheduler.py::TriggerStatusTests`) and the claim path.

## Decisions worth remembering

- **No new scheduler process.** The loop lives in the web process; each
  periodic job is also reachable as a management command. Production has no
  cron and no beat — don't add crontab lines calling `manage.py` for these
  (each `docker compose exec` starts a second Django process inside the
  backend's memory limit).
- **Atomicity with plain UPDATEs.** Lease and per-slot claim are single
  conditional UPDATEs — atomic on SQLite and Postgres alike, no advisory
  locks, no `select_for_update`.
- **B4 (double-fire) was real.** `due_triggers` used to not lock rows; the
  per-slot claim closes it even for overlapping sweeps.
- **The recalculated date hid the bug.** `upcoming[0]` (recomputed) made a
  never-firing schedule look healthy; the relative text now comes from the
  stored `next_due_at`.
- **Correctness rule:** a schedule must not depend on an operator remembering
  to add a crontab line.

## Open

- **Acceptance checklist not ticked** (the §8 "done means" list was not
  walked through).
- **Phase 5 (optional):** the same claim-then-run fix for the other sweeps
  (e.g. reminders, missions, stale-solution nudges).
