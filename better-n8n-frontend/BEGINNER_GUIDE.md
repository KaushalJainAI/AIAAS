# Frontend Beginner's Guide

A plain tour of the web app. For the whole system, read
[`../START_HERE.md`](../START_HERE.md). For where code goes in `src/` and which
rules the lint enforces, see the Folders section below and `eslint.config.js`.

If you see "workflow" or "node" in a name, it is left over from the old
drag-and-drop canvas, which is gone. The app is about **chat** and **agents**.

---

## What the app does

You sign in and land on **Ask** (the chat). The menu has five places. Three of
them are hubs: their tabs (`components/layout/HubTabs.tsx`) switch between the
sections. A page with a `PageHeader` draws the tabs inside that header, in the
title's place, so tabs and buttons share one row; a hub page without one gets a
standalone strip (`lib/hubHeader.ts` decides which). Every section still has its
own address. Activity (`/runs`) has its own tabs (Now, Planned, History, Files;
`?tab=`, rules in `lib/activityTabs.ts`), drawn with `components/layout/PageTabs.tsx`.

| Menu | Sections (tabs) |
|---|---|
| Ask | none |
| Activity | none |
| Agents | My agents, Explore, Schedules, Evals |
| Library | Files, Apps, Team knowledge, Studio |
| Connect | Connections, Keys, Tools, Skills |

Settings and Profile sit at the foot of the sidebar (and in the phone's More
drawer). **Ctrl+K** (⌘K on a Mac), or the Search button, opens one search over
every place, setting, recent chat and agent (`components/command/CommandMenu.tsx`).
The bell opens your notifications (`components/notifications/NotificationsPanel.tsx`).

| Page | Route | Page file | What it is |
|---|---|---|---|
| Ask | `/ai-chat` | `features/chat/AIChat.tsx` → `features/chat/components/StandaloneChat.tsx` | Chat with the assistant |
| Activity | `/runs` | `pages/Runs.tsx` | Every agent run, and runs waiting for your approval |
| Agents | `/agents`, `/agents/:id` | `pages/Agents.tsx`, `pages/AgentBuilder.tsx` | Your saved agents, and the editor for one |
| Explore | `/templates` | `pages/Templates.tsx` | Ready-made agents and packs to install |
| Tools | `/tools` | `pages/Tools.tsx` | Switch tools on and off |
| Code | `/code` | `pages/Code.tsx` | A placeholder. The `/code` command lands here; the coding workspace it will open is not built yet |
| Schedules | `/schedules` | `pages/Schedules.tsx` | When agents run automatically |
| Studio | `/imagine` | `pages/Imagine.tsx` | Image, video and audio generation |
| Skills | `/skills` | `pages/Skills.tsx` | Reusable instruction snippets |
| Evals | `/evals` | `pages/Evals.tsx` | Testing how good an agent is |
| Connections | `/connections` | `pages/Connections.tsx` | Gmail, Drive, Slack and the curated connectors. Adding your own MCP server is off |
| Keys | `/credentials` | `pages/Credentials.tsx` | Saved API keys |
| Apps | `/apps`, `/apps/:appId` | `pages/Apps.tsx`, `components/apps/AppFrame.tsx` | The launcher, and the full-screen Docs, Sheets, Slides, code and PDF apps |
| Files | `/documents` | `pages/Documents.tsx` | Your files, folders and knowledge bases |
| Team knowledge | `/team` (also `/solutions`) | `pages/Solutions.tsx`, `components/solutions/` | What your team has solved. See below |
| Dashboards | `/dashboards` | `pages/Dashboards.tsx` | Live tiles an agent saved |
| Pages | `/pages` | `pages/Pages.tsx` | Pages you published by link |
| Settings, Profile | `/settings`, `/profile` | `pages/Settings.tsx`, `pages/Profile.tsx` | Preferences, including Memory (what the assistant remembers about you) |
| Missions | part of `/runs` | `pages/Runs.tsx` (data from `api/missions.ts`) | Long goals that span many agent runs |

Public pages without login: `/a/:slug` (a shared agent) and `/p/:slug` (a
published page).

Old addresses only redirect. `/inbox`, `/overview`, `/missions` and `/executions`
go to `/runs`. `/insights` goes to Settings.

## Libraries

