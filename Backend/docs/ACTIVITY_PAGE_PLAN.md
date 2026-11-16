# Activity Page (`/runs`)

**Status:** built (2026-09-28). The missions decision went to option B; the mission sweep runs detached.

Activity is the one screen for everything running, waiting, scheduled or recently changed. A user can stop it or clear it up. The pieces are read-only unions over existing tables, plus a few delete and stop doors. The reminder side is in `RUN_VISIBILITY_AND_REMINDERS_PLAN.md`.

## What it delivered

- **Live union**: `GET /api/activity/live/` (`Backend/logs/activity.py`, routes in `logs/activity_urls.py`). Five kinds: `agent_run`, `code_task`, `eval_sweep`, `eval_world`, `chat_turn`. Each row carries server-computed `actions`, so the UI never offers a verb the backend would refuse.
- **Recent files**: `GET /api/activity/recent-files/`. Kinds `file_opened`, `file_version`, `code_change`.
- **Run deletes**: `DELETE /api/logs/executions/<id>/` and `POST executions/bulk-delete/` (finished runs only, cost records kept). `executions/<id>/mark-failed/` closes a stuck run through `recovery._fail`.
- **Mission delete**: refused while a mission is active or waiting. Pause and resume are back on the Activity page.
- **Page split**: `pages/Runs.tsx` is now a 65-line layout. Sections live in `components/activity/`: `NeedsYou`, `LiveList`, `ScheduledSection`, `RecentlyDone`, `FileActivity`, `HistoryList`, `RunDetail`, `MissionsSection`.
- **Redirects**: `/overview`, `/inbox`, `/orchestrator` and `/missions` all redirect to `/runs`. Deep links `?run=`, `?request=` and friends still work.
- **Tests**: `logs/tests/test_activity_live.py`, `logs/tests/test_run_delete.py`, `missions/tests/test_mission_delete.py`, `better-n8n-frontend/src/lib/__tests__/activity.test.ts` (action matrix) and `src/components/activity/__tests__/`.

## Decisions worth remembering

- **Only existing doors stop things.** Stop reuses agent cancel, eval cancel and chat stop. No new cancel path was added.
- **Live means live here.** Chat turns and code tasks live in one process's memory. The endpoint shows only this process's ones, and the empty state says so. Run rows and eval rows are visible on every process. No Redis mirror.
- **Eval worlds are open-only.** There is no cancel route for world generation, so none is offered.
- **Costs survive a delete.** `CostEntry` rows are kept, so spend totals and caps do not drop when history is cleared. The dialog says so.
- **Live rows never offer Delete.** Stop first. The backend returns 409 anyway.
- **Missions moved to a detached launch** (`missions/sweep.py`, in `PERIODIC_JOBS`). That is why they can be shown as running. See CLAUDE.md, "A mission is a chain of detached runs".
- **Scheduled is read-only here.** Schedules stays the editor. The section hides when nothing is scheduled and the scheduler is healthy.

## Open

- Pending office drafts (autosaved specs waiting for the 30 s render) in Recent files. The plan said omit in v1 unless trivially readable. They are not in `logs/activity.py`.
- Live chat turns and code tasks are seen only by the process that holds them. A Redis mirror is not built.
- Scheduler liveness shows "down" only. Per-sweep last-run times are not shown in v1.
- Manual check from the plan §6 (start an agent run, a code task, an eval sweep, a world and a chat turn; stop each; delete finished runs; clear failed; file save appears in file activity). Not recorded as done.
- Eval-world cancel: not built (the plan says do not invent one in v1).
