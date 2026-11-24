# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AIAAS (Agentic AI Automation System) is a full-stack AI agent platform: a chat
assistant that plans and delegates to configurable sub-agents, with files,
knowledge bases, connectors, schedules and evals. Three sub-projects:

- **better-n8n-frontend/** — React/Vite web app (chat, agents, files, apps, evals). The
  name is historical: the n8n-style canvas was removed in 2026-08
- **Backend/** — Django ASGI backend; the agent loop runs on LangGraph
- **mobile-native/** (2026-11-12) — React Native (Expo SDK 58, expo-router) app for
  Android and iOS with full web parity (tabs Chat, Activity, Agents, Files, More;
  rich editors open the web app's editor in a signed-in web view). A second UI on
  purpose: it copies the web app's request bodies exactly, so a change to a route it
  calls is a mobile change too, and it copies the web's look (`src/theme.ts` holds the
  web's colour tokens, IBM Plex is bundled, `Text` comes from `src/components/Text`).
  Gates: `npx tsc --noEmit` and `npm run lint`; rules in its `DESIGN.md`; read its
  `AGENTS.md` before using an Expo API. See `Backend/docs/MOBILE_APP_PLAN.md`

---

## Commands

### Frontend (`better-n8n-frontend/`)
```bash
npm install
npm run dev          # Dev server at http://localhost:5173
npm run build        # TypeScript check + Vite bundle
npm run lint         # ESLint
```

### Backend (`Backend/`)
```bash
python -m venv venv && source venv/Scripts/activate   # Windows
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 0.0.0.0:8000

# Run tests
python manage.py test
python manage.py test agents.tests           # single app
pytest                                       # pytest also works
pytest chat/tests/test_vision.py             # single file

# Async workers (requires Redis)
celery -A workflow_backend worker -l info
```

### Docker
```bash
docker compose up --build                        # Local dev (SQLite + Redis)
docker compose --profile async up                # Include Celery worker
docker compose -f docker-compose.prod.yml up     # Production (PostgreSQL, Caddy)
```

---

## Architecture

### Execution Pipeline

There are two loops, and they share one engine: a LangGraph graph of
`agent → tools → curate → steering` (`chat/turn/agent.py`).

1. **A chat turn**: the browser POSTs a message → `chat/turn/pipeline.py::run_chat_turn`
   (preflight, history, notes, memory) → the graph → frames streamed back as SSE
   (`chat/transport/`). Chat is the orchestrator: it reads, plans and delegates.
2. **An agent run**: a `SubAgent` (prompt + model + grants, no graph) starts at
   `agents/agent/runtime.py::start_agent_run` — from the Run button
   (`POST /api/orchestrator/agents/{id}/execute/`, 202 + `execution_id`), a
   schedule or webhook trigger (`agents/sweep.py`), a mission, chat delegation
   or an eval. It runs detached (`background.spawn()`) through the same graph
   and is recorded as `ExecutionLog` → `AgentTurn` → `AgentStep`.
3. Every model call resolves through `llm/access.py`; every tool through
   `chat/tools/`, gated per agent by `GRANT_TOOLS`. Live run events go out over
   Django Channels (`streaming/consumers.py`).

### Django Apps (`Backend/<app>/`; settings live in `Backend/workflow_backend/settings/`)

Settings are a package: `base.py` holds all shared config, and `local.py`,
`deployment.py`, `test.py` set env defaults and `from .base import *` with a few
overrides. Every entry point sets `DJANGO_SETTINGS_MODULE` explicitly
(`manage.py` → `settings.local`/`settings.test`, `asgi.py`/`wsgi.py`/`celery.py`
→ `settings.local`, `Dockerfile` → `settings.deployment`). There is **no
`workflow_backend/settings.py`** — the compatibility shim that used to re-export
`local` was deleted (2026-08-17); it was unreachable because Python resolves
`workflow_backend.settings` to the package and nothing ever referenced it. Add
new config to `base.py`, never to a new top-level `settings.py`.

| App | Responsibility |
|-----|---------------|
| `core/` | JWT auth, OAuth2 (allauth), API throttling, middleware, CSRF protection |
| `sandbox/` (not a Django app) | The Python execution sandbox behind the `execute_python` tool, for chat and agent runs alike. **One door — `sandbox/engine.py::arun_code`** — selects by `SANDBOX_ENGINE`: `service` (production) POSTs to the hardened sidecar container `sandbox_service/` (real confinement, numpy/pandas available); `inprocess` (dev fallback only, weaker) is `safe_execution.py` (AST denylist + `exec` on a worker thread). No automatic fallback between them. The vendored wasmtime engine + its 40 MB CPython-wasm tree were **removed 2026-09-02** (no callers, and WASM can't load the C extensions agents need); `RestrictedPython`/`wasmtime` are gone from requirements |
| `agents/` | `SubAgent` + `Trigger` CRUD, the agent runtime (`agent/runtime.py`), delegation (`agent/orchestrator.py`), the trigger sweep (`sweep.py`), HITL pause/resume/reject. **App label is `orchestrator`, not `agents`** — see `agents/apps.py` |
| `chat/` | Perplexity-style conversational agent with Python sandbox, external thinking extraction |
| `inference/` | Hierarchical RAG (file → user → platform tiers) + the per-user file system (`Folder`, `filesystem.py`, `recycle.py`) + the extraction engine (schemas, extracted rows, review queue — the retired `extraction` app folded in 2026-08-18; models are `inference_extraction*`, routes stay `/api/extraction/` via `inference/extraction_urls.py`) |
| `credentials/` | AES-encrypted API key storage with credential injection for MCP |
| `mcp_integration/` | Model Context Protocol client with tool caching, user-scoped access, validation |
| `streaming/` | WebSocket consumers for real-time execution logs and input data tracking |
| `skills/` | Pluggable skill registry invoked by agents |
| `tools_config/` | The tool library page and the per-user overlay on it (`ToolConfig`). Serves `/api/tools/`; the catalogue is derived from `chat/tools/registry.py` + `GRANT_TOOLS`, never stored. **Absent row = code default**, so a fresh `migrate` yields zero rows and every tool behaves as before the app existed |
| `logs/` | Agent observability: `ExecutionLog` (run) → `AgentTurn` (model call, with its full reasoning) → `AgentStep` (tool call), plus `SubAgentRevision` (the config a run executed under) and `logs/revisions.py`. Served at `/api/logs/`; views are thin and sync, all ORM in `logs/queries.py`. See `Backend/docs/AGENT_OBSERVABILITY.md`. (`NodeExecutionLog` was renamed to `AgentStep` 2026-08-19; `ExecutionLogger`, `AuditEntry` and `OrchestratorThought` are gone — all DAG-era with no writer) |
| `solutions/` | What an organisation has already solved, found again by the next person: `Solution` records (problem, symptoms, cause, fix, claims with how fast each goes stale), reviews (worked / failed / doubtful, with which model said so), and three small indexes (error signatures, keywords, float16 vectors). **One read door, `access.py::visible`**, checks org membership live; a choke-point test fails on any other `Solution.objects` read. Organisations themselves are `core.Organization`/`Membership` (`core/orgs.py`). See `Backend/docs/SOLUTION_MEMORY_PLAN.md` |
| `notifications/` | Persistent notifications + the HITL reminder engine (escalation ladder, hourly nudges, daily email digest) |
| `imagine/` | Media generation (image/video/audio) via OpenRouter; form + conversational agent with HITL |
| `llm/` | The whole provider layer (and `decisions.py`, the decision-model door): vocabulary (`providers.py`), the `AIProvider`/`AIModel` registry, the handler calling convention + registry (`handlers/base.py`, `handlers/registry.py` — the `nodes` app was deleted 2026-08-19 and its two load-bearing files moved here), the five provider handlers (`handlers/llm_providers.py`, `handlers/llm_nodes.py`, `handlers/openai_compatible.py`, `handlers/llm_base.py`), and the access funnel `access.py` (was `chat/turn/llm.py`), plus `context.py` — `ExecutionContext`, what a handler is handed besides its config (was `compiler/schemas.py`; that app held nothing else and was deleted 2026-08-24). Serves `/api/llm/models/` |
| `eval/` | Evaluation of sub-agents: suites, cases, graders, sweeps, and the human review of what the graders decided. `graders.py` is a registry (registration *is* the schema, as in `chat/tools/`); `runner.py` sweeps a suite through the same `run_agent` door as every other run; `supervision.py` owns the review policy and is the single place a run's score is computed. **`eval/api.py` is the public surface other apps import** — pure grading (`grade_answer`, `grade_execution` scores an `ExecutionLog` that already ran), sweeps (`run_suite_now` awaited / `start_suite_run` detached), supervision and the reads. Nothing in `eval/` imports a sibling app at module scope, so no cycle is possible, and `eval/__init__.py` stays empty because `INSTALLED_APPS` imports the package before the app registry is ready. **App label is `eval`, singular** — a deleted `evals` app left inert `evals_*` tables in dev databases. See `Backend/docs/EVALUATION.md`. **The practical benchmark is `eval/benchmarks/`** — suites as code (capability + guardrail groups), installed into an account through `AgentSerializer` and run with `manage.py benchmark run --user <email>`, writing a scorecard to `eval/benchmarks/reports/`; guardrail suites have a 100% bar because they test our code, not the model. Start at its `README.md`. The **work tier** (2026-09-17) is the harder half: each case starts from a folder of messy fixtures reset before every attempt (`eval/workspace.py`), is graded on the files it produced (`file_*`, `json_value`, `csv_value` graders) rather than on its prose, and is run 3 times so the scorecard reports pass@1 *and* pass^k — a case that works twice in three runs is not a feature. Expected values are computed by a reference solution over the same fixture text, and a test fails if a case cannot be passed with ideal outputs or *can* be passed with the untouched fixtures |

**Tests live in a `tests/` package per app** — `<app>/tests/test_<topic>.py`, never a flat
`<app>/tests.py` or `<app>/tests_<topic>.py` beside the source. Both runners discover them
(`pytest`, and `manage.py test <app>.tests`). Because the file sits one level down, import
the app's own modules absolutely (`from chat.models import ...`), not relatively. Frontend
tests use the sibling convention `src/<dir>/__tests__/<name>.test.ts`.

### App naming: package vs. label

`agents/` is the Django app whose **label is `orchestrator`** (pinned in
`agents/apps.py`). The package was renamed when the product shifted from the
workflow canvas to agents; the label was not, because every table in it is
`orchestrator_*`, and five other apps' migrations (`eval`, `llm`, `logs`,
`missions`, `notifications`) point at `orchestrator.*` models — 15 of them
depend on `('orchestrator', ...)`. So:

- **Python imports** use `agents.` — `from agents.models import SubAgent`
- **Label-shaped strings** stay `orchestrator` — `to='orchestrator.subagent'`,
  migration `dependencies`, `manage.py showmigrations orchestrator`,
  `reverse('orchestrator:agent_list')`
- **The HTTP surface** stays `/api/orchestrator/...` — renaming it would break
  the frontend and the mobile app for no gain

Renaming the label is a separate, database-shaped change (`django_migrations`
and `django_content_type` rows, plus a deploy window); it is not implied by the
package name.

### AI provider layer

`llm/` owns the whole provider layer. The vocabulary (`llm/providers.py` —
`SUPPORTED_PROVIDERS`, `RETIRED_PROVIDERS`, `PROVIDER_LABELS`,
`provider_choices`) and the `AIProvider` / `AIModel` registry live in the
`nodes_aiprovider` / `nodes_aimodel` tables (historical names, pinned; the
`nodes` app that birthed them was deleted 2026-08-19). The model picker reads
`/api/llm/models/` (the old `/api/nodes/models/` alias is gone). The LLM *handlers* live in `llm/handlers/` —
`base.py` (`BaseNodeHandler`, the calling convention) and `registry.py`
(`ProviderRegistry`, `get_registry()`, on the agent hot path) moved there from
`nodes/handlers/` when the `nodes` app was deleted; the five provider handlers
(`llm_providers.py` for OpenRouter/OpenAI/NVIDIA, `llm_nodes.py` for Ollama,
`responses_api.py` for the ChatGPT plan, `openai_compatible.py` for the shared
protocol, `llm_base.py` for the SSE / reasoning plumbing) register through that registry, and
`llm/access.py` (the moved `chat/turn/llm.py`) is the funnel every model call
resolves through: credential lookup, the platform-key fallback, context
clamping, `complete()` / `stream()`. `chatgpt` (a user's own ChatGPT plan) is
sign-in only and has no platform key by design: one person's plan must not
answer for another user. OpenCode Zen was removed 2026-10-11.

### Backend module layout notes

Apps are grouped by *mechanism*, and only where there was a genuine pile — an
app of six standard Django modules plus a domain file or two is left flat,
because foldering it makes it harder to read, not easier. Django's load-bearing
names (`apps.py`, `models.py`, `admin.py`, `serializers.py`, `urls.py`,
`views.py`) always stay at the app root.

- `chat/` — `turn/` (pipeline, agent, history, prompts, extraction, events,
  runs), `transport/` (sse, streaming_http), `sources/` (attachments, search),
  `guest/` (the unauthenticated surface), plus `tools/` and `vision/`.
  `tools/` also holds `permissions.py` and `tool_output.py`: both are about
  running a tool, not about chat in general.
- `chat/tools/` — one module per domain (`web`, `knowledge`, `conversation`,
  `agents`, `sandbox`, `artifacts`, `vision`, `internal`, `clock`). A tool is a
  single `@tool(schema)` declaration: registration *is* the schema, so an
  advertised tool is dispatchable because it is the same object. Availability is
  declared on the tool (`requires="memory" | "vision" | "spill"`), not matched by
  name in a distant filter. Adding a tool means editing one place; it used to
  mean three, ~1000 lines apart, with drift caught only by a test that scraped
  the dispatch function's source.
- `agents/` — `views/` (agents, builder, capabilities, gallery, hitl, responses, runs,
  triggers, wizard),
  `agent/` (runtime, stream, orchestrator). In `views/`,
  `urls.py` imports the submodules directly so
  the routing table names each route's owner; `agents.py` is there because it is
  entirely routed views; the one unauthenticated endpoint, the webhook
  receiver, lives in `triggers.py`. Two modules sit at the app root because other apps
  import them (2026-09-26): **`grants.py`** — the permissions vocabulary
  (`GRANT_TOOLS`, `ALWAYS_AVAILABLE`, `RETRIEVAL_TOOLS`, `UNSERVED_GRANTS`,
  `AUTONOMY_LADDER`, `CALLERS`, `UNATTENDED_CALLERS`, `CODE_COMMAND_CLASSES`),
  pure data read from 12 files in 6 apps, which used to mean importing the
  2,600-line runtime to read a table; the runtime re-imports it — and
  **`config.py`** — `AgentSerializer` and its closed sets (`TOOL_KEYS`,
  `FILE_ACCESS`, `AUTONOMY`...), the one save path, which lived in
  `views/agents.py` while seven non-view modules imported it (including
  `logs/revisions.py`, which had to defer the import to dodge a cycle through
  the views). `views/agents.py` is now the ~250 lines of routes around it.
- `core/` — `http/` (middleware, throttling, pagination), `auth/`
  (authentication, permissions), `realtime/` (channels_middleware, consumers),
  `safety/` (security, net). `core/http` classes are registered by dotted path
  in `settings/base.py`, so moving one means editing that string too.
- `llm/handlers/` — what survived the `nodes` app: `base.py` (the calling
  convention) and `registry.py` (the provider registry), both load-bearing on
  every agent turn (see the AI provider layer note). They moved here verbatim
  (trimmed) when the `nodes` app was deleted 2026-08-19; the rest of that app —
  the trigger package, core/logic/utility nodes, `subworkflow_node.py`,
  `langchain_nodes.py`, `integration_nodes.py`, `rest_base.py` and `connectors/`
  (the 17-node REST connector pack) — went with the runtime or was deleted
  because they were registered into a dict nothing read: the only callers of
  `get_handler` resolve a *provider slug*. Git holds them if a conversion ever
  wants them.
- `agents/gallery/` — the template catalogue, one module per pack (`office.py`,
  `coding.py`, ... plus `standalone.py`), each holding its prompts, its `TEMPLATES`
  and its `PACK` list; `__init__.py` joins them and keeps the public API
  (`TEMPLATES`, `PACKS`, `get`, `listing`, `pack_of`, `check_catalogue`). Split from a
  2,178-line `gallery.py` on 2026-09-24 with a parity check (same entries, same
  per-pack and standalone order — Explore lists a pack's members in dict order).
- `office/` (2026-09-26) — **not a Django app**: the document-format library
  (`deck`, `document`, `workbook`, `pdf`, `diagram`, `edit`, `spec`, `themes`,
  `charts` — the chart spec — `sheets` and `formulas`). It was
  `chat/tools/office/*` plus `inference/sheets.py`/`formulas.py` and the library
  half of `chat/tools/charts.py`, which made the file store import the chat tool
  folder to render its own files. Only the tools stay in chat
  (`chat/tools/office.py`, `chat/tools/charts.py`), and `office` may import
  nothing but `workflow_backend.thresholds` — an import contract enforces it.
  `inference/dashboards.py` (the dashboard spec validator, shared by the tool
  and the API) and `credentials/oauth.py::ALLOWED_REDIRECT_ORIGINS` moved the
  same day for the same reason: code other apps use does not live in a tool
  module or a view.
- `Backend/scripts/` — the one-off dev scripts (`seed_demo/runs/improve/notion_dev`,
  `check_imports`). `populate_models.py` and `populate_credentials.py` stay at the
  backend root because the Dockerfile, `llm/catalog_refresh.py` and
  `instance/scripts/setup.*` load them by name.
- Left flat on purpose: `credentials`, `mcp_integration`,
  `inference`, `notifications`, `imagine`, `logs`, `skills`, `tools_config`,
  `templates`, `streaming`, `eval`. Their module
  lists are already coherent and short. `eval` is the newest of these and the
  test of the rule: it is six standard Django modules plus four domain files
  (`graders`, `runner`, `supervision`, `queries`), each of which is one
  mechanism, so foldering it would put one file per directory.

(Historical note, kept because `conftest.py` still explains itself in these
terms: `executor/sample_inputs.py` was `test_generator.py`; the old name matched
pytest's `test_*` collection pattern, which is why `conftest.py` once carried a
`collect_ignore` entry for a module that is not a test. Both are now deleted.)

### Layers and import contracts (2026-09-26)

The apps form layers, lowest first: **foundation** (`workflow_backend`,
`core`, `credentials`, `sandbox`, `office`) → **providers and data**
(`llm`, `inference`, `logs`, `notifications`, `streaming`, `skills`,
`datasources`, `browsing`, `esign`, `voice`) → **product** (`chat`, `agents`,
`eval`, `missions`, `imagine`, plus the apps that serve product pages over
them: `tools_config`, `mcp_integration`, `messaging`, `workspaces`). A layer
may read a lower layer's **models**; it may not import the **agent runtime**
(`agents.agent`), the **chat engine** (`chat.turn`), the **tool library**
(`chat.tools`), `chat.commands`, `eval` or `missions` — and no app imports
another app's **views**.

`Backend/.importlinter` states this as four contracts and
`workflow_backend/tests/test_import_contracts.py` runs them, so CI fails on a
break and names the import (`lint-imports` from `Backend/` prints the full
report). Two choices make it workable here. **Only direct imports are
checked** (`allow_indirect_imports`): when this landed, 773 of 915 cross-app
imports were deferred into function bodies, so almost everything reaches
everything through some chain — a direct import is what a person writes and a
reviewer can refuse. **Tests are exempt**, since a test legitimately wires two
apps together. Every remaining exception is listed in the file *with its
reason*; the list should only shrink. The first pass fixed the violations that
were cheap to fix rather than listing them: the dead `enable_tools` path in
`llm/handlers` (the only reason `llm` imported `chat`), the office library, the
dashboard validator, the OAuth redirect allow-list, and `AgentSerializer`.

**What is still not fixed**, deliberately, because it is a larger move: the
agent loop (`chat/turn/`) and the tool library (`chat/tools/`) live inside the
`chat` app although `agents` runs on both, which is why `chat` and `agents`
import each other ~110 times (all deferred). The next step is to lift them into
their own packages so `chat` and `agents` both sit on top; the contracts above
are what will keep that honest once it lands.

### Frontend State (`better-n8n-frontend/src/`)

**Feature folders (2026-11-16).** Code only one feature uses lives in
`src/features/<name>/` (`chat` is the first; the rest still use `pages/` +
`components/<area>/`). Outside code imports a feature only through its
`index.ts` (`@/features/chat`) — `FEATURE_BOUNDARY` in `eslint.config.js`
fails a deeper import. Code two features use stays shared: AI-output renderers
are `components/content/` (`MarkdownMessage`, `ChartArtifact`, `MediaPreview`,
`QuestionCard`). Use `@/` for imports outside your own feature. Rules and the
migration list: `better-n8n-frontend/FRONTEND_STRUCTURE.md`.

- `features/chat/components/` — Chat interface with code execution tracking, live state management, responsive sidebar
- `pages/Connections.tsx` — the one page for external capability. It merged the former
  "Tools" (`/mcp-servers`) and "Data sources" (`/connectors`), which were two views of
  the same two tables; both paths now redirect to `/connections`. Raw MCP config lives
  behind its Advanced disclosure, and connector presentation comes from the backend
  (`icon_slug` → `lib/connectorIcons.ts`), never from a name-keyed map in this app
- `pages/OAuthCallback.tsx` — `/oauth/callback`, the credential OAuth popup landing page
  (distinct from `GoogleCallback`, which logs a user *in*)
- `components/mcp/` — the custom MCP server modal, used by the Connections Advanced section
- `components/pane/` (2026-11-17) — the side pane with tabs: `SidePane` (layout, resize, Escape,
  phone Back, per-conversation `sessionStorage` via `storageKey`), `PaneTabStrip` / `PaneTabMenu` /
  `PaneBody` (props only; only the active body is mounted). The tab rules are the pure reducer in
  `lib/paneTabs.ts`. `components/files/FilePreviewProvider.tsx` is a re-export of `SidePane`, kept
  so existing imports work
- `api/client.ts` — Axios instance with the JWT refresh interceptor; `api/sse.ts` — the single
  reader for `data:` streams (chat endpoints POST SSE, so `EventSource` can't be used)
- `lib/origins.ts` (2026-11-12) — where the app and its server live. `SITE_ORIGIN`/`siteUrl()`
  for anything that leaves the tab (share links, OAuth redirect URIs, webhooks); `API_ORIGIN`
  for REST, SSE and sockets. Both are same-origin unless a build sets `VITE_PUBLIC_SITE_URL` /
  `VITE_API_ORIGIN` (the mobile wrapper will); the web image sets neither, and a malformed value
  means same-origin, never a guess. Never build a link from `window.location.origin` directly
- `lib/oauthFlow.ts` (2026-11-12) — the one way to connect an account: `startOAuth` tries a
  popup and falls back to a full-page redirect when it is blocked (phones block popups opened
  after an `await`) or when running as an installed app; `/oauth/callback` reads the pending
  flow (validated, 15-minute TTL, `returnTo` through `safeNext`) and either reports to the
  opener or toasts and navigates back
- `lib/websocket.ts` — `useSocket`, the one WebSocket primitive. Every real-time feature goes
  through it; it owns URL resolution, exponential backoff, and the remount race guard
- `features/chat/hooks/useChatStream.ts` — reducer for one streamed assistant turn; sibling hooks
  (`useMessagePanels`, `useMessageSelection`, `useChatModelSelection`) carry the rest of
  `StandaloneChat`'s state
- `features/chat/components/StandaloneChat.tsx` owns the chat page's state and handlers; the
  drawing is split into props-only pieces (2026-09-24): `ChatHistorySidebar`,
  `ChatHeader`, `ChatSettingsDialog`, `ChatMessageItem` (one saved message),
  `ToolApprovalCard`, with shared text helpers in `format.ts`. They hold no hooks and
  never call the API — every action is a callback — and
  `features/chat/components/__tests__/chatPieces.test.tsx` pins the arguments each callback
  receives. The live-turn view and the composer are still inline and are the next
  candidates
- `lib/commands.ts` — slash-command parsing, palette ranking, chip serialisation
  (pure, vitest-covered); `api/commands.ts` + `api/missions.ts` — command
  catalogue/completion/action transport and the mission routes P7 left out;
  `features/chat/hooks/useCommands.ts` — one catalogue per session; `features/chat/components/`
  `CommandPalette.tsx` (leading-`/` palette, 44px rows, sheet on phones) +
  `CommandCard.tsx` (mission, status, cost, memory, findings, confirm sheets)

---

## Core rules

The invariants every change must keep. The reasons behind each live in
`DESIGN_HISTORY.md` (next section); search there before changing the code a
rule names.

- **One door per mechanism.** Every run starts at `agents/agent/runtime.py::start_agent_run` /
  `run_agent` (callers differ in config, never in code path). Every model call goes
  through `llm/access.py`; decision models through `llm/decisions.py`. Every agent save
  goes through `agents/config.py::AgentSerializer` (builder, templates, `create_agent`).
  Credentials resolve through `credentials/manager.py::CredentialManager`.
- **Detached work uses `workflow_backend.background.spawn()`**, never bare
  `asyncio.create_task` / `ensure_future`.
- **A tool is one `@tool(schema)` declaration** in `chat/tools/<domain>.py`, declaring
  `effect` (`read | reversible | irreversible`, default irreversible), and `parallel`,
  `sensitive`, `requires` where they apply.
- **Reach is checked at both doors**: what the toolbox *offers*
  (`AgentToolbox.descriptors`, `get_available_tools`) and what dispatch *accepts*
  (`AgentToolbox.dispatch`, `execute_tool`). Grant = whether, scope = which. Older scopes
  treat empty as unrestricted; `browserDomains` treats empty as read-only.
- **Chat is the orchestrator and holds only read tools** plus `CHAT_ORCHESTRATOR_EXTRA`
  (`chat/tools/__init__.py`). Never add a write/send tool there; give it a grant instead.
  Chat's check lives in `execute_chat_tool`, never in `execute_tool`.
- **The system prompt is session-stable.** Anything that changes per turn (clock, mode,
  pace, plan) rides a trailing system message (`prompts.build_context_update`).
- **Approval is settled before anything is dispatched** (`interrupt()` re-runs the node).
- **Third-party text reaches the model inside `<untrusted_data>` (`provenance.wrap_untrusted`); a tool whose output is only ours declares `trusted_output=True`.**
- **Fail before you look busy.** Preflight before the first status frame; account errors
  raise (`LLMUserActionable`), other provider failures go through
  `llm.explain_provider_failure()`.
- **Model-written input is refused, never truncated, when over a cap**; oversized tool
  output is spilled to `ToolOutput` and named by id, never silently cut.
- **No unbounded lists.** DRF pagination does not reach `@api_view` functions: set a cap
  and say `truncated` in the body.
- **Unknown and foreign ids get the same 404.** Folders resolve through
  `inference/filesystem.py::resolve_folder`; agent file paths are walked
  (`inference/vfs.py`), never matched against a column; solutions are read only through
  `solutions/access.py::visible`; shared KBs through `inference/kb_access.py`.
- **Trash is `deleted_at`** with `LiveManager` as the default manager; never set
  `base_manager_name`.
- **Periodic jobs**: an entry in `CELERY_BEAT_SCHEDULE` must also be in
  `agents/scheduler.py::PERIODIC_JOBS` or `NOT_IN_PROCESS` (a test fails otherwise).
- **Pinned twins change together**: the cron wording (`lib/cron.ts` ↔
  `agents/triggers.py`), the effort ladder, the shipped default model in three places,
  and the model-id table below ↔ its test.
- **Layers**: `Backend/.importlinter` contracts must pass; `office/` imports nothing but
  `workflow_backend.thresholds`.
- **Frontend**: only `src/api/` calls the backend; `useSocket` is the only WebSocket
  primitive; URLs come from `lib/origins.ts`; redirects pass `lib/nextPath.ts::safeNext`;
  feature code lives in `src/features/<name>/` behind its `index.ts`.
- **Test hazards**: `cache.clear()` in `setUp` where credentials or the vision witness
  resolve (ids restart per test DB); `CredentialType` rows exist after migrate, so use
  `update_or_create`.
- **Tests script the model at the wire** (`llm/testing.py`) or replay a provider
  recording (`llm/recorded.py`); never patch `llm.access.stream`/`complete` or a judge
  (`llm/tests/test_no_model_fakes.py` fails). Time moves by `workflow_backend/testclock.py`,
  never by sleeping. Outbound HTTP goes through `workflow_backend.httpclient.shared_client`,
  the seam both kits use. CI is `.github/workflows/` at the repo root (H-169).
- **Paid runs** (benchmarks, calibration, eval proof runs) need the user's go-ahead.

---

## Design history — search it, don't load it

`DESIGN_HISTORY.md` (repo root) holds ~150 entries: every design decision, bug
post-mortem and trade-off behind the code, moved out of this file word for word
on 2026-11-16. It is ~250 KB, so **never read it whole**. Search it when the
task needs the *why*:

1. **Before changing a file**, grep for its path or module name. Each entry's
   `Files:` line lists every path it mentions:
   `grep -n "chat/turn/steering" DESIGN_HISTORY.md`
2. **To find a topic**, list the titles (one line each) and pick:
   `grep -n "^## H-" DESIGN_HISTORY.md`
   or grep a keyword (`grep -n -i "spend cap" DESIGN_HISTORY.md`).
3. **Read only the matching entries**: open the file at the line grep gave,
   reading until the next `## H-` heading.

Read the history first when you are about to: remove a check that looks
redundant, change a default, add a tool or a grant, touch approvals, scopes,
spend, credentials, the scheduler, curation or the model catalogue. Most rules
above exist because the obvious version shipped and broke.

Entries describe the code **as of their date**. If an entry names a file or
function, check it still exists. When you make a decision worth keeping, add a
new entry at the end (`## H-NNN · title`, `Files:` line, then the text), and add
a rule above only if it must always hold.

## Environment Variables

Copy `Backend/.env.local` (or `Backend/.env.example`) to `Backend/.env`. Critical vars:

```
SECRET_KEY=                        # Django secret key
CREDENTIAL_ENCRYPTION_KEY=         # AES key for stored credentials (required)
DEBUG=True
REDIS_URL=redis://redis:6379/0     # Required for Celery + Django Channels
RUN_WORKFLOWS_ASYNC=False          # Set True in production
DB_ENGINE=sqlite                   # or postgres
DATABASE_URL=                      # PostgreSQL DSN (overrides DB_* vars)
GOOGLE_OAUTH_CLIENT_ID/SECRET=     # For OAuth/social login (allauth)
HITL_REMINDER_SWEEP_SECONDS=300    # Celery beat interval for the HITL reminder sweep
HITL_DIGEST_DEFAULT_TIME=09:00     # Default local time for the daily HITL digest
RECYCLE_BIN_RETENTION_DAYS=30      # How long a trashed file stays restorable
RECYCLE_SWEEP_SECONDS=3600         # Beat interval for the recycle-bin purge
STORAGE_QUOTA_FREE_MB=1024         # Storage per free account (files + trash + versions + attachments); 0 = no quota
STORAGE_QUOTA_PRO_MB=10240         # Same, pro tier (STORAGE_QUOTA_ENTERPRISE_MB for enterprise)
MAX_DOCUMENTS_PER_USER=10000       # Files per account, trash included
INDEXING_CONCURRENCY=2             # Documents extracted + embedded at once (inference/indexing.py)
NOTIFICATIONS_EMAIL_ENABLED=False  # Digest email only; nudges are always device-only
VAPID_PUBLIC_KEY=                  # Web Push public key (GET /api/notifications/push/vapid-key/); blank = closed-browser push off
VAPID_PRIVATE_KEY=                 # Web Push private key — never leaves the server (`manage.py generate_vapid_keys`)
VAPID_SUBJECT=mailto:no-reply@aiaas.local  # VAPID contact claim
EXPO_PUSH_ENABLED=True             # Native phone push (React Native app) via the Expo Push Service; settings/test.py forces False
EXPO_ACCESS_TOKEN=                 # Optional Expo access token, sent as Bearer when set
LLM_INPUT_TOKEN_CEILING=0          # Optional cap on one request's input tokens; 0 = the model's own window (curation starts at 70% of it)
OPENROUTER_API_KEY=                 # Platform key for the DEFAULT provider — required
CONTEXT_SUMMARY_PROVIDER=nvidia     # Provider for the context fold (platform key)
CONTEXT_SUMMARY_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b  # Agent's summaryModel overrides
EVAL_JUDGE_PROVIDER=openrouter      # Default provider for the llm_judge grader
EVAL_JUDGE_MODEL=meta/muse-spark-1.3-contributor  # Judge for llm_judge; see "Model IDs" below
AUTO_REVIEWER_PROVIDER=openrouter   # Chat `auto` judge; must be fast + non-reasoning
AUTO_REVIEWER_MODEL=meta-llama/llama-4-scout  # Blank = the chat's own model
AUTO_REVIEWER_TIMEOUT_S=3           # Over this, the call asks
CHATGPT_PLAN_ENABLED=False         # Continue with ChatGPT; True in settings/local.py, False in deployment (a hosted site needs OpenAI's approval)
CHATGPT_AGENT_NAME=AIAAS           # Our name on OpenAI's consent screen; keep it stable
CHATGPT_REDIRECT_URI=              # Blank = http://127.0.0.1:<this server's port>/auth/callback
MCP_MEMORY_BUDGET_MB=150           # Total resident MB for all MCP connectors; 0 disables
MCP_MAX_CONCURRENT_STARTS=1        # Connectors that may be starting at once
MCP_MAX_POOLED_SESSIONS=6          # Live sessions kept (cache policy under the budget)
MCP_SESSION_TTL=300                # How long an idle connector holds its subprocess
MCP_ALLOW_STDIO=True               # Local-process MCP servers; deployment defaults False (no Node in image)
SESSION_NOTES_ENABLED=True         # Per-conversation notes file, updated after every chat turn
SESSION_NOTES_PROVIDER=            # Blank = CONTEXT_SUMMARY_PROVIDER (platform key)
SESSION_NOTES_MODEL=               # Blank = CONTEXT_SUMMARY_MODEL
SESSION_NOTES_DAILY_CAP=300        # Notes model calls per user per day; past it the index is kept without prose
SOLUTION_CAPTURE_ENABLED=True      # Auto-save solved problems (thumbs-up / "that worked")
SOLUTION_CAPTURE_PROVIDER=         # Blank = CONTEXT_SUMMARY_PROVIDER (platform key)
SOLUTION_CAPTURE_MODEL=            # Blank = CONTEXT_SUMMARY_MODEL
SOLUTION_CAPTURE_DAILY_CAP=30      # Captures (one cheap-model call each) per user per day; 0 = off
SOLUTION_IMPORT_DAILY_CAP=5        # Documents imported as draft solutions per user per day
SOLUTION_STALE_SWEEP_SECONDS=604800  # Weekly "may be out of date" nudge + search-log purge
RUN_DETAIL_RETENTION_DAYS=180      # Finished runs lose reasoning + tool payloads after this (record kept)
BROWSER_FRAME_TTL_SECONDS=3600     # How long the last browser picture stays viewable, owner only (browsing/frames.py)
OUTBOUND_DAILY_CAP=100             # Messages an account's agents may send per 24 h, all channels
OUTBOUND_AI_DISCLOSURE=unattended  # AI line on sent messages: unattended | always | never
CONTENT_MODERATION_MODEL=openai/gpt-oss-safeguard-20b  # Model check on image prompts + pages; blank = off
CONTENT_MODERATION_TIMEOUT_S=4     # Over this, the check passes (patterns already ran)
MISSION_SWEEP_SECONDS=120          # Mission sweep interval (in-process scheduler)
STT_ENGINE=openrouter              # Chat mic + transcribe_audio; `none` = off (voice/stt.py)
STT_MODEL=openai/whisper-large-v3-turbo  # OpenRouter STT model, ~$0.012/hour of audio
DECISION_PROVIDER=openrouter       # Platform default for the `decide` tool; users pick provider+model in Settings (llm/decisions.py)
DECISION_MODEL=~typesafe/jev-latest  # Router alias, survives releases being retired
TTS_ENGINE=openrouter              # text_to_speech + /api/chat/speak/ on the platform key; `none` = off (voice/tts.py). Model/voice are per-user (UserProfile.tts_model/tts_voice via voice.tts.resolve_voice()), not env vars
SENTRY_DSN=                        # Error reporting for web + worker; blank = off (workflow_backend/observability.py)
SENTRY_TRACES_SAMPLE_RATE=0        # Performance tracing; off by default on the small box
BACKUP_S3_BUCKET=                  # manage.py backup_db uploads here when set; BACKUP_DIR / BACKUP_KEEP for local copies
ALLOWED_HOSTS=*                    # Frontend and API hosts
TRUSTED_PROXY_COUNT=               # Reverse proxies we run in front of Django (DRF NUM_PROXIES); deployment defaults 2 (Caddy, nginx). Throttles + audit IPs read the client address through it (core/http/client_ip.py)
CORS_ALLOWED_ORIGINS=              # Frontend CORS origins for WebSocket connections
```

### Model IDs — use these exact strings, never a near-miss

**DeepSeek is `deepseek/deepseek-v4.1-flash` (V4.1 Flash).** Not
`deepseek/deepseek-v4-flash`, which is V4 and **retired** (its catalogue row is
inactive, and OpenRouter only routes it onward to V4.1). The two ids differ by
two characters and both still appear on OpenRouter's model list, so "it exists
on OpenRouter" does **not** make an id right. When the user says "DeepSeek",
"DeepSeek flash" or "v4.1 flash", they mean `deepseek/deepseek-v4.1-flash`.
Verified answering on user 1's OpenRouter credential 2026-09-17.

**Muse Spark is `meta/muse-spark-1.3-contributor`** ("Meta Muse Spark 1.3
Contributor"). Not `meta/muse-spark-1.3` and not the `1.2` variants, which all
exist too. It is a **reasoning model**: it spends ~270 hidden tokens even on a
trivial reply and returns an *empty* string when `max_tokens` runs out first,
so never give it a small token cap (`eval/graders.py::JUDGE_MAX_TOKENS`).

**`openai/gpt-4.1` is retired. Do not use it** (no row in `nodes_aimodel`).

| Role | Provider | Model id | Set in |
|---|---|---|---|
| Eval judge (the `llm_judge` grader) | `openrouter` | `meta/muse-spark-1.3-contributor` | `EVAL_JUDGE_MODEL`, `settings/base.py` |
| Benchmark agents under test | `openrouter` | `deepseek/deepseek-v4.1-flash` | `eval/benchmarks/agents.py::BENCHMARK_MODEL` |
| Chat `auto` reviewer | `openrouter` | `meta-llama/llama-4-scout` | `AUTO_REVIEWER_MODEL`, `settings/base.py` |

The two are **deliberately different models** (the user's decision,
2026-09-17): a judge grading its own model's answers cannot tell a bad rubric
from a bad answer. `eval/tests/test_benchmarks.py::
test_the_shipped_models_are_the_ones_claude_md_names` pins both ids to this
table and fails if they are ever made equal, so change this table and that test
together.

Before writing any model id into code, settings, docs or a command: check it
against this table, and if it isn't here, look it up in `nodes_aimodel`
(`AIModel.objects.filter(value__icontains=...)`) and prefer the row with
`is_active=True`. Never type a model id from memory.

## Internal Documentation

**Beginner docs (2026-09-24).** `START_HERE.md` (repo root) is the plain-language
tour: what the product is, how a chat message and an agent run travel, a map of
every app, and step-by-steps for common jobs. Every backend app has a `README.md`
(file-by-file, in reading order), `Backend/docs/README.md` sorts the docs below
into *reference* / *built plans* / *open plans* / *history*, and
`better-n8n-frontend/BEGINNER_GUIDE.md` is the frontend tour. Keep them in step
when you move or add a file: a guide naming a file that no longer exists is worse
than no guide. Write them in short sentences and plain words; the design history
belongs in `DESIGN_HISTORY.md`, not in them.

Detailed technical docs live in `Backend/docs/`:
- `API.md` — **Endpoint map / code-review index**: every HTTP route with its Django app,
  purpose, access, complexity, test coverage, serializer, DB tables, atomicity, and gotchas.
 **Keep this current** — whenever you add, remove, or change a route (any `urls.py`),
  its permission, or its serializer, update the matching row in `Backend/docs/API.md` in
  the same change. It is the first stop for reviewing the backend surface.
- `CHAT_AGENT.md` — Tool-loop architecture for the chat agent with Python sandbox execution
- `RAG_STRATEGY.md` — Hierarchical RAG design decisions for knowledge base
- `SANDBOX_EXECUTION.md` — The `execute_python` sandbox: the hardened sidecar container, its layered isolation, and the in-process dev fallback
- `MCP_ARCHITECTURE.md` — MCP client design with credential injection and tool caching
- `SAFETY_AND_GUARDRAILS.md` — **Every AI guardrail in one place** (reach, approvals,
  injection, containment, limits, content and legal duties), mapped to OWASP Agentic
  Top 10 and to Indian/EU law, with the open gaps. Update it when a guardrail changes
- `NOTIFICATION_SERVICE.md` — Notification delivery and HITL reminders
- `OPEN_WORK.md` — Every open item across all plans, in one list
- `CONTEXT_LIFECYCLE.md` — How a long agent run stays inside its context window: the
  segment rule, the watermark, and the three builder toggles that drive it
- `TESTING.md` — How tests are written: the scripted model, recorded provider HTTP, the frozen clock, and what is still not real
- `EVALUATION.md` — Sub-agent evaluation: the grader registry, the sweep runner, and the supervision model (who checks the checker, and how agreement is measured)
- `EVALUATION_PRODUCTION_PLAN.md` — The plan (implemented 2026-09-19; paid runs still need the user's go-ahead) to make eval production-grade: trustworthy numbers + a deploy gate, feedback capture for future traffic, and external benchmarks (IFEval, GAIA, DABstep, …) including the "platform tax" comparison against the bare model
- `EVAL_ENVIRONMENTS_PLAN.md` — The plan (proposed 2026-09-24; E-1–E-5 built 2026-09-24, E-6 paid proof runs still need the user's go-ahead) for judge-generated test worlds: an `EvalWorld` per suite (planted facts + fixtures across files, KB, mailbox, calendar, drive, a frozen web), simulators behind `AgentToolbox.dispatch` so an eval never touches the owner's real data or real services, expected answers set by the judge only and re-derived blind, and chat tools that only ever make drafts
- `PLATFORM_CAPABILITIES_PLAN.md` — The plan (P0–P10 built 2026-09-21; P0+P3 committed, the rest in the working tree; the `/code` page is still not built — `/missions` landed with the gap-closure pass and `/dashboards` already existed) for messaging (Slack/WhatsApp/Teams/SMS), SQL + generic API caller, browser sessions and vault logins, a per-user compute plane, the Code tab (serves the `shell` grant), long-horizon missions, dashboards, auto mode, voice/OCR/e-sign, and slash commands (§18, P10). Payments deliberately out
- `CODING_AGENTS_PLAN.md` — The plan (built 2026-09-22) for a coding subagent roster (scout, architect, implementer, test-writer, debugger, reviewer, integrator + a coding lead), `writePaths`/`commandScope` scopes, file leases with a stale-write guard, change notices through the steering mailbox, detached `start_tasks`/`wait_tasks`/`steer_task`/`stop_task` dispatch, and an OpenCode-style side plan panel
- `IMAGINE.md` — OpenRouter-backed image/video/audio generation; per-user credential vault lookup, endpoint reference, and video polling state machine
- `CONCURRENCY_LAG_FIX_PLAN.md` — The plan (proposed 2026-09-24; Phases 0–5 built 2026-09-24, Phase 5 as the t3.small option — needs the instance resize to take effect; Phase 6 conditional on measurements) for the "lags with several runs, even one user" problem: DB connections held across model calls (pool of 10), the SQLite checkpointer's global lock + full-state serialise on the event loop, per-run/global single-thread `sync_to_async`, memory overcommit on the 913 MB box; Phase 0 measures first
- `GAP_CLOSURE_PLAN.md` — The plan (proposed 2026-09-24, implemented 2026-09-24) from a codebase-wide gap sweep: digest-only email default, pack availability in Explore, the order-dependent test failures, lint back to zero, Memory and Missions UI, and CLAUDE.md drift
- `SECURITY_REVIEW_FIX_PLAN.md` — The whole-project security review of 2026-09-25 and its fixes (implemented, undeployed): Google sign-in no longer links into an unverified password account (pre-account takeover), `UserProfile.tokens_valid_after` revokes every JWT on password/email change (`core/auth/revocation.py`, checked by REST, refresh and WebSocket), `token_blacklist` actually installed, no `?token=` HTTP auth, API keys stored as SHA-256, the workspace job hook scoped to its owner and detached, `CSP: sandbox` on file responses. Learning: `learning/15_whole_project_security_review.md`
- `MOBILE_APP_PLAN.md` — The mobile app plan. Changed 2026-11-12 from a Capacitor wrapper to a separate **React Native (Expo) app in `mobile-native/`**: Chat, Inbox, Agents and Settings tabs built, typechecked and bundled, not yet run on a device; Google sign-in and native push (FCM behind the existing `send_web_push` door) still to do. The superseded Capacitor reasoning is kept in the same file
- `PREVIEW_PANE_AND_BROWSER_PLAN.md` — The plan (built 2026-11-17, undeployed; checked by hand locally without a real browser engine) for an OpenCode-style tabbed side pane on phone and desktop (every current preview kept), showing the agent's remote browser (frames, steps, live view, take-over) and better browser control (element list with selectors, new step actions, phone viewport). Written phase by phase for smaller models; its Progress table records what was built and decided. Open: Phase 6's paid proof run, and prod's `BROWSER_ENGINE` (with `none` every browser feature stays hidden)
- `ORG_KNOWLEDGE_PLAN.md` — The plan (K0–K7 built 2026-11-11, undeployed, not yet checked in a browser) that made solution memory a team product: invitations, drafts and curators, citations in chat, import, stale nudges, insights, KBs shared read-only with an org, org choice per chat and per scheduled agent
- `SOLUTION_MEMORY_PLAN.md` — The plan (S0–S4 built 2026-09-28, undeployed; S5 benchmark not built) for org-scoped solution memory: solved problems captured automatically as structured records, found again with `search_solutions`, each claim labelled by how fast it goes stale and re-verified or flagged before it is stated. Adds an `Organization` model (reversing the 2026-08-14 "no org context" decision); the rule is that nothing leaves the org it was captured in (§3a)
- `PROMPT_AND_MEMORY_PLAN.md` — The plan (built 2026-09-28) fixing the chat and agent system prompts (chart/mode/`can_ask` wording, an untrusted-content rule, dates, notes for repeating agents), user memory's prompt selection (categories were cut alphabetically), and the chat double-send of earlier turns (checkpoint + DB history), which Phase 0 proved with a test before the fix
- `CHATGPT_PLAN_PROVIDER_PLAN.md` — The plan (built 2026-10-11; **not yet run against a real ChatGPT account** — `scripts/chatgpt_plan_spike.py` is Phase 0 and §10 is still empty) that removed OpenCode Zen and added a `chatgpt` provider through OpenAI's official Sign in with ChatGPT flow (Responses API, loopback redirect, rotating refresh tokens). Self-hosted installs only until OpenAI approves the hosted site

## Frontend-Specific Docs

- `better-n8n-frontend/docs/concept-v3.html` — the "work home" UI concept
- `better-n8n-frontend/BEGINNER_GUIDE.md` — onboarding: every page, the folder layout, the
  data-fetching pattern to copy
