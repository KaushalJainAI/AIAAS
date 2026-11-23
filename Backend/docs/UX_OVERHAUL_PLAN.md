# UX overhaul plan (phone and desktop)

**Status:** proposed 2026-11-18; Phases 0–11 and 13 built 2026-11-19 (undeployed,
not committed). Phase 12 (run replay) is optional and not built. Comes from a product review of the
web app (`better-n8n-frontend/`) on 2026-11-17. **Frontend only.** No phase
changes a backend route, model or migration.

**Progress** (update this table as each phase moves; newest notes last):

| Phase | State | Notes |
|---|---|---|
| 0 Baseline | done 2026-11-19 | tsc `-b --force`: 0 errors. Lint: 0 problems. Vitest: 93/93 files, 752/752 tests passed, 0 failed, no red suites. Build: exit 0 (41 s). E2E: not run, no backend on :8000. §3: 4 rows corrected (Sidebar, Message actions, Schedules Run now, Run record). Phase 1 still names `Schedules.tsx` for Run now (line ~188); fix it in Phase 1. |
| 1 Quick fixes | **built** 2026-11-19 | Toasts 4 s; Profile links to Settings → Account; "Automations" → "Agents", page h1 "Studio"; phone bar reads `primaryNav`; every native `confirm()` is now `ConfirmDialog` (`useRestoreRevision` returns a `dialog` its two callers render; the hook is now `.tsx`). Correction to Phase 0: `pages/Schedules.tsx` **does** have "Run once now", greyed out when paused; it now says "Paused. Turn it on to run it." instead |
| 2 Touch basics | **built** 2026-11-19 | `Modal` is a bottom sheet below `md` and only locks scroll / takes Escape while `open`; `IconButton`, `Button` and the title-bar menu button are 44 px on phones; `useLongPress`; Files rows have a "More actions" button + long-press, and the menu is a sheet on phones; Settings is a list on phones. **Root cause found by the e2e:** `:root` font-size is 14 px, so Tailwind's `h-11` was 38.5 px; `spacing.11` is now pinned to `44px` in `tailwind.config.js`. The closed chat-history drawer is `invisible` (it was clipped but still in the tab order) |
| 3 Five destinations | **built** 2026-11-19 | Ask / Activity / Agents / Library / Connect, `tabs` on each hub, `hubFor`, `HubTabs` mounted once in the shell; desktop gear to Settings beside the bell; one-group nav hides its heading. The Agents page's own "Explore" button was removed (the tab strip has it) |
| 4 A calmer chat header and composer | **built** 2026-11-19 | One vocabulary (`AUTONOMY_COPY`, control named "Approval" in chat and builder); composer border takes the level's tone, "Never asks" on `full`; "This chat" menu (`ThisChatMenu`, `PopMenu`); phone "+" sheet (`ComposerMoreSheet`); Retry / Edit / More with a confirm when later messages would go. **Changed after the browser check:** at 390 px the header could not hold title + approval + model, so on phones the approval level is a coloured chip in the composer that opens the "+" sheet, which lists the four levels with their hints (H-132 put the mode in the composer). Desktop keeps the header select |
| 5 Chat history | **built** 2026-11-19 | Search, Today / Yesterday / Previous 7 days / Older (`historyGroups.ts`), rename through `updateSession`, More menu per row, delete confirm outside the drawer |
| 6 Notifications | **built** 2026-11-19 | `NotificationsPanel` (popover on desktop, sheet on phones), bell in the phone top bar; `notificationLink` is now the one link check, also used by Settings → Notifications |
| 7 Cmd+K | **built** 2026-11-19 | `CommandMenu` + pure `lib/commandMenu.ts`; signed-in only; reads the query cache, never fetches. Settings now applies `?tab=` whenever it changes, so picking a section while on Settings works on desktop |
| 8 Failed runs | **built** 2026-11-19 | `explainRunError` matches fragments of the real backend sentences (listed in its test); Retry with a confirm, hidden for delegated **and eval** runs (a retry outside the sweep would never be scored); "Open agent" link |
| 9 First run | **built** 2026-11-19 | "Get set up" card, `pickStarters` (no-connection starters for members with no account connected), Agents empty state. The "connected" rule now lives in `lib/connectionStatus.ts`, shared by Connections and the card |
| 10 Simple agent builder | **built** 2026-11-19 | Essentials / All settings over one config and one Save; `changedAdvancedFields`; builder knob renamed "Approval" |
| 11 Motion and feedback | **built** 2026-11-19 | Receipt under each reply (`turnReceipt.ts`), `useCountUp`, `useTitleProgress`, plan items struck through (in `components/plan/PlanView.tsx`; only rows that finish while on screen animate), chat column `2xl:max-w-5xl`; send, mic and rating buttons 44 px on phones |
| 12 Run replay (optional) | not started | Skipped: optional, waits for the owner's go-ahead |
| 13 Docs | **done** 2026-11-19 | H-163–H-167, BEGINNER_GUIDE, FRONTEND_STRUCTURE, APP_FLOW_GAP_REVIEW (C14 and the 2026-11-19 findings), OPEN_WORK |
| — Final check | **done** 2026-11-19 | tsc 0, lint 0, vitest 107 files / 914 tests (752 at baseline), build OK, `mobile-layout.spec.ts` 37/37 against a local backend. Checked by screenshot at 390×844 and 1440×900: chat, Agents, Files, Settings, Activity, Connections, Cmd+K, the bell panel and the phone approval sheet. Not checked: a real phone, a live agent run (receipt, title progress, plan strike) and 1920 px |

