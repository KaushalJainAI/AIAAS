# Undo plan: "Undo this run" and "Undo send"

**Status:** being built on branch `feature/undo` (started 2026-11-23). Nothing
in this plan spends money, so no phase needs a paid-run go-ahead.

**Progress** (newest last; update this table as each phase moves):

| Phase | State | Notes |
|---|---|---|
| 0 Facts | **done** 2026-11-23 | Facts gathered; see "Phase 0 results". Baseline: 3209 passed, 0 failed. Surprises: `workspaces.CodeChange` already exists, and draft renders and upload imports write inside read paths. |
| 1 Send window (backend) | **built** 2026-11-24 | `messaging.PendingSend`, `messaging/holds.py`, three routes, sweep job; H-169. Decided beyond the plan: evals are never held; a bad Gmail address fails at once (composed before queueing); a send the provider took but we failed to record is `sent`, never `failed`; the WhatsApp/SMS cost is filed on delivery, not on queueing (a cancelled hold costs nothing). Open: adapter refusals (WhatsApp 24 h window) now surface as a failed hold + notification ~20 s later, not as a tool error |
| 2 Send window (web) | **built** 2026-11-24 | `api/messaging.ts`, `hooks/usePendingSends.ts` (polls only while a row is held/sending), `components/content/PendingSends.tsx`, in chat above the composer and on `RunDetail`. The receipt says "asked to send a message": the trace carries no tool output, so it cannot tell held from sent. tsc, lint 0, vitest 930 passed. Not yet checked by hand in a browser |
| 3 Change log: model + recording | **built** 2026-11-24 | As §6.1–§6.3, §6.9. Decided: only `agent` and `restore` versions are stamped (an `app` copy inside a tool call is the user's pending draft render, taken before the draft lands); `answer_subagent` is also `journal=False`; `_looks_like_error` matches only the exact `Error:` / `Error running` prefixes. Full backend suite green after merging 1–3 |
| 4 Revert engine + API | not started | |
| 5 Workers, closing, the message chip | not started | |
| 6 Revert UI (web) | not started | |
| 7 Memory and agent settings | not started | |
| 8 Phone app | not started | |
| 9 Docs | with each phase | |

**Who runs this plan:** a smaller model, one phase at a time. Read §1–§6
before any phase. Do not skip ahead. Do not merge two phases into one change.
Each phase lists the files to touch, the steps, the tests and how to know it
is done. When this plan and the code disagree, the code wins: stop, write what
you found in the Progress table, and fix the plan before you go on.

---

## 1. What we want

Today the system can undo **one thing at a time**. A file can go back to an
older version. A deleted file can come out of the recycle bin. An agent's
settings can go back to an older revision. But if an agent run edits six
files, deletes two and saves a memory, the user has to find all nine changes
by hand, on three different screens. Nothing records which run made which
change.

We want two things:

1. **"Undo this run" / "Undo these changes".** One button on a chat answer
   and on a run's detail page. It shows the list of what changed. It puts back
   everything that can be put back. It **never overwrites work done since**:
   if the user edited a file after the run, that file is skipped and the user
   is told why. Things that cannot be undone (an email that was sent) are
   listed honestly as "can't be undone".
2. **"Undo send".** When an agent sends an email or a chat message for a
   person who is watching, the message waits about 20 seconds before it really
   goes. A bar shows a countdown with **Cancel** and **Send now**. This is how
   Gmail's "Undo send" works. An email that has already gone cannot be taken
   back, so this short wait is the only real undo for sends.

What we do **not** promise: undo for things outside our app (a Google
Calendar invite, a Notion page, any MCP tool, money spent on models). Those
are listed in the change list as "can't be undone from here", so the user can
see them and deal with them.

## 2. What exists today (checked 2026-11-23)

Read these before you start. File paths are from `Backend/` unless noted.

**File versions.** `inference/versions.py`. Every path that overwrites a file
calls `snapshot(doc, source)` first, so `DocumentVersion` holds what the file
said before. Sources are `app`, `agent` and `restore`. Three rules:
- *Coalesced.* Saves from the same source within
  `FILE_VERSION_COALESCE_SECONDS` (300, `workflow_backend/thresholds.py`)
  share one version, the one from before the burst.
- *Bounded.* `FILE_VERSIONS_KEPT` (25) per file. Older ones are deleted.
  Files over `FILE_VERSION_MAX_BYTES` (25 MB) are not versioned at all.
- *Best effort.* A failed snapshot never fails the save.

`versions.restore(doc, version)` puts a version back and first saves the
current state as a `restore` version.

**Recycle bin.** `inference/recycle.py`. `trash(user, folders=, documents=)`
sets `deleted_at`. `restore(user, folder_ids=, document_ids=)` brings rows
back to their own parent. Purged after `RECYCLE_BIN_RETENTION_DAYS` (30).
`Document.objects` / `Folder.objects` hide trashed rows; use `all_objects` to
see them (DESIGN_HISTORY H-129).

**The agent's file door.** `inference/vfs.py`. Every agent file tool goes
through it: `write_file` (`_write_text_locked`), `write_binary`
(`_create_binary`, `_replace_in_place`), `edit_file` (`_edit_locked`),
`edit_document`, `edit_deck`, `restore_file_version`, `export_file`,
`make_dir`, `delete`, `move`, `copy` (check the exact name in Phase 0). The
file's etag is `vfs._version(doc)` = `doc.updated_at.isoformat()`.
`inference/office_edit.py::is_stale(doc, etag)` is the shared "changed since?"
check; it already ignores the background render of a draft.

`FileScope.author` (`vfs.agent_author`) already stamps `execution_id` on
files an agent run writes, but only into `Document.metadata`. Chat writes have
`execution_id: None`.

**Agent settings history.** `logs.SubAgentRevision` + `logs/revisions.py`.
The restore lives in a **view**: `agents/views/agents.py::agent_restore_revision`.
It records the restore as a new revision with source `restore`.

**Memory.** `core/memory.py::remember(user, text, category)` returns
`(row, created)`. `forget(user, text)` **hard-deletes** matching rows. The
tools are `chat/tools/memory.py` (`remember_about_user`, `forget_about_user`).

**Tool effects.** Each `@tool` declares `effect = read | reversible |
irreversible` (`chat/tools/registry.py`, default `irreversible`), plus
`sensitive`, `external` and `action_label`. `registry.effect_of(name)`
answers for any name, worst case for unknown ones (MCP tools).

**Where tools run.** `chat/turn/agent.py::_dispatch_one` runs every tool call
of a chat turn and of an agent run. It builds a fresh `ctx` dict per call from
`_tool_context(turn, state)`, which holds `user_id`, `session_id`, `turn_id`,
`execution_id`, `caller` and more. **`turn_id` is regenerated when a paused
turn resumes**, so it cannot identify a chat turn across an approval.

**Chat turns.** `chat/turn/pipeline.py::run_chat_turn`. The user's
`ChatMessage` is created before the turn (around line 925). An approval or
answer **reuses the last user message**, so the user message *is* stable
across a pause. The `TurnContext` is built after it (around line 1127). The
assistant `ChatMessage` is created at the end (around line 1457), with a
`metadata` dict. An interrupted turn saves its own assistant row (around line
707).

**Agent runs.** `ExecutionLog` (`logs/models.py`) with a uuid
`execution_id`. Workers started by a run point at it through
`parent_step`. Runs start through `agents/agent/runtime.py::run_agent` /
`start_agent_run`, which build the run's `TurnContext`. Detached work uses
`workflow_backend.background.spawn()`, which starts each task with an
**empty** `contextvars.Context()`, so nothing set in a ContextVar reaches a
detached worker by accident.

**A ContextVar we already use.** `chat/turn/side_calls.py` holds a list in a
ContextVar for the length of a turn, so a tool deep inside can record
something without a parameter on every function. This plan copies that
pattern.

**Sends.** `chat/tools/talk.py::message_send` (Slack, WhatsApp, Teams, SMS,
Telegram) and `chat/tools/google/gmail.py::gmail_send_message`. Both are
`sensitive=True, effect='irreversible', external=True`. Both call
`core/safety/outbound.py::check` (content policy + daily cap) and `disclose`
(AI line) and then send at once. `outbound.SEND_TOOLS` names both.
`outbound.sent_last_24h` counts completed `AgentStep`s of those tools.
`messaging.OutboundMessage` records channel sends (not Gmail).
`talk._unattended(context)` is true for callers in
`agents/grants.py::UNATTENDED_CALLERS` (`trigger`, `orchestrator`,
`mission`).

**Periodic jobs.** A job must be in both `CELERY_BEAT_SCHEDULE`
(`workflow_backend/settings/base.py`) and
`agents/scheduler.py::PERIODIC_JOBS` (or `NOT_IN_PROCESS` with a reason). A
test fails otherwise.

**Notifications.** `notifications/utils.py::create_notification(user, type,
title, message, data=None, ...)`. Types are
`notifications/models.py::Notification.NOTIFICATION_TYPES`.

**Frontend.** The receipt line under a finished reply is
`features/chat/lib/turnReceipt.ts`, drawn by
`features/chat/components/ChatMessageItem.tsx` (props only, no hooks, no API
calls; `StandaloneChat.tsx` owns state). A run's page is
`components/activity/RunDetail.tsx`. Only `src/api/` calls the backend.

## 3. Words used in this plan

- **Change set**: everything one owner changed. The owner is one chat message
  (the user's message that started the turn) or one agent run.
- **Change**: one row in a change set. It describes **one target** (one file,
  one folder, one memory fact, one agent's settings) with its state *before
  the set first touched it* and its state *after the set last touched it*. If
  a run writes the same file five times, that is **one** change.
- **Untracked change**: a tool call that did something we cannot undo or do
  not track yet (a sent email, an MCP call). Recorded so the list is honest.
  It has no target and cannot be reverted.
- **Binding**: the ContextVar value that says "changes made now belong to this
  owner". Set around each tool call.
- **Revert**: putting the targets of a change set back to their *before*
  state.
- **Hold**: an outgoing message waiting for its send time.

## 4. Decisions

Each decision has its reason. Do not change one without writing the new
reason here.

**D1. Record the net effect per target, not every action.** One row per
(change set, target): `before` is written once, the first time the set
touches the target; `after` is overwritten every time. *Why:* reverting
action by action breaks on the version history. Two writes to one file within
300 s share one version (coalescing), so the second write has no "before"
copy of its own. Net effect needs only one copy, the one from before the set
began, and that copy always exists (D3).

**D2. Never overwrite work done since.** Before reverting a target, compare
its current state with the change's `after`. If they differ (the user or
another run changed it), **skip it** and say why. No "force" option in this
plan. *Why:* an undo button that destroys newer work is worse than having no
button. A false "changed since" only costs one manual restore from version
history. A wrong overwrite costs the user's work.

**D3. A file version knows its change set.** Add
`DocumentVersion.change_set_id` (plain integer, not a foreign key).
`versions.snapshot` stamps it from the binding. Coalescing only joins a burst
with the **same** change set id. *Why:* without this, run B writing a file
within 300 s of run A writes no version, so A's output is lost when B is
reverted. With it, the earliest version carrying the set id is exactly "the
file before this set". A plain integer because a file's history must not
disappear when a change set is purged, and so `inference` needs no migration
dependency on `logs`.

**D4. Version pruning still wins.** `FILE_VERSIONS_KEPT` is not raised and
versions with a set id are not protected. If the "before" version was pruned,
the revert skips that file with "the copy from before this run is no longer
kept". *Why:* a scheduled agent that rewrites a large file every 5 minutes
would otherwise keep thousands of copies. The latest 25 runs stay revertible.

**D5. The binding is a ContextVar set around each tool call** in
`_dispatch_one`, holding the owner (chat message id or execution id) and the
tool call. Recording functions read it; with no binding they do nothing.
*Why:* the write paths are ~15 functions deep in `inference/vfs.py`, and they
are also used by the user's own app saves, which must not be journaled.
Threading a parameter through all of them would touch every signature. The
same reasoning made `side_calls.py`.

**D6. The chat owner is the user's ChatMessage, not `turn_id`.** *Why:*
`turn_id` changes when a paused turn resumes. The user message is reused
across an approval (`pipeline.py` around line 925).

**D7. Workers link to their parent by an explicit id.** A delegating tool
passes `change_parent_id` to `run_agent` / `start_agent_run`. The worker's
set gets `parent` = that id. Reverting a set reverts its children first.
*Why:* `spawn()` starts detached tasks with an empty context, so the binding
cannot flow to a worker by itself (and it must not: the worker is a different
owner).

**D8. Everything a tool did that we do not track becomes an "untracked" row.**
After a call that completed, if its tool's effect is not `read` and it
recorded no change, `_dispatch_one` adds an untracked row. *Why:* a file path
we forgot to hook, an MCP tool, a sent email: each one shows up in the list
as "can't be undone from here" instead of vanishing. Missing a hook then
makes the list honest but incomplete, never silently wrong.

**D9. Tools that only orchestrate are not journaled.** `@tool(...,
journal=False)` on delegation and bookkeeping tools (`run_agent`,
`invoke_subagent`, the `*_tasks` tools, `update_conversation_notes`, ...).
*Why:* their real effects are recorded in the worker's own set (D7) or are
not worth undoing, and an untracked row for each would bury the real list.

**D10. The revert is not itself undoable in this plan (no redo).** *Why:*
it keeps the engine small. The undo is still recoverable by hand, because
`versions.restore` keeps the replaced state as a `restore` version and a
trashed file sits in the bin for 30 days. Redo is listed in §10.

**D11. Evals and guest chat never journal.** `caller == 'eval'` and the guest
surface get no binding. *Why:* an eval's world is reset before every attempt
(`eval/workspace.py`), and a guest has no files.

**D12. Holds apply only when a person is watching.** A send is held when the
caller is **not** in `UNATTENDED_CALLERS` and `OUTBOUND_HOLD_SECONDS > 0`
(default 20). Unattended runs send at once, as today. *Why:* the window exists
so a watching person can catch a mistake. For a 3 a.m. schedule nobody is
watching, and the recipient allowlist and the daily cap already guard it.

**D13. A cancelled hold still counts toward the daily cap.** `sent_last_24h`
is not changed. *Why:* the cap counts completed send steps, and a held send's
step completes when it is queued. Counting a cancelled message is
conservative and harmless (one fewer message today). Changing the counter is
a separate decision.

**D14. A send interrupted mid-delivery is never retried.** A hold stuck in
`sending` for 5 minutes becomes `unknown`, and the user gets a notification:
"may or may not have been sent". *Why:* a retry after a crash can send the
email twice. Sending twice is worse than telling the user we are not sure.

**D15. The new code lives in `logs`.** The models go in `logs/models.py`, the
binding and recording in `logs/changes.py`, the revert engine in
`logs/undo.py`, the routes under `/api/logs/changes/`. *Why:* `logs` already
holds run history (`ExecutionLog`, `AgentStep`, `SubAgentRevision`), it may
read `inference`, `core` and `agents.models`, and the import contracts
(`Backend/.importlinter`) forbid it only the agent runtime, the chat engine,
the tool library, views, `eval` and `missions`. `inference/vfs.py` and
`chat/tools/*` may import `logs.changes`. Use **deferred imports** (inside
functions) for every cross-app import, as the rest of the codebase does.

*Decisions added after Phase 0 (2026-11-23):*

**D16. Record in the vfs public write functions, never in `save_text` /
`replace_bytes`.** *Why:* those lower doors also run inside *read* paths
(`drafts.ensure_rendered` renders the user's pending draft from
`file_versions`, `export_file`, `restore_file_version`, `_editable_spec`;
`importers.import_upload` converts an upload on the first `edit_document`).
Recording there would blame the run for the user's own draft and for a
format conversion. The two direct writers that skip the vfs API
(`update_conversation_notes`, the second `Document.save` in
`kb_folders.add_document`) are covered by D9 (`journal=False`) and by the
`vfs.write_file` call before it, respectively.

**D17. Folders are recorded in `vfs._make_dirs`, for each folder it actually
creates.** *Why:* every agent folder creation goes through it (`write_file`,
`write_binary`, `make_dir`, `folder_for_write`, `move`, `copy`, the sandbox).
The scope builders (`chat_scope`, `agent_home`) call `fs.ensure_folder`
directly, so `/Chat` and `/Agents/<name>` are never recorded, which is right:
the platform needs them.

**D18. `_dispatch_one` always binds, even with no owner.** It binds `None`
when `change_owner` is missing. *Why:* `invoke_subagent` awaits its child run
**inline** (`chat/tools/agents.py:1054`), so the child shares the parent's
context. A child with no owner (an eval) would otherwise record into the
parent's set.

**D19. Code workspace changes are not part of this plan.**
`workspaces.CodeChange` already records `ws_write`/`ws_edit`/`ws_apply_patch`
per file, and `revert_task` undoes them. Those tools show as untracked rows
("can't be undone from here") in v1; joining the two is listed in §10.

**D20. Moving a file back uses its own helper**, `.update(folder=, name=,
file_type=)` exactly as `vfs.move` does (`vfs.py:2020`), without touching
`updated_at`. *Why:* there is no shared model-level helper, and
`fs.move(documents=)` bumps `updated_at` and skips the name check.

## 5. Design A: the send window

### 5.1 Model (`messaging/models.py`)

```python
class PendingSend(models.Model):
    """An outgoing message waiting for its send time (docs/UNDO_PLAN.md §5)."""

    STATUS_CHOICES = [
        ('held', 'Waiting'),          # can be cancelled
        ('sending', 'Sending'),       # claimed by deliver(); cannot be cancelled
        ('sent', 'Sent'),
        ('cancelled', 'Cancelled'),
        ('failed', 'Failed'),         # the provider refused; nothing went out
        ('unknown', 'Unknown'),       # stuck in `sending`; may or may not have gone (D14)
    ]
    TOOL_CHOICES = [('message_send', 'Message'), ('gmail_send_message', 'Email')]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                             related_name='pending_sends')
    tool = models.CharField(max_length=32, choices=TOOL_CHOICES)
    #: Everything deliver() needs, already checked and with the AI line added.
    #: For message_send: {channel, to, body, draft_id|None}.
    #: For gmail_send_message: the tool's args after `outbound.disclose`.
    #: Never a token or a secret: credentials are looked up at send time.
    payload = models.JSONField()
    #: Short words for the bar: "Email to sam@example.com", "Slack #general".
    label = models.CharField(max_length=200)
    send_at = models.DateTimeField(db_index=True)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default='held')
    #: What the tool would have returned on success, kept for the UI.
    result = models.JSONField(default=dict, blank=True)
    error = models.TextField(blank=True, default='')
    chat_session_id = models.CharField(max_length=100, blank=True, default='')
    execution_id = models.CharField(max_length=64, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['status', 'send_at']),
            models.Index(fields=['user', 'status']),
        ]
```

Migration: `messaging/migrations/0003_pendingsend.py` (the latest is
`0002_...`; check before you number it).

### 5.2 Settings

In `workflow_backend/settings/base.py`, next to `OUTBOUND_DAILY_CAP`:

```python
OUTBOUND_HOLD_SECONDS = int(os.environ.get('OUTBOUND_HOLD_SECONDS', '20'))   # 0 = off
OUTBOUND_HOLD_SWEEP_SECONDS = int(os.environ.get('OUTBOUND_HOLD_SWEEP_SECONDS', '15'))
```

`settings/test.py`: leave the default; tests set it with `override_settings`.

### 5.3 `messaging/holds.py` (new)

```python
def hold_seconds() -> int: ...
    # max(0, int(settings.OUTBOUND_HOLD_SECONDS)); a bad value means 0, never a guess.

def should_hold(context: dict) -> bool: ...
    # hold_seconds() > 0 and context.get('caller') not in UNATTENDED_CALLERS
    # and context.get('user_id'). Import UNATTENDED_CALLERS inside the function.

def create(user_id, tool, payload, label, context) -> PendingSend: ...
    # send_at = now + hold_seconds(); chat_session_id = context['session_id'] or '';
    # execution_id = str(context.get('execution_id') or '').

async def deliver(hold_id: int) -> str: ...
    # 1. Claim: PendingSend.objects.filter(pk=hold_id, status='held',
    #    send_at__lte=now).aupdate(status='sending'). If 0 rows: return 'skipped'.
    #    This one UPDATE is what makes Cancel, Send now, the timer and the sweep
    #    safe against each other. Never read-then-write.
    # 2. Call the sender for row.tool (deferred import):
    #      chat.tools.talk.deliver_message(user_id, payload)  -> dict
    #      chat.tools.google.gmail.deliver_gmail(user_id, payload) -> dict
    # 3. Success: status='sent', result=<dict>. Failure: status='failed',
    #    error=<plain words>, and create_notification(user, 'outbound_failed',
    #    'A message was not sent', '<label>: <error>', data={'hold_id': id}).
    # 4. Return the new status.

async def deliver_after(hold_id: int, delay: float) -> None: ...
    # await asyncio.sleep(delay); await deliver(hold_id). Started with
    # workflow_backend.background.spawn(), never asyncio.create_task.

def cancel(user, hold_id) -> str: ...
    # UPDATE ... WHERE pk=hold_id AND user=user AND status='held' -> 'cancelled'.
    # 0 rows: if a row with that id exists for this user -> 'too_late', else 'not_found'.

def send_now(user, hold_id) -> bool: ...
    # UPDATE send_at=now WHERE pk, user, status='held'; then the caller spawns deliver().

async def sweep() -> dict: ...
    # a) every 'held' row with send_at <= now - 5s: await deliver(id)  (the timer died:
    #    a restart or another worker process)
    # b) every 'sending' row with updated_at <= now - 5 min: status='unknown' and a
    #    notification "may or may not have been sent" (D14). Never deliver these again.
    # Cap each pass at 100 rows. Return counts.
```

Add `('outbound_failed', 'Message Not Sent')` to
`Notification.NOTIFICATION_TYPES`. This changes `choices`, so
`makemigrations notifications` will make a small migration. Commit it.

### 5.4 Splitting the two send tools

Do not change *what* is checked. Only split "check" from "deliver".

**`chat/tools/talk.py::message_send`:**
1. Keep everything up to and including `body = outbound.disclose(body, context)`.
2. Move the rest (the `_account` lookup, `adapter_for(channel).send`, `_save`,
   the result dict) into a new module-level
   `async def deliver_message(user_id: int, payload: dict) -> dict`. It
   returns `{'sent': True, ...}` or raises `DeliveryError(str)` (a small new
   exception in the same file) with plain words. It must not use `context`.
   Per-run counters (`_sent_counts`) and `_record_message_cost(context, ...)`
   stay in the tool, because they belong to the run.
3. In the tool, after `disclose`:
   ```python
   from messaging import holds
   if holds.should_hold(context):
       row = await sync_to_async(holds.create)(user_id, 'message_send',
           {'channel': channel, 'to': to, 'body': body,
            'draft_id': draft.id if draft else None},
           f'{channel.title()} to {to}', context)
       spawn(holds.deliver_after(row.id, holds.hold_seconds()), name=f'hold:{row.id}')
       _sent_counts(context)[to] = _sent_counts(context).get(to, 0) + 1
       await _record_message_cost(context, channel)
       return json.dumps({'queued': True, 'hold_id': row.id,
           'send_at': row.send_at.isoformat(), 'channel': channel, 'to': to,
           'rendered': f'Sending to {to} on {channel} in {holds.hold_seconds()} s. '
                       f'The user can cancel it until then.'})
   ```
   Otherwise call `deliver_message` at once and return what the tool
   returns today. The unheld path must return **exactly** today's output.
   Add a test for that.

**`chat/tools/google/gmail.py::gmail_send_message`:** the same shape.
`deliver_gmail(user_id, payload)` builds `context = {'user_id': user_id}`
and runs `_compose(payload, context)` and `send_json(context, 'POST', ...)`.
Phase 0 checks that `chat/tools/google/client.py::_request` reads only
`user_id` from the context; if it reads more, pass that too and write down
what. Keep `@handles_google_errors` on the tool. In `deliver_gmail`, catch
`GoogleAPIError` and raise `DeliveryError` with its message.

**Tool descriptions.** Gmail's says "This cannot be undone". Change it to:
"When the user is watching, the email waits a few seconds so they can
cancel it; once sent it cannot be undone." Add the same sentence to
`message_send`. When the result has `queued: true`, the model must say "will
be sent", not "sent". The `rendered` text above says this.

### 5.5 Routes (`messaging/urls.py`, `messaging/views.py`)

| Route | Method | Does |
|---|---|---|
| `/api/messaging/holds/` | GET | The user's holds. Filters: `?session=<chat session id>`, `?execution=<uuid>`, `?status=held` (default: `held`, `sending`, plus anything changed in the last 2 minutes, so the bar can show "Sent ✓"). Capped at 50, newest first, `truncated` in the body. Rows: `id, tool, label, status, send_at, error, seconds_left` |
| `/api/messaging/holds/<id>/cancel/` | POST | 200 `{status:'cancelled'}`; 409 `{status:<current>}` when it is too late; 404 for unknown **and** foreign ids (same 404) |
| `/api/messaging/holds/<id>/send-now/` | POST | 200, then spawns `deliver`; 409 when not `held`; same 404 rule |

All require auth and are user-scoped in the query (`user=request.user`),
never checked after a fetch. Check `messaging/urls.py` for the mount point
before you write the paths into `API.md`.

### 5.6 Periodic job

- `messaging/tasks.py`: a Celery task `messaging.deliver_held_sends` that runs
  `async_to_sync(holds.sweep)()`.
- `CELERY_BEAT_SCHEDULE['deliver-held-sends'] = {'task':
  'messaging.deliver_held_sends', 'schedule': OUTBOUND_HOLD_SWEEP_SECONDS}`.
- `agents/scheduler.py`: `async def _held_sends(): from messaging.holds import
  sweep; return await sweep()` and
  `PeriodicJob('messaging.deliver_held_sends', 'OUTBOUND_HOLD_SWEEP_SECONDS', _held_sends)`.

## 6. Design B: change sets

### 6.1 Models (`logs/models.py`)

```python
class ChangeSet(models.Model):
    """What one chat message or one agent run changed (docs/UNDO_PLAN.md §6)."""

    OWNER_CHOICES = [('chat', 'A chat message'), ('run', 'An agent run')]
    STATUS_CHOICES = [
        ('open', 'Open'),             # a chat turn still going (or abandoned; see idle rule)
        ('closed', 'Closed'),
        ('reverting', 'Reverting'),   # a revert holds it (the lock)
        ('reverted', 'Reverted'),     # every revertible change was put back
        ('partial', 'Partly reverted'),
    ]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                             related_name='change_sets')
    owner_kind = models.CharField(max_length=8, choices=OWNER_CHOICES)
    #: The USER message that started the chat turn (D6). SET_NULL: deleting a
    #: chat must not take the undo of its file changes with it.
    chat_message = models.ForeignKey('chat.ChatMessage', on_delete=models.SET_NULL,
                                     null=True, blank=True, related_name='change_sets')
    execution = models.ForeignKey(ExecutionLog, on_delete=models.SET_NULL,
                                  null=True, blank=True, related_name='change_sets')
    parent = models.ForeignKey('self', on_delete=models.SET_NULL, null=True,
                               blank=True, related_name='children')
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='open')
    #: True when a change could not be recorded or the row cap was hit, so the
    #: UI can say "some changes may be missing from this list".
    incomplete = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    closed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=['user', '-created_at'])]
        constraints = [
            models.UniqueConstraint(fields=['execution'],
                                    condition=Q(execution__isnull=False),
                                    name='changeset_one_per_execution'),
            models.UniqueConstraint(fields=['chat_message'],
                                    condition=Q(status='open'),
                                    name='changeset_one_open_per_message'),
        ]


class Change(models.Model):
    """One target's before and after within a change set (D1)."""

    TARGET_CHOICES = [('document', 'File'), ('folder', 'Folder'),
                      ('memory', 'Memory'), ('agent', 'Agent settings'),
                      ('', 'Untracked')]
    OUTCOME_CHOICES = [('reverted', 'Reverted'), ('skipped', 'Skipped'),
                       ('failed', 'Failed')]

    change_set = models.ForeignKey(ChangeSet, on_delete=models.CASCADE,
                                   related_name='changes')
    #: Order of first touch within the set. Reverts walk it backwards.
    seq = models.PositiveIntegerField()
    target_type = models.CharField(max_length=10, choices=TARGET_CHOICES, blank=True)
    target_id = models.BigIntegerField(null=True, blank=True)
    #: The first tool that touched it, and the call id, for the run page link.
    tool = models.CharField(max_length=100)
    call_id = models.CharField(max_length=100, blank=True, default='')
    #: Plain words for the list: "/Chat/report.docx", "Memory: works in IST".
    label = models.CharField(max_length=300)
    before = models.JSONField(null=True, blank=True)   # None = did not exist before
    after = models.JSONField(null=True, blank=True)
    content_changed = models.BooleanField(default=False)
    revertible = models.BooleanField(default=True)
    #: Why not revertible, in plain words (untracked rows, too-large files).
    reason = models.CharField(max_length=200, blank=True, default='')
    reverted_at = models.DateTimeField(null=True, blank=True)
    outcome = models.CharField(max_length=10, choices=OUTCOME_CHOICES, blank=True, default='')
    outcome_note = models.CharField(max_length=300, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['seq']
        constraints = [
            models.UniqueConstraint(fields=['change_set', 'target_type', 'target_id'],
                                    condition=Q(target_id__isnull=False),
                                    name='change_one_row_per_target'),
        ]
```

`logs` already has foreign keys to `chat.ChatMessage` (`Feedback`,
`RunSignal`), so the string reference is an existing pattern.

`inference/models.py::DocumentVersion` gets
`change_set_id = models.BigIntegerField(null=True, blank=True, db_index=True)` (D3).

Thresholds (`workflow_backend/thresholds.py`):
`MAX_CHANGES_PER_SET = 500`, `CHANGE_SET_IDLE_SECONDS = 600`,
`CHANGE_LIST_LIMIT = 500`.
Settings (`base.py`): `CHANGE_HISTORY_DAYS` (default: the value of
`RECYCLE_BIN_RETENTION_DAYS`, because after that a trashed file cannot come
back anyway) and `CHANGE_SET_SWEEP_SECONDS` (default 86400).

### 6.2 The binding (`logs/changes.py`)

```python
@dataclass
class Binding:
    user_id: int
    owner_kind: str                 # 'chat' | 'run'
    chat_message_id: int | None = None
    execution_id: str | None = None # ExecutionLog.execution_id as a string
    parent_set_id: int | None = None
    tool: str = ''
    call_id: str = ''
    #: Filled on first use so one call does one lookup.
    set_id: int | None = None
    #: How many changes this call recorded. A counter on a shared object, not a
    #: new Binding, so a sync_to_async thread's copy of the context still
    #: updates the same object (the side_calls.py trick).
    recorded: int = 0

_binding: ContextVar[Binding | None] = ContextVar('change_binding', default=None)

def bind(b: Binding) -> Token: ...
def unbind(token: Token) -> None: ...
def current() -> Binding | None: ...

def current_set_id(*, create: bool) -> int | None: ...   # sync
async def acurrent_set_id(*, create: bool) -> int | None: ...   # sync_to_async wrapper
```

`current_set_id(create=True)`:
- No binding: `None`.
- `owner_kind == 'run'`: `get_or_create` on the `ExecutionLog` with that
  `execution_id`, defaults `user_id`, `owner_kind='run'`,
  `parent_id=parent_set_id`, `status='closed'`. (Run sets need no open/closed
  state; liveness comes from the run's own status, §6.6. Use `closed` so the
  chat-only unique constraint never matters.) If no `ExecutionLog` row exists,
  return `None`.
- `owner_kind == 'chat'`: the `open` set for that message, else create one.
  On `IntegrityError` (two creators raced the unique constraint), read it
  again.
- Cache the id on `binding.set_id`.

**Where it is bound.** In `chat/turn/agent.py::_dispatch_one`:

```python
owner = batch.tool_context.get('change_owner')   # dict or None
# Always bind, None included (D18): an inline child run must never record
# into its parent's set.
binding = changes.Binding(**owner, tool=call.name, call_id=call.id) if owner else None
token = changes.bind(binding)
try:
    ...existing dispatch...
finally:
    changes.unbind(token)
```

Then the untracked fallback (D8), after the call, still inside the binding:

```python
if owner and status == 'completed' and binding.recorded == 0:
    entry = registry entry for call.name (None for MCP)
    if effect_of(call.name) != 'read' and (entry is None or entry.journal) \
            and not _looks_like_error(output):
        await sync_to_async(changes.record_untracked)(
            label=<entry.action_label or call.name> + ': ' + <short target from args>,
            external=bool(entry and entry.external) or entry is None,
            effect=effect_of(call.name))
```

`_looks_like_error(output)`: true when the output parses as JSON with a
top-level `error` key, or `status == 'error'`, or starts with `"Error"`.
Write a unit test with real outputs from three tools.

**`TurnContext` gets one field**: `change_owner: dict | None = None`
(`chat/turn/agent.py`). `_tool_context` copies it into the dict as
`'change_owner'`. The dict holds `user_id`, `owner_kind`,
`chat_message_id`, `execution_id`, `parent_set_id`.

- Chat (`pipeline.py`, the `TurnContext(` around line 1127):
  `change_owner={'user_id': user.id, 'owner_kind': 'chat', 'chat_message_id': user_message.id}`.
  Only in `run_chat_turn`. Not in the guest surface (D11).
- Agent runs (`agents/agent/runtime.py`): every `TurnContext(` built for a
  run gets `{'user_id': user.id, 'owner_kind': 'run', 'execution_id':
  str(log.execution_id), 'parent_set_id': change_parent_id}`, or `None` when
  `caller == 'eval'` (D11). Phase 0 lists every `TurnContext(` call.

### 6.3 Recording

All recording functions are **sync**, do nothing without a binding, and
**never raise**. On any exception they log, set `incomplete=True` on the set
if they can, and return. The write they follow has already happened, and
failing it now would be worse (the same rule as `versions.snapshot`).

```python
def doc_state(doc) -> dict:
    # {'folder_id', 'name', 'trashed': doc.deleted_at is not None,
    #  'etag': doc.updated_at.isoformat() if doc.updated_at else None}

def folder_state(folder) -> dict:
    # {'parent_id', 'name', 'trashed': folder.deleted_at is not None}

def record_document(doc_id: int, *, before: dict | None, content: bool, label: str) -> None
def record_folder(folder_id: int, *, before: dict | None, label: str) -> None
def record_memory(*, memory_id: int | None, before: dict | None, after: dict | None, label: str) -> None
def record_agent(agent_id: int, *, before: dict | None, after: dict, label: str) -> None
def record_untracked(*, label: str, external: bool, effect: str) -> None
```

`record_document` (the others follow the same shape):
1. `b = current()`; no binding: return.
2. `set_id = current_set_id(create=True)`; `None`: return.
3. Reload the row with `Document.all_objects` (it may be trashed now).
4. `get_or_create(change_set_id=set_id, target_type='document',
   target_id=doc_id)`. When creating: `seq = <max seq in set> + 1`,
   `before = before` (the caller's pre-action state; `None` for a new file),
   `tool = b.tool`, `call_id = b.call_id`. If the set already has
   `MAX_CHANGES_PER_SET` rows, do not create: set `incomplete=True` and return.
5. Always: `after = doc_state(doc)`, `label = label`, and
   `content_changed = content_changed or content`.
6. `b.recorded += 1`.

Run steps 4–5 in one `transaction.atomic()` with `select_for_update()` on the
row. Two serial calls in one run cannot race, but a run and its worker can.

**How the vfs uses it.** In each write path, take the state *before* the
write and record *after* it:

```python
from logs import changes                     # deferred, inside the function
before = changes.doc_state(doc) if doc is not None else None
... the existing write ...
changes.record_document(doc.id, before=before, content=True, label=render(scope, parts))
```

| vfs path | before | content |
|---|---|---|
| create a new file (`_write_text_locked` create branch, `_create_binary`, `export_file`, `copy` of a file) | `None` | `True` |
| overwrite (`_write_text_locked` save branch, `_replace_in_place`, `_edit_locked`, `edit_document`, `edit_deck`, `restore_file_version`) | `doc_state(doc)` | `True` |
| `delete` of a file | `doc_state(doc)` | `False` |
| `move` / rename of a file | `doc_state(doc)` | `False` |
| `_make_dirs` (D17), for each folder it **creates** (not ones that existed) | `record_folder(id, before=None)` | — |
| `delete` / `move` of a folder | `record_folder(id, before=folder_state(f))` | — |
| `copy` of a folder | `record_folder(new_id, before=None)` for the new top folder only | — |

Phase 0 confirms this list against the code and adds any write path it
finds. The **label** is the path the model saw (`render(scope, parts)`).

**Version stamping (D3).** In `inference/versions.py::snapshot`:
- `set_id = changes.current_set_id(create=True) if source == 'agent' else None`
  (deferred import, inside the `try`).
- Coalesce only when `latest['source'] == source` **and**
  `latest['change_set_id'] == set_id` and it is inside the window. Add
  `change_set_id` to the `.values(...)` call.
- Save `change_set_id=set_id` on the new version.
- `listing()` returns `change_set_id` too.

App saves have no binding, so `set_id` is `None` and they coalesce exactly as
before. Keep the existing version tests green.

### 6.4 What the revert does, per target

Each change is reverted in its own `transaction.atomic()`. Each one ends with
`outcome` set to `reverted`, `skipped` (with a note) or `failed` (with a
note; the exception is logged). A change with `outcome == 'reverted'` is
never touched again.

**Document.** `doc = Document.all_objects.filter(pk=target_id,
user=set.user).first()`.
1. `doc is None` (purged) → skipped: "This file is gone for good (the bin was
   emptied)."
2. **Changed since?** Skip with "Changed after this run — restore an older
   version from the file's history instead" when any of these holds:
   `office_edit.is_stale(doc, after['etag'])`; `doc.deleted_at is not None`
   differs from `after['trashed']`; `doc.folder_id != after['folder_id']`;
   `doc.name != after['name']`.
3. `before is None` (the set created it): if not already trashed,
   `recycle.trash(user, documents=[doc])` → reverted.
4. Otherwise, in this order:
   a. trashed now and `before['trashed']` is false →
      `recycle.restore(user, document_ids=[doc.id])`. If the result lists it
      under `refused` (for example `parent_still_trashed`) → skipped with that
      reason, in plain words.
   b. `content_changed` → `v = DocumentVersion.objects.filter(document=doc,
      change_set_id=set.id).order_by('created_at', 'id').first()`. No `v` →
      skipped: "No copy from before this run was kept (the file was too large,
      or only the last 25 versions are kept)." Otherwise
      `versions.restore(doc, v)`.
   c. `folder_id` or `name` differ from `before` → move back with the D20
      helper (`Document.all_objects.filter(pk=).update(folder_id=, name=,
      file_type=)`, the file type from `vfs._file_type(name)`; do not build a
      fake `FileScope`). Check the name first the way `vfs.move` does
      (`vfs.py:2014`). If the old name is taken in the old folder →
      skipped: "Could not move it back: a file named X is already there."
   → reverted.

**Folder.**
1. Missing → skipped. Changed since (`parent_id`, `name`, `trashed` differ
   from `after`) → skipped.
2. `before is None` (created by the set): if it has **no live children**
   (documents or folders) → `recycle.trash(user, folders=[folder])` →
   reverted. Otherwise skipped: "Not removed: it now holds files this run did
   not make." Reverse `seq` order means the files the run made inside it have
   already been trashed by this point.
3. Otherwise restore from the bin and/or move back, as for documents.

**Memory** (Phase 7). `before is None` (added): delete the row if it still
exists and its text equals `after['text']`, else skipped. `after is None`
(removed): `core.memory.remember(user, before['text'], before['category'])`
→ reverted.

**Agent settings** (Phase 7). `after['revision']` must equal the agent's
newest revision number, else skipped ("The agent was edited again since").
Then `logs.revisions.restore(agent, before['revision'], user=user)` (moved
out of the view in Phase 7). A created agent (`before is None`) is skipped in
this plan: "Delete the agent from its page if you don't want it." Deleting
an agent is too big a step to hide inside an undo.

**Untracked.** Never touched. Listed with `reason`.

### 6.5 Revert order and locking (`logs/undo.py`)

```python
class RevertRefused(Exception):
    """409 with a plain-words reason: still running, already reverting."""

def describe(change_set) -> dict      # the tree for the sheet (§6.7), bounded
def revert(change_set, user, *, change_ids: list[int] | None = None) -> dict
```

`revert`:
1. **Live check (§6.6).** Live → `RevertRefused`.
2. **Lock:** `ChangeSet.objects.filter(pk=..., user=user,
   status__in=['open', 'closed', 'partial']).update(status='reverting')`. 0
   rows → `RevertRefused('This change set is already being undone.')`.
3. `try:` walk the tree **depth first, children before parents, newest child
   first** (`children` by `-created_at`), and within each set the changes by
   **`-seq`**. Stop descending at `MAX_DELEGATION_DEPTH`
   (`agents/agent/orchestrator.py`, which imports only the standard library).
   If `change_ids` is given, revert only those ids. They may belong to child
   sets; check every id is in the tree, else 404.
4. `finally:` set each touched set's status: `reverted` when none of its
   revertible changes are left un-reverted, else `partial`.
5. Return `{'outcomes': [{'change_id', 'label', 'outcome', 'note'}],
   'reverted': n, 'skipped': n, 'failed': n, 'not_revertible': n}`.

The revert runs **sync**, inside the request. It touches at most
`MAX_CHANGES_PER_SET` × tree size rows, and each step is a DB write or a file
restore. If a tree has more than `CHANGE_LIST_LIMIT` changes, refuse with
"Too many changes to undo at once. Undo the workers one by one." Do not
spawn the revert in the background: the user is waiting for the answer.

### 6.6 When a set is "live"

A revert of a live set must be refused, or it fights the run that is still
writing.

- Run set: live when its `ExecutionLog.status` is not a finished status. Read
  `ExecutionLog.STATUS_CHOICES` in Phase 0 and write the finished set into
  `logs/undo.py` as `FINISHED_RUN_STATUSES` with a comment.
- Chat set: live when `status == 'open'` and
  `updated_at > now - CHANGE_SET_IDLE_SECONDS`. (A turn paused for approval
  stays open. After 10 idle minutes it may be reverted.)
- A set is live if **any descendant** is live. Say which one: "The worker
  'Researcher' is still running."

### 6.7 Closing chat sets and the message chip (Phase 5)

`changes.close_chat(user_id, chat_message_id) -> dict | None`: sets the open
set to `closed` with `closed_at`, and returns `summary(set)`, or `None` when
there is no set or it holds no changes in its whole tree.

`summary(set)` = `{'set_id', 'total', 'revertible', 'not_revertible',
'incomplete'}`, counted over the tree (children included).

Call it in `pipeline.py` in three places:
- just before the final assistant `ChatMessage.objects.acreate(...)`: `if s:
  metadata['changes'] = s`;
- just before the interrupted assistant row (around line 707);
- in the `except llm.LLMUserActionable` branch, before `raise TurnError`.

Do **not** close on a pause for approval. Detached workers may still add
changes after the turn closes. The chip shows the count at close time, and
the sheet always fetches the live tree.

### 6.8 Routes (`logs/urls.py`, thin sync views; ORM in `logs/changes.py` / `logs/undo.py`)

| Route | Method | Does |
|---|---|---|
| `/api/logs/changes/sets/<id>/` | GET | `describe()`: the set, its changes (newest first) and its children, nested; each change has `id, label, target_type, revertible, reason, outcome, outcome_note, tool`, plus `live` and `live_reason` on the set. Capped at `CHANGE_LIST_LIMIT` rows over the tree, `truncated` in the body |
| `/api/logs/changes/sets/<id>/revert/` | POST | Body `{change_ids?: int[]}`. 200 with the outcome list; 409 `{detail}` for `RevertRefused`; 404 for unknown or foreign |
| `/api/logs/executions/<id>/` | GET (existing) | Add `change_set: summary or null`, the set whose `execution` is this run |

Same 404 for unknown and foreign ids (CLAUDE.md core rule): filter by
`user=request.user` in the query.

### 6.9 Retention

`changes.purge_old_sets()` deletes sets with `created_at` older than
`CHANGE_HISTORY_DAYS` (changes cascade). Register it like §5.6:
`logs/tasks.py` task `logs.purge_change_sets`, a `CELERY_BEAT_SCHEDULE`
entry, and a `PeriodicJob('logs.purge_change_sets',
'CHANGE_SET_SWEEP_SECONDS', ...)`. `DocumentVersion.change_set_id` is left
pointing at nothing. That is harmless, because revert only reads it through
a live set.

---

## 7. Phases

Before every phase:
- `git status` must be clean or hold only this plan's earlier phases.
- Grep `DESIGN_HISTORY.md` for each file you are about to change
  (`grep -n "inference/versions" DESIGN_HISTORY.md`) and read the matching
  entries. CLAUDE.md asks for this.

How to run the checks:
- Backend, from `Backend/`: `pytest <paths>`, `python manage.py
  makemigrations --check --dry-run`, `lint-imports`.
- Frontend, from `better-n8n-frontend/`: `npx tsc -b --force` (plain `tsc
  --noEmit` checks zero files), `npm run lint` (the baseline is zero
  problems), and vitest **run from PowerShell with an upper-case `C:\` path**
  (from a lower-case `c:\` working directory every suite "fails").
- Phone app, from `mobile-native/`: `npx tsc --noEmit`, `npm run lint`.
- Tests that resolve credentials need `cache.clear()` in `setUp`.

### Phase 0: facts (no code changes except this file)

Answer each item below and write the answers into a "Phase 0 results"
section at the end of this file.

1. **ContextVars reach `sync_to_async` threads.** Write a throwaway test: set
   a ContextVar holding an object, call a sync function through
   `sync_to_async` that mutates the object, check the change is visible. Also
   check that an `asyncio.gather` child task sees the same object. (asgiref
   copies the context, which is what `side_calls.py` relies on. Prove it with
   the installed version.)
2. **Every agent write path.** In `inference/vfs.py`, list every function
   that creates, overwrites, trashes, moves, renames or copies a document or
   folder: grep `Document.objects.create`, `Folder.objects.create`,
   `save_text(`, `replace_bytes(`, `recycle.trash(`, `versions.restore(`,
   `.save(`, `.update(`. Then grep `chat/tools/*.py` and
   `chat/tools/google/*.py` for any of those **outside** `vfs` (a tool that
   writes files without the vfs). Write the table.
3. **Every `TurnContext(`** in `agents/agent/runtime.py` and `chat/`. Mark
   which are agent runs, which is the chat turn, which are guest or eval.
4. **Every call that starts a worker** from a tool: grep
   `start_agent_run(`, `run_agent(`, `start_agent_run_and_wait(` in
   `chat/tools/`. List the file and function.
5. **`ExecutionLog.STATUS_CHOICES`**: which values are finished.
6. **`chat/tools/google/client.py::_request`**: which context keys it reads.
7. **`vfs.move` / `vfs.copy`**: their exact names and the model-level helper
   that changes `folder`/`name` (for §6.4 "move back").
8. **Baseline tests**: run `pytest logs inference messaging chat/tests
   agents/tests core/tests` and write down any failures that exist before
   you start, so later phases do not chase them.

Done when: the results section exists and every item has an answer.

### Phase 1: send window, backend

**Files:** `messaging/models.py`, new `messaging/migrations/0003_*.py`,
new `messaging/holds.py`, `messaging/views.py`, `messaging/urls.py`,
`messaging/tasks.py`, `chat/tools/talk.py`, `chat/tools/google/gmail.py`,
`notifications/models.py` (+ its migration), `workflow_backend/settings/base.py`,
`agents/scheduler.py`, `Backend/.env.example`.

**Steps:** §5.1–§5.6 in order.

**Tests** (new `messaging/tests/test_holds.py`, unless noted):
- An attended `message_send` with `OUTBOUND_HOLD_SECONDS=20` makes a `held`
  row, returns `queued: true`, and calls the adapter **zero** times. Mock
  `adapter_for(...).send`.
- An unattended caller (`'trigger'`) sends at once, and its output equals the
  output from before this change. Pin the old shape in the test.
- `OUTBOUND_HOLD_SECONDS=0`: sends at once.
- `deliver()` on a `held` row past `send_at` sends once. Calling it twice
  sends once (the second returns `'skipped'`).
- `cancel()` before delivery → `cancelled`, and a later `deliver()` sends
  nothing. `cancel()` after `sent` → `'too_late'`.
- `send_now()` then `deliver()` sends before `send_at` would have passed.
- `sweep()` delivers an overdue `held` row; turns a `sending` row older than 5
  minutes into `unknown`, does **not** call the adapter, and creates a
  notification.
- A provider error during `deliver()` → `failed` + a notification; no
  retry.
- Gmail: the same four cases with `send_json` mocked
  (`chat/tests/test_gmail_hold.py`).
- Views: list is user-scoped and capped; cancel/send-now on another user's
  id → 404, same body as a made-up id.
- `agents/tests/test_scheduler.py` (existing) passes with the new beat entry.

**Done when:** the tests pass, `makemigrations --check` is clean,
`lint-imports` passes, and the baseline from Phase 0 has no new failures.
Add the DESIGN_HISTORY entry and the API.md rows (Phase 9).

### Phase 2: send window, web

**Files:** `src/api/messaging.ts` (add `listHolds`, `cancelHold`,
`sendHoldNow`), new `src/components/content/PendingSends.tsx`, new
`src/hooks/usePendingSends.ts`, `features/chat/components/StandaloneChat.tsx`,
`components/activity/RunDetail.tsx`, `features/chat/lib/turnReceipt.ts`.

**What to build:**
- `usePendingSends({sessionId?, executionId?, nudge})`: fetches
  `listHolds`. Polls every 2 s **only while** a row is `held` or `sending`,
  and stops when none are. Re-fetches when `nudge` changes. The chat passes a
  counter it bumps whenever a tool trace entry for `message_send` or
  `gmail_send_message` arrives in the live turn.
- `PendingSends` (props only): one row per hold: label, a countdown from
  `send_at` (computed on the client from `seconds_left` at fetch time, ticking
  every second), **Cancel** and **Send now** (44 px targets on phones). After
  the action it shows "Cancelled" / "Sent ✓" / "Not sent: <error>" / "Might
  not have been sent" for 2 minutes, then hides. `aria-live="polite"`.
- Place it above the composer in the chat, and at the top of `RunDetail`.
- `turnReceipt.ts`: when the send's trace output has `queued: true`, the
  phrase is "queued a message" (and "queued an email").

**Tests:** `src/components/content/__tests__/PendingSends.test.tsx`: the
countdown renders; Cancel calls the callback with the id; a cancelled row
says "Cancelled". `turnReceipt.test.ts`: the queued phrase.

**Done when:** tsc, lint (zero) and vitest pass. Then check by hand: send
a Slack or Gmail message from chat in `ask` mode, approve it, see the bar,
press Cancel, and confirm nothing arrived. Then repeat and let it go. Do this
at 390×844 and 1440×900. Write what you saw in the Progress table.

### Phase 3: change log, model and recording

**Files:** `logs/models.py` + migration, new `logs/changes.py`,
`inference/models.py` + migration (`DocumentVersion.change_set_id`),
`inference/versions.py`, `inference/vfs.py`, `chat/turn/agent.py`
(`TurnContext.change_owner`, `_tool_context`, `_dispatch_one`),
`chat/turn/pipeline.py` (the owner only, not closing yet),
`agents/agent/runtime.py` (the owner, `change_parent_id` kwarg accepted and
stored but not yet passed by any tool), `chat/tools/registry.py`
(`journal: bool = True` on `@tool`, carried onto the entry like
`external`), the delegation tools (`journal=False`), `logs/tasks.py`,
`settings/base.py`, `workflow_backend/thresholds.py`, `agents/scheduler.py`.

**Steps:** §6.1, §6.2, §6.3, §6.9. Set `journal=False` on: every tool that
starts, steers, waits for or stops a worker (Phase 0 item 4 plus
`chat/tools/tasks.py`), `update_conversation_notes`, and `update_todos`.
Write the list, with one reason each, as a comment above the first of them.

**Tests:**
- `logs/tests/test_change_binding.py`: no binding → `record_document` is a
  no-op and makes no rows. With a run binding: one set per execution, reused.
  Chat binding: one open set per message, and a second set once the first is
  closed. The binding is visible inside `sync_to_async`.
- `logs/tests/test_change_record.py`, through the real `vfs` functions with a
  binding set:
  - write a new file → one row, `before None`, `content_changed`;
  - write the same file 3 times → still one row; `before` from the first
    write, `after` from the last;
  - edit an existing file → one row with `before` set, plus a
    `DocumentVersion` whose `change_set_id` is the set;
  - two different sets writing one file within 300 s → **two** versions (D3);
  - an app save with no binding still coalesces as before;
  - delete → `after.trashed` true; move → `after.folder_id` changed;
  - `make_dir` of `a/b/c` where `a` exists → two folder rows;
  - the 501st target → no row, `incomplete=True`.
- `chat/tests/test_dispatch_journal.py`: a fake `irreversible` tool that
  records nothing → one untracked row; a `read` tool → none; a tool with
  `journal=False` → none; a tool that returns `{"error": ...}` → none; a
  failed call → none.
- A test that every tool with `journal=False` has `effect != 'read'`, and
  that every name in the list is a registered tool.
- `agents/tests/test_scheduler.py` passes. `inference` version tests pass
  unchanged.

**Done when:** the tests pass, the migrations are clean, `lint-imports`
passes. Nothing is visible to users yet.

### Phase 4: revert engine and API

**Files:** new `logs/undo.py`, `logs/views.py`, `logs/urls.py`,
`logs/queries.py` (the `change_set` field on execution detail),
`logs/serializers.py` if the views use one.

**Steps:** §6.4 (documents and folders only; memory and agents come in Phase
7), §6.5, §6.6, §6.8 (without the chat chip).

**Tests** (`logs/tests/test_undo_documents.py`, `test_undo_api.py`):
- Created file → revert → it is in the bin.
- Edited file → revert → content equals the pre-run text; a `restore`
  version now holds the run's text (so the user can get it back).
- Edited 3 times in one run → revert → the text from before the first edit.
- Deleted file → revert → live again in its old folder.
- Moved file → revert → back in its old folder with its old name; old name
  taken → skipped with the note.
- Created, then edited, then deleted in one run → revert → in the bin (net
  effect: it did not exist).
- **User edited after the run → skipped, and the user's text is untouched.**
  This is the most important test in the plan. Write it first.
- Another run edited the file after → skipped.
- The before-version was pruned (make 26 versions) → skipped with the note.
- Created folder with the run's files in it → revert → files and folder all
  in the bin. Created folder that now also holds a user file → the run's
  files are trashed, the folder is skipped.
- Revert twice → the second does nothing (`already reverted`), with no
  errors.
- Live run → 409. Chat set open and fresh → 409; open and idle 11 minutes →
  allowed.
- Two reverts at once (call `revert` twice; the second while status is
  `reverting`) → the second is refused.
- `change_ids` subset → only those.
- Untracked rows are listed and never touched.
- API: foreign set id → 404, same body as a made-up id; the list is capped
  with `truncated`; execution detail carries `change_set`.

**Done when:** the tests pass; check by hand through the API with a local
agent run that writes, edits and deletes files.

### Phase 5: workers, closing, and the message chip

**Files:** every tool from Phase 0 item 4, `agents/agent/runtime.py`
(pass `change_parent_id` through `start_agent_run` →
`run_agent` → the run's `change_owner`, and through
`start_agent_run_and_wait`), `chat/turn/pipeline.py` (§6.7), and
`api/chat.ts` (the type of `metadata.changes`).

**Steps:**
1. In each delegating tool: `parent = await changes.acurrent_set_id(create=True)`
   and pass `change_parent_id=parent` to the run it starts. The parent set is
   created even if no worker ends up changing anything; an empty set has no
   chip and is purged later.
2. In the runtime: accept `change_parent_id: int | None = None` on
   `run_agent`, `start_agent_run` and `start_agent_run_and_wait`, and put it
   into `change_owner['parent_set_id']`. A resumed run (`resume_agent_run`)
   finds its set by execution, so the parent link already on the row is kept.
3. §6.7 closing in the pipeline.

**Tests** (`agents/tests/test_change_parent.py`, `chat/tests/test_change_close.py`):
- A chat turn that calls `run_agent` (fake agent writing one file) → the
  chat set has one child set holding the file change. Reverting the chat set
  trashes the file.
- The worker is still running → reverting the chat set is refused and the
  reason names the worker.
- The final assistant message has `metadata.changes` with `total == 1`. A
  turn with no changes has no `changes` key.
- An approval pause does not close the set; the resumed turn records into
  the **same** set.

**Done when:** the tests pass and `lint-imports` passes.

### Phase 6: revert UI, web

**Files:** new `src/api/changes.ts` (`getChangeSet(id)`,
`revertChangeSet(id, changeIds?)`), new `src/hooks/useChangeSet.ts`, new
`src/components/changes/ChangesSheet.tsx` (+ `index.ts`),
`features/chat/components/ChatMessageItem.tsx`, `StandaloneChat.tsx`,
`components/activity/RunDetail.tsx`, and
`features/chat/components/__tests__/chatPieces.test.tsx`.

**What to build:**
- **On a chat answer:** when `message.metadata.changes?.total > 0`, the
  receipt line ends with a link "Undo changes…". `ChatMessageItem` stays
  props-only: it calls `onOpenChanges(setId)`; `StandaloneChat` holds which
  set is open.
- **On a run page:** when `change_set` is present, a "Changes (N)" section
  with the same button.
- **`ChangesSheet`** (a side sheet on desktop, a bottom sheet on phones,
  following `CommandPalette`'s phone sheet):
  - Title "Undo what this run changed". A line on what happens: "Files go
    back to how they were before. Anything you changed since is left alone."
  - Groups: "Can be undone" (checkbox per row, all ticked) and "Can't be
    undone from here" (no checkbox, the `reason` under each). Workers'
    changes are grouped under the worker's name.
  - While `live`: the button is disabled and `live_reason` shows.
  - `incomplete`: "Some changes may be missing from this list."
  - Button "Undo N changes". After the call, every row shows its outcome
    ("Undone", "Skipped: changed after this run", ...). A toast sums it up:
    "6 undone, 1 skipped".
  - Already-reverted rows show "Undone" and no checkbox.
- 44 px touch targets; keyboard reachable; Escape closes.

**Tests:** `components/changes/__tests__/ChangesSheet.test.tsx`: groups render;
unticking a row leaves it out of the ids sent; live disables the button;
outcomes render after revert. `chatPieces.test.tsx`: `onOpenChanges` gets the
set id.

**Done when:** tsc, lint (zero) and vitest pass. Then check by hand at 390×844
and 1440×900: ask chat to have an agent write two files and edit one, undo
from the answer, and see the files go back. Then edit one file yourself in
the app first and confirm it is skipped. Write what you saw in Progress.

### Phase 7: memory and agent settings

**Files:** `chat/tools/memory.py`, `chat/tools/authoring.py`,
`logs/revisions.py`, `agents/views/agents.py`, `logs/undo.py`.

**Steps:**
1. Memory: in `remember_about_user`, when `created` is true:
   `record_memory(memory_id=row.id, before=None, after={'text', 'category'})`.
   In `forget_about_user`: read the matching rows **before** `forget`, then
   record one change per row with `before={'text', 'category'}, after=None`.
   `core/memory.py` is not changed (it is the foundation layer).
2. Agent settings: move the body of `agent_restore_revision` into
   `logs/revisions.py::restore(agent, number, *, user) -> SubAgentRevision`,
   keeping every check it has today. The view calls it. Existing tests must
   pass unchanged. In `update_agent` (`chat/tools/authoring.py`), record
   `before={'revision': <newest number before>}`, `after={'revision': <newest
   after>}`. In `create_agent`, record `before=None` (revert skips it, §6.4).
3. §6.4 memory and agent reverters.

**Tests:** remember → revert → the fact is gone; forget → revert → the fact is
back; update_agent → revert → the old config is live and the timeline shows a
`restore` revision; the agent edited again by hand → skipped; the moved
restore keeps the view's existing tests green.

**Done when:** the tests pass and `lint-imports` passes. (`logs` reading
`agents.config` is allowed: only `agents.agent` and `agents.views` are
forbidden.)

### Phase 8: phone app

**Files:** under `mobile-native/`. Read its `AGENTS.md` and `DESIGN.md`
first. Its request bodies must match the web's exactly.

**What to build:**
- The pending-send bar above the chat composer, with Cancel and Send now
  (same routes, same polling rule).
- "Undo changes…" on a chat answer that has `metadata.changes`, opening a
  screen with the same groups, checkboxes and outcomes as `ChangesSheet`.
- Record anything not built in `PARITY.md`.

**Done when:** `npx tsc --noEmit` and `npm run lint` pass. The app has no test
runner, so describe a by-hand check in Progress.

### Phase 9: docs (with each phase, not at the end)

- `Backend/docs/API.md`: a row for every new route (§5.5, §6.8) and the
  changed execution detail row.
- `Backend/docs/SAFETY_AND_GUARDRAILS.md`: a section on the send window
  (D12–D14) and on undo (D2, D8).
- `DESIGN_HISTORY.md`: one entry per built phase that made a decision, at
  least: "A send waits for the person watching" (Phase 1), "Undo is net
  effect per target, and never overwrites newer work" (Phase 3/4), "Change
  sets cross the detached boundary by id, not by context" (Phase 5). Next
  number after the last `## H-` heading.
- `logs/README.md`, `messaging/README.md`: the new files, in reading order.
- `CLAUDE.md`: the new env vars in the Environment Variables block
  (`OUTBOUND_HOLD_SECONDS`, `OUTBOUND_HOLD_SWEEP_SECONDS`,
  `CHANGE_HISTORY_DAYS`, `CHANGE_SET_SWEEP_SECONDS`); update this plan's
  status in the Internal Documentation list.
- `Backend/docs/README.md` and `Backend/docs/OPEN_WORK.md`: update the
  status line.
- `better-n8n-frontend/BEGINNER_GUIDE.md`: the two new components.

## 8. Things that will go wrong (read before each phase)

1. **Recording that raises.** A bug in `record_document` must never fail the
   file write the user asked for. Every recording function catches
   everything, logs, and sets `incomplete`.
2. **Recording the before-state too late.** `doc_state(doc)` must be taken
   *before* the write. After `save_text` the etag has already moved.
3. **Coalescing hides the before-copy.** If the D3 test (two sets, one file,
   within 300 s, two versions) fails, revert will silently restore the wrong
   text. Do not skip it.
4. **Recording app saves.** If `inference` tests start creating change sets,
   a binding has leaked. Bind only in `_dispatch_one`, and always unbind in
   `finally`.
5. **A ContextVar in a detached task.** `spawn()` uses an empty context, so
   a worker's tool calls are bound by the worker's own `_dispatch_one`, never
   by the parent. Do not "fix" a missing binding by copying the parent's
   context into `spawn`.
6. **`Document.objects` hides trashed rows.** Revert must read
   `Document.all_objects` / `Folder.all_objects`, or a deleted file looks
   "gone for good".
7. **Double send.** Only `deliver()`'s single conditional `UPDATE` may move a
   hold out of `held`. Never `get()` then `save()`. Never re-deliver a
   `sending` row.
8. **The model says "sent" for a queued message.** Keep the `rendered` text,
   and check one real transcript in Phase 2.
9. **Unbounded lists.** The holds list, the change tree and the revert are all
   capped, and say `truncated` / refuse past the cap.
10. **Foreign ids.** Every query filters by the requesting user. A foreign id
    gets the same 404 as a made-up one.
11. **Migrations across apps.** `logs` → `chat` (the `ChatMessage` foreign key)
    needs a migration dependency on chat's latest migration. Let
    `makemigrations` write it; do not hand-edit numbers.
12. **CRLF files.** Some files are CRLF. Edit with the Edit tool, not `sed -i`
    in Git Bash (it rewrites line endings).

## 9. Test matrix (the cases that matter most)

| Case | Expected | Phase |
|---|---|---|
| User edits a file after the run, then presses Undo | File untouched, row "skipped: changed after this run" | 4 |
| Run writes one file 5 times | One row; Undo gives the pre-run text | 3, 4 |
| Two runs edit one file within 5 minutes; undo the second | Text from after the first run | 3, 4 |
| Run deletes a file; Undo | File back in its folder | 4 |
| Chat delegates to a worker that writes files; Undo on the answer | Worker's files put back | 5 |
| Undo pressed while the worker still runs | Refused, names the worker | 5 |
| Agent sends an email in chat; user presses Cancel within 20 s | Nothing sent | 1, 2 |
| Server restarts during the 20 s | The sweep sends it after restart | 1 |
| Server dies while sending | `unknown` + notification; never sent twice | 1 |
| Scheduled agent sends at 3 a.m. | Sent at once, as today | 1 |
| MCP tool or calendar invite in a run | Listed as "can't be undone from here" | 3, 6 |

## 10. Out of scope (later work)

- **Redo** (undo the undo). The replaced state is already kept as a `restore`
  version and in the bin, so it can be recovered by hand.
- **Force revert** over newer changes.
- **Google reversals:** `gmail_modify_labels` (apply the inverse labels),
  `gmail_trash_message` (untrash), `drive_create_file` (trash),
  `sheets_update_values` (needs the old values read before the write). They
  are listed as untracked until then.
- **Holding calendar invites** (`calendar_create_event` sends invites at
  once).
- **Knowledge-base writes** (`create_knowledge_base`,
  `add_to_knowledge_base`), solutions, eval suites, dashboards, published
  pages: untracked for now.
- **Undo from the Activity list** (one button per row).
- **Code workspace changes** (`workspaces.CodeChange`, `revert_task`) joined
  into change sets (D19).
- Changing `sent_last_24h` so cancelled holds do not count (D13).

## 11. Questions for the user (defaults used until answered)

1. Hold time: **20 s** by default. Gmail offers 5–30 s. Should the user be
   able to change it in Settings?
2. Should unattended runs also hold (D12)? The default is no.
3. Should "Undo changes" also appear on the Activity list rows, or only on
   the chat answer and the run page (the default)?

---

## Phase 0 results (2026-11-23)

Checked on branch `feature/undo`. No code was changed. The scratch script is
`C:\Users\91700\AppData\Local\Temp\claude\undo_phase0\ctxcheck.py` (outside the repo).
Paths are from `Backend/` unless noted.

### 1. ContextVars reach `sync_to_async` and `gather` children

Ran `Backend/venv/Scripts/python.exe` on the script. Output:

```
asgiref version: 3.11.1
final counter: 3
```

A ContextVar holding a mutable object is visible to a `sync_to_async` call and
to both `asyncio.gather` children. Mutating the shared object works. This is
the property `Binding.recorded` and `side_calls.py` rely on. The script does
not test a child that calls `.set()` on the var: that change stays local to
the child. Django is 5.2.14.

### 2. Agent write paths (`inference/vfs.py`)

Every place that creates, overwrites, trashes, moves, renames or copies a file
or folder. "Public fn" is the vfs function a tool calls.

| # | Where | What it does | Public fn that reaches it |
|---|---|---|---|
| A | `vfs.py:1114` `_write_text_locked` create branch: `Document.objects.create` | create text file | `write_file` |
| B | `vfs.py:1141` and `:1394` → `office_edit.py:260` `save_text` → `versions.snapshot` + `doc.save`, or `replace_bytes` if the file has bytes | overwrite (or append) text | `write_file`, `edit_file` |
| C | `vfs.py:1232-1253` `_create_binary`: `Document(...)`, `file.save`, `doc.save` | create binary | `write_binary` |
| D | `vfs.py:1278` `_replace_in_place` → `office_edit.py:179` `replace_bytes` (`snapshot` 203, `file.save` 206, `doc.save` 235, queryset update 240, blob delete 254) | overwrite binary in place | `write_binary(overwrite=True)` |
| E | `vfs.py:1455` `versions.restore` → `snapshot(…,'restore')` then `replace_bytes` or `doc.save` (`versions.py:127-163`) | overwrite (restore) | `restore_file_version` |
| F | `vfs.py:1478/1480` `write_file` / `write_binary` (`overwrite=False`) | create a new file beside the source | `export_file` |
| G | `vfs.py:1564` and `:1683` → `office_edit.py:422` `edit_spec` → `replace_bytes` (`:445`, `:456`) | overwrite docx / pptx | `edit_document`, `edit_deck` |
| G2 | `vfs.py:1503` `importers.import_upload` → `importers.py:461` `replace_bytes(version_source=None)` plus the spec in metadata | convert an uploaded docx/pptx on first edit (**hidden write**) | `edit_document`, `edit_deck` (via `_editable_spec`) |
| H | `vfs.py:1863` `make_dir`, `:1892` `folder_for_write`, `:2008` `move`, `:2069` `copy`, `:2159` inside `_make_dirs` → `filesystem.py:367` `ensure_folder` → `:262` `create_folder` → `:275` `Folder.objects.create` | create folder(s) | `make_dir`; also `write_file`, `write_binary`, `move`, `copy`, `folder_for_write` |
| I | `vfs.py:1916` `recycle.trash(documents=)` (`recycle.py:60`, queryset update `deleted_at`) | trash file | `delete` |
| J | `vfs.py:1922` `recycle.trash(folders=)` | trash folder (and its subtree) | `delete` |
| K | `vfs.py:2020-2021` `Document.objects.filter().update(folder, name, file_type)` | move or rename file (no `updated_at` bump) | `move` |
| L | `vfs.py:2029` `fs.rename_folder` (`filesystem.py:389`, `save(update_fields name, updated_at)`) | rename folder | `move` |
| M | `vfs.py:2032` `fs.move(folders=[…])` (`filesystem.py:411`) | move folder | `move` |
| N | `vfs.py:2075` `office_edit.copy` (`office_edit.py:533`, `save`, `file.save`) and `:2078` queryset update of name, type, metadata | copy file | `copy` |
| O | `vfs.py:420` `chat_scope` → `fs.ensure_folder('/Chat')`; `vfs.py:443-444` `agent_home` → `/Agents`, `/Agents/<name>` | create system folders when a scope is built | none (scope builders, not tools) |
| P | `chat/tools/sandbox.py:315` calls `vfs._make_dirs` directly, then `write_*` (`:322`, `:334`) | folders for sandbox outputs | not a public fn |

Not a vfs write, but reached from a read path inside vfs:

- `drafts.ensure_rendered` (`inference/drafts.py:189`) renders a pending
  **user** draft by calling `replace_bytes` (`drafts.py:215, 251, 268`). It is
  called from `vfs._existing` (`vfs.py:1416`), which is used by `file_versions`,
  `export_file`, `restore_file_version` and `_editable_spec`. It is also called
  from `_replace_in_place` (`:1277`) and `copy` (`:2064`).

Non-vfs writes that chat tools reach:

| Where | What | Notes |
|---|---|---|
| `chat/tools/conversation.py:362` `update_conversation_notes` → `chat/turn/session_notes.py:779` `set_notes_sync` → `:800` `_write_notes_only` → `:812` `office_edit.save_text` | writes `/Chat/Conversations/*.md` | bypasses the vfs public API |
| `chat/turn/session_notes.py:694-727` background `update` (spawned) → `:615` `save_text`, `:622` `vfs.write_file` | notes after each turn | spawned, so no binding |
| `inference/kb_folders.py:100-104` `vfs.write_file` then `doc.save(update_fields=[knowledge_base, status])` | `add_to_knowledge_base` tool | second write after the vfs write |
| `inference/kb_folders.py:66` `vfs.folder_for_write` | `create_knowledge_base` tool | goes through vfs |
| `chat/tools/code.py` `ws_write`, `ws_edit`, `ws_apply_patch`, `ws_run`, git tools | writes a sandbox VM project through `workspaces/engine.py`, and `_record_change` (`:882-941`) creates `workspaces.CodeChange` | not the Document tree; see surprise 1 |
| `chat/tools/publish.py:86` → `inference/pages.py:37-124` `publish` | `PublishedPage` row and file | not a `Document` |
| `chat/tools/docs.py` `ocr_document`, `chat/tools/workspace.py` `extract_data` | `run_extraction` creates extraction rows | no Document writes |

Chat tools that write files **through vfs** (covered if recording sits inside
the vfs write functions): `files.py` (all file tools), `sandbox.py`
(`_save_outputs`), `office.py` (`render_*`, `edit_workbook`, `render_diagram`,
imported by name as `write_binary`), `browser.py:72-79, 531-560`,
`media.py:203-227`, `fetch.py:114-156`, `data.py:248`, `voice.py:121, 200`,
`compute.py:342-367`, `apicaller.py:337, 360`.

Google tools (`chat/tools/google/*.py`) write **no local file**. Their only
local write is a temp file in `drive.py:74`. The remote writes, all untracked, are:
`calendar_create_event`, `calendar_update_event`, `calendar_respond_to_event`,
`calendar_delete_event`, `drive_create_file`, `sheets_update_values`,
`docs_create`, `docs_append`, `gmail_create_draft`, `gmail_send_message`,
`gmail_modify_labels`, `gmail_trash_message`.

Non-agent writers, for completeness: `chat/turn/pipeline.py:1561` (inbound
channel media becomes a Document), `chat/sources/attachments.py:167` (user
upload), `inference/views.py` (user HTTP), `imagine/services/documents.py:236`
(imagine jobs, `dispatcher.py:142, 222`, `tasks.py:50`), `eval/kb_world.py:72`.

### 3. Every `TurnContext(` construction

| Where | Enclosing function | Kind |
|---|---|---|
| `chat/turn/pipeline.py:1127` | `run_chat_turn` (line 771), called from `chat/views.py:230` and `:276` | **chat turn** |
| `agents/agent/runtime.py:2261` | `run_agent` (line 2068) | **agent run**; `caller` decides which kind (see below) |
| `chat/turn/agent.py:1102` | `replace(turn, effort=…)`: a copy, not a new construction | copies keep `change_owner` (dataclass `replace`) |

Callers of `run_agent` set `caller` (default `'api'`). The caller then selects
the kind: `'eval'` is an eval (`eval/runner.py:318, 326`); `'trigger'` and
`'orchestrator'` and `'mission'` are unattended runs. The guest surface does
**not** build a `TurnContext`. `chat/guest/runtime.py::stream_guest_chat`
(line 124) calls the provider directly over httpx (line 169) and has no tool loop.

`TurnContext` is defined at `chat/turn/agent.py:109`. Its `execution_id` field
is at line 442. `turn_id` is at line 146 and is generated on each construction.

### 4. Worker starts from tools

| File:line | Enclosing function (tool name) | Call | Detached? |
|---|---|---|---|
| `chat/tools/agents.py:561` | `run_agent` (tool `run_agent`, schema at 463; def at 493) | `start_agent_run` (imported line 507) | yes: `runtime.py:2751` `spawn` |
| `chat/tools/agents.py:1054` | `invoke_subagent` (tool `invoke_subagent`, schema at 819; def at 866) | `run_agent` (runtime, imported at 995) | **no**: awaited inline, so it shares the caller's context |
| `chat/tools/tasks.py:499` | `_launch_one` (def 375), called from `start_tasks` (tool `start_tasks`, schema at 151, def at 181) at line 275 | `run_agent` (inside nested `_run()`) | yes: `_run` is `spawn`ed at `tasks.py:548` |

- `start_agent_run_and_wait`: no call in `chat/tools/`. Its only caller is
  `agents/sweep.py:417`, a periodic job, and `missions/sweep.py:249` (also a job).
- `missions/`: no call. `chat/tools/missions.py::start_mission` (line 174)
  does not start a run directly.
- Not a tool: `chat/commands/agents.py:166` (slash command).

Name collision: `chat/tools/agents.py` has a tool function `run_agent` (line
493), and `invoke_subagent` imports the runtime's `run_agent` inside its body
(line 995). It works, but the two are easy to confuse.

### 5. `ExecutionLog.STATUS_CHOICES` (`logs/models.py:123-131`)

| Value | Label | Finished? |
|---|---|---|
| `pending` | Pending | no (live) |
| `running` | Running | no (live) |
| `paused` | Paused | no (live; waiting on a person) |
| `completed` | Completed | **yes** |
| `failed` | Failed | **yes** |
| `cancelled` | Cancelled | **yes** |
| `timeout` | Timeout | **yes** |

Finished set: `completed, failed, cancelled, timeout`. It matches
`ExecutionLog.is_complete` (`logs/models.py:363`) and `logs/retention.py:36`
`_FINISHED`. Live set: `pending, running, paused`. It matches
`logs/activity.py:49 LIVE_RUN_STATUSES` and `agents/sweep.py:47 IN_FLIGHT_STATUSES`.
`paused` is live, so a paused run blocks revert (§6.6).
`AgentStep` has its own choices at `logs/models.py:571`. Do not confuse them.

### 6. `chat/tools/google/client.py::_request` (173-215)

It reads only `context["user_id"]` (line 176). Everything downstream uses that
user id:

- `_access_token(user_id)` (94) → `_load_credential` (71) →
  `CredentialManager.lookup_by_slug_sync(GOOGLE_CREDENTIAL_SLUG, user_id)`.
- `_token_for` (77) → `credential.get_valid_access_token`.
- `_send` (112) takes no context.

`get_json`, `send_json` and `download` only pass `context` through to `_request`.

So a Google call needs nothing from a change-set binding.

### 7. vfs move and copy

- `vfs.move(scope: FileScope, src: str, dst: str) -> dict` (`vfs.py:1979`).
- `vfs.copy(scope: FileScope, src: str, dst: str) -> dict` (`vfs.py:2039`).

**There is no shared model-level helper.** The plan's "find the shared helper"
does not exist. Each path writes its own columns:

| Target | Helper | Writes | Bumps `updated_at`? |
|---|---|---|---|
| File, `vfs.move` | inline, `vfs.py:2020-2021` | `folder`, `name`, `file_type` via queryset `.update` | no |
| File, rename only | `office_edit.rename(doc, raw_name)` (`office_edit.py:148`) | `name` via queryset `.update` | no. Only caller: `inference/views.py:374` (HTTP) |
| File, `fs.move(..., documents=)` | `filesystem.py:411`, `move(user, *, folders=(), documents=(), target)` | `folder` via `.update` (lines 474-476) | **yes**. It does not rename and does not check the name |
| File, restore from bin | `recycle.py:241` `_restore_document` | `folder` (None if the parent is gone, i.e. `relocated`), `deleted_at`, `trashed_directly`, `updated_at` via `save(update_fields=…)` | yes |
| Folder, same parent | `filesystem.py:389` `rename_folder(folder: Folder, name: str) -> Folder` | `name`, `updated_at` via `save(update_fields=…)` | yes |
| Folder, new parent | `filesystem.py:411` `move(...)` | `parent` via `folder.save()`, descendant `path`/`depth` via one `.update` | yes |

Name and validation helpers:
`filesystem.py:225 validate_name(name: str) -> str`;
`filesystem.py:361 folder_name_taken(user, parent, name, *, exclude_pk=None) -> bool`;
for files, the check is inline at `vfs.py:2014`.

Plan implication for §6.4: the "move back" step needs its own small helper that
does what `vfs.move` does for a file (`.update` of `folder`, `name`, without
touching `updated_at`). Do not use `fs.move(documents=…)`: it bumps `updated_at`,
which the next revert would read as "changed since", and it skips the name.

### 8. Baseline tests

Command (from `Backend/`): `venv/Scripts/python.exe -m pytest logs inference messaging chat/tests agents/tests core/tests -q -p no:cacheprovider`.
`pytest-timeout` is not installed here, so `--timeout` was dropped. `-x` was not used.

Result: **3209 passed, 4 skipped, 0 failed, 0 errors** (403 s, 559 subtests passed).
No pre-existing failures in these paths, so later phases should treat any failure as theirs.

Two earlier attempts were stopped and their output discarded. They wrote to the same file at once, so their results are not used.

### 9. Registry plumbing (`chat/tools/registry.py`)

- `Tool` dataclass: `@dataclass(frozen=True, slots=True)` at line 53. Fields:
  `external: bool = False` (line 105), `action_label: str = ""` (line 109),
  `trusted_output: bool = False` (line 118). A new `journal` field goes next to them.
- `tool(schema, *, requires, sensitive, parallel, effect, connector, timeout,
  external=False, action_label="", trusted_output=False)`, lines 123-153.
  The kwargs are at lines 127-134. `register` stores them at lines 149-153:
  `Tool(name, schema, func, requires, sensitive, parallel, effect, connector,
  timeout, external=external, action_label=action_label, trusted_output=trusted_output)`.
- Readers: `external_names()` (213), `external_of(name)` (218),
  `action_label_of(name)` (228; default "Approve" at 231).
  Consumers: `chat/tools/describe.py:52, 307, 309, 429`;
  `chat/turn/reviewer.py:168-173`.
- `DELEGATION_TOOLS` is defined in **three** places. Do not import the wrong one:
  - `chat/turn/reviewer.py:102` `DELEGATION_TOOLS = {run_agent, invoke_subagent, start_tasks}`
  - `chat/tools/__init__.py:187` `CHAT_DELEGATION_TOOLS` (11 names)
  - `chat/tools/describe.py:357` `_DELEGATION_TOOLS = {run_agent, invoke_subagent}`

### 10. URL mounts (`workflow_backend/urls.py`)

- `messaging/urls.py` is mounted at `api/messaging/` (line 117). So the webhook
  is `/api/messaging/hooks/<channel>/<secret>/`.
- `logs/urls.py` is mounted at `api/logs/` (line 66). So plan §6.8 paths are
  `/api/logs/changes/sets/<id>/` and `/api/logs/executions/<id>/`.
  `logs.activity_urls` is separately mounted at `api/activity/` (line 71).

### Surprises that contradict or extend the plan

1. **Code workspaces already record per-file changes.** `workspaces.CodeChange`
   (`workspaces/models.py:129`) is written by `chat/tools/code.py::_record_change`
   for `ws_write`, `ws_edit` and `ws_apply_patch`. It is read by
   `logs/activity.py:281-312` and `eval/runner.py:493`. The file's docstring says
   the UI "shows and reverts per file". I did not check that revert UI. Plan §1
   ("nothing records which run made which change") is only true for the Document
   tree. The plan needs a decision: does undo cover `CodeChange`, or is it a
   separate source?
2. **Folders are created in many places, not only by `make_dir`.** Every folder
   creation goes through `vfs._make_dirs` (`vfs.py:2137`). It is called from
   `write_file`, `write_binary`, `make_dir`, `folder_for_write`, `move`, `copy`
   and the private `sandbox.py:315` call. The scope builders `chat_scope` (420)
   and `agent_home` (443-444) also create `/Chat` and `/Agents/<name>` with no
   tool at all. §6.3 records folders only in `make_dir`. Recording belongs in
   `_make_dirs`, or in `fs.ensure_folder` when it actually creates a row. The
   system folders need an exclusion.
3. **Writes happen inside read paths.** (a) `drafts.ensure_rendered` renders
   the user's pending draft from `file_versions`, `export_file`,
   `restore_file_version` and `_editable_spec`. (b) `importers.import_upload`
   converts an upload the first time `edit_document` or `edit_deck` touches it
   (`importers.py:461`). If recording sits inside `replace_bytes` or `save_text`,
   a run would record the user's draft render and the import as agent changes.
   §6.3's table lists neither. The attribution rule must say what to do.
4. **Some writes skip the vfs public API.** `update_conversation_notes` writes
   notes via `office_edit.save_text` directly (`session_notes.py:812`). The
   `kb_folders.add_document` write is followed by a second `Document.save`
   (`kb_folders.py:104`). Recording inside vfs misses both unless the recording
   sits in `save_text` or `replace_bytes`.
5. **`invoke_subagent` runs its child inline.** It awaits `run_agent` in the same
   task (`chat/tools/agents.py:1054`), so the child shares the parent's
   ContextVar. §6.2's `_dispatch_one` only calls `bind()` when `change_owner` is
   set. A child run with no owner would then write under the chat's binding.
   Bind `None` explicitly in that case. The `_launch_one` worker is spawned
   (`tasks.py:548`), so it does not share the context.
6. **Mtime semantics differ by path.** `recycle.trash` (`recycle.py:87`) and
   `restore` (`:250`) bump `updated_at`. `vfs.move` for files does not. `fs.move`
   for documents does. §6.4's etag check is still correct as long as the
   after-state is captured after every write.
7. `versions._prune` (`versions.py:99-103`) deletes old `DocumentVersion` rows
   during a write. §6.4 already plans for a missing copy.
8. `chat/tools/agents.py` has a tool function and an imported function both named
   `run_agent` (see §4).
