# `missions/`: goals that take many runs

The user sees this as a Mission: a bigger goal than one run can finish. One agent
run lasts at most about two hours, so a mission is a chain of normal runs.
Each run starts through the usual door (`start_agent_run`), so every usual
limit still applies.

Start one from chat with `/goal` (the user confirms first), or from the
Missions section of the Activity page (`components/activity/MissionsSection.tsx`).
Pause and resume are there too. `/missions` redirects to `/runs`.

Between runs the mission keeps a plan and a notebook file,
`/Agents/<name>/missions/<id>/NOTES.md`.

## Data (`models.py`)

| Model | What it is |
|---|---|
| `Mission` | Goal, status, plan, budget, deadline, when to wake next |

## Files

| File | What it does |
|---|---|
| `service.py` | After a run ends: done, waiting, next run, or paused? `after_failed_run` handles failures |
| `sweep.py` | Reads back finished runs, then starts runs for missions that are due |
| `tasks.py` | Celery entry |
| `urls.py` | `/api/missions/`: create, list, pause, resume, cancel |
| `management/commands/run_missions.py` | Runs one sweep by hand |

## How a sweep works

The sweep runs every `MISSION_SWEEP_SECONDS` (default 120) inside the web
server, from `agents/scheduler.py`. It does two things.

1. **Settle.** If a mission's current run has finished, read it back once:
   did it call `complete_mission`? What is the plan now? `service.after_run`
   then decides the next step. A failed run retries after 10 minutes and
   pauses after three runs in a row that got nowhere.
2. **Launch.** A mission whose wake time has passed gets its next run. The
   sweep starts it detached and does not wait. The run's goal carries the plan
   so far.

A refused run (spend cap, or the agent may not run unattended) pauses the
mission and says why.

## Rules

- Two sweeps must not start one run. A due mission is claimed with a conditional update.
- Still open: a waiting mission wakes on its timeout only, not on the event it waits for.

## Tests

`missions/tests/test_mission_sweep.py`, `missions/tests/test_mission_delete.py`.
