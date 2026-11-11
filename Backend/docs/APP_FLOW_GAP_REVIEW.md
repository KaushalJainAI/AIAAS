# App-flow review: current features, their requirements, and the gaps

This document has three parts:

1. **Current features.** For each application: what I understand it does today, the requirement it has to meet, and which gaps break that requirement.
2. **Gaps grouped by feature.** All 111 gaps regrouped by the capability they break, across applications, with what I believe each capability must guarantee. Read this part to check we agree.
3. **Gap register.** One row per gap, with evidence and a fix, in the order the waves found them.
4. **Product feature gaps.** New features, from easy to hard (end of file).

My understanding comes from reading the code during this review and from CLAUDE.md. Where a requirement is my inference rather than something written down, it says so.

---

## Part 1: Current features, requirements, and where they fall short

### 1. Chat (`/ai-chat`)
**What it is today.** The main place a person works. They type a message and a model answers, streamed live.

What chat can do:
- **Orchestrator role.** Chat is the "manager": it reads, plans with a todo list, and delegates.
- **Workers.** It delegates writing, sending and publishing to subagents (workers) in three ways:
  - inline workers (`invoke_subagent`): the turn waits for them;
  - detached runs (`run_agent`): they keep going on their own;
  - coding-style tasks (`start_tasks`).
- **Steering.** You can type a correction while it works; it is delivered at the next tool boundary.
- **Approval modes.** Each chat has one of four: Ask, Auto (a fast judge model approves safe calls), Plan (read-only), and Full auto (no approvals).
- **Pauses.** A turn pauses on an approval card or a question card and resumes when you answer.
- **Memory.** A per-chat switch replays earlier turns; a separate user memory stores lasting facts about you.
- **Survives a closed tab.** A turn runs on the server and survives the tab closing; you can re-attach.
- **Errors.** Missing credentials or quota fail before anything is shown. Provider errors are explained in plain sentences.

**Requirements it must meet.**
- A message you send is either answered, refused with a reason, or visibly interrupted. Never silently lost.
- An approval or question you're shown can be answered later, from any device, exactly once.
- Stop means stop, including the work chat started on your behalf.
- Your approval mode is respected by everything the turn starts. A poisoned web page can't loosen it.
- Only you can see, steer or stop your chat, and only while your login is valid.

**Where it falls short.**
- Memory-off chats can't resume approvals (C1).
- Revoked logins still work on the stream (C2).
- Cards vanish on reload (C3).
- Deploys leave unanswered questions (C4).
- Stop leaves detached workers running (C7).
- A message sent right after Stop is dropped (C9).
- Workers inherit Full mode after a poisoned read (C11).
- Deleted chats keep their transcripts (C17).

### 2. Agents (`/agents`, wizard, builder, history, `/templates`, `/a/:slug`)
**What it is today.** An agent is a saved configuration, not code: a prompt, a model, and grants (web, files, office, connectors, subagents, code…). Each grant can be narrowed in four ways:
- **scopes:** which knowledge bases, connections, folders and delegates;
- **a tool list;**
- **per-tool permissions** (allow / ask / deny);
- **guardrails:** autonomy level, spend cap, maximum run time, unattended allowed.

How agents are created and changed:
- **Build:** with a wizard, in the builder, or by asking chat (`create_agent`).
- **Save:** every save goes through one serializer, which checks ownership of every id, and records a revision.
- **Templates:** a gallery of templates and packs (office, code).
- **Publishing:** strips ids into "requirements" so an installer chooses their own. There are three visibilities: link, platform, public.

**Requirements it must meet.**
- An agent can only reach what its owner configured. When it delegates, it can't exceed its own limits through a worker.
- Every save is validated the same way, whether from the builder or from chat. A save never silently discards someone else's change.
- A run is recorded against the configuration that actually ran.
- Deleting something tells you what it breaks.
- A published agent leaks no ids or secrets, and stays under its author's control.
- The spend cap really limits spending.

**Where it falls short.**
- Chat can't save any agent that uses a knowledge base, connection or delegate (A9).
- The last save silently wins (A1).
- Delegation gets around limits (A15).
- The spend cap is checked only at start (A16), and 0 means unlimited (A4).
- Deletes cascade silently and orphan listings (A2, A11).
- References to deleted things block every later save (A10).
- A tool list hides connector tools (A18).
- The builder ignores the capabilities endpoint (A3).

### 3. Runs, Inbox, Missions and Schedules (`/runs`, `/schedules`)
**What it is today.**
- **Runs:** every agent run is an `ExecutionLog` made of turns and steps, viewable on `/runs`.
- **Inbox:** "Needs you" lists runs paused for approval or a question. Answering resumes the run.
- **Reminders:** unanswered requests get a reminder ladder (+0, +1 h, +1 d) and a daily email digest.
- **Schedules:** cron in the user's timezone (with explicit DST rules), webhooks and events. Each has an overlap policy: skip, queue or cancel. All are driven by an in-process scheduler under a database lease.
- **Missions:** long goals carried by a chain of runs, with a plan, waits and retries.
- **Recovery:** a sweep resumes or fails runs whose process died.

**Requirements it must meet.**
- A schedule fires when it should. When it doesn't, it says why in words.
- One answer resumes a paused run exactly once and tells you the result.
- A request nobody will ever answer doesn't block the agent for ever.
- Cancelling (a run or a mission) stops the work and its pending approvals.
- A run interrupted by a restart either resumes under its original limits or is closed honestly.
- Webhooks can't be used to flood the account.

**Where it falls short.**
- One unanswered approval blocks a schedule for ever (R15).
- Two answers can both resume a run (R1), and the Inbox reports "sent" when nothing resumed (R9).
- The webhook skips overlap and limits (R2).
- A pause or cap disables schedules permanently (R16).
- Mission cancel doesn't stop its run (R17).
- Resumed runs lose their limits, and refused resumes loop (C5, C6).

### 4. Files and workspace apps (`/documents`, `/apps/*`)
**What it is today.** One file tree per user: folders, a recycle bin, versions, a storage quota and recently opened files.
- **Apps:** Docs (TipTap), Sheets (Univer), Slides, Notepad and Code (CodeMirror), LaTeX, a PDF reader and previews of every file type. They open full-screen with tabs, autosave (office files park a draft that is rendered after 30 s of quiet), undo, export and Share.
- **Agents:** they work on the same files through a virtual filesystem confined by scope. Edits keep versions, and deletes go to the recycle bin.
- **Knowledge bases:** files in a KB-linked folder are indexed for search by a queue that runs inside the server process.

**Requirements it must meet.**
- An upload is either stored and indexed, or refused with a reason. You know which files didn't make it.
- An edit is never silently lost: by a closed tab, a second tab, or an agent editing the same file.
- Search reflects the file's current content.
- The storage quota bounds everything that writes bytes.
- Deleting is reversible for 30 days, and permanent afterwards.

**Where it falls short.**
- Indexing jobs lost in a restart stay pending for ever (F6).
- Concurrent agent edits lose updates (F7).
- The final save on tab close can be cancelled (F1).
- Unrendered drafts leave search stale (F8).
- Edits, versions and drafts bypass the quota (F12).
- Skipped uploads aren't listed (F2).

### 5. Outputs: published pages, dashboards, Imagine (`/pages`, `/p/:slug`, `/dashboards`, `/imagine`)
**What it is today.**
- **Published pages:** an agent or a person publishes HTML, a report or a file as a snapshot at `/p/:slug`. Visibility is link, platform or public. HTML runs in a sandboxed frame with a no-network policy, and an unattended run may publish only `link`.
- **Dashboards:** store chart specs.
- **Imagine:** generates images, video and audio through OpenRouter. It checks the content policy and a moderation model first, labels images as AI-generated, and saves results to Documents.

**Requirements it must meet.**
- A published page can't run code that reaches the network or the app.
- Unattended publishing stays narrow.
- Every paid generation is counted once, against a limit, even if it fails after billing.
- A long generation finishes or fails honestly, even if you close the tab or the server restarts.

**Where it falls short.**
- The `<header>` CSP bypass (O1).
- Video polling never runs in production (O2).
- Mission runs can publish public pages (O3), and dashboards skip unattended rules (O4).
- Billed failures go unrecorded (O5), and Imagine spending has no cap (O6).
- Dashboards' `sources` and refresh do nothing (O8).

### 6. Integrations (`/connections`, `/credentials`, `/tools`, `/skills`)
**What it is today.**
- **Credentials:** encrypted at rest. Google OAuth connects Gmail, Drive, Sheets and Calendar as native tools (no subprocess).
- **Custom MCP servers:** URLs are checked against requests to internal addresses (SSRF), and local-process (stdio) servers are off in production.
- **Tool pinning:** an MCP tool whose description changes is held until the user approves it.
- **`/tools`:** switches built-in tools on or off and sets their limits per user.
- **`/skills`:** reusable instructions, shareable between users.

**Requirements it must meet.**
- A secret never reaches the browser or a model.
- A broken connection is visible as broken, with a fix, and stops being offered.
- Removing a credential tells you what it breaks.
- Switching a connector or tool off takes effect on the next call, everywhere.

**Where it falls short.**
- Credential delete checks one dependency and fails silently (I1).
- A revoked Google token never disconnects (I2).
- Unticked scopes still count as "verified" (I3).
- Agent runs ignore a connector switched off mid-run (I4).

### 7. Account (signup, login, Google, `/settings`, `/profile`, orgs, `/solutions`)
**What it is today.**
- **Sign-in:** email and password with OTP-based reset, or Google sign-in.
- **Tokens:** JWTs last 24 h and refresh tokens 30 days. Changing the password or email revokes all tokens.
- **API keys:** stored hashed.
- **Organisations:** owner, admin and member roles; they exist to share *solutions* (problems solved before, found again by search, with stale facts labelled).
- **Settings:** default model, approval mode, voice, and notification preferences.

**Requirements it must meet.**
- You stay signed in until your session really ends, and can end it everywhere.
- Signing in can't be used to find out who has an account.
- What is shared in an org stays in that org.
- You can take your data out and delete your account (DPDP/GDPR).