| Library | What for |
|---|---|
| React 19 + TypeScript | The UI |
| Vite | Dev server and build |
| Tailwind CSS | Styling with class names (`p-4 text-sm ...`) |
| React Router | Pages and URLs (`App.tsx`) |
| TanStack Query | Fetching and caching server data (`useQuery`, `useMutation`) |
| Axios | HTTP calls, inside `api/client.ts` only |
| Zustand | Small global stores (e.g. `lib/toastStore.ts`) |
| lucide-react | Icons |
| react-markdown | The assistant's markdown answers |
| Vitest, Playwright | Unit tests and browser tests |

## Folders in `src/`

```
src/
├── main.tsx, App.tsx     start the app; every route is in App.tsx
├── pages/                one file per screen
├── features/             feature folders with a front door (index.ts). Today: chat/
│   └── chat/             AIChat.tsx, components/, hooks/, lib/
├── components/           pieces of screens, grouped by feature
│   ├── ui/               shared building blocks: Button, Modal, Switch, Select, EmptyState...
│   ├── layout/           Sidebar, MobileTopBar, MobileBottomNav, PageHeader, HubTabs
│   │                     (menu items and hub tabs: lib/navigation.ts)
│   ├── command/          the Ctrl+K search (CommandMenu; rules in lib/commandMenu.ts)
│   ├── notifications/    the bell's panel (NotificationsPanel)
│   ├── content/          markdown, charts, question cards, media previews
│   ├── plan/             the assistant's plan (PlanView, PlanDock)
│   ├── orchestration/    the team lanes when several agents work at once (PlanPanel)
│   ├── files/            file cards and the shared file preview (PreviewFrame)
│   ├── pane/             the side pane with tabs (SidePane, PaneTabStrip, paneTabs in lib/)
│   ├── apps/             the document apps: AppFrame, AppBar, FileMenu, one editor per file type.
│   │                     Heavy editors (Univer, TipTap, CodeMirror, pdf.js) load lazily.
│   │                     Edits save by themselves. There is no Save button.
│   └── agents/, runs/, schedules/, solutions/, ...   one folder per feature
├── api/                  one file per backend area. THE ONLY place that calls the backend
├── hooks/                reusable React logic (useLiveRun, useHITLReminders, ...)
├── lib/                  plain functions, no React (cron text, costs, paths, ...)
├── contexts/             app-wide state: logged-in user, theme, the assistant
└── types/                shared types (agentConfig.ts = every agent setting)
```

Tests sit beside the code in `__tests__/` folders, for example
`src/lib/__tests__/cron.test.ts`. `@/` means `src/`.

## How a page gets data (the pattern to copy)

Most pages follow the same three steps. `pages/Dashboards.tsx` is a short example.

1. **A service in `api/`** wraps the HTTP call:

   ```ts
   // api/dashboards.ts
   export const dashboardsService = {
     list: async () => (await apiClient.get('/inference/dashboards/')).data,
     remove: async (id: number) => { await apiClient.delete(`/inference/dashboards/${id}/`); },
   };
   ```

2. **The page reads it with `useQuery`**. Loading, errors and caching are handled for you:

   ```tsx
   const { data, isLoading, isError } = useQuery({
     queryKey: ['dashboards'],
     queryFn: () => dashboardsService.list(),
   });
   ```

3. **Changes use `useMutation`**, then refresh the list:

   ```tsx
   const remove = useMutation({
     mutationFn: (id: number) => dashboardsService.remove(id),
     onSuccess: () => {
       toast.success('Dashboard deleted.');
       qc.invalidateQueries({ queryKey: ['dashboards'] });
     },
   });
   ```

`api/client.ts` adds your login token to every request and refreshes it when it
expires. Pages never deal with tokens.

## Live updates

- **Chat streams over HTTP.** The chat endpoint sends `data:` lines. `api/sse.ts`
  reads them. `features/chat/hooks/useChatStream.ts` turns each event into what you
  see. The event list is `Backend/chat/turn/events.py`.
- **Steering is not a socket.** A message typed while the assistant works is sent to
  `POST /api/chat/sessions/<id>/message/steer/`.
- **Everything else uses WebSockets**, through one helper, `lib/websocket.ts`
  (`useSocket`). It reconnects by itself. Do not open a `WebSocket` directly.
  - `hooks/useLiveRun.ts`: live steps of an agent run (`ws/execution/<id>/`)
  - `hooks/useHITLReminders.ts`: approval reminders and notifications (`ws/hitl/`)

