# Frontend Beginner's Guide

A plain-language tour of the web app. For the whole system (backend too),
start with [`../START_HERE.md`](../START_HERE.md).

> Older versions of this guide described a drag-and-drop workflow canvas.
> That canvas was removed in August 2026. The app is now about **chat** and
> **agents**. If you see "workflow" or "node" in a name, it is left over.

---

## What the app does

You sign in and land on **Ask** (the chat). From the menu you can reach:

| Menu | Route | Page file | What it is |
|---|---|---|---|
| Ask | `/ai-chat` | `pages/AIChat.tsx` → `components/chat/StandaloneChat.tsx` | Chat with the assistant |
| Activity | `/runs` | `pages/Runs.tsx` | Every agent run, and runs waiting for your approval |
| Automations | `/agents`, `/agents/:id` | `pages/Agents.tsx`, `pages/AgentBuilder.tsx` | Your saved agents, and the editor for one |
| Explore | `/templates` | `pages/Templates.tsx` | Ready-made agents and packs to install |
| Tools | `/tools` | `pages/Tools.tsx` | Switch tools on/off; your custom tools |
| Schedules | `/schedules` | `pages/Schedules.tsx` | When agents run automatically |
| Studio | `/imagine` | `pages/Imagine.tsx` | Image / video / audio generation |
| Skills | `/skills` | `pages/Skills.tsx` | Reusable instruction snippets |
| Evals | `/evals` | `pages/Evals.tsx` | Testing how good an agent is |
| Connections | `/connections` | `pages/Connections.tsx` | Gmail, Drive, Slack, MCP servers... |
| Credentials | `/credentials` | `pages/Credentials.tsx` | Saved API keys |
| Apps | `/apps`, `/apps/:appId` | `pages/Apps.tsx`, `components/apps/AppFrame.tsx` | The launcher, and the full-screen Docs, Sheets, Slides, code and PDF apps. An app opens without the normal menus, with its own bar, tabs and file panel |
| Documents | `/documents` | `pages/Documents.tsx` | Your files, folders and knowledge bases |
| Dashboards | `/dashboards` | `pages/Dashboards.tsx` | Live tiles an agent saved |
| Pages | `/pages` | `pages/Pages.tsx` | Pages you published by link |
| Settings / Profile | `/settings`, `/profile` | `pages/Settings.tsx`, `pages/Profile.tsx` | Your preferences, including Memory (what the assistant remembers about you) |
| Missions | Part of `/runs` | `pages/Runs.tsx` (data from `api/missions.ts`) | Long goals that span many agent runs |

Public pages without login: `/a/:slug` (a shared agent) and `/p/:slug` (a
published page).

Some old addresses only redirect: `/inbox`, `/overview` and `/missions` go to
`/runs`, and `/insights` goes to Settings.

## Tools we use

| Library | What for |
|---|---|
| React 19 + TypeScript | The UI |
| Vite | Dev server and build |
| Tailwind CSS | Styling with class names (`p-4 text-sm ...`) |
| React Router | Pages and URLs (`App.tsx`) |
| TanStack Query (`@tanstack/react-query`) | Fetching and caching server data (`useQuery`, `useMutation`) |
| Axios | HTTP calls (`api/client.ts`) |
| Zustand | Small global stores (e.g. `lib/toastStore.ts`) |
| lucide-react | Icons |
| react-markdown | Showing the AI's markdown answers |
| Vitest, Playwright | Unit tests and browser tests |

## Folders in `src/`

```
src/
├── main.tsx          starts the app
├── App.tsx           all routes. Every page is lazy-loaded except the login screens
├── pages/            one file per screen
├── components/       pieces of screens, grouped by feature
│   ├── ui/           shared building blocks: Button, Modal, Switch, Select, EmptyState...
│   ├── layout/       Topbar, Sidebar, mobile bars, PageHeader (menu items: lib/navigation.ts)
│   ├── chat/         everything in the chat page
│   ├── apps/         the document apps (Docs, Sheets, Slides...): AppFrame,
│   │                 AppBar, FileMenu, one editor per file type. The heavy
│   │                 editors (Univer, TipTap, CodeMirror, pdf.js) load lazily,
│   │                 only inside the app that uses them. Edits save by
│   │                 themselves (there is no Save button)
│   ├── files/        file cards and the shared file preview
│   └── agents/, runs/, orchestration/, schedules/, ...   one folder per feature
├── api/              one file per backend area. THE ONLY place that calls the backend
├── hooks/            reusable React logic (useChatStream, useLiveRun, ...)
├── lib/              plain functions, no React (cron text, costs, paths, ...)
├── contexts/         app-wide state: logged-in user, theme, assistant
└── types/            shared types (agentConfig.ts = every agent setting)
```

Tests sit next to the code in `__tests__/` folders, e.g.
`src/lib/__tests__/cron.test.ts`.

## How a page gets data (the pattern to copy)

Almost every page follows the same three steps. `pages/Dashboards.tsx` is a
short, clean example.