**Where it falls short.**
- The silent refresh calls a route that doesn't exist, so everyone is logged out daily (U1).
- There is no account deletion or export (U2).
- Sign-out is local only, there's no "sign out everywhere", and API keys survive a password reset (U3).
- Signup reveals registered emails (U4).
- Members can be added to an org without consent (U6).

### 8. Evals (`/evals`)
**What it is today.**
- **Suites and cases:** test suites of cases per agent, graded by small checks plus an LLM judge.
- **Human review:** a person reviews where the judge and the checks disagree, and the platform measures how often they agree.
- **Test worlds:** the judge model builds a fake world (mailbox, calendar, drive, files, a frozen web) so an eval never touches real data. Tools without a simulator are withheld.
- **Drafts:** generated cases are drafts, accepted only on the Evals page.
- **Benchmarks:** suites live in code, with a scorecard.

**Requirements it must meet.**
- An eval measures the agent without touching the owner's real accounts, unless the owner clearly chose to.
- A score is final only once review is done, and a broken judge never counts as a broken agent.
- A sweep has a cost bound.
- A restart leaves no sweep looking alive.

**Where it falls short.**
- Imported and added cases run on real accounts, under the default "Record and run" setting (E1).
- A judge outage scores the agent 0 (E2).
- There is no default cost ceiling (E3).
- Reviewing during a sweep closes the run early (E5).

---

# Part 2: Gaps grouped by feature

Each group starts with **What I think it must guarantee**, my understanding of the requirement. If you disagree with that line, the verdicts under it change. Full evidence and fixes for each ID are in Part 3.

Severity: **H** high, **M** medium, **L** low.

## Summary

| # | Feature | Gaps | H | M | L | Root cause in one line |
|---|---|---|---|---|---|---|
| 1 | Approvals and questions | 12 | 4 | 6 | 2 | The pause lives in a checkpoint; the UI, thread id and Inbox don't reliably find it again |
| 2 | Restarts and recovery | 9 | 5 | 1 | 3 | Work kept in memory or on Celery; resume rebuilds the run without its original context |
| 3 | Stop, cancel, concurrent sends | 5 | 1 | 3 | 1 | Stop/cancel acts on one task, not on the work it started |
| 4 | Delegation and permission limits | 6 | 1 | 3 | 2 | Workers use their own config; only some limits are intersected with the parent's |
| 5 | Spend and cost control | 8 | 1 | 6 | 1 | Caps checked once at start; several paid paths write no ledger row |
| 6 | Sign-in, sessions, orgs | 11 | 2 | 4 | 5 | Wrong refresh URL; revocation not applied everywhere; no consent or lockout |
| 7 | Agent configuration and saving | 8 | 3 | 4 | 1 | No version check on save; chat's save path missing the request context |
| 8 | Deleting things and data lifecycle | 10 | 2 | 3 | 5 | Deletes cascade or orphan with no preview; checkpoints and some blobs never deleted |
| 9 | Schedules, webhooks, missions | 7 | 2 | 4 | 1 | "Busy" includes paused runs nobody will answer; refusals counted as failures |
| 10 | File editing and storage | 11 | 0 | 7 | 4 | Agent edits have no version check; quota only on create; flush not `keepalive` |
| 11 | Publishing and content safety | 7 | 1 | 4 | 2 | CSP regex; hand-copied caller list; dashboards outside the publishing rules |
| 12 | Connections and credentials | 6 | 0 | 2 | 4 | A failed refresh is "None" for every reason, so revoked never becomes disconnected |
| 13 | Evals | 5 | 1 | 2 | 2 | Non-world cases are real runs by default; a judge failure scores as an agent failure |
| 14 | Honest UI and lists | 6 | 0 | 3 | 3 | Responses and counts the server sends are thrown away by the client |
| | **Total** | **111** | **23** | **50** | **38** | |

## 1. Approvals and questions
**What I think it must guarantee.**
- When a run pauses to ask you something, you can see the request again from any device and answer it once.
- That answer resumes the run exactly once, and you are told whether it did.
- A request nobody answers ends cleanly. It never blocks anything for ever.

| ID | Sev | Gap |
|---|---|---|
| C1 | H | Memory-off chats can never resume an approval or question (thread id changes each request) |
| C3 | H | The approval/question card disappears on reload; only "Waiting for your answer…" remains |
| R1 | H | Two devices answering at once can both resume the run, or race approve against reject |
| R9 | H | Inbox says "Response sent" even when nothing resumed |
| C8 | M | An expired login clears the card before the answer is sent, so the answer is lost |
| C18 | M | Switching memory on/off while paused orphans the pause |
| R3 | M | Answering a request whose agent was deleted is accepted and does nothing |
| R10 | M | A link to an already-answered request silently selects a different one |
| R5 | M | The pending-approvals list is unbounded |
| A17 | M | Approving after the cap or pause changed: Inbox says "resumed", run stays stuck |
| R6 | L | A typo'd action is recorded as "answered" |
| R14 | L | "Expired" is only a label; Approve still works |

## 2. Restarts and recovery
**What I think it must guarantee.**
- A deploy never makes work silently disappear.
- Interrupted work either resumes with the same limits it started with, or is closed with a message you can read.

| ID | Sev | Gap |
|---|---|---|
| C4 | H | A chat turn cut by a deploy leaves no answer and no "interrupted" marker |
| C5 | H | Resumed runs lose their caller, write scope, task claims and parent link; dead chats' workers resume and spend |
| C6 | H | A resume refused by pause/cap stays "running" for ever and is retried every sweep |
| F6 | H | Files queued for indexing at restart stay "pending" for ever |
| O2 | H | Video polling needs Celery, which production doesn't run: billed, never finished |
| F8 | M | Unrendered office drafts never render after a restart; search stays stale |
| E4 | L | A sweep looks "running" for up to 3 h after a restart; its attempt folders are left behind |
| R19 | L | During a scheduler takeover jobs can run twice; mission settle can double-count |
| U12 | L | Solution capture can insert twice with several workers |

## 3. Stop, cancel, concurrent sends
**What I think it must guarantee.**
- Stop and Cancel end the work, including everything that work started.
- A message you send is never swallowed because something else was running.

| ID | Sev | Gap |
|---|---|---|
| C7 | H | Stop leaves detached workers (`run_agent`, `start_tasks`) running and spending |
| C9 | M | A message sent right after Stop, or from a second tab, looks sent but is never saved |
| C10 | M | Deleting a chat mid-turn doesn't stop the run |
| E6 | M | A cancelled sweep whose process died blocks deletion for ever; cancel can overwrite "completed" |
| R7 | L | A run on another process can't be cancelled until recovery |

## 4. Delegation and permission limits
**What I think it must guarantee.** An agent can never do through a worker what it couldn't do itself, and a switch you turn off applies to the next call everywhere.

| ID | Sev | Gap |
|---|---|---|
| A15 | H | Workers keep their own file access, connectors, tool list and autonomy; a read-only `ask` agent can send mail through a `full` worker |
| C11 | M | A worker started after a poisoned read runs in Full; taint is lost once results are compacted |
| A18 | M | Setting a tool list silently removes Gmail/Drive/web/delegation tools |
| I4 | M | Agent runs ignore a connector switched off mid-run |
| A7 | L | Removing a grant leaves hidden tool-list entries that can block saving |
| A20 | L | Mid-run edits are ignored by the run, but apply after an approval resume |

## 5. Spend and cost control
**What I think it must guarantee.**
- Every paid call is counted once, whether it succeeded or failed.
- The limit you set really stops spending, including runs already in progress.

| ID | Sev | Gap |
|---|---|---|
| A16 | H | Cap checked only at start; in-flight runs count zero; workers' spend not counted against the parent |
| A4 | M | A cap of 0 means unlimited |
| C12 | M | No chat-level budget: one turn can start N workers, each with a full cap |
| O5 | M | Billed-but-failed image calls are recorded nowhere, and the model is told to retry |
| O6 | M | Imagine and chat-turn images are in no ledger and under no cap |
| U10 | M | Platform-key calls (capture, moderation) have no per-user limit |
| E3 | M | Eval sweep cost ceiling is unlimited by default |
| A14 | L | No ceiling on the cap value or on the agent brief's length |

## 6. Sign-in, sessions, orgs
**What I think it must guarantee.**
- You stay signed in until you sign out, and can sign out everywhere.
- A revoked login stops working on every channel.
- Nobody can learn who has an account.
- Nobody can be put in an org without agreeing.

| ID | Sev | Gap |
|---|---|---|
| U1 | H | Silent refresh posts to a route that doesn't exist, so everyone is logged out daily |
| C2 | H | Revoked logins still work on the chat stream |
| U3 | M | Sign-out is local only; no "sign out everywhere"; API keys survive a password reset |
| U4 | M | Signup/email change reveal registered emails; login throttle per IP only |
| U5 | M | Password users never verify email; "Continue with Google" silently retires their password |
| U6 | M | Members added to orgs without consent; last-owner guard can race |
| U7 | L | A revoked WebSocket keeps retrying instead of logging out |
| U8 | L | Case-sensitive reset lookups; OTP email failures hidden |
| U9 | L | API keys have no scopes; UI manages only one |
| C19 | L | Rate limits trust `X-Forwarded-For` (depends on proxy) |
| C13 | L | A stranger holding a session UUID can replay a live chat stream |

## 7. Agent configuration and saving
**What I think it must guarantee.**
- Saving from the builder and saving from chat follow the same rules.
- No save silently overwrites another person's change.
- The record of a run matches what actually ran.

| ID | Sev | Gap |
|---|---|---|
| A9 | H | Chat can't create/update any agent with a KB, connection or delegate (missing request context) |
| A1 | H | Two tabs, or builder + chat: last save silently wins |
| A10 | H | After a referenced KB/agent/connection is deleted, every save of the referring agent fails |
| A3 | M | Builder never reads `/capabilities/`; unavailable grants look usable |
| A6 | M | Server errors are one toast, never beside the field |
| A19 | M | A run's recorded revision can differ from what executed |
| A13 | M | Double "install pack" creates duplicates or a 500 |
| A8 | L | Wizard progress lost on leaving; stale copy; delegate picker stale for 60 s |