**Who runs this plan:** a smaller model, **one phase per session**. Read §1–§4
before any phase. Do not skip ahead. Do not merge two phases. Stop at the end
of the phase and report (see §4.9). A reviewer checks each phase before the
next one starts.

---

## 1. What we want

The app can do a lot, but it shows people how it is built instead of what
they came to do. Too many destinations, too many buttons in the chat header,
a 44-control agent form, dead ends when a run fails, and several things that
only work with a mouse. We want:

1. **Fewer places to go.** Five destinations instead of fourteen.
2. **Everything works by touch.** Every action has a visible, labelled,
   44 px control. Hover, right-click and keyboard are shortcuts only.
3. **Calmer screens.** One control per idea; rare settings one tap away.
4. **No dead ends.** A failed run says why in plain words and offers Retry.
5. **A first win in two minutes** for a new account.
6. **Small, meaningful motion** that shows progress, never decoration.

## 2. The rule for phones and desktops

Every phase must keep this rule. The reviewer will check it.

- **Phone** = below Tailwind `md` (768 px). Check at **390 × 844**.
- **Desktop** = `md` and up. Check at **1440 × 900**, and the chat at **1920 × 1080**.
- Every interactive control is at least **44 × 44 px on phones** (the visible
  icon may be smaller; pad the hit area). Desktop may be smaller.
- Every icon-only control has an `aria-label`. On phones, a control whose
  meaning is not obvious from its icon also shows a text label.
- Nothing is reachable **only** by hover, right-click, long-press or a key.
  Each of those is a shortcut to something visible.
- Dialogs are **bottom sheets on phones** after Phase 2 (`Modal` does it).
- No sideways page scroll on phones. The shell is `overflow-hidden`; each page
  owns its own scroller (see `tests/e2e/mobile-layout.spec.ts`).
- Respect `prefers-reduced-motion`. `index.css` already has an override near
  line 633; new animations must be covered by it.

## 3. What we have today (checked 2026-11-18)

Paths are under `better-n8n-frontend/src/` unless they start with `Backend/`.
Line numbers drift; search for the quoted text if a line is off.

| Thing | Where | Fact |
|---|---|---|
| Navigation | `lib/navigation.ts` | `navGroups`: 14 items in 4 groups (Work, Build, Improve, Data). `primaryNav` (4 items) is **not used** by the phone bar |
| Phone bottom bar | `components/layout/MobileBottomNav.tsx` | Hard-coded Ask / "Agents" / New / Activity / More. Says "Agents"; the sidebar says "Automations" |
| Sidebar | `components/layout/Sidebar.tsx` | Bell at ~line 410 links to `/settings` (no inbox). The account block at the foot (~lines 459–470: avatar, name, email) is the desktop link to `/settings`; the word "Settings" appears only as a tooltip when collapsed. `unreadCount` at ~line 115 |
| Phone top bar | `components/layout/MobileTopBar.tsx` | Title, pending pill, avatar. No bell |
| Shell | `App.tsx` | Routes at ~164–282. Toaster at ~285: `duration={1500}` |
| Dialog | `components/ui/Modal.tsx` | Centred box at every width. `ModalBody`, `ModalFooter` exported |
| Confirm | `components/ui/ConfirmDialog.tsx` | Styled confirm. Seven places still use native `confirm()`: `components/extraction/ExtractionPanel.tsx:724`, `components/imagine/ImagineChat.tsx:136`, `features/chat/components/StandaloneChat.tsx:810`, `hooks/useRestoreRevision.ts:41`, `pages/Documents.tsx:500`, `pages/Evals.tsx:278`, `pages/Imagine.tsx:282` |
| Icon button | `components/ui/IconButton.tsx` | `p-1.5`, about 28 px. Has `aria-label` + `title` |
| Profile | `pages/Profile.tsx` ~256 | Says "Email cannot be changed"; Settings → Account has a change-email form |
| Settings | `pages/Settings.tsx` | 9 tabs; on phones a sideways strip with a hidden scrollbar (~1091). Reads `?tab=` (~134) |
| Approval words | `features/chat/components/ChatHeader.tsx` ~21 (`APPROVAL_RULE_LABELS`) and `types/agentConfig.ts` (`AUTONOMY_COPY`) | Same four labels typed twice. Chat calls the control "Approval rule", the builder calls it "Autonomy" (`AgentBuilder.tsx` ~1433). Builder has a fifth level, `review` |
| Chat header | `ChatHeader.tsx` | History, title, org picker (new chat only), approval select, model button (in `StandaloneChat.tsx` ~1806, `text-[10px]`), "Memory off" chip, sharing chip, cost chip (md+), "Encrypted" (xl+), gear |
| Composer | `StandaloneChat.tsx` ~2870–3070 | "+" attach, "Commands" pill, Search and Research toggles, mic (hidden below 380 px), Send / Stop / Add. Label "To Lead + N workers" (~3067) |
| Message actions | `features/chat/components/ChatMessageItem.tsx` ~750–820 | Copy, Read aloud, "Rewrite prompt", thumbs (`FeedbackControl`, ~line 788), "Take back", "Edit and resend", Delete |
| Chat history | `features/chat/components/ChatHistorySidebar.tsx` | No search, rename or date groups. Delete is hover-only (~132). Sessions query key `['chatSessions']` (`StandaloneChat.tsx` ~262) |
| Rename a chat | `api/chat.ts` ~442 `chatService.updateSession(id, {title})` | Works today: `title` is writable in `Backend/chat/serializers.py` |
| Help card | `features/chat/components/CommandCard.tsx` ~164 | Lists `/mode ask|auto|plan`; `full` is accepted but missing |
| Files | `pages/Documents.tsx`, `components/explorer/ItemsView.tsx`, `components/explorer/ContextMenu.tsx` | Right-click menu only (`onContextMenu`, ItemsView ~215). New/Upload disabled with no reason when not in a folder (~803, ~809) |
| Schedules (Run now) | `components/activity/ScheduledSection.tsx` ~66, rendered on `/runs` (`pages/Runs.tsx` ~55) | A plain "Run now" button that opens a confirm. It has no `disabled` state. `pages/Schedules.tsx` has no Run now button (comment ~392) |
| Run record | `api/logs.ts` | `ExecutionLog.workflow_id` is the agent id; `ExecutionDetail.input_data.goal` is the task (`Backend/agents/agent/runtime.py` ~1673, `input_data={'goal': goal, ...}`) |
| Start a run | `api/agents.ts` ~76 | `execute(id, goal, threadId?)` |
| Run errors | `components/activity/HistoryList.tsx` ~330, ~427; `RunDetail.tsx` ~48 | Raw `error_message` only. No Retry |
| Notifications | `api/notifications.ts` | `getNotifications`, `markAsRead(id)`, `markAllAsRead()`. `Notification` has `id, type, title, message, data, is_read, created_at` |
| Agent builder | `pages/AgentBuilder.tsx` | 5 tabs, 44 always-visible controls. Defaults in `types/agentConfig.ts` (`DEFAULT_AGENT`) |
| Chat welcome | `features/chat/components/ChatWelcome.tsx` | `MEMBER_STARTERS` need Gmail/Drive; no first-run guidance |
| Animations | `tailwind.config.js` ~72–140, `index.css` | Keyframes exist: fade, slide-up, scale, slide-in-right/bottom, shimmer, agent-pulse. **No framer-motion; do not add it** |
| Tailwind | `package.json` | v3.4, so `max-md:` and `motion-reduce:` variants work |
| E2E | `tests/e2e/mobile-layout.spec.ts` | 390 × 844. Needs a running backend (it registers an account). Some assertions look stale (`/overview`, a "Runs" link, a builder "Settings" switch); Phase 0 records which pass |