1. **A service in `api/`** wraps the HTTP call:

   ```ts
   // api/dashboards.ts
   export const dashboardsService = {
     list: async () => (await apiClient.get('/inference/dashboards/')).data,
     remove: async (id: number) => { await apiClient.delete(`/inference/dashboards/${id}/`); },
   };
   ```

2. **The page reads it with `useQuery`** (loading, error and caching are handled for you):

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
       qc.invalidateQueries({ queryKey: ['dashboards'] });   // re-fetch the list
     },
   });
   ```

`api/client.ts` adds your login token to every request and quietly refreshes it
when it expires. Pages never deal with tokens.

## Live updates

- **Chat streams over HTTP.** The chat endpoint sends a stream of `data:` lines.
  `api/sse.ts` reads them; `hooks/useChatStream.ts` turns each event into what
  you see (text arriving, tool calls, charts, approval cards). The event names
  are listed in `Backend/docs/CHAT_AGENT.md`.
- **Everything else uses WebSockets** through one helper, `lib/websocket.ts`
  (`useSocket`). It reconnects by itself. Don't open a `WebSocket` directly.
  - `hooks/useLiveRun.ts`: live steps of an agent run (`ws/execution/<id>/`)
  - `hooks/useHITLReminders.ts`: approval reminders and notifications (`ws/hitl/`)

## The chat page

`components/chat/StandaloneChat.tsx` holds the chat page's state and handlers.
The screen is drawn by smaller pieces it passes data and callbacks to:

| File | What it is |
|---|---|
| `components/chat/ChatHistorySidebar.tsx` | The conversation list on the left |
| `components/chat/ChatHeader.tsx` | The thin bar above the chat: history button, title, memory-off chip, cost, settings |
| `components/chat/ChatSettingsDialog.tsx` | Per-chat system prompt and memory switch |
| `components/chat/ChatMessageItem.tsx` | One saved question or answer, with its sources, reasoning, charts and action buttons |
| `components/chat/ToolApprovalCard.tsx` | "The assistant wants to do X": Approve / Deny / Allow for this chat / Always |
| `components/chat/format.ts` | Small text helpers shared by the pieces above |
| `hooks/useChatStream.ts` | State of the answer currently streaming in |
| `hooks/useChatModelSelection.ts`, `hooks/useEffortSelection.ts` | The model picker and "how hard to think" |
| `hooks/useChatDraft.ts` | Keeps unsent text per conversation |
| `components/chat/MarkdownMessage.tsx` | Draws one answer |
| `components/chat/ChartArtifact.tsx`, `HtmlArtifact.tsx` | Charts and HTML the AI produced |
| `components/chat/TodoPanel.tsx` | The AI's plan while it works |
| `components/orchestration/PlanPanel.tsx` | When the AI hands work to several agents: one lane per worker, with Steer / Stop buttons. A side rail on desktop, a bottom sheet on phones |
| `components/chat/QuestionCard.tsx` | A question the AI paused to ask you (pick one, pick several, a number, or text). The Activity page uses the same card |
| `components/files/PreviewFrame.tsx` | The one file preview used everywhere: chat's side drawer, the Documents page, and the preview dialog |
| `components/chat/CommandPalette.tsx`, `CommandCard.tsx` | The `/` command menu and its results |
| `components/chat/ThinkingTimer.tsx` | The ticking timer (kept separate so it doesn't redraw everything) |

## Common jobs

**Add a page**

1. Create `src/pages/MyPage.tsx`.
2. In `App.tsx`, add `const MyPage = lazyPage(() => import('./pages/MyPage'));`
   and a `<Route path="/my-page" element={<MyPage />} />`.
3. Add it to `lib/navigation.ts`. That one list feeds the sidebar, the desktop
   top bar and the mobile tab bar, so a page is never reachable from only one of them.

**Call a new backend endpoint**

Add a function to the matching file in `src/api/`, and use it from the page
with `useQuery` or `useMutation`. Never call `axios` or `fetch` from a
component. `npm run lint` enforces this: importing the HTTP client (or axios)
outside `src/api/` is an error. Helpers such as `tokenManager` are fine.

**Add a shared UI piece**

Check `components/ui/` first. There is already one `Button`, one `Modal`, one
`Switch`, one `Select` for the whole app. Reuse them so every screen looks the same.

## Checks before you push

```bash
npx tsc -b --force     # type check. Plain `tsc --noEmit` checks nothing in this repo
npm run lint           # should report 0 problems
npm test               # unit tests (vitest)
npm run build          # production build
```

## Gotchas

- The whole page layout is `overflow-hidden`. **Each page scrolls itself.** If
  your page doesn't scroll, give its main area `overflow-y-auto`. A
  Playwright test (`tests/e2e/mobile-layout.spec.ts`) checks this on phone sizes.
- Anything that ticks fast (timers) goes in its own small component, or the
  whole chat transcript re-renders every tick.
- After login, `lib/nextPath.ts::safeNext` decides where to send the user.
  Always use it; never redirect to a URL taken straight from the query string.
