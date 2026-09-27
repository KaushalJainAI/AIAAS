# AIAAS Frontend

[![ci](https://github.com/KaushalJainAI/workflow_assistant/actions/workflows/ci.yml/badge.svg?branch=agent)](https://github.com/KaushalJainAI/workflow_assistant/actions/workflows/ci.yml)

The web app for **AIAAS**, a platform for building AI agents that do real work
on a user's behalf and stop to ask before anything irreversible. The backend
lives in [`AIAAS_Backend`](https://github.com/KaushalJainAI/AIAAS_Backend).

React 19 · TypeScript · Vite · Tailwind · TanStack Query · Zustand

**New here?** Read [BEGINNER_GUIDE.md](BEGINNER_GUIDE.md): every page, the
folder layout, and the pattern to copy when adding a screen.

## Screens

| Route | What it's for |
|---|---|
| `/ai-chat` | Streaming chat with live tool calls, a plan (todo) panel, charts, approvals and questions inline, Ask / Auto / Plan modes, `/` commands, and **steering**: type while the agent works to redirect it |
| `/agents`, `/agents/:id` | Automations list (searchable, grouped by category with Scheduled vs On demand inside) and agent builder: prompt, model and reasoning effort, granted tools, connector scopes, autonomy level, spend cap, schedules |
| `/templates` | Explore: curated agents grouped by pack (plus standalone and community sections); requirements are matched to *your* knowledge bases and connections, never someone else's ids. Installed entries show an Installed mark with Open and Uninstall |
| `/runs` | Activity: runs waiting for your decision, missions, and run history (each model turn with its reasoning, each tool call, cost) |
| `/schedules` | Cron schedules with a live plain-English reading ("Every weekday at 9:00") |
| `/connections` | Gmail, Drive, Sheets, Calendar, Notion, messaging apps and MCP servers |
| `/documents` | File system and knowledge bases |
| `/apps`, `/apps/:appId` | Full-screen Docs (TipTap), Sheets (Univer) and Slides apps that edit the same real files agents write, with autosave, undo, version history and export |
| `/evals` | Evaluation suites and human review of grader decisions |
| `/a/:slug` | Public page for a published agent (no account needed) |

## Engineering notes

- **Streaming without `EventSource`.** Chat endpoints stream Server-Sent
  Events over `POST`, which `EventSource` cannot send, so `api/sse.ts` is a
  single hand-written reader used everywhere.
- **One WebSocket primitive.** `lib/websocket.ts::useSocket` owns URL
  resolution, exponential backoff and the remount race guard; no feature opens
  its own socket.
- **Lazy routes.** Every page except the auth screens is code-split. The app
  used to ship as one 1.2 MB chunk behind a login screen that needed none of it.
- **Render isolation.** The 10 Hz "thinking" timer lives in its own component
  and `MarkdownMessage` is memoised, so a ticking clock doesn't re-parse the
  whole transcript's markdown ten times a second.
- **Wording pinned across the stack.** The schedule description is rendered
  instantly in the browser and then replaced by the server's reading. Both are
  tested against the *same* table of expected strings, so the sentence never
  visibly rewrites itself under the cursor.
- **Safe redirects.** `lib/nextPath.ts::safeNext` refuses any post-login
  redirect that isn't a same-origin path. An open redirect on a sign-in page is
  a phishing primitive.

## Run it locally

```bash
npm install
npm run dev            # http://localhost:5173, expects the backend on :8000
```

## Checks (all run in CI)

```bash
npx tsc -b --force     # typecheck (plain `tsc --noEmit` checks zero files here)
npm run lint           # zero-warning baseline
npm test               # vitest unit tests
npm run build          # production bundle
```

Optional suites: `npm run test:integration` (needs `msw`) and
`npm run test:e2e` (Playwright, including a mobile-layout spec).
