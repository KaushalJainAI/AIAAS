# AIAAS Web App

The web app for AIAAS: chat, agents, runs, files, connections and the document
apps. The backend is [`../Backend/`](../Backend/README.md).

React 19 · TypeScript · Vite · Tailwind · TanStack Query · Zustand

**New here?** Read [BEGINNER_GUIDE.md](BEGINNER_GUIDE.md): every page, the folder
layout, and the pattern to copy when you add a screen. To run it, see
[START_HERE.md](../START_HERE.md), section 3.

## Screens

Routes are in `src/App.tsx`.

| Route | Screen |
|---|---|
| `/ai-chat` | Chat with the assistant: live tool calls, plan, charts, approvals and questions, the four modes (Ask, Auto, Plan, Full auto), `/` commands, and steering |
| `/agents`, `/agents/new`, `/agents/:id`, `/agents/:id/history` | Automations list, the agent builder, the creation wizard, and an agent's config history |
| `/templates`, `/templates/:slug` | Explore: installable agents and packs |
| `/runs` | Activity: runs waiting for you, missions, and run history with turns, tool calls and cost |
| `/schedules` | Cron schedules, with a plain-English reading of each |
| `/connections`, `/credentials` | Connected accounts and MCP servers; saved keys |
| `/documents`, `/pages`, `/dashboards` | Files and knowledge bases; published pages; dashboards |
| `/apps`, `/apps/:appId` | The app launcher and the full-screen Docs, Sheets, Slides and other editors |
| `/imagine` | Image, video and audio generation |
| `/tools`, `/skills` | The tool library; reusable instructions |
| `/team` (also `/solutions`) | Team knowledge: solved problems and shared fixes |
| `/evals` | Evaluation suites and review of grader decisions |
| `/settings`, `/profile` | Preferences, Memory, account |
| `/login`, `/signup`, `/forgot-password`, `/terms`, `/privacy` | Sign-in and legal pages |
| `/a/:slug`, `/p/:slug` | A published agent and a published page. Public ones need no login. |
| `/oauth/callback`, `/auth/google/callback` | Return from a connector's OAuth popup, and from Google sign-in |
| `/` | Signed-in users go to `/ai-chat`. Guests see the chat in a public shell. |

Old addresses redirect: `/inbox`, `/missions`, `/overview`, `/orchestrator` and
`/executions` go to `/runs`. `/connectors` and `/mcp-servers` go to `/connections`.
`/studio` goes to `/imagine`. `/explore` goes to `/templates`. `/insights` goes to Settings.

## Engineering notes

- Chat streams over POST, so it uses one SSE reader (`api/sse.ts`), not `EventSource`. [BEGINNER_GUIDE.md](BEGINNER_GUIDE.md#engineering-notes)
- One WebSocket helper (`lib/websocket.ts::useSocket`) owns reconnects. [BEGINNER_GUIDE.md](BEGINNER_GUIDE.md#engineering-notes)
- Every page except the sign-in screens is lazy-loaded. [BEGINNER_GUIDE.md](BEGINNER_GUIDE.md#engineering-notes)
- The ticking timer is its own component, and markdown is memoised. [BEGINNER_GUIDE.md](BEGINNER_GUIDE.md#engineering-notes)
- The schedule reading is written twice and pinned to one table of strings. [BEGINNER_GUIDE.md](BEGINNER_GUIDE.md#engineering-notes)
- `lib/nextPath.ts::safeNext` refuses any redirect that is not a same-origin path. [BEGINNER_GUIDE.md](BEGINNER_GUIDE.md#engineering-notes)
- Lint fences: only `src/api/` may import the HTTP client, and a feature is imported through its front door. [BEGINNER_GUIDE.md](BEGINNER_GUIDE.md#engineering-notes)

## Checks

```bash
npx tsc -b --force     # typecheck (plain `tsc --noEmit` checks nothing here)
npm run lint           # zero-warning baseline
npm test               # vitest unit tests
npm run build          # type-check and production bundle
```

Optional: `npm run test:integration` (needs `msw`) and `npm run test:e2e`
(Playwright, including a mobile-layout spec).
