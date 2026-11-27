# How the frontend is organised

This guide explains where code goes in `src/`, and which industry practice
each rule follows. It also says what is done and what is still to do.
For a tour of the pages, read `BEGINNER_GUIDE.md` first.

---

## The short version

```
src/
├── features/          ← one folder per product feature
│   └── chat/          ← the first one moved
├── components/        ← shared UI: ui/, content/, layout/ …
├── api/               ← every call to the backend
├── hooks/             ← shared React hooks
├── lib/               ← shared plain functions (no React)
├── contexts/          ← app-wide state
├── pages/             ← screens not yet moved into a feature
└── App.tsx            ← the routes
```

**The rule:** if only one feature uses a file, it lives inside that feature.
If two or more features use it, it lives in a shared folder.

---

## What changed (2026-11-16)

### 1. Chat is now a feature folder

Before, the chat code was spread over five folders: `pages/`,
`components/chat/`, `hooks/`, `lib/` and `api/`. To work on chat you had to
jump between all of them. Now the chat-only code is in one place:

```
features/chat/
├── index.ts          ← the front door (see below)
├── AIChat.tsx        ← the page
├── components/       ← StandaloneChat, ChatHeader, CommandPalette, …
│   └── __tests__/
├── hooks/            ← useChatStream, useMessagePanels, useMessageSelection, useCommands
└── lib/              ← chatMode, welcome, contextFormat
    └── __tests__/
```

| Moved from | Moved to |
|---|---|
| `pages/AIChat.tsx` | `features/chat/AIChat.tsx` |
| `components/chat/*` (21 files) | `features/chat/components/` |
| `hooks/useChatStream`, `useMessagePanels`, `useMessageSelection`, `useCommands` | `features/chat/hooks/` |
| `lib/chatMode`, `lib/welcome`, `lib/contextFormat` | `features/chat/lib/` |

