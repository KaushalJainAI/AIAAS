# UI redesign plan — Concept 5, with the backend it needs

Status: **proposed 2026-11-11, not started.** Nothing in this file has been built.

Design: [Concept 5 — Professional](https://claude.ai/artifact/KQvmQTnQKm7pyMeS2YJVc5) (17 desktop
screens, 11 phone screens, light and dark). The rule for the whole job: **the
structure and the flows stay as they are; the look changes**, plus the few new
pieces of information the new screens show. Where a screen shows something the
server does not send today, this plan adds it to the server first, as an
**additive** field, so the current UI (and BrowserOS, which ships its own
build) keeps working against the new backend before the new UI lands.

---

## 1. What the new screens need from the server

Checked against the code on 2026-11-11. "Exists" means the UI only needs
restyling there.

| Screen element (Concept 5) | Data it needs | Today | Backend change |
|---|---|---|---|
| Sidebar: Activity badge, bell | pending approvals, unread notifications | exists (`agents/hitl/pending/`, notifications) | none |
| Sidebar: "Spend this month ₹68" | month-to-date spend (no budget — decided) | **no endpoint**; no monthly budget concept | **B6** |
| Chat header: approval rule ("Ask before irreversible") | `ChatSession.autonomy` | exists (`plan/ask/auto/full`) | **B11** wording only |
| Chat header: organisation, run settings | `org`, `llm_*` | exists | none |
| Reply block header: "6 steps · 8.2s · trace" | tool steps count, turn duration | steps: exists (`metadata.tool_trace`); **duration not saved** (only logged) | **B4** |
| Reply block "Answer" line | a short headline of the answer | exists (`metadata.summary` from `context_summary`) | none |
| Reply block "Evidence" / "Outputs" | sources, files written | exists (`metadata.sources`, `metadata.files`) | none |
| Approval item: risk label ("Leaves the workspace · can't be undone") | the tool's `effect`, whether it sends outside | **not in** `describe_call` output (only `title/sentence/fields`) | **B1** |
| Approval item: "first time this agent writes to them" | recipient seen before? | logic exists in `chat/turn/reviewer.py::_recipients` + history, **not exposed** | **B1** |
| Approval item: action-named button ("Send email") | a verb per tool | **missing** | **B1** |
| Approval item: "Applies to: this vendor, this run" | approve with an argument match | `ToolPermission.match` exists; **approve API takes only `scope`** | **B2** |
| Approval item: "Edit draft" | approve with edited arguments | **missing** | **B3 (deferred)** |
| Team panel: run plan with owners | todos with `owner` | exists | none |
| Team panel: workers, Steer / Open run / Stop | `task_update` frames, per-run steer/cancel | exists | none |
| Team panel: locked files | `lease_update` frames | exists for code tasks only; hide when empty | none |
| Team panel: "₹12.40 · 4m 12s" while running | live cost of the turn | cost only after the turn ends | **B12 (deferred)** |
| Phone history grouped "Waiting / Running / Finished" + agent | per-session run state, last agent | **not in** the session list | **B5** |
| Automations cards: runs, "on its own %", spend, schedule | `runs`, `unattended`, `spend`, triggers | exists (`agents/views/agents.py`) | none |
| Tools: filter by effect | `effect` | exists (`tools_config/views.py`) | none |
| Schedules: plain-words schedule | `describe` | exists | none |
| Credentials: "Expires in 6 days" / "Rejected last time" | `token_expires_at`, `last_error` | `last_error` exposed; **`token_expires_at` not serialized** | **B7** |
| Documents: "by Analyst" tag | which agent wrote a file | **not recorded** on `Document` (only on versions as `source='agent'`) | **B8** |
| Skills: "Used by 2 agents" | count of agents using the skill | **missing** | **B9** |
| Settings: accent palette with teal | `UserProfile.accent_color` | free text field, default `blue`; frontend keeps it in `localStorage` | **B10** |
| Explore requirements, Evals agreement, storage meter, recents, held tools, Solutions | — | exist | none |

---

## 2. Backend changes

All additive. Every route/serializer change updates its row in
`Backend/docs/API.md` in the same change. Tests go in each app's `tests/`
package.

**B1 — Approval details (`chat/tools/describe.py`, `chat/tools/registry`).**
`describe_call` / `describe_call_async` gain:
- `effect`: the tool's declared `read | reversible | irreversible` (MCP and
  unknown tools: `irreversible`, matching the registry default);
- `leaves_workspace`: true for tools that send or publish outside (mail,
  messaging, publish above `link`, browser submit). Declared on `@tool`
  (`external=True`) rather than matched by name;
- `first_contact`: true when a recipient in the arguments has not appeared in
  this user's earlier sends — reuse `reviewer._recipients` and its history
  check, do not write a second one;
- `action_label`: a short verb for the approve button ("Send email",
  "Publish page"), declared on `@tool(action_label=...)`, default "Approve".
Rendering rules stay: no markup, redaction by key name, shape not payload.
Tests: `chat/tests/test_describe.py`, plus the frame test in
`chat/tests/test_turn_output_e2e.py` so the new fields reach the client.

