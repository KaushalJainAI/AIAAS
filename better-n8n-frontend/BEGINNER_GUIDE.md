# Frontend Beginner's Guide

A plain tour of the web app. For the whole system, read
[`../START_HERE.md`](../START_HERE.md). For where code goes in `src/` and which
rules the lint enforces, see the Folders section below and `eslint.config.js`.

If you see "workflow" or "node" in a name, it is left over from the old
drag-and-drop canvas, which is gone. The app is about **chat** and **agents**.

---

## What the app does

You sign in and land on **Ask** (the chat). From the menu you can reach:

| Menu | Route | Page file | What it is |
|---|---|---|---|
| Ask | `/ai-chat` | `features/chat/AIChat.tsx` → `features/chat/components/StandaloneChat.tsx` | Chat with the assistant |
| Activity | `/runs` | `pages/Runs.tsx` | Every agent run, and runs waiting for your approval |
| Automations | `/agents`, `/agents/:id` | `pages/Agents.tsx`, `pages/AgentBuilder.tsx` | Your saved agents, and the editor for one |
| Explore | `/templates` | `pages/Templates.tsx` | Ready-made agents and packs to install |
| Tools | `/tools` | `pages/Tools.tsx` | Switch tools on and off |
| Schedules | `/schedules` | `pages/Schedules.tsx` | When agents run automatically |
| Studio | `/imagine` | `pages/Imagine.tsx` | Image, video and audio generation |
| Skills | `/skills` | `pages/Skills.tsx` | Reusable instruction snippets |
| Evals | `/evals` | `pages/Evals.tsx` | Testing how good an agent is |
| Connections | `/connections` | `pages/Connections.tsx` | Gmail, Drive, Slack, MCP servers |
| Credentials | `/credentials` | `pages/Credentials.tsx` | Saved API keys |
| Apps | `/apps`, `/apps/:appId` | `pages/Apps.tsx`, `components/apps/AppFrame.tsx` | The launcher, and the full-screen Docs, Sheets, Slides, code and PDF apps |
| Documents | `/documents` | `pages/Documents.tsx` | Your files, folders and knowledge bases |
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
│   ├── layout/           Sidebar, MobileTopBar, MobileBottomNav, PageHeader
│   │                     (menu items: lib/navigation.ts)
│   ├── content/          markdown, charts, question cards, media previews
│   ├── plan/             the assistant's plan (PlanView, PlanDock)
│   ├── orchestration/    the team lanes when several agents work at once (PlanPanel)
│   ├── files/            file cards and the shared file preview (PreviewFrame)
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
| `components/plan/PlanView.tsx`, `components/plan/PlanDock.tsx` | The plan while the AI works, pinned above the message box |
| `components/orchestration/PlanPanel.tsx` | Several agents at once: one lane per worker, with Steer and Stop. A side rail on desktop, a sheet on phones |
| `components/content/QuestionCard.tsx` | A question the AI paused to ask you. The Activity page uses the same card |
| `components/files/PreviewFrame.tsx` | The one file preview: chat's side drawer, the Documents page, the preview dialog |
| `features/chat/components/CommandPalette.tsx`, `CommandCard.tsx` | The `/` command menu and its results |
| `features/chat/components/ThinkingTimer.tsx` | The ticking timer, kept apart so it does not redraw everything |

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
- **Lazy routes.** Every page except the sign-in screens is code-split. The app
  used to ship as one 1.2 MB chunk behind a login screen that needed none of it.
  Add a new page to the lazy block in `App.tsx`, not to the static imports.
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
3. Add it to `lib/navigation.ts`. That one list feeds the sidebar, the desktop top
   bar and the mobile tab bar.

**Call a new backend endpoint**

Add a function to the matching file in `src/api/`, then use it from the page with
`useQuery` or `useMutation`. Never call `axios` or `fetch` from a component.

**Add a shared UI piece**

Check `components/ui/` first. There is already one `Button`, one `Modal`, one
`Switch` and one `Select`. Reuse them, so every screen looks the same.

## Checks before you push

```bash
npx tsc -b --force     # type check. Plain `tsc --noEmit` checks nothing in this repo
npm run lint           # should report 0 problems
npm test               # unit tests (vitest)
npm run build          # production build
```

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
