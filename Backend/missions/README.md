# `missions/`: goals that span many runs

One agent run lasts at most about 2 hours. A **mission** is a bigger goal
carried out by a chain of normal runs. Each run starts through the usual door
(`start_agent_run`), so all the usual limits apply. Between runs the mission
keeps a plan and a notebook file (`/Agents/<name>/missions/<id>/NOTES.md`).

## Files

| File | What it does |
|---|---|
| `models.py` | `Mission`: goal, status, plan, budget, deadline, when to wake next |
| `service.py` | After a run ends: done, waiting, next run, or paused? |
| `sweep.py` | Reads back finished runs, then starts runs for missions that are due |
| `tasks.py` | Celery entry |
| `urls.py` | `/api/missions/`: create, list, pause, resume, cancel |

Start one from chat with `/goal`, or from the Missions section at the top of
the Activity page in the web app (`src/pages/Runs.tsx`, through
`src/api/missions.ts`). `/missions` redirects to `/runs`.

Management command: `run_missions`.

## How one sweep works

The sweep runs every 2 minutes inside the web server (`agents/scheduler.py`,
`MISSION_SWEEP_SECONDS`). It does two things.

1. **Settle.** A mission with a run out (`current_execution_id`) checks that
   run. Still running or waiting for an answer? Leave it. Finished? Read it
   back once: did it call `complete_mission`? `wait_for`? What is the plan
   now? Then `service.after_run` picks the next step. A failed run goes to
   `service.after_failed_run`: try again in 10 minutes, pause after three runs
   in a row that got nowhere.
2. **Launch.** A mission whose wake time has passed gets its next run. The
   sweep starts it and does **not** wait for it. The run's goal carries the
   plan so far, so each run knows where the last one stopped.

A run that is refused (spend cap reached, agent not allowed to run
unattended) pauses the mission and tells the owner why.

Still open: a waiting mission wakes on its timeout, not on the event it is
waiting for.

Tests: `tests/test_mission_sweep.py`.