**B2 — Narrower approvals ("Applies to").** `approve_tool_call` and its two
HTTP doors (chat approve, agent approve, and the Inbox via `respond_to_hitl`)
accept an optional `match: {key: value}`. It must be a subset of the paused
call's own arguments (refuse otherwise), is only allowed with
`scope='session'`, and is written to the existing `ToolPermission.match`.
`permissions.is_remembered` already matches on it. Tests:
`chat/tests/test_tool_approval.py`, `agents/tests/test_autonomy.py::ApprovalScopeTests`.

**B3 — Edit before approving (deferred to a later release).** Approving with
changed arguments means re-running every check the original call passed
(content policy, outbound cap, egress, recipients) on the new arguments and
recording both versions on the `AgentStep`. Until then the UI shows
**Decline** + a steer ("change the subject to…") instead of **Edit draft**.

**B4 — Turn timing on the saved reply (`chat/turn/pipeline.py`).** Save
`metadata.elapsed_ms` (already computed as `turn_elapsed_s`) and
`metadata.steps` (length of `tool_trace`) on the assistant message. No
migration (JSON field).

**B5 — Run state in the chat list (`chat/models.py`, `chat/serializers.py`,
`chat/turn/runs.py`).** Add `ChatSession.awaiting_approval` (bool, migration,
set when a turn pauses, cleared on approve/reject/new turn) so the list does
not have to read every session's last message. The list serializer adds
`run_state`: `waiting` (that flag), `running` (`runs.active_keys(user)`,
already in memory), else `idle`, and `last_agent` (the worker named by the
latest `worker_plans`/`agent_run` metadata, else null). Tests:
`chat/tests/test_session_list.py`.

**B6 — Month-to-date spend (`logs/` or `agents/spend.py`).** New
`GET /api/logs/spend/summary/` → `{month_rupees, by_caller}`, using
`agents/spend.py` conversion so the number matches what the spend cap
enforces; cached 60 s like `insights_overview`. **Decided 2026-11-11: spend
only** — the sidebar shows "₹68 this month" with no budget and no bar. A
monthly budget (and refusing runs at it) is a separate feature, not part of
this redesign.

**B7 — Credential health (`credentials/serializers.py`).** Add
`token_expires_at` (read-only) and a derived `health`: `ok | expiring
(<7 days) | failed (last_error set) | unverified`. Tests:
`credentials/tests/`.

**B8 — Who wrote a file (`inference/vfs.py`, office renders,
`inference/serializers.py`).** When a write happens inside a run, stamp
`Document.metadata['author'] = {kind: 'agent', agent_id, name, execution_id}`
(chat writes: `{kind: 'chat'}`); uploads stay unstamped. Expose `author` on
the document list and detail. Existing files show no tag. Tests:
`inference/tests/test_vfs.py`.

**B9 — Skill usage (`skills/views.py`).** Add `used_by` (count of the user's
agents whose config names the skill) to the skills list, one aggregate
query. Tests: `skills/tests/`.

**B10 — Accent (`core/models.py`, profile serializer, `ThemeContext.tsx`).**
Accept `teal` (the new default for new profiles; existing `blue` users keep
their choice) and validate the value against a closed list
(`teal | ink | blue | magenta`). The frontend reads and writes the profile
value instead of only `localStorage`, so the choice follows the user across
devices.

**B11 — Approval rule wording.** API values stay `plan | ask | auto | full`
(chat, agents, BrowserOS and tests all speak them). Only the user-facing
words change: "Plan only", "Ask before changes", "Ask before irreversible",
"Never ask". Update the `/mode` command's help and error text
(`chat/commands/session.py`) and any refusal message that names a mode. The
model-facing `AUTONOMY_NOTES` are not user text and stay.

**B12 — Live turn cost (deferred).** A `turn_usage` frame with tokens and
cost after each model call, so the team panel can show cost while a turn
runs. Until then the panel shows elapsed time only, and cost when done.

---

## 3. Frontend work, split so agents never share a file

Model: Haiku agents for the UI slices, each in its own set of files. I review
every slice's diff before it is merged into the branch. Each slice also does
the phone version of its own screens.

| Slice | Owns these files | Needs |
|---|---|---|
| **F0 Foundation** (runs alone, first) | `src/index.css`, `tailwind.config.js`, `index.html` fonts, `contexts/ThemeContext.tsx`, `components/ui/*` (Button, Switch, Select, Modal, IconButton, Alert, …) | B10 |
| **F1 Shell** | `components/layout/*` (Sidebar, Topbar → removed, MobileTopBar, MobileBottomNav, PageHeader), `lib/navigation.ts` | B6 |
| **F2 Chat** | `components/chat/StandaloneChat.tsx`, `ChatHeader.tsx`, `ChatMessageItem.tsx`, `ChatHistorySidebar.tsx`, composer, `format.ts` | B4, B5, B11 |
| **F3 Approvals & questions** | `ToolApprovalCard.tsx`, `QuestionCard.tsx`, Inbox detail on `/runs`, `CommandCard.tsx` | B1, B2 |
| **F4 Plan & team** | `components/orchestration/PlanPanel.tsx`, `components/plan/*` (PlanView, PlanDock, PlanSummary) | — |
| **F5 Pages A** | `pages/Runs.tsx` + `components/activity/*`, `pages/Agents.tsx`, `pages/AgentBuilder.tsx`, `pages/Templates.tsx` | — |
| **F6 Pages B** | `pages/Connections.tsx`, `pages/Documents.tsx` + `components/files/*`, `pages/Tools.tsx`, `pages/Schedules.tsx`, `pages/Credentials.tsx` | B7, B8 |
| **F7 Pages C** | `pages/Imagine.tsx`, `pages/Solutions.tsx`, `pages/Skills.tsx`, `pages/Evals.tsx`, `pages/Apps.tsx`, `pages/Settings.tsx`, `pages/Login.tsx`, `Signup.tsx` | B9, B10 |

