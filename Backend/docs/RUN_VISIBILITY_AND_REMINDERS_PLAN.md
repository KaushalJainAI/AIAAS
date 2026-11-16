# Run Visibility and Reminders

**Status:** built, undeployed. Phases A and B and the owner's "everything" override are in the tree. The manual checks in Phase C are not recorded.

The assistant can see the user's own jobs, report their progress, and set reminders at a time the user chose or on a heartbeat the user named. It never invents timing.

## What it delivered

- **Job discovery**: `list_user_runs` in `Backend/chat/tools/runs.py`. Lists the caller's runs, running first. Each row has status, goal, turns, steps, todo progress, open items (up to 5), approval flag, cost and a `/runs` link. Read-only and always available.
- **Progress in run reads**: `get_agent_run` gets the same progress block (`chat/tools/agents.py`). The block's `todos.source` says where the todos came from: `live` or `run record`.
- **Reminder tools**: `schedule_notification`, `list_scheduled_notifications`, `cancel_scheduled_notification` in `Backend/chat/tools/workspace.py`. Repeats are `none`, `hourly`, `daily` or `weekly`.
- **Reminder model and sweep**: `ScheduledNotification` in `notifications/models.py`, fired by `notifications/scheduled.py`. Runs in the in-process scheduler loop (`agents/scheduler.py::PERIODIC_JOBS`).
- **Reminder endpoints**: `/api/notifications/scheduled/` and `scheduled/<id>/` (`notifications/urls.py`).
- **Reminder UI**: `components/settings/ScheduledReminders.tsx` and `ReminderPreferences.tsx` in Settings.
- **Tests**: `chat/tests/test_run_visibility.py`, `notifications/tests/test_scheduled_api.py`, `test_scheduled_sweep.py`, `test_email_policy.py`.

## Decisions worth remembering

- **User scope is the privacy model.** Every read filters on the user. A foreign id gets the same "no such run" answer as a missing one.
- **Compact, never the trace.** Rows carry counts, short excerpts and capped lists. Reasoning and step payloads stay out of the model's context.
- **No graph peeking.** Live todos are read best-effort from the same process's checkpointer. Anything the tool cannot read says so, rather than guessing.
- **Timing is quoted, not chosen.** The description forbids invented reminders. Completion uses `notify_user` now.
- **One firing path.** A reminder delivers exactly what `notify_user` delivers: a feed row, a device ping unless quiet hours, and web push. Email is opt-in per reminder (`send_email`, default off). The global email switch still has the last word.
- **Claim before send.** The sweep is safe to run from more than one place (see CLAUDE.md, "The scheduler loop runs every periodic job").

## Open

- Manual checks from Phase C: "what's running?" during an agent run, "remind me tomorrow 9am", a heartbeat cancelled from chat, and a second user seeing neither. Not recorded as done.
- `pytest`, `tsc` and `eslint` results for this change are not recorded in the plan.
- Live todo text exists only in the process that holds the run. A run on another process reports from its record instead, and says so.