## 8. Deleting things and data lifecycle
**What I think it must guarantee.**
- Before you delete something, you're told what it breaks.
- After you delete it, it is really gone: bytes, transcripts, listings.
- You can delete your account and export your data.

| ID | Sev | Gap |
|---|---|---|
| U2 | H | No account deletion or export (DPDP/GDPR) |
| A2 | H | Deleting an agent silently deletes its missions; listing survives; others still point at it |
| C17 | M | Chat checkpoints (full transcripts) are never deleted |
| I1 | M | Credential delete checks one dependency; a refusal is invisible |
| A11 | M | A deleted agent's listing stays installable and can't be withdrawn |
| R18 | L | Reminders keep nudging about dead requests for up to 7 days |
| F10 | L | Purge can delete bytes a chat attachment still uses |
| F14 | L | Preview images are never deleted and can go stale |
| F16 | L | Trashing a shared file keeps its link live, silently |
| U11 | L | Avatar survives account deletion; backups have no erasure window |

## 9. Schedules, webhooks, missions
**What I think it must guarantee.**
- Automation fires when it should, and says why when it doesn't.
- A temporary pause never permanently switches it off.
- A webhook can't flood the account.
- Cancelling a mission stops it.

| ID | Sev | Gap |
|---|---|---|
| R15 | H | One unanswered approval blocks the schedule for ever (paused counts as busy; abandon doesn't close the run) |
| R2 | H | Webhooks skip overlap and admission: 1000 hits = 1000 runs; 20 MB buffered before the size check |
| R16 | M | An account pause or cap reached 5 times disables the schedule permanently |
| R4 | M | Mission status changes have no rules (resume a cancelled one, etc.) |
| R17 | M | Cancelling a mission leaves its run going and its approvals pending |
| R13 | M | A skipped slot says "already running", not "waiting for your approval" |
| R8 | L | A webhook 500 reveals the secret is live |

## 10. File editing and storage
**What I think it must guarantee.**
- An edit is never silently lost: by closing the tab, a second tab, or an agent.
- The quota bounds everything that adds bytes.
- An upload tells you exactly what didn't make it.

| ID | Sev | Gap |
|---|---|---|
| F7 | M | Two agents editing the same office file: one's edits vanish |
| F1 | M | The save on tab close isn't `keepalive`; the last edits can be lost |
| F2 | M | Files skipped by "storage full" aren't listed |
| F3 | M | Another tab or an agent's edit isn't noticed until a save fails |
| F9 | M | A failed draft render, then an agent write, discards the user's draft |
| F12 | M | Edits, versions and drafts bypass the quota |
| F13 | M | Trashing a large folder de-indexes inside the request and can time out |
| F4 | L | Offline autosave retries every 1.5 s with a toast each time |
| F5 | L | Large uploads have no progress or cancel |
| F11 | L | "New file" and new folders can create same-name duplicates |
| F15 | L | Inconsistent error codes; image upload skips validation; a bad `kb_id` silently goes to the default KB |

## 11. Publishing and content safety
**What I think it must guarantee.**
- Anything published runs sandboxed with no network.
- Unattended agents can only publish narrowly.
- Every way of publishing follows the same rules.

| ID | Sev | Gap |
|---|---|---|
| O1 | H | `<header>` defeats the no-network CSP on published HTML |
| O3 | M | Mission runs can publish public pages (copied caller list missing `mission`) |
| O4 | M | Dashboards skip unattended, content and approval checks |
| O7 | M | Republish makes a new URL; the old one serves stale content; link slugs guessable |
| A12 | M | Share screen breaks after a referenced KB is deleted; republish relists a withdrawn listing |
| O8 | L | "Public" dashboards aren't public; `sources` leak; refresh does nothing |
| O9 | L | Moderation blocks the run's thread for 4 s; some media never labelled |

## 12. Connections and credentials
**What I think it must guarantee.** A broken connection shows as broken with a Reconnect button, stops being offered, and secrets stay server-side.

| ID | Sev | Gap |
|---|---|---|
| I2 | M | A revoked Google token never disconnects; every call waits ~10 s and fails |
| I3 | M | Consent with a scope unticked still counts as "verified" |
| I5 | L | Parallel 401s each force their own refresh |
| I6 | L | Credential cache is per process and not cleared on cascade deletes |
| I7 | L | DNS-rebinding window between the SSRF check and connect |
| I8 | L | OAuth state replayable for 10 min; raw errors returned; shared skills unscreened |

## 13. Evals
**What I think it must guarantee.**
- An eval measures the agent without touching your real accounts, unless you clearly choose to.
- A broken judge is never mistaken for a broken agent.
- A score is final only once review is done.

| ID | Sev | Gap |
|---|---|---|
| E1 | H | Imported/added cases run on real accounts and really send/publish under the default |
| E2 | M | A judge outage scores the agent 0, with no review |
| E5 | M | Reviewing during a sweep marks the run completed early |
| E7 | L | "Save as eval case" doesn't check the agent and doesn't dedupe; bulk accept isn't atomic |
| E8 | L | Silent truncation, heavy suite counts, reviewers overwrite each other silently |

## 14. Honest UI and lists
**What I think it must guarantee.** What the screen says is what the server did, and a list shows when it is incomplete.

| ID | Sev | Gap |
|---|---|---|
| R11 | M | Failed runs show the raw provider error with no fix link |
| R12 | M | Run history stops at 50 with no "load more" |
| A5 | M | `?next=` dropped by Google sign-in and the login/signup links |
| C14 | L | Rewrite deletes without asking and drops attachments and the command |
| C15 | L | Failed first message: text not restored; empty chat left in the sidebar |
| C16 | L | Guest chat errors show internal text |

## What this says, in short
- **Three weak areas hold half the high-severity gaps:** approvals (1), recovery (2) and agent saving (7).
- **Most medium gaps are honesty failures.** The server knows the truth (not resumed, skipped, refused, disconnected), and it doesn't reach the user (groups 1, 9, 10, 12, 14).
- **The security-relevant ones are few and specific:** U1, C2, O1, A15, E1, C13.

---

# Part 3: Gap register (full detail)

Confidence: **V** = orchestrator read the lines; **S** = subagent evidence only; **S2** = two subagents independently.

## Wave 1: Chat

| ID | Sev | Conf | What the user sees | Root cause | Fix direction |
|---|---|---|---|---|---|
| C1 | High | V | In a memory-off chat, Approve / Deny / Answer does nothing ("approval ignored" in log) and may start an empty-prompt billed turn | `pipeline.py:638-650` mints `nomem:<uuid4>` per request; `agent.py:2710-2713` no-ops on empty state; pipeline continues with last user msg | Persist the paused nomem thread id on the paused message/session and reuse it on resume; refuse (TurnError) when no state |
| C2 | High | V | Revoked JWT (after password change) still sends, attaches, stops and steers chat | `chat/transport/streaming_http.py:85-90` builds `AccessToken` without `is_revoked` | Call `core.auth.revocation.is_revoked` in `authenticate` |
| C3 | High | V+S2 | Approval/question card vanishes on reload; only a "Waiting for your answer…" message with no buttons | Cards live only in `useChatStream` state; nothing reads `metadata.awaiting_approval` (grep: 0 frontend hits) | Rebuild card from the last message's metadata (store the pending call/question there) |
| C4 | High | V | After a deploy, the last question has no answer and no "interrupted" marker; a stream open at the time silently drops the partial answer | No chat-turn recovery (`agents/recovery.py` covers ExecutionLog only); assistant msg written only after `run_turn` returns (`pipeline.py:1158`); `followTurn.ts:109-112` returns normally on empty tail | Write an assistant row up front / on SIGTERM; on startup mark user-msg-without-answer as interrupted; UI refetch on empty tail |
| C5 | High | V | Workers resumed after a restart run as `caller='api'` with the agent's full write scope, no task claims, no shared workspace; mission/schedule runs lose unattended rules (can pause on `ask_user` nobody answers); inline workers of a dead chat turn resume top-level and spend for nobody | `agents/recovery.py:231-234` passes only agent/goal/thread/trigger/depth; `_orphans` has no `parent_step_id` filter | Pass `log.caller` + stamp workspace/write_paths/claims/gated_calls in `input_data`; fail workers whose parent is dead |
| C6 | High | V | A run refused at resume (global pause / spend cap) stays "running" for ever, re-refused every sweep, then resumes days later | `runtime.py:1973-1975` guardrail checks are before the `try` that closes the log; `recovery.py:_go` swallows | Move checks inside the try, or close the log in `_go` on `AgentRunRefused` |
| C7 | High | S2 | Stop leaves detached workers (`run_agent`, `start_tasks`) running and spending; nothing on screen shows them | `runs.stop` cancels only the chat task; no parent_step lookup; UI Stop calls only `stopStream` | On stop, cancel detached runs whose `parent_step.execution`/session is this turn; show live lanes |
| C8 | Med | S2 | Approve/Answer with an expired token clears the card, then toasts "Authentication required."; answer lost | Streaming endpoints answer 200 + error frame, not 401 (`streaming_http.py:119`); `sse.ts` no refresh; handlers clear card first | Return 401 for auth; refresh-and-retry in `streamSse`; clear card only on first frame |
| C9 | Med | S2 | Message sent right after Stop, or from a second tab, shows as sent but is never saved | `views.py:183-187` + `runs.start` return the live run and ignore the new payload | Return 409 "still answering" so the UI keeps the text |
| C10 | Med | S | Deleting a chat mid-turn keeps the run spending and writing `/Chat/` files until its message write fails | `perform_destroy` (`views.py:135-138`) never calls `runs.stop` | Stop the run before purge |
| C11 | Med | S2 | Worker started after a poisoned web read (if approved) runs at `full`; and taint disappears once curation compacts the poisoned result | `_live_autonomy` passes session mode, not tainted mode, to workers (`agent.py:1802,1832`); taint recomputed from live ToolMessages only | Pass effective (tainted) mode; record taint in `metadata` so compaction cannot erase it |
| C12 | Med | S | One chat turn can start N detached workers each spending a full cap; no chat-level cap | `check_guardrails` per agent only; `start_tasks`/`invoke_subagent` divide within one call | Chat-turn budget reserved across all delegation calls |
| C13 | Low | V | Someone with another user's session UUID can replay that user's live stream | `views.py:185-208` ownership checked only on the attach shortcut; `runs.start` returns any live run for the key | Check `existing.user_id` in `runs.start` / get_session before start |
| C14 | Low | S | Rewrite deletes the message and everything after with no confirm, and drops the command chip, reference and attachments | `StandaloneChat.tsx:751-775` resends plain text | Use `regenerate_of` path; confirm |
| C15 | Low | S | Refused/failed first message: input text not restored; orphan conversation stays in sidebar for non-sanitizer failures | `StandaloneChat.tsx:1443` clears input; cleanup only for SECURITY_VIOLATION/CONTENT_POLICY | Restore draft on any failure; delete empty session |
| C16 | Low | S | Guest chat errors leak internals (`Server error: {exc}`) | `guest/views.py:236` | Generic sentence |
| C17 | Med | S | Deleting a chat leaves its last 3 checkpoints (full transcript + tool results) in Postgres for ever; every memory-off turn leaves its own thread | `perform_destroy`/`purge_session` never delete checkpoints; `prune.py` keeps 3 per thread and never drops a thread | `forget_thread(session.id)` + nomem threads on delete; retention sweep for checkpoints |
| C18 | Med | S | Flipping memory on/off while a turn is paused orphans the pause (approval silently dropped) | `memory_enabled` writable any time (`serializers.py:66`); thread id derived from it | Refuse the PATCH while paused, or store the thread id on the session (same fix as C1) |
| C19 | Low | S | Throttles (all of them, incl. guest 50/day) key on the raw `X-Forwarded-For` string; spoofable if the proxy chain appends rather than replaces | DRF `get_ident`, no `NUM_PROXIES` set | Set `NUM_PROXIES` to the real hop count; verify edge-caddy + nginx headers |

## Wave 2: Agents

| ID | Sev | Conf | What the user sees | Root cause | Fix direction |
|---|---|---|---|---|---|
| A1 | High | S | Two builder tabs, or builder + chat `update_agent`: the last Save silently reverts the other's changes; on focus the page flips to "unsaved" with no merge prompt | `AgentBuilder.tsx:725-751` PATCHes the whole cfg; no version/etag (`updated_at` read-only only) | Send `updated_at` as an etag, refuse stale with 409, offer reload/merge |
| A2 | High | V | Deleting an agent silently deletes its active missions (and eval suites/triggers); the dialog says only "schedules and settings"; a published listing survives with a null agent; other agents' `delegatesTo` dangle | `missions/models.py:40-43` CASCADE; `SharedAgent` SET_NULL; delete is a bare `agent.delete()` | Count dependents in the confirm; withdraw listing; prune `delegatesTo`; or block delete while missions are active |
| A3 | Med | V | Grants whose engine is off (browser, shell, workspace) look like live switches in the builder | `GET /api/orchestrator/capabilities/` exists but has zero frontend callers; `UNSERVED_TOOLS = new Set([])` hardcoded | Read capabilities in the builder and grey out with the reason |
| A4 | Med | V | Spend cap "0" means *unlimited*, though the field reads "per month" | `runtime.py:1507` `if cap:` | Treat blank as unlimited and 0 as "never run", or forbid 0 with a hint |
| A5 | Med | V+S | Google sign-in, the login↔signup toggle links, and ProtectedRoute all drop `?next=`, so a shared agent link lands on chat after sign-in; link-visibility shares have no signed-out landing | `GoogleCallback.tsx:34`; `Login.tsx:183`, `Signup.tsx:223`; `App.tsx:72-82` | Carry `next` through OAuth state and every redirect |
| A6 | Med | S | Server 400s show as one toast ("field: message"), never beside the field; the wizard's create error is generic and discards field errors | `AgentBuilder.tsx:613-622`; `AgentCreateWizard.tsx:63` | Map errors to knobs inline |
| A7 | Low | S | Removing a grant leaves invisible `toolScope` entries; next Save 400s with only a toast (plausible "unsaveable agent") | toolPermissions pruned client-side at save, toolScope not | Prune toolScope the same way |
| A8 | Low | S | Wizard progress lost on leaving; install toast says "Tools page" (it is Connections); new agent missing from the delegatesTo picker for 60 s | `AgentCreateWizard.tsx:24-32`; `Templates.tsx ~496`; un-invalidated query key | sessionStorage draft; copy fix; invalidate key |

| A9 | High | V | Chat "make me an agent that searches my KB / reads Gmail / delegates to X" always fails with "Could not save the agent: 'request'"; `update_agent` fails on any agent that already has a KB, connection or delegate | `chat/tools/authoring.py:219` `AgentSerializer(data=merged)` with no `context={'request': ...}`; validators read `self.context['request']` (`config.py:476,749`). Test `test_authoring.py:65-69` passes on the KeyError, not the ownership check | Pass a request-shaped context (or `user` in context and read that); fix the test to assert the ownership message |
| A10 | High | S | After deleting an agent, KB or connection, every later Save (even a rename) of any agent that referenced it 400s with "No such agent: N"; restoring an old revision hits the same trap | No delete-time pruning; `to_config` returns stale ids and PATCH merges them back; `_owned_ids` refuses | Prune references on delete, or drop unresolvable ids on save with a notice |
| A11 | Med | S | Deleting an agent leaves its published listing live and installable, and the author can no longer withdraw it (the only withdraw route needs the agent id) | `SharedAgent.subagent` SET_NULL; withdraw at `agents/<id>/share/` only | Withdraw on delete, or a listings page keyed by share id |
| A12 | Med | S | Share screen 400s (can't see published state/installs) after a referenced KB is deleted; republishing silently relists a withdrawn listing | `views/gallery.py:708-709` runs `to_shareable` on GET; `L744-755` sets `is_listed=True` | Read listing state without `to_shareable`; keep `is_listed` unless the author relists |
| A13 | Med | S | Double-clicking "install pack" (or two tabs) creates duplicate agents or a 500 | `template_slug` has no unique constraint; read-then-create; name loop races `unique_together(user,name)` uncaught | Partial unique `(user, template_slug)`; catch IntegrityError |
| A14 | Low | S | `spendCapRupees` has no ceiling; agent brief has no length cap (a huge prompt is billed every turn) | `config.py:354`, `:172` | `max_value`, `max_length` |

| A15 | High | V | A read-only, `ask`-mode agent can send mail and write files through a delegated worker configured `full` | `invoke_subagent` (`chat/tools/agents.py:900-1090`) narrows only subAgents, toolPermissions, writePaths/commandScope, cap; NOT fileAccess, connectors, toolScope or autonomy (`lifted_autonomy` only lifts; agent parents pass `''`) | Intersect every scope parent→worker; cap worker autonomy at the parent's |
| A16 | High | S | Spend cap overshoots: concurrent runs each pass at the same spend, and in-flight runs count zero; a parent's cap ignores its workers' spend | `check_guardrails` start-only (`runtime.py:1483-1516`); cost written only in `_close_log`; `_spend_this_month` filters `subagent=agent` | Reserve at start, count running runs, re-check per iteration |
| A17 | Med | S | Approving a paused run after the cap, pause or unattended setting changed: the Inbox says "resumed" but the run stays `running` until recovery fails it | Guardrails before the `try` (`runtime.py:1973-1975`); resume `_run` only logs (`:2582-2595`); `hitl.py:164-170` returns `resumed: true` | Same fix as C6; surface the refusal |
| A18 | Med | V | Setting `toolScope` silently removes Gmail, Drive, Calendar, web and delegation tools although they are granted | `allowed_names` intersects connector tools with toolScope (`runtime.py:~202-211`); validator checks names only | Exempt connector/infra tools or validate against held grants; warn in builder |
| A19 | Med | S | Run revisions misdescribe execution: workers pin the unmodified DB revision; some writers skip `record()` (`gallery.py:645`, admin); an edit between load and open mismatches | `_open_log` uses `revisions.current(agent)` | Snapshot the in-memory config the toolbox was built from |
| A20 | Low | S | Edits mid-run are ignored by a running run but apply after an approval resume; the tool library switch and connector card are read live, the rest frozen | Frozen toolbox vs `disabled_tools_for` live reads | Document, or make resume use the original revision |

## Wave 3: Runs & Schedules

| ID | Sev | Conf | What the user sees | Root cause | Fix direction |
|---|---|---|---|---|---|
| R1 | High | V | Two devices answering the same Inbox request can both resume the run, or race approve against reject; a resume that fails is swallowed after the row is closed, so the user can't retry and the run stays paused | `agents/views/hitl.py:63-67` read-then-act, unconditional `asave` (`:128-135`), `except` logs only (`:149-153`) | Conditional `filter(status='pending').update()` + rowcount; return `resumed:false` with a reason; close the row only after a successful resume |
| R2 | High | V | A webhook hit 1000×/min starts 1000 detached runs: overlap policy ignored, no route-specific throttle; bodies up to 20 MB are buffered before the 64 KB check | `agents/views/triggers.py:696-699` calls `start_agent_run` directly, bypassing `sweep.prepare`; global AnonRateThrottle only | Route through `prepare`/overlap; per-trigger throttle; reject on `CONTENT_LENGTH` before reading |
| R3 | Med | S | Answering a request whose agent was deleted shows "Response sent" but nothing resumes; the run stays paused for ever | `hitl.py:80-85` (agent None → not resumable, row still closed) | Refuse with a sentence, or close the run as cancelled |
| R4 | Med | S | Missions: resuming a cancelled one reactivates it; cancelling one leaves its in-flight run running; pausing a finished one pauses it | `chat/commands/views.py:376-392` writes status with no transition checks or run cancel | State machine + cancel `current_execution_id` |
| R5 | Med | S | Pending-approval list is unbounded | `hitl.py:20-35` no slice | Cap + `truncated` |
| R6 | Low | S | An unknown Inbox `action` (typo) is recorded as "answered" | `hitl.py:74-79` | Validate the action |
| R7 | Low | S | Cancelling a run on another worker returns 409 and can't be stopped until recovery | `runtime.py:1872-1875` | Cross-process cancel flag checked per iteration |
| R9 | High | V | Inbox says "Response sent" even when nothing resumed (deleted agent, failed resume, missing thread) — the approved email never goes out | `api/orchestrator.ts:94-96` discards the body; `NeedsYou.tsx:44-51` always toasts success | Return and show `resumed`/reason; link to the run |
| R10 | Med | V | A notification link to an already-answered request silently selects a *different* pending request, which the user may then approve | `NeedsYou.tsx:96` `?? pending[0]` | Show "already answered" instead of falling back |
| R11 | Med | S | Failed runs show the raw provider error with no "reconnect Google"/credentials link | `HistoryList.tsx:419-423`, `RunDetail.tsx:46-47` | Map error codes to an action |
| R12 | Med | S | Run history is capped at 50 with no "load more", though the API supports a cursor | `HistoryList.tsx:93` | Pager |
| R13 | Med | S | Schedules page never shows `last_error`; a slot skipped behind a paused run reads only "Skipped — already running" (not "waiting for your approval") | `Schedules.tsx:95-99, 316-327`; `lib/triggerStatus.ts:44-48` | Show the reason and link to the waiting request |
| R14 | Low | S | An "expired" approval (past `timeout_seconds`) still offers Approve; the expiry is only a label | `NeedsYou.tsx:13-20` | Expire server-side or disable |
| R15 | High | V | One unanswered approval on an `ask` schedule blocks every later firing for ever — even after the 7-day abandon cancels the request (then nobody can answer it at all); `queue` just flips queued→dropped daily | `sweep.py:47-56` counts `paused` as busy; `reminders.py:_sweep_abandoned` cancels only the HITLRequest, never the log; recovery selects `running` only | Abandon = cancel the run too (`cancel_agent_run`); optionally a paused-age cutoff per schedule |
| R16 | Med | V | An account pause or a spend cap reached for 5 firings permanently disables the schedule; un-pausing or the new month does not re-enable it | `sweep.py:416-427` counts `AgentRunRefused` as a failure; `:378-380` disables at 5 | Treat pause/cap refusals like `paused` agent (skip, record, don't count) |
| R17 | Med | S | Cancelling a mission leaves its run going or paused, its approvals pending, `current_execution_id` set — so the cancelled mission can still act and ask, and a resumed mission can never launch again | `chat/commands/views.py:360-392`; `missions/sweep.py:50,124-125` | Cancel the in-flight run on mission cancel/pause; clear the id |
| R18 | Low | S | Nudges about a deleted agent's or a recovery-failed run's request continue for up to 7 days | `recovery._fail` doesn't close HITL rows; `reminders.py:285` keeps null-agent rows | Close HITL rows in `_fail` and on agent delete |
| R19 | Low | S | During a scheduler-lease takeover every periodic job starts again while the old holder's jobs still run; mission `settle` has no claim, so two sweeps can double-count `runs_done`/spend | per-process `_running` (`scheduler.py:251-284`); `missions/sweep.py:110-152` | DB claim per job / per mission settle |
| R8 | Low | S | Webhook 500 on a start error reveals the secret is live | `triggers.py:707-711` | Same 404 |

## Wave 4: Files & workspace apps

| ID | Sev | Conf | What the user sees | Root cause | Fix direction |
|---|---|---|---|---|---|
| F1 | Med | V | Closing the tab right after typing can lose the last edits: the hide/close flush is an ordinary axios request the browser may cancel | No `keepalive`/`sendBeacon` anywhere in src; `SheetEditor.tsx:196-206`, `OfficeEditors.tsx:168-181` | `fetch(..., {keepalive:true})` for the flush |
| F2 | Med | V+S | After "Storage is full" during a bulk upload, the skipped files are neither counted nor listed; the toast still says "Uploaded N files" | `Documents.tsx:426-441` | Summarise "N uploaded, M not uploaded (storage full)" with names |
| F3 | Med | S | A second tab (or a tab open while an agent edits/trashes the file) shows stale content until its own save gets a 412; a trashed file only surfaces as repeated "Could not save" toasts | No refetch on focus / no change signal for a mounted editor | Refetch `updated_at` on focus; dedicated 404 "moved to Trash" state |
| F4 | Low | S | Offline autosave retries every ~1.5 s with a toast each time, no backoff or offline indicator; a flush during an in-flight save is dropped | `SheetEditor.tsx:142,179-183` | Backoff + single offline banner; queue the flush |
| F5 | Low | S | Large uploads (45 MB video) show a spinner with no progress or cancel; 5-min timeout fails on slow links with "Please try again" | `api/documents.ts:316-319` no `onUploadProgress`; `client.ts:24` | Progress bar, cancel, client size check |

| F6 | High | V | Files being indexed during a deploy stay "pending"/"processing" for ever — never searchable in their KB; only a re-upload fixes it | `inference/indexing.py:10-16` in-process queue; no startup re-queue or stuck-row sweep | A periodic job re-submitting `pending`/`processing` rows older than N minutes |
| F7 | Med | V | Two agents (or an agent and a later agent) editing the same workbook/document/deck at once: one's edits silently vanish | `chat/tools/office.py:650-658` read → apply → `write_binary(overwrite)` with no `expected_version`; same for `edit_document`/`edit_deck` | Pass the read version as `expected_version`, or hold the name lock across read-modify-write |
| F8 | Med | S | After a restart, an unrendered Sheets/Docs draft never renders unless someone opens/downloads it; `find_files` and KB search keep the pre-edit text | debounce is `spawn(sleep)` (`views.py:990-996`); `maybe_render_draft` not in `PERIODIC_JOBS`; `vfs.find` reads `content_text` directly | Periodic draft-render sweep |
| F9 | Med | S | If rendering the user's draft fails, an agent write then silently discards the user's unsaved edits | `drafts.py:160-171` keeps draft with `draft_error`; `replace_bytes` pops it (`office_edit.py:220-222`) | Refuse the agent write while `draft_error` is set, or keep the draft as a version |
| F10 | Low | S | Recycle purge can delete bytes a chat attachment still points at; blob deleted before the row | `recycle.py:310-315` unconditional `file.delete`; `drop_document_blob` checks only Document | Use the shared-name check; delete the row first |
| F11 | Low | S | Concurrent creates via the app's "New file" or a new folder path can produce same-name duplicates on Postgres | `office_edit.create` / `_make_dirs` outside `_name_lock` | Take the lock |

| F12 | Med | V+S | A user at quota keeps growing storage: content edits, version snapshots (25 × 25 MB per file), and draft JSON never hit the quota check; drafts aren't even counted | `office_edit.py` checks quota only in create/copy (`:473,:515`), not `replace_bytes`/`save_text`; `drafts.py:83-140` no size cap | Check growth (new − old) on edits; cap draft size; keep fewer versions at quota |
| F13 | Med | S | Trashing a folder with ~1000 files de-indexes each doc serially inside the request and can time out | `recycle.py:50-95` `_deindex` per doc via `async_to_sync` | Background job; batch vector delete |
| F14 | Low | S | Preview PNG cache is never deleted on purge, isn't counted, and is keyed by file size only (same-size replacement shows a stale preview) | `previews.py:51,73`; `signals.py:66` | Delete with the doc; key on `updated_at`/hash |
| F15 | Low | S | Quota/validation errors on image upload and edits lack `code`, so the UI can't show "Storage full"; image upload skips `validate_file_upload`; an invalid `kb_id` silently goes to the default KB | `views.py:790`, edit `EditError` → `{'error'}` 413; `views.py:244-247` | One error shape; validate; refuse unknown kb_id |
| F16 | Low | S | Trashing or purging a shared file keeps its published link live (snapshot) and its bytes count against quota, with no hint in the UI | No `PublishedPage` handling in recycle/signals | Tell the user on trash; offer "stop sharing" |

## Wave 5: Outputs (pages, dashboards, Imagine)

| ID | Sev | Conf | What the user sees | Root cause | Fix direction |
|---|---|---|---|---|---|
| O1 | High | V | A published HTML page whose body contains `<header>` (very common) runs with **no** network CSP — it can fetch/exfiltrate from visitors' browsers | `lib/pageBody.ts:46` regex `/<head[^>]*>/i` matches `<header>`, so the CSP meta lands in the body (ignored by browsers) | Always wrap in a fixed `<head>` with the CSP first (parse with DOMParser), or serve the frame document with a CSP header |
| O2 | High | V | Video generation in production never finishes: polling is a Celery task and prod runs no Celery; the job is billed then left pending/failed; with Celery the 10-min retry cap fails long videos | `imagine/services/dispatcher.py:207-208` `.delay`; nothing in `agents/scheduler.py` PERIODIC_JOBS; `tasks.py` 20×30 s | Poll from `PERIODIC_JOBS` over DB rows; longer budget; record cost at submit |
| O3 | Med | V | A mission run can publish a page `public` (unattended limit is `link`) | `chat/tools/publish.py:31` hand-copied `UNATTENDED_CALLERS` omits `mission` | Import `agents.grants.UNATTENDED_CALLERS` |
| O4 | Med | S | A scheduled agent can save a dashboard `public` with no unattended limit, no content check, no approval | `chat/tools/dashboards.py:76-109` reversible, no caller check | Same rules as `publish_page` |
| O5 | Med | S | Provider errors or unreadable bytes after billing are recorded nowhere (invisible to caps), and the model is told "try again" — a second paid call | `chat/tools/media.py:73-93, 209-210` | Record the cost before parsing; don't invite retry |
| O6 | Med | S | Imagine and chat-turn image spend is in no ledger and under no cap (only a 30/hour throttle; a batch returns n images); video cost never recorded | `dispatcher.py:134-138`; `media.py:117-127` skips without an ExecutionLog | CostEntry for every paid call; user-level cap |
| O7 | Med | S | Republishing a page mints a new URL (`-2`, `-3`); the old link keeps the stale snapshot; no relist; `link` slugs are guessable from the title | `pages.py:26-34`; `page_views.py:156` GET/DELETE only | Update-in-place route; random suffix for `link` |
| O8 | Low | S | "Public" dashboards are only visible to signed-in users and expose `sources` to non-owners; `refresh`/`refresh_cron` do nothing | `dashboard_views.py:36,101-132` | Align with pages or rename; hide sources |
| O9 | Low | S | Moderation runs a synchronous 4 s HTTP call on the run's thread, with no negative cache; audio prompts skip the model check; label failure saves the image unlabelled (GIF/video/audio never labelled) | `core/safety/moderation.py:160-171`; `labels.py:43-47,87-89` | Async client, short negative cache, label what can be labelled |

## Wave 6: Integrations

| ID | Sev | Conf | What the user sees | Root cause | Fix direction |
|---|---|---|---|---|---|
| I1 | Med | V | Deleting the Google credential silently breaks every Gmail/Drive/Calendar agent; when delete *is* refused, the dialog just stays open (error only in console) | `credentials/views.py:121-133` checks only `SubAgent.llm_credential_id`; `Credentials.tsx:110-118` `console.error` | List dependents (native cards, MCP env maps, secret refs, scoped agents); show the refusal |
| I2 | Med | S | A revoked Google refresh token leaves the credential "active": tools stay offered every turn, each call burns a ~10 s refresh POST then fails; revoked vs network blip look the same | `credentials/models.py:312-317,361` (non-200/exception → None, no disconnect); `google/client.py:81-91` presence-only check | Parse `invalid_grant` → mark disconnected, withhold tools, show "Reconnect" |
| I3 | Med | S | Google consent with a scope unticked still produces a "verified" credential that fails later | OAuth callback doesn't check granted scopes (`credentials/views.py:~315-330`) | Compare granted vs required; tell the user |
| I4 | Med | S | Agent runs keep the native-connector live set for the whole run: switching a card off or removing the credential mid-run is not honoured until the run ends (chat re-reads per call) | `runtime.py:165,335-339` memoised `native_live` | Re-read at dispatch like chat |
| I5 | Low | S | N parallel Gmail calls that each get a 401 each force a refresh in sequence under the lock | `models.py:305-309` forced refresh skips the "already refreshed" re-check | Compare rejected token vs stored before refreshing |
| I6 | Low | S | Credential cache is per process and not invalidated on ORM/cascade deletes; cached tokens aren't tied to their expiry | `credentials/manager.py:38-87` | Signal-based invalidation; cap TTL at token expiry |
| I7 | Low | S | DNS-rebinding window between the SSRF check and the MCP client's own resolve | `mcp_integration/client.py:1041` vs `:1073,1091` | Pin the resolved IP for the connection |
| I8 | Low | S | OAuth state is replayable for 10 min (no nonce); token-exchange errors returned verbatim; shared skills are unscreened prompt text any agent may follow | `credentials/views.py:227-283`; `skills/views.py:19` | Nonce; generic error; screen shared skills like tool descriptions |

## Wave 7: Account

| ID | Sev | Conf | What the user sees | Root cause | Fix direction |
|---|---|---|---|---|---|
| U1 | High | V | Every user is logged out once their 24 h access token expires — the silent refresh always 404s; refresh rotation/blacklist never take effect | `better-n8n-frontend/src/api/client.ts:130` posts `/auth/refresh/`; the route is `auth/token/refresh/` (`core/urls.py:63`); `client.ts:94` has the same wrong path | Use `/auth/token/refresh/` in both places (or add an alias) |
| U2 | High | S | No way to delete an account (UI or API); Legal page says "contact us" — DPDP/GDPR erasure gap | No endpoint in `core/urls.py`; `Profile.tsx:330-354` only Sign out | Deletion endpoint with re-auth + a defined data-removal list (see wave 7 data lifecycle) |
| U3 | Med | S | Sign-out doesn't invalidate the refresh token server-side; no "sign out everywhere"/session list; API keys survive a password reset | `api/auth.ts:252` local only; `APIKeyAuthentication` never checks `tokens_valid_after` | Blacklist on logout; revoke-all button; revoke keys on reset |
| U4 | Med | S | Signup and email change reveal whether an email is registered; login throttle is per-IP only (no per-account lockout); one shared 10/h reset scope can lock an office out | `core/serializers.py:183-194`; `views.py:59,476`; `base.py:496,511` | Generic signup message + email verification; per-account throttle |
| U5 | Med | S | Password users never verify their email (signup returns tokens immediately); a later "Continue with Google" silently disables their password | `views.py:203-243`, `_claim_verified_email` `:128-148` | Verify on signup; tell the user when the password is retired |
| U6 | Med | S | Anyone with manager rights can add any registered user to an org with no consent/invite step; last-owner guard is a non-atomic count (two owners leaving at once can orphan the org) | `core/orgs.py:148-155,169-192` | Invite + accept; guard inside the transaction |
| U7 | Low | S | A revoked WebSocket reconnect (close 4001) backs off and retries instead of logging out | `lib/websocket.ts:175-190` no 4001 branch | Treat 4001 as auth failure |
| U8 | Low | S | Reset/verify lookups are case-sensitive (mixed-case email silently fails; duplicate legacy email → 500); OTP emails sent from a thread with failures swallowed ("OTP sent" when mail is down) | `views.py:96-107,530,553,588` | `iexact`; report send failures |
| U9 | Low | S | API keys have no scopes (full user power); the UI manages only `keys[0]` | `api/auth.ts:370-390` | Scopes; list all keys |

| U10 | Med | S | Solution capture, moderation and other platform-key calls have no per-user cap (thumbs-up spam = one paid call each) | `solutions/capture.py:167-180,224-228` only adds to `total_tokens_used` | Per-user daily budget for platform-key calls |
| U11 | Low | S | Avatar file likely survives account deletion; backups have no erasure/retention beyond `--keep` | no post_delete for `UserProfile.avatar` (`core/models.py:136`); `backup_db` | Delete handler; S3 lifecycle |
| U12 | Low | S | Same answer can be captured twice with several workers; membership check and insert not atomic | per-process `_IN_FLIGHT`; non-atomic dedupe (`capture.py`) | Unique `(source_message_id)`; check inside the transaction |

Note: **C17** (checkpoints never deleted) and **U2** (no account deletion) were each found independently by two subagents (wave 1 API, wave 7 data lifecycle); treat them as S2.

## Wave 8: Evals

| ID | Sev | Conf | What the user sees | Root cause | Fix direction |
|---|---|---|---|---|---|
| E1 | High | V | An imported or hand-added eval case runs on the owner's **real** Gmail/Drive/MCP/browser/publish/image tools, and with the default "Record and run" it really sends, publishes and spends; the page only shows an approvals dropdown | `eval/environment.py:552-553` returns no environment for versionless cases; default `gated_calls='run'`; `Evals.tsx:589-599` | Default `block` for versionless cases; a clear "runs against your real account" confirm |
| E2 | Med | V | A judge outage scores every judge-only case 0 and fails the sweep as if the agent were broken; nothing is queued for review | `eval/graders.py:862-867` returns `passed=False, 0.0`; `supervision.py:97-105` queues only the uncertain band | Mark judge failure as error/`auto_passed=None` and queue |
| E3 | Med | V | Sweep cost ceiling is unlimited by default, checked only before each case (concurrent cases overshoot) — a 200 × 3 sweep has no bound | `eval/models.py:115-118` null = unlimited; `runner.py:288-302` | A default ceiling + pre-sweep cost estimate |
| E4 | Low | S | After a restart a sweep looks "running" for up to 3 h (a world for 30 min) before recovery fails it; it is never resumed, and killed attempts' `/.eval/` folders stay and count toward quota | `thresholds.py:393`; `eval/recovery.py:31-67`; `api.py:346-359` | Boot-time sweep keyed on process start; clean attempt folders |

| E5 | Med | V | Reviewing a result while a sweep is still running marks the run `completed` (or `awaiting_review`) early, with a provisional score — and then the suite can be deleted mid-sweep | `eval/supervision.py:220-238` only protects `failed`/`cancelled`; delete guard (`views.py:141-151`) doesn't cover `awaiting_review` | Leave `pending`/`running` alone outside `_finish`; extend the guard |
| E6 | Med | S | A cancelled sweep whose process died blocks deleting its suite/sweep for ever (409); cancel can overwrite a just-completed run | `run_cancel` sets no `completed_at` (`views.py:351-359`); recovery matches `running` only | Recovery handles cancelling rows; conditional UPDATE |
| E7 | Low | S | "Save as eval case" doesn't check the suite's agent matches the run's, has no dedupe (double-click = duplicates), accepts eval-caller runs; bulk draft accept isn't atomic | `views.py:512-537, 823-829` | Validate, dedupe on execution_id, atomic |
| E8 | Low | S | Evals UI silently shows 20 runs / 25 review items with no "more" indicator; suite list unpaginated with a heavy 3-way count join; two reviewers overwrite each other's verdict with no signal; suite-delete 409 reason dropped | `api/evals.ts:320-348`; `queries.py:170-184`; `Evals.tsx:177-180` | Show counts/pager; subquery counts; show the reason |

### Refuted in wave 8
- A *world* eval fails closed: tools without a simulator are withheld and refused at dispatch; MCP is withheld wholesale.
- A judge failure is never recorded as a pass.

### Refuted in wave 7
- Forgot-password is enumeration-safe (same response, dummy hash); OTPs are hashed, single-use, expire in 10 min, lock after 5 tries.
- Password/email change revokes tokens at REST, refresh and WebSocket connect; Google sign-in on an unverified password account cannot take it over.
- Removing an org member cuts solution access immediately (membership read live).

### Refuted in wave 6
- OAuth state is bound to the user and redirect origins are allow-listed; custom MCP URLs are SSRF-checked at save and connect; stdio is refused in deployment at both doors.
- Held-tool approval is owner-scoped (foreign id → 404); credential values are write-only, refresh tokens never serialised.
- ChatGPT token rotation is locked and marks sign-out after the transaction.

### Refuted in wave 5
- Content-policy refusals in Imagine happen before the provider call and are not charged.
- `generate_image` asks per call under `auto`; a successful image is counted once (ledger `image` excluded from the sum).
- Published-page refusals are a uniform 404; lists are capped; withdraw takes the page down on the next fetch.

### Refuted in wave 4
- Agent edit during a user's draft window: the agent path renders the draft first (`ensure_rendered`), and a stale render cannot overwrite a newer write (`render_of` row lock, `DraftSuperseded`).
- Published file pages and versions survive a purge (server-side copies).
- Two editors saving the same file: every editor sends `If-Match`; a 412 shows Reload / Overwrite (no silent overwrite).
- STORAGE_FULL stops the remaining uploads (it does not keep trying all 40).

### Refuted in wave 2 (runtime)
- Native Google tools declare their effects correctly; `read` connector mode lets no mutating tool through.

### Refuted in wave 2
- Public `/a/:slug` never shows the author's email (`_author_name` uses full name or username).
- Hostile ids (foreign KB, agent, connection), unknown contract, fanout and run-seconds bounds are all validated (in the builder path).
- Publishing fails closed when an id no longer resolves; installs choose the installer's own ids.

### Refuted in wave 1
- Inline `invoke_subagent` workers ARE cancelled with the chat turn (`orchestrator.py:298-304`, `_finalise_cancelled`).
- `steers_returned` IS delivered after Stop on the same stream and put back in the box.
- Mode switch IS saved (UI PATCHes `ChatSession.autonomy` before posting the steer).
- Recovery does not resume `paused` runs; eval runs are failed, not resumed against real data.
- Resumed runs DO re-check pause and spend cap (they get stuck, see C6, they do not bypass).

---

# Application-flow gap review: plan

## Roles
- **Orchestrator (me).** Goes through one application at a time. For each one I write
  realistic user scenarios and a hypothesis for each ("I think X breaks when Y").
  I hand each subpart to a subagent, read their summaries, question them, compare
  their answers against each other, and check the most important claims in the code myself.
- **Subagents (Sonnet, read-only).** Each one owns one subpart of one application.
  They trace the real code path for the scenario and report a summary with file:line
  evidence. They stay available so I can ask follow-up questions.

## Subparts per application
| Subpart | What the subagent traces |
|---|---|
| **UI** | Page and components: loading, empty, error and race states. Is every button wired to a real endpoint? What does the user actually see? |
| **API** | Views, serializers, permissions, validation, transactions, ownership checks. |
| **Runtime** | Detached tasks, sweeps, restarts, recovery, notifications, what happens after the HTTP response. |

## Applications, in order (one wave at a time)
1. **Chat** (`/ai-chat`): turn, stop, steer, approvals, questions, delegation, modes, restart.
2. **Agents** (`/agents`, wizard, builder, history, `/templates`, `/a/:slug`): build, save, publish, install, revisions.
3. **Runs and Schedules** (`/runs` with Inbox and Missions, `/schedules`): triggers, HITL, recovery, missions.
4. **Files and workspace apps** (`/documents`, `/apps/*`: files, docs, sheets, slides, notepad, code, latex, pdf, photos, media, whiteboard, tasks, web): upload, quota, indexing, autosave, agent edits, trash.
5. **Outputs** (`/pages`, `/p/:slug`, `/dashboards`, `/imagine`): publish, snapshot, withdraw, cost.
6. **Integrations** (`/connections`, `/credentials`, `/tools`, `/skills`): OAuth, token refresh, MCP, native Google, tool config.
7. **Account** (signup/login/Google, `/settings`, `/profile`, orgs, `/solutions`): auth, revocation, org isolation, deletion.
8. **Evals** (`/evals`): world generation, sweeps, review, recovery.

## How one application runs
1. **Simulate.** I write 3–5 scenarios with numbered hypotheses H1..Hn.
2. **Dispatch.** I start 2–3 Sonnet subagents (UI / API / Runtime), each given the scenarios and the hypotheses that touch its subpart.
3. **Report.** Each returns a step trace, a verdict on each hypothesis (CONFIRMED / REFUTED / PARTIAL) with file:line, and the other gaps it found.
4. **Question.** I send targeted follow-ups (SendMessage), especially where two subagents disagree or where the UI and API reports don't line up.
5. **Verify.** I read the cited lines myself for every high-severity finding before it goes in the register.
6. **Record.** Findings go in the gap register.

## Gap register (one row per gap)
ID · application · scenario · what the user sees · root cause (file:line) · severity (high/med/low) · confidence (verified by orchestrator / subagent only) · suggested fix

## Deliverable
`Backend/docs/APP_FLOW_GAP_REVIEW.md`: the register sorted by severity, plus what was refuted
(so nobody re-investigates it). No code changes during the review.

---

# Product feature gaps and improvements (easy → hard)

Written as a product manager's read of the platform after the flow review. Each item has:
- **What I understand today**: the current state, from the code review and CLAUDE.md.
- **Requirement**: what "done" means, as acceptance criteria.
- **Gaps it closes**: rows in the register above.

Items marked *check first* rest on a belief I did not confirm in code.

## Easy (days; mostly surfacing what the backend already has)

### 1. Say what really happened
**What I understand today.**
- Several flows fail silently.
- A chat turn cut off by a deploy leaves a question with no answer and no marker.
- The Inbox shows "Response sent" even when the run did not resume, because the response body is thrown away.
- A bulk upload stopped by "Storage full" doesn't say which files were skipped.
- The backend usually knows the truth: `resumed:false`, `storageFull`, and a user message with no answer.

**Requirement.**
- A chat turn with no answer after a restart shows "This answer was interrupted — Retry", and Retry resends the same message.
- An Inbox answer shows one of three outcomes: "Run continued" (with a link to the run), "Answer recorded, but the run could not continue: <reason>", or "Already answered".
- A bulk upload ends with "N uploaded, M not uploaded (storage full)", followed by the file names.
- No success toast appears unless the server confirmed success.

**Gaps it closes.** C4, R9, R10, F2, C15.

### 2. Grey out unavailable capabilities in the agent builder
**What I understand today.**
- `GET /api/orchestrator/capabilities/` already returns each grant's tools, its engine liveness and a risk line.
- The builder never calls it, and uses a hard-coded empty "unserved" set.
- So browser, shell or workspace grants look switchable even when their engine is off.

**Requirement.**
- The builder loads capabilities once per visit.
- A grant whose engine is off is disabled, with the reason ("Browser engine isn't configured on this platform").
- Each grant's risk line is shown beside its switch.
- An already-saved agent holding an unavailable grant shows a warning on its card.

**Gaps it closes.** A3.

### 3. Show what a delete will break
**What I understand today.**
- Deleting an agent silently cascades its missions, schedules and eval suites. It also leaves its public listing live and other agents pointing at it.
- Deleting a credential checks only whether an agent uses it as its LLM key. Gmail, Drive and other connectors break silently.
- When a delete is refused, the refusal never reaches the screen.

**Requirement.**
- Before deleting an agent or a credential, show its dependents with counts and names:
  - schedules, active missions and paused runs;
  - agents that delegate to it;
  - published listings;
  - connectors that use the credential.
- The user confirms with that list in view. The listing is withdrawn and other agents' references are pruned in the same action.
- A refusal is shown as a sentence in the dialog.

**Gaps it closes.** A2, A10, A11, I1.

### 4. "Reconnect" banners for broken connections
**What I understand today.**
- When a Google refresh fails, the credential gets `is_verified=False` and a `last_error`.
- The tools are still offered on every turn, and each call waits about 10 s on a refresh and then fails.
- Failed runs show the raw provider error, with no link to fix it.

**Requirement.**
- A revoked token (`invalid_grant`) marks the connection "Disconnected" and withholds its tools from chat and agents.
- Connections, the failed run and the next chat turn all show "Google needs reconnecting", with a Reconnect button that opens OAuth.
- A temporary error (timeout, 5xx) does not mark the connection disconnected.

**Gaps it closes.** I2, R11.

### 5. Make the spend cap mean something
**What I understand today.**
- `spendCapRupees: 0` currently means *unlimited*, because the runtime checks `if cap:`.
- The cap is checked only when a run starts, and runs still in progress count as zero spend.
- The UI says "per month" and shows no live figure.

**Requirement.**
- Blank means unlimited; 0 means "never run" (or 0 is refused with a hint).
- The agent card and builder show "₹spent / ₹cap this month", including runs in progress.
- A run is refused, or stopped between iterations, once the cap is reached, and the run says why.

**Gaps it closes.** A4, A16.

### 6. Sign out everywhere, and a session list
**What I understand today.**
- `core/auth/revocation.py` can revoke every token for a user, but only a password or email change triggers it.
- Sign-out only clears local storage, so the refresh token stays valid.
- API keys ignore revocation.
- The Settings Security tab says "coming soon".

**Requirement.**
- Sign-out blacklists the refresh token on the server.
- Settings → Security has a "Sign out of all devices" button, which revokes tokens and, optionally, API keys.
- It also lists recent sign-ins (device, IP, time).
- A WebSocket closed with code 4001 sends the user to sign-in instead of retrying.

**Gaps it closes.** U3, U7.

### 7. Counts and "load more" on long lists
**What I understand today.**
- Run history stops at 50 and Evals at 20 runs and 25 review items.
- The API already returns `count`/`truncated` and supports cursors, but the frontend throws that away.

**Requirement.**
- Every capped list shows "Showing 50 of 312" and a "Load more" control, using the existing cursor.
- Filters persist.
- The review queue can be sorted newest-first.

**Gaps it closes.** R12, E8, R5.

### 8. Explain a skipped schedule
**What I understand today.**
- A schedule skipped because its previous run is waiting for approval shows only "Skipped — already running".
- The Schedules page never shows `last_error`.

**Requirement.**
- The schedule card shows the last outcome as a sentence:
  - "Skipped: last run is waiting for your approval (open)";
  - "Refused: spend cap reached";
  - "Disabled after 5 failures: <reason>".
- Each comes with the matching action: open the request, raise the cap, or re-enable.

**Gaps it closes.** R13, R16.

## Medium (one to two weeks each)

### 9. Account deletion and data export
**What I understand today.**
- There is no deletion endpoint or UI; the Legal page says "contact us".
- Most rows cascade from the user. Some data survives a deletion:
  - chat checkpoints, which hold full transcripts, are never deleted, even when the chat is;
  - backups have no erasure story;
  - the avatar file is probably orphaned.
- CLAUDE.md names DPDP consent and export as due before May 2027.

**Requirement.**
- **Export (Settings → Privacy):** a zip of files, chats, agents, runs and memory, prepared in the background, with an emailed download link.
- **Delete account:**
  - requires a fresh password or Google re-auth, and a typed confirmation;
  - shows a 7-day grace period, then hard-deletes;
  - deletes file bytes, checkpoints, published pages and listings, vectors and the avatar;
  - asks the user to transfer or delete any org they solely own;
  - records that it happened, without personal data.
- Backups age out within a documented window.
- Deleting a chat also deletes its checkpoints.

**Gaps it closes.** U2, U11, C17.

### 10. One usage and billing page
**What I understand today.**
- Spending lives in several places:
  - agent runs (`ExecutionLog.cost_usd`, tokens);
  - the `CostEntry` ledger, which skips chat-turn images;
  - Imagine, which writes `metadata.cost_usd` only and has no ledger entry and no cap;
  - eval sweeps, excluded from caps and unlimited by default;
  - platform-key calls (solution capture, moderation, context folds), which nothing limits.
- `/billing` redirects to Settings.

**Requirement.**
- Every paid call writes one ledger row (`CostEntry`) with user, source (chat, agent, Imagine, eval, platform) and amount, including failed calls that were billed.
- The page shows this month's total, a breakdown by source and agent, a daily chart, and a forecast.
- There is one monthly cap per user that every paid path checks.
- Before a sweep or a large batch, show an estimate ("about ₹40") and ask for confirmation.

**Gaps it closes.** O5, O6, U10, E3, A16, C12.

### 11. Approve from anywhere
**What I understand today.**
- The Inbox, notifications, push and the daily digest exist, but approving means opening the app.
- An approval nobody answers keeps its run paused for ever. The 7-day abandon cancels the request and not the run, so the schedule is blocked for good.
- "Expired" is only a label.

**Requirement.**
- Push notifications and the digest email carry Approve and Deny actions, as signed one-time links that expire and are tied to the request.
- Each approval has a timeout (per agent, default 24 h). When it passes, the run is cancelled, the request is closed, the user is told, and the schedule is free to fire again.
- A notification link to an answered request says so instead of opening a different one.
- Two devices answering at once produce exactly one resume.

**Gaps it closes.** R15, R14, R1, R10.

### 12. Schedule reliability settings
**What I understand today.**
- Any refusal counts toward disabling a schedule, including an account pause or the spend cap; after 5, it is disabled for good.
- There is no retry after a temporary failure and no alert when a schedule is disabled.

**Requirement.**
- **Retries:** per schedule, retry a temporary failure up to N times with backoff.
- **Pause and cap:** an account pause or reached cap skips the slot without counting it as a failure, and the schedule resumes automatically when the pause lifts or the cap resets.
- **Alerts:** "Your 9am Inbox Agent was disabled: <reason>", by notification and in the digest.
- **Webhooks:** they go through the same overlap and admission rules as schedules, with a per-trigger rate limit.

**Gaps it closes.** R16, R2, R8.

### 13. Two-factor authentication
**What I understand today.** The Security tab is a placeholder. Login is throttled per IP only, there is no per-account lockout, and signup reveals whether an email is registered.

**Requirement.**
- TOTP 2FA with recovery codes, asked at login and before sensitive actions (deleting the account, changing the email, creating API keys).
- Per-account login throttling.
- A signup response that doesn't reveal registered emails, with email verification.
- API keys gain scopes (read-only, run agents, full).

**Gaps it closes.** U4, U5, U9.

### 14. Agent debugging and "did my edit help?"
**What I understand today.**
- Revisions are recorded per save, and runs pin a revision, though not always accurately (A19).
- Evals exist, but you can't change the prompt and replay a past run, or compare two revisions on the same cases.

**Requirement.**
- **Replay:** on any run, "Replay from turn N" with an edited prompt or model, running against simulated tools or blocked side effects by default.
- **Compare:** on agent history, select two revisions and run the agent's eval suite on both, showing scores side by side with a per-case diff.
- **Accurate revisions:** each run's recorded revision is the config that actually executed.

**Gaps it closes.** A19; also helps E1.

### 15. Live dashboards
**What I understand today.** Dashboards store `sources` and `refresh_cron`, but nothing reads them. "Refresh" returns the stored spec with a new timestamp, and "public" dashboards are visible only to signed-in users.

**Requirement.**
- A source (sheet range, KB query, run metric) is resolved by a scheduler job on `refresh_cron`, with the chart data updated.
- A failed source shows an error on its own tile only.
- Visibility follows published pages: link, platform, or public with anonymous access.
- `sources` is hidden from people who don't own the dashboard.

**Gaps it closes.** O8.

### 16. Missions that wake on events
**What I understand today.** A mission can wait for something (a reply, a file), but only its timeout wakes it; nothing listens for the event. Cancelling a mission doesn't stop its running run.

**Requirement.**
- A mission's `wait_for` names an event (email from X, file in a folder, webhook, run done).
- When the event arrives, the mission wakes within a minute, with the timeout still as the fallback.
- Cancel or pause stops the in-flight run, closes its approvals and clears its execution id.
- Mission status changes follow a defined set of allowed transitions.

**Gaps it closes.** R4, R17.

### 17. Updates for installed agents
**What I understand today.** A published agent is copied once at install and never updated. Republishing gives the listing a new version number, but people who already installed it never hear about it.

**Requirement.**
- An installed agent remembers its listing and version.
- When the author publishes a new version, the agent shows "Update available", with a diff of prompt, grants and requirements.
- Updating needs the installer's approval if grants widen, and goes through the normal save path.
- Withdrawn listings tell installers, but their copies keep working.

## Hard (multi-week, platform-level)

### 18. Team workspaces
**What I understand today.**
- Organisations exist only for solutions: members share solved problems, read live.
- Agents, knowledge bases, connections, runs, approvals and files are strictly per user.
- Adding a member needs no consent (no invite).

**Requirement.**
- **Invites:** by email; the invitee must accept.
- **Roles:**

  | Role | Can |
  |---|---|
  | Owner | Everything |
  | Admin | Everything except deleting the org |
  | Builder | Create and edit shared agents |
  | Member | Use shared agents |
  | Viewer | Read only |

- **Sharing:** agents, KBs and connections can be shared with an org. Using a shared connection never reveals its secret, and its use is logged.
- **Approvals:** routed to a role or person, so a team inbox works.
- **Activity:** an org-level spend view and audit log.
- **Isolation:** the same choke-point design as `solutions/access.py`: one read door per shared object, and foreign ids get a uniform 404.

**Gaps it closes.** U6. This is the biggest step toward business customers.

### 19. Durable jobs underneath everything
**What I understand today.**
- Several kinds of work live only in memory or depend on Celery, which production doesn't run:
  - chat turns and the run registry;
  - indexing jobs;
  - debounced draft renders;
  - video polling;
  - the solution-capture dedupe set.
- Agent runs have partial recovery, but resuming loses context (C5) and refusals loop for ever (C6).

**Requirement.**
- One jobs table (kind, payload, status, attempts, claim and lease, next try), worked by the existing in-process scheduler under its lease.
- Every job is safe to run twice, retries with backoff, and has a final failed state the user can see.
- Use it for indexing, renders, video polling, capture, and the end-of-turn writes for chat.
- On startup, unfinished jobs are claimed again.
- Agent-run recovery keeps the caller, scopes, claims and parent link, and closes refused runs.

**Gaps it closes.** F6, F8, O2, C4, C5, C6, R19, U12.

### 20. Run on more than one server process
**What I understand today.** The chat run registry, steering mailbox, credential cache and connector live-set are all held per process. CLAUDE.md says re-attaching to a chat would break with several workers, so capacity is limited to one daphne process.

**Requirement.**
- Run state and the steering mailbox move to Redis or the database.
- Caches are shared or invalidated across processes.
- A request on any process can attach to a turn, steer it or stop it.
- Cancelling works across processes.
- A load test with 2+ processes passes the chat end-to-end suites.

**Gaps it closes.** R7, I6, and part of C9.

### 21. Real-time co-editing in Docs and Sheets
**What I understand today.** Editors detect conflicting edits (`If-Match`, 412, then Reload or Overwrite). A second tab or an agent's edit isn't seen until the next save, and agent edits can still lose updates between themselves.

**Requirement.**
- **Docs:** live presence and merged edits (CRDT via Yjs with TipTap).
- **Sheets:** cell-level operations broadcast over the existing WebSocket.
- **Agent edits:** arrive as operations visible live ("Analyst is editing B4:B20").
- **Offline:** edits queue and merge on reconnect.

**Gaps it closes.** F3, F7.

### 22. Run alerts and observability
**What I understand today.** Each run records turns, steps, cost and duration. There are no per-agent trends, no alerts, and no summary for the owner.

**Requirement.**
- Per-agent charts of success rate, cost per run, latency and approvals per run over time.
- Alert rules: failure rate above X, a spend spike, a schedule disabled, a connection disconnected. Alerts go by notification, digest or webhook.
- A weekly "Your agents" summary email.

## If only three
1. **#1 and #3.** Cheap, and they remove most "it silently didn't work" moments.
2. **#10.** Spending visibility is what lets people trust autonomous agents with money.
3. **#18.** It turns this from a personal tool into a team product.
