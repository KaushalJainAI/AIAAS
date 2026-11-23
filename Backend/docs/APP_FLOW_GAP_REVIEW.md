# App-flow review — gap register

Found 2026-09-24/25 by tracing every application's flows against the code
(UI, API, runtime). One row per gap. `severity`: High / Med / Low.
`where` is the first file involved; the register previously carried the
full root-cause and fix detail, now dropped to keep this readable.

**Status:** C19 is fixed (2026-11-16). Everything else is open.
Every open item here is tracked once, in [OPEN_WORK.md](OPEN_WORK.md).
Verification (confidence) notes are dropped; the high-severity items were
read in the code before they were listed.

| ID | severity | gap | where | status |
|---|---|---|---|---|
| C1 | High | Memory-off chats can never resume an approval or a question ("approval ignored" in log; may start an empty-prompt billed turn) | `chat/turn/pipeline.py` | Open |
| C2 | High | Revoked JWT (after password change) still sends, attaches, stops and steers chat | `chat/transport/streaming_http.py` | Open |
| C3 | High | Approval/question card vanishes on reload; only a "Waiting for your answer…" message remains | `useChatStream` state | Open |
| C4 | High | A chat turn cut by a deploy leaves no answer and no "interrupted" marker | `chat/turn/pipeline.py` | Open |
| C5 | High | Resumed runs lose their caller, write scope, task claims and parent link; dead chats' workers resume and spend | `agents/recovery.py` | Open |
| C6 | High | A resume refused by pause/cap stays `running` for ever and is retried every sweep | `agents/agent/runtime.py` | Open |
| C7 | High | Stop leaves detached workers (`run_agent`, `start_tasks`) running and spending | `runs.stop`, `runs.py` | Open |
| C8 | Med | Approve/Answer with an expired token clears the card, then toasts "Authentication required"; answer lost | `streaming_http.py` | Open |
| C9 | Med | A message sent right after Stop, or from a second tab, shows as sent but is never saved | `chat/views.py` | Open |
| C10 | Med | Deleting a chat mid-turn keeps the run spending and writing `/Chat/` files | `chat/views.py` (`perform_destroy`) | Open |
| C11 | Med | A worker started after a poisoned web read runs at `full`; taint lost once curation compacts the poisoned result | `_live_autonomy`, `chat/turn/agent.py` | Open |
| C12 | Med | One chat turn can start N detached workers each spending a full cap; no chat-level cap | `check_guardrails` | Open |
| C13 | Low | A stranger holding a session UUID can replay a live chat stream | `chat/views.py` | Open |
| C14 | Low | Rewrite deletes the message and everything after with no confirm; drops command chip and attachments | `StandaloneChat.tsx` | Confirm fixed 2026-11-19 (Retry/Edit/Take back ask when more than the next reply would go); chip and attachments still dropped |
| C15 | Low | Failed first message: text not restored; orphan conversation left in the sidebar | `StandaloneChat.tsx` | Open |
| C16 | Low | Guest chat errors leak internals (`Server error: {exc}`) | `chat/guest/views.py` | Open |
| C17 | Med | Deleting a chat leaves its last checkpoints (full transcripts) in Postgres for ever | `chat/turn/checkpoints.py` | Open |
| C18 | Med | Switching memory on/off while paused orphans the pause (approval silently dropped) | `chat/serializers.py` | Open |
| C19 | Low | Throttles key on the raw `X-Forwarded-For` string; spoofable if the proxy chain appends rather than replaces | DRF `get_ident` | **Fixed 2026-11-16** |
| A1 | High | Two builder tabs, or builder + chat `update_agent`: the last Save silently reverts the other's changes | `AgentBuilder.tsx` | Open |
| A2 | High | Deleting an agent silently deletes its missions; a published listing survives; others still point at it | `missions/models.py` | Open |
| A3 | Med | Builder never reads `/capabilities/`; engine-off grants (browser, shell, workspace) look live | `AgentBuilder.tsx` | Open |
| A4 | Med | Spend cap "0" means unlimited, though the field reads "per month" | `agents/agent/runtime.py` | Open |
| A5 | Med | Google sign-in and the login links drop `?next=`; a shared agent link lands on chat after sign-in | `GoogleCallback.tsx`, `Login.tsx` | Open |
| A6 | Med | Server 400s show as one toast, never beside the field; wizard's create error is generic | `AgentBuilder.tsx`, `AgentCreateWizard.tsx` | Open |
| A7 | Low | Removing a grant leaves invisible `toolScope` entries; next Save 400s with only a toast | `agents/config.py` | Open |
| A8 | Low | Wizard progress lost on leaving; install toast says "Tools page"; delegate picker stale for 60 s | `AgentCreateWizard.tsx` | Open |
| A9 | High | Chat "make me an agent…" always fails with "Could not save the agent: 'request'"; same for any agent with a KB/connection/delegate | `chat/tools/authoring.py` | Open |
| A10 | High | After a referenced KB/agent/connection is deleted, every Save of the referring agent 400s | `agents/config.py`, `to_config` | Open |
| A11 | Med | A deleted agent's listing stays installable and can't be withdrawn | `SharedAgent.subagent` | Open |
| A12 | Med | Share screen 400s after a referenced KB is deleted; republishing silently relists a withdrawn listing | `views/gallery.py` | Open |
| A13 | Med | Double-clicking "install pack" (or two tabs) creates duplicates or a 500 | `agents/template_slug` | Open |
| A14 | Low | `spendCapRupees` has no ceiling; the agent brief has no length cap | `agents/config.py` | Open |
| A15 | High | A read-only `ask`-mode agent can send mail and write files through a `full`-configured delegated worker | `chat/tools/agents.py` (`invoke_subagent`) | Open |
| A16 | High | Spend cap overshoots: concurrent runs pass at the same spend; in-flight runs count zero; workers' spend not counted to the parent | `agents/agent/runtime.py`, `agents/spend.py` | Open |
| A17 | Med | Approving after the cap/pause changed: the Inbox says "resumed", the run stays stuck | `agents/agent/runtime.py` | Open |
| A18 | Med | Setting `toolScope` silently removes Gmail, Drive, Calendar, web and delegation tools although they are granted | `agents/agent/runtime.py` | Open |
| A19 | Med | A run's recorded revision can differ from what executed | `logs/revisions.py` | Open |
| A20 | Low | Edits mid-run are ignored by the run, but apply after an approval resume | `agents/agent/runtime.py` | Open |
| R1 | High | Two devices can both resume the same Inbox request, or race approve against reject; a failed resume is swallowed | `agents/views/hitl.py` | Open |
| R2 | High | A webhook hit 1000×/min starts 1000 detached runs; bodies buffered before the 64 KB check | `agents/views/triggers.py` | Open |
| R3 | Med | Answering a request whose agent was deleted shows "Response sent"; nothing resumes | `agents/views/hitl.py` | Open |
| R4 | Med | Missions: resuming a cancelled one reactivates it; cancelling leaves its run going; pausing a finished one pauses it | `chat/commands/views.py` | Open |
| R5 | Med | Pending-approval list is unbounded | `agents/views/hitl.py` | Open |
| R6 | Low | An unknown Inbox `action` (typo) is recorded as "answered" | `agents/views/hitl.py` | Open |
| R7 | Low | Cancelling a run on another process returns 409; it can't be stopped until recovery | `agents/agent/runtime.py` | Open |
| R8 | Low | A webhook 500 on a start error reveals the secret is live | `agents/views/triggers.py` | Open |
| R9 | High | The Inbox says "Response sent" even when nothing resumed — the approved email never goes out | `api/orchestrator.ts`, `NeedsYou.tsx` | Open |
| R10 | Med | A notification link to an already-answered request silently selects a different pending request | `NeedsYou.tsx` | Open |
| R11 | Med | Failed runs show the raw provider error with no "reconnect Google" link | `HistoryList.tsx`, `RunDetail.tsx` | Open |
| R12 | Med | Run history is capped at 50 with no "load more", though the API supports a cursor | `HistoryList.tsx` | Open |
| R13 | Med | Schedules never show `last_error`; a slot skipped behind a paused run reads "already running" | `Schedules.tsx` | Open |
| R14 | Low | An "expired" approval (past `timeout_seconds`) still offers Approve; expiry is only a label | `NeedsYou.tsx` | Open |
| R15 | High | One unanswered approval on an `ask` schedule blocks every later firing for ever — even after the 7-day abandon | `agents/sweep.py` | Open |
| R16 | Med | An account pause or a spend cap reached 5 times permanently disables the schedule | `agents/sweep.py` | Open |
| R17 | Med | Cancelling a mission leaves its run going and its approvals pending; a resumed mission can never launch again | `chat/commands/views.py`, `missions/sweep.py` | Open |
| R18 | Low | Nudges about a deleted agent's or a recovery-failed run's request continue for up to 7 days | `agents/recovery.py` | Open |
| R19 | Low | During a scheduler-lease takeover, jobs run twice; mission settle can double-count | `agents/scheduler.py`, `missions/sweep.py` | Open |
| F1 | Med | Closing the tab right after typing can lose the last edits (the flush request is cancellable) | `SheetEditor.tsx`, `OfficeEditors.tsx` | Open |
| F2 | Med | Files skipped by "storage full" in a bulk upload are neither counted nor listed | `Documents.tsx` | Open |
| F3 | Med | A second tab shows stale content until its own save gets a 412 | editors (no focus refetch) | Open |
| F4 | Low | Offline autosave retries every ~1.5 s with a toast each time; a flush during an in-flight save is dropped | `SheetEditor.tsx` | Open |
| F5 | Low | Large uploads show a spinner with no progress or cancel | `api/documents.ts` | Open |
| F6 | High | Files being indexed during a deploy stay "pending"/"processing" for ever — never searchable | `inference/indexing.py` | Open |
| F7 | Med | Two agents editing the same office file at once: one's edits silently vanish | `chat/tools/office.py` | Open |
| F8 | Med | After a restart, an unrendered draft never renders; search keeps the pre-edit text | `views.py`, `find_files` | Open |
| F9 | Med | A failed draft render, then an agent write, discards the user's unsaved draft | `drafts.py`, `office_edit.py` | Open |
| F10 | Low | Recycle purge can delete bytes a chat attachment still points at | `recycle.py` | Open |
| F11 | Low | Concurrent "New file" / new folders can create same-name duplicates on Postgres | `office_edit.py` | Open |
| F12 | Med | A user at quota keeps growing storage: edits, version snapshots (25 × 25 MB) and drafts never hit the quota check | `office_edit.py`, `drafts.py` | Open |
| F13 | Med | Trashing a folder with ~1000 files de-indexes each doc serially inside the request and can time out | `recycle.py` | Open |
| F14 | Low | Preview PNG cache is never deleted on purge, isn't counted, keyed by size only (stale previews) | `previews.py` | Open |
| F15 | Low | Quota/validation errors lack `code`, so the UI can't show "Storage full"; image upload skips validation | `inference/views.py` | Open |
| F16 | Low | Trashing a shared file keeps its published link live; bytes count against quota with no UI hint | `PublishedPage` | Open |
| O1 | High | A published HTML page whose body contains `<header>` runs with no network CSP — it can fetch/exfiltrate from visitors' browsers | `lib/pageBody.ts` | Open |
| O2 | High | Video generation in prod never finishes: polling is a Celery task and prod runs no Celery; the job is billed, never finished | `imagine/services/dispatcher.py`, `imagine/tasks.py` | Open |
| O3 | Med | A mission run can publish a page `public` (the unattended limit is `link`) | `chat/tools/publish.py` | Open |
| O4 | Med | A scheduled agent can save a dashboard `public` with no unattended limit, content check or approval | `chat/tools/dashboards.py` | Open |
| O5 | Med | Provider errors or unreadable bytes after billing are recorded nowhere; the model is told "try again" — a second paid call | `chat/tools/media.py` | Open |
| O6 | Med | Imagine and chat-turn image spend is in no ledger and under no cap | `imagine/services/dispatcher.py` | Open |
| O7 | Med | Republishing mints a new URL; the old link keeps the stale snapshot; `link` slugs are guessable from the title | `inference/pages.py` | Open |
| O8 | Low | "Public" dashboards are only visible to signed-in users, expose `sources` to non-owners, and `refresh`/`refresh_cron` do nothing | `dashboard_views.py` | Open |
| O9 | Low | Moderation runs a synchronous 4 s HTTP call on the run's thread; some media never labelled | `core/safety/moderation.py` | Open |
| I1 | Med | Deleting the Google credential silently breaks every Gmail/Drive/Calendar agent; a refused delete just stays open with the error in console | `credentials/views.py` | Open |
| I2 | Med | A revoked Google refresh token leaves the credential "active": tools stay offered every turn, each call burns a ~10 s refresh then fails | `credentials/models.py` | Open |
| I3 | Med | Google consent with a scope unticked still produces a "verified" credential that fails later | `credentials/views.py` | Open |
| I4 | Med | Agent runs keep the native-connector live set for the whole run; switching a card off mid-run is ignored until it ends | `agents/agent/runtime.py` | Open |
| I5 | Low | N parallel Gmail calls that each 401 force a refresh in sequence under the lock | `credentials/models.py` | Open |
| I6 | Low | Credential cache is per process, not invalidated on ORM/cascade deletes, not tied to token expiry | `credentials/manager.py` | Open |
| I7 | Low | DNS-rebinding window between the SSRF check and the MCP client's own resolve | `mcp_integration/client.py` | Open |
| I8 | Low | OAuth state is replayable for 10 min (no nonce); token-exchange errors returned verbatim; shared skills unscreened | `credentials/views.py`, `skills/views.py` | Open |
| U1 | High | Every user is logged out once their 24 h access token expires — the silent refresh always 404s | `better-n8n-frontend/src/api/client.ts` | Open |
| U2 | High | No account deletion or export (UI or API) — DPDP/GDPR erasure gap | `core/urls.py` | Open |
| U3 | Med | Sign-out doesn't invalidate the refresh token server-side; no "sign out everywhere"; API keys survive a password reset | `api/auth.ts` | Open |
| U4 | Med | Signup and email change reveal registered emails; login throttle is per-IP only | `core/serializers.py` | Open |
| U5 | Med | Password users never verify their email; a later "Continue with Google" silently retires their password | `core/views.py` | Open |
| U6 | Med | Anyone with manager rights can add any registered user to an org with no consent; last-owner guard can race | `core/orgs.py` | Open |
| U7 | Low | A revoked WebSocket reconnect (close 4001) backs off and retries instead of logging out | `lib/websocket.ts` | Open |
| U8 | Low | Reset/verify lookups are case-sensitive; OTP emails sent with failures swallowed | `core/views.py` | Open |
| U9 | Low | API keys have no scopes; the UI manages only the first key | `api/auth.ts` | Open |
| U10 | Med | Solution capture, moderation and other platform-key calls have no per-user cap | `solutions/capture.py` | Open |
| U11 | Low | An avatar file survives account deletion; backups have no erasure/retention window | `core/models.py` | Open |
| U12 | Low | The same answer can be captured twice with several workers; membership check and insert not atomic | `solutions/capture.py` | Open |
| E1 | High | An imported or hand-added eval case runs on the owner's **real** Gmail/Drive/MCP/browser/publish/image tools — and really sends by default | `eval/environment.py` | Open |
| E2 | Med | A judge outage scores every judge-only case 0 and fails the sweep as if the agent were broken; nothing queued for review | `eval/graders.py`, `eval/supervision.py` | Open |
| E3 | Med | Sweep cost ceiling is unlimited by default, checked only before each case | `eval/models.py` | Open |
| E4 | Low | After a restart a sweep looks "running" for up to 3 h; never resumed; killed attempts' folders stay and count toward quota | `eval/recovery.py` | Open |
| E5 | Med | Reviewing a result while a sweep is running marks the run completed early, with a provisional score | `eval/supervision.py` | Open |
| E6 | Med | A cancelled sweep whose process died blocks deleting the suite; cancel can overwrite a just-completed run | `eval/views.py` | Open |
| E7 | Low | "Save as eval case" doesn't check the agent matches the run's, has no dedupe, accepts eval-caller runs; bulk accept isn't atomic | `eval/views.py` | Open |
| E8 | Low | Evals UI silently caps runs/reviews with no "more"; suite list unpaginated; reviewers overwrite each other silently | `api/evals.ts` | Open |

