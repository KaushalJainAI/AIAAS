# `logs/`: the record of what agents did

The user sees this on the Activity page (live runs, history, what needs them)
and in run details. Every agent run is stored at three levels:

```
ExecutionLog   one run           (status, goal, answer, cost, what started it)
 └─ AgentTurn    one model call    (the model's reasoning for that turn)
     └─ AgentStep  one tool call   (arguments, result, approval decision)
```

`SubAgentRevision` is a snapshot of an agent's settings, so every run points at
the exact config it ran with.

Design: [`docs/AGENT_OBSERVABILITY.md`](../docs/AGENT_OBSERVABILITY.md).

## Data (`models.py`)

| Model | What it is |
|---|---|
| `ExecutionLog` | One run. `caller` says what started it (`api`, `chat`, `orchestrator`, `trigger`, `eval`, `mission`). `parent_step` is the tool call that delegated it, if any. `chat_session` is the chat it worked for, so a chat can show what its agents spent |
| `AgentTurn` | One model call, with its reasoning |
| `AgentStep` | One tool call. Written *before* the tool runs |
| `SubAgentRevision` | An agent's settings at one point in time |
| `CostEntry` | Spending that is not model tokens (images, messages) |
| `Feedback`, `RunSignal` | A thumbs up or down, and automatic quality signals |
| `ChangeSet`, `Change` | What one chat message or run changed, one row per file or folder. Kept so it can be put back (see `changes.py`) |

## Files

| File | What it does |
|---|---|
| `queries.py` | **Every** database read behind `/api/logs/`. Views stay thin |
| `views.py`, `urls.py` | `/api/logs/`: insights, run history, revisions, and run cleanup (delete, mark a stuck run failed) |
| `activity.py`, `activity_urls.py` | `/api/activity/`: what is running (`live/`), what finished in the last day (`recent/`: runs and each chat's latest reply) and recent files, for the Activity page |
| `revisions.py` | Saves a new revision only when settings really changed. `restore(agent, number, user=...)` puts an old configuration back as a new `restore` revision, through the same serializer checks as a save. It raises `RestoreRefused` (the 400 body) or `SubAgentRevision.DoesNotExist`. The restore view and the undo both call it |
| `changes.py` | The change log. A tool call's owner (a chat message or a run) is bound while it runs, and the file writes record what changed. Never raises, so a failed record cannot fail the write |
| `undo.py` | Puts back what a set changed (`docs/UNDO_PLAN.md` §6.4–6.5). Reads the change log, refuses a set that is still running, skips anything changed since the run rather than overwrite it, and returns one outcome per change |
| `costs.py` | The only writer of `CostEntry` |
| `failures.py` | Classifies why a run failed, as one word |
| `signals_api.py` | Records automatic quality signals |
| `retention.py`, `tasks.py` | After `RUN_DETAIL_RETENTION_DAYS` (180), clears a finished run's reasoning and tool payloads. The run record stays. `manage.py purge_run_detail` runs it by hand |
| `serializers.py` | API shape |
| `admin.py`, `apps.py` | Django admin and app config |

**Who writes the run records?** Not this app. `agents/agent/runtime.py` opens
the `ExecutionLog`, and `agents/agent/stream.py` writes turns and steps as the
run goes.

## Rules

- Views never query the database. Put the query in `queries.py`.
- A truncated list says so in its own body. A short list and a cut one must not look the same.
- Paused runs never age out of retention.

## Tests

`logs/tests/`. Start with `test_turns.py`, `test_revisions.py`, `test_retention.py`,
`test_change_binding.py` and `test_undo_api.py`. The undo tests are the
`test_undo_*` files.