## 4. Rules for every phase

1. **Read before you change.** For every file you will edit, run
   `grep -n "<path or module name>" DESIGN_HISTORY.md` from the repo root and
   read the matching entries (to the next `## H-`). If an entry explains why
   the code is the way it is, follow it and note it in your report. Never read
   `DESIGN_HISTORY.md` whole (it is ~250 KB).
2. **Frontend only.** Only `better-n8n-frontend/` changes, plus the docs named
   in Phase 13. Only `src/api/` calls the backend. If a step seems to need a
   new endpoint, stop and report; do not add one.
3. **The working tree already has other uncommitted work** (for example
   `StandaloneChat.tsx`, `AgentBuilder.tsx`). Never revert, reformat or
   "clean up" lines you did not need to change. **Do not commit.**
4. **Edit with the Edit tool**, not `sed -i` (Git Bash `sed -i` rewrites
   CRLF files as LF).
5. **Feature folders.** Chat-only code goes in `src/features/chat/`; outside
   code imports it only through `@/features/chat` (ESLint enforces this).
   Code two areas use goes in `src/components/` or `src/lib/`.
6. **No new npm packages** unless the phase says so (none do).
7. **Pure logic goes in a pure function with a vitest test** next to it
   (`src/lib/__tests__/<name>.test.ts`). Each phase lists which.