## Found 2026-11-19

A second sweep (backend, then frontend against the backend), skipping
everything above. `checked` = read in the code by the reviewer; the rest come
from a read-only agent review with file:line evidence and still want a look
before work starts.

| ID | severity | gap | where | status |
|---|---|---|---|---|
| T1 | High | An event trigger (`job.finished`) is switched off instead of launched: `prepare` claims the next cron slot, an event trigger has no cron, so `_rearm` disables it as "never comes round again". Latent until the workspace engine ships; the test mocks `launch` | `agents/sweep.py` (`prepare`), `agents/scheduler.py::launch` | Open, checked |
| T2 | High | e-sign requests can never complete: no callback URL or per-request secret is sent, nothing sets `expired`. Latent while `ESIGN_ENGINE` is off | `esign/provider.py`, `esign/views.py` | Open |
| T3 | Med | A document shared to the platform KB is marked shared before the copy succeeds; a failed or empty copy can't be re-shared (403) and edits never refresh it | `inference/views.py`, `inference/tasks.py` | Open |
| T4 | Med | A sent message draft can be sent again (lookup has no `status='draft'` filter, no atomic claim) | `chat/tools/talk.py` | Open |
| T5 | Med | Slack retries/replays store inbound messages twice (no provider message id, no unique key) | `messaging/views.py`, `messaging/models.py` | Open |
| T6 | Med | The outbound daily cap is check-then-act: concurrent runs all pass at 99 | `core/safety/outbound.py` | Open |
| T7 | Med | A failed cost-ledger write is logged and swallowed, so spend caps undercount | `logs/costs.py` | Open |
| T8 | Med | A video job is marked failed after 10 minutes while the provider keeps it (and bills it); nothing collects it later | `imagine/tasks.py` | Open |
| T9 | Med | The workspace `job.finished` hook is not idempotent: a retried POST rewrites a finished job and wakes waiters again | `workspaces/views.py` | Open |
| T10 | Med | ASGI/WSGI/Celery entry points default to `settings.local` (DEBUG, CORS allow-all, a public fallback SECRET_KEY); only the Dockerfile sets deployment | `workflow_backend/asgi.py`, `wsgi.py`, `celery.py` | Open |
| T11 | Low | `/executions/{id}/events/` reads a table nothing writes, so it always returns [] | `streaming/views.py` | Open |
| T12 | Low | Deleting a skill removes vector doc `None` (pk cleared by `delete()` first); the vectors stay | `skills/views.py` | Open |
| T13 | Low | `Notification` rows are never purged | `notifications/models.py` | Open |
| T14 | Low | Production ALLOWED_HOSTS/CSRF origins always include localhost and ngrok wildcards | `workflow_backend/settings/base.py` | Open |
| T15 | Low | Two concurrent eval-world generations: the loser gets an IntegrityError (500), not "busy" | `eval/api.py` | Open |
| W1 | High | Another account's cached data survives sign-in: the 401 handler and `login()` never clear the react-query cache (`claimAccountData` clears storage only), and queries stay fresh 5 min | `contexts/AuthContext.tsx` | Open, checked |
| W2 | Med | Any failed profile read at boot (network blip, 5xx) clears the tokens and signs the user out | `contexts/AuthContext.tsx` | Open |
| W3 | Med | The protected-route redirect sends no `?next=`, so an expired session on a deep link lands on chat after sign-in | `App.tsx` | Open |
| W4 | Med | Escape on a confirm also closes the dialog under it (every open `Modal` listens on window), losing a form's edits | `components/ui/Modal.tsx` | Open |
| W5 | Med | `Modal` does not move, trap or restore focus | `components/ui/Modal.tsx` | Open |
| W6 | Med | Six Schedules mutations have no error message (a failed rotate or toggle just snaps back) | `pages/Schedules.tsx` | Open |
| W7 | Med | Creating an agent in the wizard did not refresh the agents list | `pages/AgentCreateWizard.tsx` | Fixed 2026-11-19, checked |
| W8 | Med | Evals "Full trace" linked `?execution=`, which Activity does not read | `pages/Evals.tsx` | Fixed 2026-11-19, checked |
| W9 | Med | The plan panel's run link went to `/runs/<id>`, which is not a route (404) | `components/orchestration/PlanPanel.tsx` | Fixed 2026-11-19, checked |
| W10 | Med | The schedules list drops the server's `truncated` flag past 200 rows | `api/triggers.ts` | Open |
| W11 | Low | Shared tools, Pages and Dashboards never show `truncated` | `components/tools/CustomTools.tsx`, `pages/Pages.tsx`, `pages/Dashboards.tsx` | Open |
| W12 | Low | Sign-out leaves `app-tabs:*`, `imagine.prompt` and `credentials.search` in session storage | `lib/accountData.ts` | Open |
| W13 | Low | The WebSocket token is in the URL, so it lands in proxy logs | `lib/websocket.ts` | Open |
| W14 | Low | A socket with no token shows "connecting" forever | `lib/websocket.ts` | Open |
| W15 | Low | A stray click on a dialog's backdrop throws away a half-filled form | `components/ui/Modal.tsx` | Open |
| W16 | Low | Evals polls every 15 s even when nothing is running | `pages/Evals.tsx` | Open |
| W17 | Low | `insights/stats/`, `usage/insights/` and `push/devices/` have no frontend caller | `logs/urls.py`, `core/urls.py`, `notifications/urls.py` | Open |
| W18 | Low | Six places wrap a `Button` in a `Link` (a button inside a link: two tab stops, invalid HTML) | `pages/Agents.tsx` and others | Open, checked |