**Chat rules (decided 2026-11-11, see the "Chat — real cases" row in Concept 5):**
- A simple reply is plain text under "Lead · time · reasoned Ns ›" — no box,
  no section labels.
- A small action gets a one-line receipt ("✓ Reminder set · Fri 09:00 ·
  Change"), not a block.
- A reply becomes a block only when agents worked (tools, files, delegation):
  live, it shows a thin animated violet line, "working · N workers",
  "reasoning Ns… ›", "N steps · elapsed", a short step list with owners, then
  the text; finished, "answer · evidence · outputs" sections appear only when
  they have content.
- Prose is capped at about 72 characters a line; code, tables and blocks use
  the full width (up to ~1000px). Code blocks get a header (language · file ·
  copy).
- The message box grows with the text. While agents run it shows "To Lead + N
  workers", and its buttons become **Stop** and **Add**.
- The team panel appears only while agents work.

Rules every slice follows:
- Use the F0 tokens (`--primary` teal, agent violet, amber only for "waiting
  for you"); no hard-coded colours, 6px corners, IBM Plex Sans / Plex Mono,
  small lowercase mono labels instead of spaced capitals.
- Keep every `aria-label`, route, callback and test id; `chatPieces.test.tsx`
  pins the callbacks the chat pieces receive.
- No new dependency without asking.
- The shell rule: no top bar on desktop; logo + New chat at the top of the
  sidebar, profile + notifications at the bottom; each page's title row is
  44px. On phones, one 52px title row and a 60px bottom bar.

---

## 4. Order of work

**Phase 0 — Clear the ground.** Wait until the other sessions (Organization
knowledge features, OpenCode) have finished, and commit their work on its own
so the redesign is a separate, revertible set of commits. Branch
`ui-redesign` from that. Baseline must be green: `tsc -b --force`,
`npm run lint` (zero problems), `npx vitest run`, backend `pytest`.

**Phase 1 — Backend first.** B1, B2, B4, B5, B6, B7, B8, B9, B10, B11, with
tests and `API.md`. Done by Haiku agents to save cost (decided 2026-11-11),
one backend change per agent, each on its own files. Because B1/B2 touch the
approval path and B5 adds a migration, those three get a line-by-line review
of the diff and their tests must pass before anything else builds on them.
The current UI keeps working because every change is additive.

**Phase 2 — F0 alone.** Everything else builds on its tokens and components.

**Phase 3 — F1 to F7 in parallel**, each on its own files, each wired to the
backend fields from Phase 1.

**Phase 4 — Check it.** Typecheck, lint, unit tests, `mobile-layout.spec.ts`,
backend tests, import contracts (`lint-imports`). Then look at every page in
the browser at desktop and phone width, light and dark, against Concept 5.

**Phase 5 — Ship.** Separate commits for backend and frontend. Deploy per
`DEPLOYMENT.md`: B5 adds a migration, so `manage.py boot` runs it on start.
Smoke-check the live site: sign in, a chat turn with an approval, Activity,
Documents.

---

## 5. Risks

- **Approval path (B1/B2).** It is the safety gate. B2 must refuse a match
  that is not a subset of the paused call's arguments, or "applies to this
  vendor" could approve something wider than the user saw.
- **Migration (B5).** The only schema change; a deploy that skips migrations
  breaks the chat list. `boot` runs migrations, but check the deploy log.
- **Files other sessions are editing.** The chat files (`StandaloneChat`,
  `ChatMessageItem`, `MarkdownMessage`) and `index.css` were being changed by
  other sessions on 2026-11-11 — Phase 0 exists for this.
- **BrowserOS** is parked and untouched; it keeps working because no field or
  route is removed.

## 6. Decisions needed before Phase 1

1. ~~Monthly budget~~ — decided: spend only, no budget.
2. ~~Edit draft~~ — decided 2026-11-11: later. B3 is not part of this
   redesign; the approval item shows Send / Decline and a steer instead.
3. ~~Deploy branch~~ — decided 2026-11-11: merge to `main` first. Phase 0
   commits the other sessions' work on `team-knowledge` and merges it to
   `main`; `ui-redesign` branches from that `main`, and Phase 5 merges
   `ui-redesign` back to `main` and deploys from `main`.