8. **Gates, every phase, all must pass** (run from `better-n8n-frontend/`):
   - `npx tsc -b --force` (plain `tsc --noEmit` checks zero files here)
   - `npm run lint`: **zero problems**; the baseline is zero
   - `npm test`: run it from PowerShell with the path written as `C:\...`
     (a lowercase `c:\` working directory makes every suite "fail"). Compare
     with the Phase 0 baseline; some suites are red on purpose (see
     `Backend/docs/OPEN_WORK.md` and the memory note on the frontend test
     runner). New failures are yours.
   - `npm run build`
9. **Report at the end of the phase**, in this order: what you built (files);
   the gates' output (counts); what you checked by hand at both widths and
   what you could not check; anything in this plan that turned out wrong; the
   Progress table row you wrote. Do not claim a check you did not run.
10. **Copy is plain words.** Short sentences, no internal terms ("Lead",
    "worker", "grant", "HITL", "execution").

---

## Phase 0 — Baseline (no code)

1. Run the four gates in §4.8. Write the counts (tests passed / failed, lint
   problems) in the Progress table.
2. If a backend is running locally (`http://localhost:8000`), run
   `npx playwright test tests/e2e/mobile-layout.spec.ts` and list which tests
   pass and fail. If it is not running, write "e2e not run: no backend".
3. Grep `DESIGN_HISTORY.md` for these and list the entry ids you found:
   `navigation`, `MobileBottomNav`, `Modal`, `ConfirmDialog`, `Toaster` or
   `toast`, `ChatHeader`, `ChatHistorySidebar`, `ChatMessageItem`,
   `AgentBuilder`, `Documents`, `ItemsView`, `Settings.tsx`. Write one line
   per entry that constrains this plan.
4. Check every row in §3 still holds. Fix any wrong row in this file.

**Done when:** the table row says the baseline, and §3 is correct.

---

## Phase 1 — Quick fixes

Small, independent changes. One commit-sized change each; no new components.

**1a. Toasts last long enough to read.** `App.tsx` Toaster: `duration={1500}`
→ `duration={4000}`. Check `DESIGN_HISTORY.md` for why 1500 was chosen first.
Error toasts that already pass their own duration keep it.

**1b. Profile stops contradicting Settings.** `pages/Profile.tsx`: replace
"Email cannot be changed" with a `Link` "Change it in Settings → Account" to
`/settings?tab=account` (check the tab id in `Settings.tsx`).

**1c. One name per place.**
- `lib/navigation.ts`: label "Automations" → "Agents" (both entries).
- `MobileBottomNav.tsx`: `guardGuest('Automations')` → `guardGuest('Agents')`.
- `pages/Imagine.tsx` ~159: the `h1` "Imagine" → "Studio" (the sidebar's name).
- Grep `src` and `tests` for "Automations" in user-facing strings and tests;
  update them.

**1d. The phone bar reads the nav file.** In `lib/navigation.ts` set
`primaryNav` to Ask, Agents, Activity (in that order). Rewrite
`MobileBottomNav.tsx` so its three links come from `primaryNav` (keep badges:
the `agent`/`pending` flags already say which item gets them), with New after
the second and More last: **Ask / Agents / New / Activity / More**, same as
today. `moreNavItems` then includes Explore, so the drawer still lists it.

**1e. Every disabled control says why.**
- `Documents.tsx` New / Upload: when `!inFolder`, show a short text beside
  them, "Open a folder to add files" (visible at every width, not a tooltip).
- `Schedules.tsx` Run now: when the schedule is paused, do not render a
  disabled button; render the text "Paused" beside the existing Enable/Resume
  control. Check that control exists in the same row first.

**1f. Composer words.** `StandaloneChat.tsx` ~3067: "To Lead + N workers" →
"Adds to this reply" and, when there are workers, " · N helpers working". The
Add button's `aria-label` → "Add to this reply".

**1g. Help card.** `CommandCard.tsx`: `/mode ask|auto|plan` →
`/mode plan|ask|auto|full`.

**1h. Readable model button.** `StandaloneChat.tsx` ~1806: `text-[10px]
font-bold` → `text-xs font-semibold`.

**1i. No more browser confirm boxes.** Replace the seven `confirm()` calls in
§3 with `ConfirmDialog`. Pattern: a `useState` holding the pending target
(`null` = closed), the button sets it, `onConfirm` runs the old code and
clears it. Keep each message's wording. `danger` only for deletes.

**Tests:** update any test that asserted old labels. Add
`src/lib/__tests__/navigation.test.ts` if absent: `primaryNav` paths are all in
`navGroups`; `moreNavItems` has no path in `primaryNav`.

**Check by hand:** phone bar and drawer at 390 px; a delete confirm at both
widths.

---

## Phase 2 — Touch basics

**2a. `Modal` is a bottom sheet on phones.** In `components/ui/Modal.tsx`:
- Overlay: `items-end md:items-center p-0 md:p-4`.
- Panel: on phones `w-full rounded-t-xl rounded-b-none max-h-[92dvh]` with
  `paddingBottom: env(safe-area-inset-bottom)`; from `md` the current box.
- Phones enter with the existing `slide-in-bottom` animation, desktop keeps
  `entrance-modal`. Exit stays as is.
- A small grab bar (`h-1 w-10 rounded-full bg-border mx-auto mt-2`, `md:hidden`,
  `aria-hidden`) at the top of the panel.
- `ModalFooter`: on phones stack buttons full width, primary last visually on
  top: `flex-col-reverse md:flex-row` and `[&>*]:w-full md:[&>*]:w-auto`.
- Check the `.modal` class in `index.css` for a fixed radius that fights this.
- Every dialog in the app inherits this. Open at least: ConfirmDialog, Run
  agent dialog, Share agent dialog, Add credential, New schedule, at both widths.

**2b. `IconButton` is 44 px on phones.** Add
`inline-flex items-center justify-center min-h-11 min-w-11 md:min-h-0 md:min-w-0`.
The icon stays the same size. Look at the five busiest callers (grep
`<IconButton`) at 390 px to make sure rows still fit.

**2c. Long-press, as a shortcut.** New `src/hooks/useLongPress.ts`:
`useLongPress(onLongPress: (x: number, y: number) => void, ms = 500)` returns
`{onPointerDown, onPointerUp, onPointerCancel, onPointerMove}`. Only for
`pointerType === 'touch'`; cancel if the finger moves more than 10 px, on up,
on cancel. Test with vitest fake timers in `src/hooks/__tests__/useLongPress.test.ts`
(fires after 500 ms; does not fire after a 20 px move; does not fire for mouse).

**2d. File actions by touch.** In `components/explorer/ItemsView.tsx`:
- Every row/tile gets a visible "More actions" `IconButton` (`MoreVertical`
  icon) **on phones** (`md:hidden`), which opens the same menu the right-click
  opens, anchored to the button.
- Long-press on a row opens the same menu at the press point (2c).
- In `ContextMenu.tsx`, on phones render the menu as a bottom sheet: a list of
  44 px rows with icons and labels. A submenu (for example New ▸) opens as a
  second list in the same sheet with a "‹ Back" row at the top. Desktop is
  unchanged.

**2e. Chat history delete is reachable.** `ChatHistorySidebar.tsx` ~132:
`opacity-100 md:opacity-0 md:group-hover:opacity-100`, and 44 px on phones.
(Phase 5 replaces it with a menu; this is the stop-gap.)

**2f. Settings on phones is a list.** In `pages/Settings.tsx`, below `md`:
with no `?tab=`, show the sections as a vertical list of 44 px rows (icon,
label, chevron). Tapping one sets `?tab=`. Inside a section, a "‹ Settings"
row at the top clears `?tab=`. The browser Back button must also return to the
list (it will, because the tab is in the URL; check). Desktop is unchanged and
still defaults to the first tab. Direct links such as `?tab=insights` still
open that section on both widths.

**2g. A test that keeps it true.** In `tests/e2e/mobile-layout.spec.ts` add a
test for `/ai-chat`, `/runs`, `/agents`, `/documents`, `/settings` at 390 × 844:
every visible `button, [role="button"], [role="tab"], [role="menuitem"]` and every `a[href]`
**not** inside `.prose` has a bounding box at least 44 × 44 **or** an ancestor
with `data-touch-exempt`, and has an accessible name (`aria-label`, text, or
`title`). Print offenders as `tag.text/label (w×h)`. Fix offenders on those five
routes. Use `data-touch-exempt` only for inline text links in paragraphs, and
list every use in your report. While in this file, fix assertions Phase 0 found
stale, without weakening what they check.

**Check by hand:** each dialog listed in 2a, the Files menu by tap and by
long-press (Chrome device mode gives touch events), Settings list → section →
Back, at 390 px. Desktop: Files right-click and dialogs unchanged.

---

## Phase 3 — Five destinations

Routes do not change. Only the navigation and a tab strip change.

**3a. The model.** In `lib/navigation.ts` add `tabs?: { label: string; path: string }[]`
to `NavItem`, and replace `navGroups` with **one group, five items**:

| Item | Path | Tabs (label → path) | `match` |
|---|---|---|---|
| Ask | `/ai-chat` | none | `/ai-chat` |
| Activity | `/runs` | none | `/runs` |
| Agents | `/agents` | My agents → `/agents`, Explore → `/templates`, Schedules → `/schedules`, Evals → `/evals` | those four, plus `/workflow` |
| Library | `/documents` | Files → `/documents`, Apps → `/apps`, Team knowledge → `/team`, Studio → `/imagine` | those four, plus `/pages`, `/dashboards`, `/solutions` |
| Connect | `/connections` | Connections → `/connections`, Keys → `/credentials`, Tools → `/tools`, Skills → `/skills` | those four |

Keep `guestOk`, `agent`, `pending` flags where they are today. Pick lucide
icons already imported where possible (Library: `FolderOpen`; Connect: `Plug`).
Keep exports `navGroups`, `primaryNav`, `moreNavItems`, `isNavActive` working
for every caller (grep them).

**3b. `HubTabs`.** New `components/layout/HubTabs.tsx`: given the pathname,
find the nav item whose `tabs` contain an entry whose path the pathname
**equals** (or equals plus a trailing `/`). If none, render nothing (so
`/agents/12`, `/agents/new`, `/templates/x` get no strip). Otherwise render a
`nav` with `aria-label="<item label> sections"` and links with `aria-current`.
Phone: scrolls sideways inside itself, 44 px tall, active tab scrolled into
view. Desktop: 36 px, underline style like the Settings tabs. Mount it once in
the shell in `App.tsx`, directly above the routed page, as a `shrink-0` row,
so pages keep owning their own scroller (check the shell's flex column).

**3c. Settings is visible.** Desktop sidebar footer: add a gear `Link` to
`/settings`, `aria-label="Settings"`, next to the bell. The bell stays (Phase 6
changes what it opens). The phone drawer already has a Settings link; check.

**3d. Phone bar and drawer.** Bar stays Ask / Agents / New / Activity / More.
The drawer lists the five items plus Settings and Profile.

**Tests:** `src/lib/__tests__/navigation.test.ts`: every path routed inside the
shell in `App.tsx` (write the list into the test as a constant, with a comment
naming `App.tsx`) is reachable as an item path or a tab path, except detail
routes and `/settings`, `/profile`; `isNavActive` lights Agents for `/templates`
and Library for `/dashboards`; a pure `hubFor(pathname)` (export it from
`navigation.ts`, `HubTabs` uses it) returns the right tabs and `null` for
`/agents/12`. Update e2e tests that click old labels.

**Check by hand:** each of the 12 tab paths at both widths shows the strip with
the right tab lit; detail pages show none; nothing scrolls sideways on phones.

---

## Phase 4 — A calmer chat header and composer

**4a. One vocabulary for approvals.** `ChatHeader.tsx`: delete
`APPROVAL_RULE_LABELS`; take labels and hints from `AUTONOMY_COPY` in
`types/agentConfig.ts` (chat simply never offers `review`). Call the control
**"Approval"** in both places: the chat select's `aria-label` and title, and
the builder knob label (`AgentBuilder.tsx` ~1433, "Autonomy" → "Approval").
Values do not change.

**4b. The level is always visible.** Add `APPROVAL_TONE` next to
`AUTONOMY_COPY`: `plan` neutral, `review` and `ask` primary, `auto` warning,
`full` destructive (use existing colour tokens). The composer box's border
uses the tone of the chat's current level (1 px, colour only, 150 ms
transition). `full` also shows a small "Never asks" text at the composer's
top-right on both widths.

**4c. One "This chat" menu.** Remove from the header: the "Memory off" chip,
the sharing chip, the cost chip and "Encrypted". The gear button becomes
**"This chat"** (`aria-label`), opening a popover on desktop and a bottom
sheet on phones, with: memory on/off (same call as today), sharing with the
org (when the chat is in an org), cost so far, "Encrypted at rest" line, and a
"Chat settings…" row that opens the existing `ChatSettingsDialog`. When memory
is off or the chat shares with an org, the gear shows a small dot so the state
is not hidden. Keep the org picker where it is (new chat only).

**4d. Phone composer.** Below `sm` only: the "+" button opens a sheet with
four 44 px rows: Attach a file, Commands, Search the web (shows on/off), Deep
research (shows on/off). The Commands pill and the two toggles are hidden
below `sm`; when Search or Research is on, a small removable chip shows above
the text box so the state is visible. The mic is no longer hidden below 380 px.
Desktop is unchanged.

**4e. Fewer message actions.** `ChatMessageItem.tsx`:
- Assistant message: Copy, Retry (was "Rewrite prompt"; same handler), thumbs,
  Read aloud, and a "More" menu with Delete.
- User message: Copy, Edit (was "Edit and resend"), and a "More" menu with
  Take back and Delete.
- Retry, Edit and Take back remove later messages. When they would remove
  more than the next reply, ask first with `ConfirmDialog`: "This removes the
  N messages after it." (closes gap C14 in `APP_FLOW_GAP_REVIEW.md` for the
  confirm part).
- `features/chat/components/__tests__/chatPieces.test.tsx` pins callback
  arguments: keep them passing; update labels it asserts.

**Check by hand:** each approval level's border colour; the "This chat" menu
at both widths; phone composer at 360 px and 390 px with the mic visible.

---

## Phase 5 — Chat history

In `ChatHistorySidebar.tsx` (props only; `StandaloneChat` passes callbacks):

- **Search** box at the top: filters loaded conversations by title, case
  insensitive. Placeholder "Search titles". Empty result: "No conversation
  matches".
- **Date groups** inside the existing "Finished" group: Today, Yesterday,
  Previous 7 days, Older, by `updated_at` in the user's local time. Pure
  function `groupByDay(items, now)` in `features/chat/lib/historyGroups.ts`
  with tests (midnight edges, empty list).
- **Rename**: a "More" `IconButton` on every row (visible on phones, on hover
  and focus on desktop) opens Rename / Delete. Rename turns the title into an
  input; Enter saves through a new `onRenameConversation(id, title)` prop,
  which `StandaloneChat` implements with `chatService.updateSession(id, {title})`
  and then invalidates `['chatSessions']`. Escape cancels. Empty title is not
  saved. Max 255 characters (the model's limit).
- Title fallback "first 18 chars of the id" → "Untitled conversation".
- Delete uses `ConfirmDialog` (done in 1i).
- Add `onRenameConversation` to `chatPieces.test.tsx`.

---

## Phase 6 — Notifications

- New `components/notifications/NotificationsPanel.tsx`: popover on desktop,
  bottom sheet on phones. Lists `notificationsService.getNotifications()`
  newest first: title, message (2 lines), relative time, unread dot. Tapping
  one marks it read (`markAsRead`) and, when `data` holds a link the app
  understands, goes there. Find which keys exist by grepping
  `Backend/notifications/` for what is put in `data` (`execution_id`, `url`,
  `request_id`...), and write a pure `notificationLink(n)` in
  `src/lib/notificationLink.ts` with tests; unknown shapes return `null` (no
  navigation). "Mark all read" at the top; "Notification settings" at the
  bottom → `/settings?tab=notifications`.
- Empty: "You're all caught up."
- The sidebar bell opens this panel instead of linking to `/settings`. Use the
  same data the sidebar already loads for `unreadCount`; after marking read,
  invalidate that query.
- Add the bell to `MobileTopBar.tsx` (44 px) with the same unread dot.

---

## Phase 7 — Cmd+K

- New `components/command/CommandMenu.tsx` + pure `src/lib/commandMenu.ts`.
- Opens with Ctrl+K / Cmd+K anywhere (also inside text fields), from a search
  button at the top of the desktop sidebar ("Search", with the shortcut shown),
  and from a search button in `MobileTopBar`. Escape closes.
- Desktop: centred panel (use `Modal size="md"`); phone: the Modal is already
  a sheet; make it `92dvh` tall with the input at the top.
- Sections, in order: **Actions** (New chat, New agent → `/agents/new`, Upload
  files → `/documents`), **Go to** (the five destinations, every hub tab, every
  Settings section as `/settings?tab=<id>`), **Recent chats** (from the
  `['chatSessions']` query if cached; do not fetch from Cmd+K if it is not),
  **Agents** (from the agents list query the Agents page uses; same rule).
- Ranking in `rankCommands(query, items)`: exact prefix of a word first, then
  substring; ties keep section order; empty query shows Actions and Go to.
  Tests for each rule.
- Arrow keys move, Enter runs, rows 44 px on phones. `role="combobox"` on the
  input, `role="listbox"` / `role="option"` for rows, `aria-activedescendant`.
- Must not clash with the chat's `/` palette.

---

## Phase 8 — Failed runs

Where a failed or cancelled run's detail shows (`HistoryList.tsx` ~330 and
~427):

**8a. Plain words.** New pure `src/lib/explainRunError.ts`:
`explainRunError(message: string | null) => { headline: string; action?: { label: string; to: string } }`.
First collect the real messages: grep `Backend/agents/agent/runtime.py`,
`Backend/llm/access.py` and `Backend/agents/spend.py` for `error_message =`,
`raise`, and `explain_provider_failure`, and list the distinct user-facing
texts in your report. Then map, at least:

| Error looks like | Headline | Action |
|---|---|---|
| no key / credential / unauthorized / 401 | "The AI provider refused the key." | "Check your keys" → `/credentials` |
| credits / quota / 402 / insufficient | "The account ran out of credits." | "See usage" → `/settings?tab=billing` |
| rate limit / 429 | "The provider was busy. Trying again later usually works." | none (Retry is below) |
| time limit / timed out | "It ran out of time." | "Raise the time limit" → `/agents/<id>` |
| step limit / iterations | "It used all its steps." | "Raise the step limit" → `/agents/<id>` |
| spend cap | "It hit its monthly spend cap." | "Change the cap" → `/agents/<id>` |
| anything else | "The run stopped with an error." | none |

Match case-insensitively on stable fragments you found in the backend, not on
guesses. The raw message stays visible under a "Details" disclosure. Tests:
one per row, plus `null`.

**8b. Retry.** A "Retry" button for failed and cancelled runs where
`workflow_id` is set, `is_delegated` is false and `input_data.goal` is a
non-empty string. It opens `ConfirmDialog`: title "Run it again?", body "Runs
<agent name> again with the same task. This uses credits." On confirm call
`agentsService.execute(workflow_id, goal)` (add nothing to `src/api/`), toast
"Started again", and select the new run (or refresh the list). If the button
cannot show, show nothing (no disabled button). "Open agent" link →
`/agents/<workflow_id>` beside it.

---

## Phase 9 — First run

**9a. A three-step card on the empty chat** (`ChatWelcome.tsx`, members only):
"Get set up" with three rows, each with a tick when done:
1. **Ask something.** Done when the user has at least one conversation.
2. **Connect an account.** Done when any connection is connected. Find how
   `pages/Connections.tsx` learns status and reuse that query; do not add a
   second way. Row links to `/connections`.
3. **Make or install an agent.** Done when the agents list is non-empty. Links
   to `/templates`.

Hide the card when all three are done or when the user taps "Hide" (store
`aiaas.setupHidden=1` in `localStorage` inside try/catch; if storage throws,
the card simply shows). Pure `setupSteps(state)` in
`features/chat/lib/setupSteps.ts` with tests.

**9b. Starters that work.** When the user has no connected account, show
starters that need none (keep the member set for connected users). Add
`NO_CONNECTION_STARTERS` in `ChatWelcome.tsx`, for example "Summarise a PDF"
("Summarise the PDF I'm about to attach in five bullet points"), "Plan my
week", "Draft an email", "Make a chart" ("Make a bar chart of monthly sales:
Jan 120, Feb 150, Mar 90"). Pure `pickStarters(isGuest, hasConnection)` with
tests.

**9c. Agents empty state.** `pages/Agents.tsx` "No agents yet": primary button
"Start from a template" → `/templates`, secondary "Describe one" →
`/agents/new`.

---

## Phase 10 — Simple agent builder

- Add a two-way switch at the top of `AgentBuilder.tsx`: **Essentials** | **All
  settings**. Remember the choice per viewer in `localStorage`
  (`aiaas.builderView`, try/catch). Default **Essentials**.
- **Essentials** is one page, no tabs, in this order:
  1. Name and brief ("What should it do?").
  2. Model (provider + model only).
  3. **What it can use:** the tools that are on, as chips with a remove ×,
     and an "Add a tool" button that opens the full tool list (the same
     toggles as today) in a `Modal`. Connections it may use (same control as today).
  4. **Approval** (the five levels; from Phase 4 the same words as chat) and
     the monthly spend cap.
  5. **When it runs** (the existing schedules section).
- Everything else (effort, temperature, files access, run limits, result
  shape, context lifecycle, skills, team knowledge, environment, evaluation,
  history) is in **All settings**, exactly as today.
- When any hidden field differs from `DEFAULT_AGENT`, Essentials shows a line
  "N other settings are changed. Show all settings" that switches view. Pure
  `changedAdvancedFields(config, defaults): string[]` in
  `src/lib/agentAdvanced.ts`, with tests (none changed → `[]`; temperature
  changed → `['temperature']`). The list of essential fields is a constant in
  the same file.
- Save, Run and the header buttons are the same in both views. On phones the
  Save button stays in a sticky bottom bar above the tab bar (check it does
  not hide behind `MobileBottomNav`).
- Saving from Essentials must send the full config (hidden fields unchanged).
  Check by saving, switching to All settings and comparing.

---

## Phase 11 — Motion and feedback

All motion: CSS only, 150–300 ms, covered by the reduced-motion override.

**11a. A receipt under each finished reply.** Pure
`summariseTrace(trace: ToolTraceEntry[]): string` in
`features/chat/lib/turnReceipt.ts`: counts tool calls by kind and returns a
line such as "Read 3 files · searched the web · wrote report.docx". Get the
tool names from `Backend/chat/tools/*.py` (`@tool` declarations); map the
common ones to verbs; unknown tools count as "used N other tools". Show the
line plus duration and cost under the assistant message, in muted 12 px text;
tapping it opens the existing Steps panel. Tests: empty trace → `""`, one of
each mapping, unknown tools.

**11b. Plan items strike through.** In `components/orchestration/PlanPanel.tsx`,
when an item becomes done, draw a line through it over 250 ms (a
`background-image: linear-gradient(currentColor, currentColor)` on a 1 px
line, `background-size` 0 → 100%). New keyframe `strike` in
`tailwind.config.js`.

**11c. Costs count up.** `src/hooks/useCountUp.ts`: animates a number from
its previous value to the new one over 400 ms with `requestAnimationFrame`;
instant under reduced motion. Use it for the receipt cost and the "This chat"
cost. Test with fake timers / a mocked `requestAnimationFrame`.

**11d. The tab title shows progress.** `features/chat/hooks/useTitleProgress.ts`:
while a turn runs, `document.title` starts with "● " and, when a plan exists,
"(2/5) ". When the turn ends while the tab is hidden, the title starts with
"✓ " until the tab is visible again. Always restore the original title on
unmount.

**11e. Wide screens.** Chat column `max-w-4xl` → `max-w-4xl 2xl:max-w-5xl`
(`StandaloneChat.tsx` ~2075 and ~2578).

---

## Phase 12 — Run replay (optional, private)

Only if the reviewer says go. On a finished run's detail, a "Replay" button
opens a view with a slider from start to end. Steps and turns appear as the
slider passes their `started_at`; a Play button moves the slider at 4× real
time (max 20 s total). Pure `visibleAt(detail, ms)` in
`src/lib/runReplay.ts` with tests. Phone: vertical list with the slider pinned
at the bottom. No sharing (that needs a backend link; see §6).

---

## Phase 13 — Docs (with each phase, not at the end)

- `better-n8n-frontend/BEGINNER_GUIDE.md`: the five destinations (Phase 3),
  new shared components (`HubTabs`, `CommandMenu`, `NotificationsPanel`,
  `useLongPress`) where it lists components.
- `better-n8n-frontend/FRONTEND_STRUCTURE.md` if a phase adds a folder.
- `DESIGN_HISTORY.md`: one new entry per phase that made a decision, at the
  end (`## H-NNN · title (date)`, a `Files:` line, then why). The last id on
  2026-11-18 is H-155.
- `Backend/docs/APP_FLOW_GAP_REVIEW.md`: set C14's status if Phase 4e closed it.
- `Backend/docs/OPEN_WORK.md`: remove this plan's line when the last phase is done.
- This file's Progress table, every phase.

## 5. Order and size

Phases 1, 2, 3 first: they change how every page feels. 4–8 are
independent of each other after that. 9 and 10 are what a new user sees. 11
is polish. 12 is optional. Rough size: 1 small; 2, 3, 4 medium; 5–9 small to
medium; 10 medium; 11 small; 12 medium.

## 6. Not in this plan (and why)

- **Share a chat by link; public run replay.** Need a backend share model and
  a public route. Separate plan.
- **Bulk approvals; edit a request before approving (B3).** Approvals have
  safety rules (CLAUDE.md "Approval is settled before anything is
  dispatched"); needs its own design and review.
- **Keyboard shortcut to approve.** Deliberately left out: one stray key would
  approve a send.
- **Pin a chat.** Needs a model field.
- **Search runs in Activity.** The list is paged on the server; a client
  filter would only search one page. Needs a query parameter.
- **Builder "try this draft" run.** Runs use the saved config; a draft run
  needs backend support.
- **Writing to memory** (add/correct). Needs an endpoint.
- **Stop with a queued message needs two presses.** Read `DESIGN_HISTORY.md`
  before changing it; not changed here.
- **The phone app (`mobile-native/`).** Its own UI; not touched. No route
  changes here, so it does not break.

---

## Prompt for the implementing model

Copy this, replacing `N` with the phase number:

> You are implementing **Phase N** of `Backend/docs/UX_OVERHAUL_PLAN.md` in the
> AIAAS repo (`c:\Users\91700\Desktop\AIAAS`). Read `CLAUDE.md`, then §1–§4 of
> the plan, then Phase N. Do only Phase N.
>
> Before editing any file, grep `DESIGN_HISTORY.md` for its path and read the
> matching entries; follow them. Edit with the Edit tool, never `sed -i`. Do
> not touch the backend, add npm packages, revert other uncommitted changes,
> or commit.
>
> Every control you add or change must work by touch on a phone (390 × 844:
> 44 px, labelled, nothing hover-only) and look right on a desktop
> (1440 × 900). Pure logic goes in a pure function with a vitest test.
>
> When the phase is built, run the four gates in §4.8 and fix anything you
> broke. Check the result by hand at both widths if you can run the app; if
> you cannot, say so. Then update the Progress table row for Phase N and
> report exactly as §4.9 says: files changed, gate output, what you checked
> and what you could not, and anything in the plan that was wrong. If a step
> needs a backend change or a decision the plan does not make, stop and ask
> instead of guessing.