**Industry practice:** this is called *feature-based* (or *feature-sliced*)
structure. It is what the widely used
[bulletproof-react](https://github.com/alan2207/bulletproof-react) guide
recommends. The benefit: to change, review or delete a feature, you open one
folder.

### 2. Shared renderers moved to `components/content/`

Four components used to live in `components/chat/`, but the Inbox, file
previews, dashboards, evals and published pages use them too:

- `MarkdownMessage`: draws an AI answer (markdown, math, code, citations)
- `ChartArtifact`: draws a chart
- `MediaPreview`: shows an image, audio or video
- `QuestionCard`: the question an agent asks you

They are not chat code, so they now live in `components/content/`, meaning
"how AI output is drawn". Moving them into `features/chat/` instead would
make five other screens depend on chat's insides.

Some chat-shaped files stay shared for the same reason. These include
`api/chat.ts`, `lib/streamHeal.ts` and `lib/sourceSpans.ts`
(used by `MarkdownMessage`), `lib/chatRuns.ts` (used at sign-out),
`hooks/useChatDraft.ts` (the apps pre-fill a new chat with it) and
`hooks/useChatModelSelection.ts` (Settings and the agent builder).

### 3. Each feature has a front door, and ESLint guards it

`features/chat/index.ts` lists what the rest of the app may use from chat.
Today that is only the page. Code outside the feature must import from
`@/features/chat` and nothing deeper:

```ts
import ChatPage from '@/features/chat';                          // ✅ the front door
import { useChatStream } from '@/features/chat/hooks/useChatStream'; // ❌ lint error
```

The rule is in `eslint.config.js` (`FEATURE_BOUNDARY`). It applies to the
shared folders and `src/api/` alike.

**Industry practice:** "public API per module" with boundaries enforced by
a linter, not by memory. Without the rule, the folders slowly fill with
cross-imports again.

**Keep the front door small.** Do not re-export every file from
`index.ts`. Such "barrel files" slow Vite's dev server and hide what is really
used. Export only what other features need.

### 4. `@/` imports instead of `../../../`

The `@/` alias (it means `src/`) was configured but used in one file. Moved
code now uses it for anything outside its own feature:

```ts
import { cn } from '@/lib/utils';             // shared code: use @/
import ThinkingTimer from './ThinkingTimer';  // same feature: stay relative
```

**Industry practice:** absolute imports for shared code. A file can then
move without breaking its imports, and you can read at a glance where each
one comes from. New code should follow this. Older files keep `../` until
they are next touched.

---

## Practices this app already followed

These were already in place before this change. They are listed so the
guide gives a full picture.

| Practice | Where |
|---|---|
| One place talks to the backend, enforced by lint | `src/api/`, rule in `eslint.config.js` |
| Server data cached by TanStack Query, not copied into state | pages use `useQuery` |
| React Compiler memoises components automatically | `vite.config.ts` |
| Pages load lazily, so the first screen is small | `lazyPage(...)` in `App.tsx` |
| Strict TypeScript (`strict`, no unused code) | `tsconfig.app.json` |
| Tests beside the code in `__tests__/` | every folder |
| Pure logic kept out of components, so it is easy to test | `lib/` |
| A ticking timer isolated in its own component | `ThinkingTimer` |

---

## How to add a new feature

1. Create `src/features/<name>/` with `index.ts`, the page, and `components/`,
   `hooks/` and `lib/` folders as you need them.
2. In `index.ts`, export the page (and anything another feature truly needs).
3. Add the route in `App.tsx`:
   `lazyPage(() => import('@/features/<name>'))`.
4. Put backend calls in `src/api/<name>.ts`, never in the feature itself.
5. If a second feature needs one of your files, move that file to a shared
   folder. Don't import past the front door.

---

### 5. The side pane is shared, in `components/pane/` (2026-11-17)

The tabbed preview pane beside the chat (`SidePane`, the tab strip and menu,
and one body per tab kind: file, media, HTML, browser, link) is used by the
chat and by the Activity and Runs pages, so it is shared code, not chat code.
Its tab rules are a pure reducer in `lib/paneTabs.ts`.
`components/files/FilePreviewProvider.tsx` is now a re-export of `SidePane`
so older imports keep working. What only the chat does with the pane
(opening new files and the browser on their own) lives in `features/chat/`
(`AutoOpenFiles.tsx`, `lib/autoOpen.ts`). Plan:
`Backend/docs/PREVIEW_PANE_AND_BROWSER_PLAN.md`.

### 6. Rules two screens need live in `lib/` (2026-11-19)

The UX overhaul (`Backend/docs/UX_OVERHAUL_PLAN.md`) added shared code in
the usual places: `components/command/` (Ctrl+K), `components/notifications/`
(the bell's panel), `components/layout/HubTabs.tsx`, and pure rules in `lib/`:
`connectionStatus.ts` (what "connected" means, used by Connections and the
chat's setup card), `notificationLink.ts` (where a notification may link),
`explainRunError.ts`, `agentAdvanced.ts`, `commandMenu.ts`. Chat-only pieces
went into `features/chat/` (`ThisChatMenu`, `PopMenu`, `ComposerMoreSheet`,
`lib/historyGroups.ts`, `lib/setupSteps.ts`, `lib/starters.ts`,
`lib/turnReceipt.ts`, `lib/approvalTone.ts`, `hooks/useTitleProgress.ts`).
When a second screen needs a rule a page keeps privately, move the rule to
`lib/` and call it from both; do not copy it.

## Still to do

The other features still use the old layout. Move them one at a time, when
you next work on each, in the same way chat was moved:

| Feature | Files today |
|---|---|
| agents | `pages/Agents`, `AgentBuilder`, `AgentCreateWizard`, `AgentHistory`, `components/agents/` |
| evals | `pages/Evals`, `components/evals/`, `lib/evalCase` |
| imagine | `pages/Imagine`, `components/imagine/`, `hooks/useImagine*`, `lib/imagineStyles` |
| files | `pages/Documents`, `components/documents/`, `files/`, `explorer/` |
| apps | `pages/Apps`, `AppWorkspace`, `components/apps/` |
| solutions | `pages/Solutions`, `components/solutions/`, `lib/solution*` |
| schedules, runs, activity | `pages/Schedules`, `Runs`, `components/schedules/`, `runs/`, `activity/` |
| settings, connections | `pages/Settings`, `Connections`, `Credentials`, `components/settings/`, `mcp/`, `credentials/` |

Moving one feature at a time keeps each change reviewable. One huge move
would touch hundreds of import lines and make `git blame` useless.

One more change to consider later:

- **Tailwind CSS v4** (we are on v3). It is faster and is configured in CSS.
  The upgrade changes class names and config, so give it its own change.

Unit tests run through `scripts/vitest.mjs` (`npm test`). It starts Vitest with
an upper-case drive letter, which fixes a Windows bug that made every suite fail
at collection. Use `npm test`, not a bare `npx vitest`.