## The chat page

`features/chat/components/StandaloneChat.tsx` holds the chat page's state and
handlers. Smaller pieces draw the screen from the data and callbacks they are given.

| File | What it is |
|---|---|
| `features/chat/components/ChatHistorySidebar.tsx` | The conversation list |
| `features/chat/components/ChatHeader.tsx` | The bar above the chat: history, title, memory chip, cost, settings |
| `features/chat/components/ChatSettingsDialog.tsx` | Per-chat system prompt and memory switch |
| `features/chat/components/ChatMessageItem.tsx` | One saved question or answer, with sources, reasoning and charts |
| `features/chat/components/ToolApprovalCard.tsx` | "The assistant wants to do X": Approve, Deny, Allow for this chat |
| `features/chat/components/format.ts` | Small text helpers shared by the pieces above |
| `features/chat/hooks/useChatStream.ts` | State of the answer streaming in right now |
| `hooks/useChatModelSelection.ts`, `hooks/useEffortSelection.ts` | The model picker and "how hard to think" |
| `hooks/useChatDraft.ts` | Keeps unsent text per conversation |
| `components/content/MarkdownMessage.tsx` | Draws one answer |
| `components/content/ChartArtifact.tsx`, `features/chat/components/HtmlArtifact.tsx` | Charts and HTML the AI produced |
| `components/plan/PlanView.tsx`, `components/plan/PlanDock.tsx` | The plan while the AI works, pinned above the message box. Once the reply has ended you can tick a step done (or untick it); a step left "doing" shows as not finished |
| `features/chat/lib/records.ts` | Session records (a failed or stopped reply, an agent's late result) are never deleted: a retry or edit keeps them on screen |
| `lib/chatEvents.ts` | Tells an open chat to reload when a notification says an agent's result was posted into it |
| `components/activity/RecentList.tsx` | Activity → Now: "Recently finished", the runs and chat replies of the last day |
| `components/orchestration/PlanPanel.tsx` | Several agents at once: one lane per worker, with Steer and Stop. A side rail on desktop, a sheet on phones |
| `components/content/QuestionCard.tsx` | A question the AI paused to ask you. The Activity page uses the same card |
| `components/content/PendingSends.tsx`, `hooks/usePendingSends.ts` | Messages the AI is holding before they go out, with Cancel and Send now. The hook re-reads the list every 2 s, and only while one is still waiting. Shown above the box in chat and at the top of a run |
| `components/changes/ChangesSheet.tsx`, `components/changes/ChangesSheetContainer.tsx`, `hooks/useChangeSet.ts` | "Undo what this run changed": the files a reply or run changed, with a checkbox per change to put it back. The hook loads the set when the sheet opens and again after a revert (no polling). The sheet only draws what it is given. Opened from "Undo changes…" under a reply, or from "Changes" on a run's page |
| `components/files/PreviewFrame.tsx` | The one file preview: chat's side drawer, the Documents page, the preview dialog |
| `features/chat/components/CommandPalette.tsx`, `CommandCard.tsx` | The `/` command menu and its results |
| `features/chat/components/ThinkingTimer.tsx` | The ticking timer, kept apart so it does not redraw everything |

## The side pane (`components/pane/`)

The side pane shows a file next to the chat. It can hold several things at once,
as tabs. Opening something that is already open switches to its tab.

A tab can be one of these kinds:

| Kind | What it shows | How it gets there |
|---|---|---|
| `file` | A file from your library (PDF, Word, sheet, code, and so on) | A file path or a file card in a reply, or a file the assistant just created |
| `html` | An HTML artifact the assistant wrote. Scripts run, but the page has no access to your account and no network | The **Open in pane** button on the artifact |
| `media` | A picture or a video from this app's own server, at full size (pinch to zoom on a phone) | Clicking a picture or video in a reply. Remote pictures from the web still open in a new browser tab, as links |
| `browser` | What the assistant's browser did in one run: the address, a picture of the page, each call with its steps (✓ or ✗). When the page needs you (a code, a login), a card says so, with **Open the live page** and **I'm done** | The **Browser · <host>** chip under a reply that browsed, or the same chip on the runs page. While a reply is still being written, the tab says "The assistant is using this page" |
| `link` | A link previewed before you open it: its title, a picture, and the start of its text, with **Open in new tab** | The **Preview** icon beside an outside link in a reply. Shown on a desktop, and only when the server has a browser |

The Browser tab's picture is the latest call's. Tap a call in the list to see its
picture instead. A picture is kept for a while, so an old one may say "This
picture has expired." **Watch live / take over** opens the provider's live view
in a new browser tab. It is never shown inside this app. A browser tab is not
kept across a reload. The chip under the reply opens it again, from the calls saved with that reply.

A new file the assistant creates, or the assistant's first browser call in a reply,
can open in the pane by itself. It only does this for the first such item of a
reply, only on a desktop (never on a phone), and not after you have closed the
pane during that reply. Turn it off under **Chat settings**, "Open new files
beside the chat" (on by default, saved in this browser).

On a wide desktop, the team's plan rail on the right folds into its small
pill when the pane leaves the chat less than 420px of room. The pill still opens
the team.

| File | What it is |
|---|---|
| `components/pane/SidePane.tsx` | The pane itself: width, drag handle, Escape, the phone Back button. Exports `MIN_PAGE_WIDTH` |
| `components/pane/PaneTabStrip.tsx` | The row of tabs. It draws what it is given and reports clicks. Keeps the active tab in view, and takes Left and Right arrows, Delete, and a phone swipe down |
| `components/pane/PaneTabMenu.tsx` | The ⋯ menu: close, close others, close to the right, reopen |
| `components/pane/PaneBody.tsx` | The body of the active tab only (file, html, media, browser or link). Inactive tabs hold no live view |
| `components/pane/BodyHeader.tsx` | The title row and hide button every body shares |
| `components/pane/BrowserTabBody.tsx` | The Browser tab: address row, the hand-off card, Watch live, the picture, and the list of calls. Takes its data as props and calls back |
| `components/pane/BrowserPicture.tsx` | One browser picture, loaded with the login token, with a plain word for each way it can be missing |
| `components/pane/NeedsUserCard.tsx` | The "The assistant needs you on <host>" card. Shared by the Browser tab and the chat reply |
| `components/pane/BrowserChip.tsx` | The "Browser · <host>" chip. It opens a run's Browser tab, and draws nothing outside a pane |
| `components/pane/LinkTabBody.tsx` | The Link tab: the previewed page's title, picture and text. Each link is previewed once per session |
| `components/pane/LinkPreviewButton.tsx` | The Preview icon beside an outside link. Draws nothing unless the pane is open, the screen is desktop-sized and the server has a browser |
| `components/pane/paneState.ts` | The React context (`usePane()`) and the sessionStorage copy. Only file tabs are saved |
| `lib/paneTabs.ts` | The tab rules as a plain reducer, with no React. Tested in `lib/__tests__/` |
| `lib/browserView.ts` | Reads a browser call from the stream or a saved message, and names its host, chip and hand-off. Plain functions, tested |
| `lib/browserPreview.ts` | The plain sentence for each way a link preview can fail (429, 404, 400, 502) |
| `api/browser.ts` | The browser's calls: status, link preview, and a picture. The only file that talks to `/api/browser/` |
| `hooks/useBrowserAvailable.ts` | Asks once per session whether the server has a browser. A yes is kept; a failed check is asked again next time |
| `features/chat/lib/autoOpen.ts` | The rule for opening a new file, or the first browser call, by itself. A plain function, tested |
| `features/chat/lib/browserRuns.ts` | The names a turn's browser tab is kept under, so the same tab comes back when it is opened again |
| `features/chat/components/AutoOpenFiles.tsx` | Wires that rule to the chat's file and browser lists, and keeps the live Browser tab up to date. It draws nothing |

`components/files/FilePreviewProvider.tsx` only re-exports `SidePane`, so older
imports still work. `useFilePreview()` still opens a file, now as a tab.

Tabs are kept per conversation in `sessionStorage`. They come back hidden, so a
reload never covers the chat. Escape and the header × hide the pane but keep the
tabs. The tab × closes one tab. On a phone the pane is a full-screen page, and
the Back button closes it. On a desktop, **Pop out** opens the file's own page in
a new browser tab.

## Team knowledge (`/team`)

`/team` (also `/solutions`) is where a team keeps the problems it has already
solved. The assistant searches it first. A fix belongs to the team it was solved
in, and no other team sees it. The page has tabs (Library, Drafts, Queue,
Insights, Team), chosen with `?tab=`. Queue and Insights are for curators. A draft
is not visible to the team until its author shares it. Code: `pages/Solutions.tsx`
and `components/solutions/`.

## Engineering notes

- **Chat streams over POST, so it uses one SSE reader.** `api/sse.ts` is the only
  reader for `data:` streams, because `EventSource` cannot send a POST. See
  "Live updates".
- **One WebSocket helper.** `lib/websocket.ts::useSocket` owns the URL, the
  exponential backoff and the remount race guard. No feature opens its own socket.
- **Lazy routes.** Every page except the sign-in screens is code-split. Add a new
  page to the lazy block in `App.tsx`, not to the static imports.
- **Render isolation.** The ticking timer is its own component, and
  `MarkdownMessage` is memoised. Anything that updates faster than a reader can
  read gets isolated the same way.
- **One wording, two copies, one test table.** The schedule reading is drawn in the
  browser at once and replaced by the server's reading a moment later. Both are
  tested against the same table of expected strings, so the sentence never rewrites
  itself under the cursor.
- **Safe redirects.** `lib/nextPath.ts::safeNext` refuses any post-login redirect
  that is not a same-origin path. An open redirect on a sign-in page is a phishing
  primitive.
- **Lint fences.** `npm run lint` fails if code outside `src/api/` imports axios, and
  if code imports another feature's inner files instead of its `index.ts`.

## Common jobs

**Add a page**

1. Create `src/pages/MyPage.tsx`.
2. In `App.tsx`, add `const MyPage = lazyPage(() => import('./pages/MyPage'));` and
   `<Route path="/my-page" element={<MyPage />} />`.
3. Add it to `lib/navigation.ts`, usually as a new tab of a hub (`tabs`), not a new
   menu item. That one file feeds the sidebar, the hub tab strip, the phone bar and
   Ctrl+K, and `src/lib/__tests__/navigation.test.ts` fails if a page is unreachable.

**Call a new backend endpoint**

Add a function to the matching file in `src/api/`, then use it from the page with
`useQuery` or `useMutation`. Never call `axios` or `fetch` from a component.

**Add a shared UI piece**

Check `components/ui/` first. There is already one `Button`, one `Modal`, one
`Switch` and one `Select`. Reuse them, so every screen looks the same.

**Make it work on a phone**

Below 768 px every button or link must be at least 44 x 44 px and have a name.
`h-11` / `min-h-11` is exactly 44 px here (pinned in `tailwind.config.js`).
`Button`, `IconButton` and `Modal` already do the right thing: a `Modal` is a
bottom sheet on a phone. Never hide an action behind hover or right-click alone;
`hooks/useLongPress.ts` is a shortcut to a visible "More actions" button, not a
replacement for it. Never use `window.confirm`: use `ConfirmDialog`.
`tests/e2e/mobile-layout.spec.ts` measures every control on the pages it lists.

## Checks before you push

```bash
npx tsc -b --force     # type check. Plain `tsc --noEmit` checks nothing in this repo
npm run lint           # should report 0 problems
npm test               # unit tests (vitest, run through scripts/vitest.mjs)
npm run build          # production build
```

Use `npm test`, not a bare `npx vitest`: the wrapper keeps the tests working when
the terminal opens at a lower-case `c:\` path.

## Gotchas

- The page layout is `overflow-hidden`. **Each page scrolls itself.** If your page
  does not scroll, give its main area `overflow-y-auto`. A Playwright test
  (`tests/e2e/mobile-layout.spec.ts`) checks this at phone sizes.
- Anything that ticks fast goes in its own small component. Otherwise the whole
  chat transcript re-renders on every tick.
- After login, `lib/nextPath.ts::safeNext` decides where to send the user. Always
  use it. Never redirect to a URL taken straight from the query string.
- Import another feature through its front door, `@/features/<name>`. Lint rejects
  imports of its inner files.
- Desktop pages share one 24px gutter: the page header row (`PageHeader`, with
  the hub tabs in it) lines up with the content (`md:px-6`). A new hub page should
  use it too. On phones every tab and button is at least 44px (`min-w-11`/`min-h-11`).
