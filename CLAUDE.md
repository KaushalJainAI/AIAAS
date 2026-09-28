# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AIAAS (Agentic AI Automation System) is a full-stack AI workflow automation
platform. Two sub-systems are current and one is parked; a task that does not
name BrowserOS means the Backend and `better-n8n-frontend/` alone.

- **better-n8n-frontend/** — React/Vite visual workflow editor (n8n-inspired) with chat, KB, and MCP UI
- **Backend/** — Django ASGI backend with LangGraph execution engine and social auth
- **BrowserOS/** — **PARKED (2026-09-04). Do not build features here.** A desktop
  environment with workspace and notification system, and the third sub-system by
  name only: the product is the backend plus `better-n8n-frontend/`, and every
  capability shipped this cycle — the plan, charts, steering, user memory, the
  virtual filesystem — was surfaced in the web frontend and **not** mirrored here.
  It is kept because it still builds and still talks to the backend, not because
  it is current.

  What that means in practice. **Treat it as read-only unless a task names it**:
  a change here is a second UI to keep in step with a backend that is moving
  weekly, and the drift is already real — it ships its own build, which is the
  whole reason `/api/nodes/models/` survives as a legacy alias of
  `/api/llm/models/`. **Do not count it when deciding whether a feature is
  finished**: "wired to the UI" means the web frontend. And when a backend change
  would break it, prefer the compatibility alias over the edit, exactly as that
  alias already does.

  State as last verified (2026-09-02): `src/api/chat.ts` streams from the correct
  `/api/chat/sessions/<id>/message/stream/` and uses `/api/chat/execute-tool/`;
  `hooks/useAIModels.ts` uses `/api/llm/models/`. One call site is intentionally
  dead: `BuddyPanel.tsx` and `ChatbotApp.tsx` POST `/api/buddy/commands/`, and the
  `buddy` backend app was removed 2026-09-02, so those calls 404. Known gaps it
  has *not* caught up on: no todo panel, no chart renderer, no steering, no file
  browser over `inference/vfs.py`. That last one is the interesting future piece
  — a Files app over the same tree is what would make the "virtual computer"
  literal — but it is deliberately not scheduled.

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

### BrowserOS (`BrowserOS/`) — parked
Builds and runs, and is not where features go. Kept for the day it is picked
back up; see the Project Overview before changing anything here.
```bash
npm install
npm run dev          # Dev server with desktop environment
npm run build        # TypeScript check + Vite bundle
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

The core loop: **Frontend → REST API → Compiler → LangGraph Executor → WebSocket stream back**

1. A workflow exists as JSON (nodes + edges) on a `Workflow` row — authored in the agent builder, seeded from a template, or generated
2. Runs start from exactly one place: `POST /api/orchestrator/agents/{id}/execute/` (202 + `execution_id`, run detached via `background.spawn()`). **There is no `workflows/{id}/execute/` route, no public webhook receiver, and no schedule/trigger runtime** — all three were retired with the DAG product; agents run on demand
3. `agents/agent/runtime.py` runs the agent turn loop, resolving each model through `llm.handlers.registry` and each tool through `chat/tools/` (gated by `GRANT_TOOLS`). **The ReactFlow→LangGraph compiler and the King supervisor are gone** — an agent is not a compiled graph
5. Execution events are broadcast in real-time via Django Channels WebSocket consumers (`streaming/consumers.py`)
6. MCP integration enables credential-injected tool access with caching and validation

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
| `logs/` | Agent observability: `ExecutionLog` (run) → `AgentTurn` (model call, with its full reasoning) → `AgentStep` (tool call), plus `SubAgentRevision` (the config a run executed under) and `logs/revisions.py`. Seven `/api/logs/` endpoints; views are thin and sync, all ORM in `logs/queries.py`. See `Backend/docs/AGENT_OBSERVABILITY.md`. (`NodeExecutionLog` was renamed to `AgentStep` 2026-08-19; `ExecutionLogger`, `AuditEntry` and `OrchestratorThought` are gone — all DAG-era with no writer) |
| `solutions/` | What an organisation has already solved, found again by the next person: `Solution` records (problem, symptoms, cause, fix, claims with how fast each goes stale), reviews (worked / failed / doubtful, with which model said so), and three small indexes (error signatures, keywords, float16 vectors). **One read door, `access.py::visible`**, checks org membership live; a choke-point test fails on any other `Solution.objects` read. Organisations themselves are `core.Organization`/`Membership` (`core/orgs.py`). See `Backend/docs/SOLUTION_MEMORY_PLAN.md` |
| `notifications/` | Persistent notifications + the HITL reminder engine (escalation ladder, hourly nudges, daily email digest) |
| `imagine/` | Media generation (image/video/audio) via OpenRouter; form + conversational agent with HITL |
| `llm/` | The whole provider layer: vocabulary (`providers.py`), the `AIProvider`/`AIModel` registry, the handler calling convention + registry (`handlers/base.py`, `handlers/registry.py` — the `nodes` app was deleted 2026-08-19 and its two load-bearing files moved here), the five provider handlers (`handlers/llm_providers.py`, `handlers/llm_nodes.py`, `handlers/openai_compatible.py`, `handlers/llm_base.py`), and the access funnel `access.py` (was `chat/turn/llm.py`), plus `context.py` — `ExecutionContext`, what a handler is handed besides its config (was `compiler/schemas.py`; that app held nothing else and was deleted 2026-08-24). Serves `/api/llm/models/` |
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
`orchestrator_*`, six other apps' migrations carry `to='orchestrator.workflow'`,
and 13 migrations depend on `('orchestrator', ...)`. So:

- **Python imports** use `agents.` — `from agents.models import Workflow`
- **Label-shaped strings** stay `orchestrator` — `to='orchestrator.Workflow'`,
  migration `dependencies`, `manage.py showmigrations orchestrator`,
  `reverse('orchestrator:agent_list')`
- **The HTTP surface** stays `/api/orchestrator/...` — renaming it would break
  the frontend and BrowserOS for no gain

Renaming the label is a separate, database-shaped change (`django_migrations`
and `django_content_type` rows, plus a deploy window); it is not implied by the
package name.

### AI provider layer

`llm/` owns the whole provider layer. The vocabulary (`llm/providers.py` —
`SUPPORTED_PROVIDERS`, `RETIRED_PROVIDERS`, `PROVIDER_LABELS`,
`provider_choices`) and the `AIProvider` / `AIModel` registry live in the
`nodes_aiprovider` / `nodes_aimodel` tables (historical names, pinned; the
`nodes` app that birthed them was deleted 2026-08-19). The model picker reads
`/api/llm/models/`; `/api/nodes/models/` is kept as a legacy alias because
BrowserOS ships its own build. The LLM *handlers* live in `llm/handlers/` —
`base.py` (`BaseNodeHandler`, the calling convention) and `registry.py`
(`ProviderRegistry`, `get_registry()`, on the agent hot path) moved there from
`nodes/handlers/` when the `nodes` app was deleted; the five provider handlers
(`llm_providers.py` for OpenRouter/OpenAI/NVIDIA/OpenCode Zen, `llm_nodes.py`
for Ollama, `openai_compatible.py` for the shared protocol, `llm_base.py` for
the SSE / reasoning plumbing) register through that registry, and
`llm/access.py` (the moved `chat/turn/llm.py`) is the funnel every model call
resolves through: credential lookup, the platform-key fallback, context
clamping, `complete()` / `stream()`. `opencode` (OpenCode Zen) is
bring-your-own-key only and has no platform key by design — Zen's ToS limits
a key to its holder's own use.

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
- `agents/` — `views/` (agents, runs, triggers, hitl, conversations, system),
  `agent/` (runtime, stream, orchestrator). In `views/`,
  `urls.py` imports the submodules directly so
  the routing table names each route's owner; `agents.py` is there because it is
  entirely routed views, and `webhooks.py` is separate because it is the one
  unauthenticated endpoint. Two modules sit at the app root because other apps
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

- `lib/nodeConfigs.ts` — Node type definitions and configurable properties
- `components/chat/` — Chat interface with code execution tracking, live state management, responsive sidebar
- `pages/Connections.tsx` — the one page for external capability. It merged the former
  "Tools" (`/mcp-servers`) and "Data sources" (`/connectors`), which were two views of
  the same two tables; both paths now redirect to `/connections`. Raw MCP config lives
  behind its Advanced disclosure, and connector presentation comes from the backend
  (`icon_slug` → `lib/connectorIcons.ts`), never from a name-keyed map in this app
- `pages/OAuthCallback.tsx` — `/oauth/callback`, the credential OAuth popup landing page
  (distinct from `GoogleCallback`, which logs a user *in*)
- `components/mcp/` — the custom MCP server modal, used by the Connections Advanced section
- `api/client.ts` — Axios instance with the JWT refresh interceptor; `api/sse.ts` — the single
  reader for `data:` streams (chat endpoints POST SSE, so `EventSource` can't be used)
- `lib/websocket.ts` — `useSocket`, the one WebSocket primitive. Every real-time feature goes
  through it; it owns URL resolution, exponential backoff, and the remount race guard
- `hooks/useChatStream.ts` — reducer for one streamed assistant turn; sibling hooks
  (`useMessagePanels`, `useMessageSelection`, `useChatModelSelection`) carry the rest of
  `StandaloneChat`'s state
- `components/chat/StandaloneChat.tsx` owns the chat page's state and handlers; the
  drawing is split into props-only pieces (2026-09-24): `ChatHistorySidebar`,
  `ChatHeader`, `ChatSettingsDialog`, `ChatMessageItem` (one saved message),
  `ToolApprovalCard`, with shared text helpers in `format.ts`. They hold no hooks and
  never call the API — every action is a callback — and
  `components/chat/__tests__/chatPieces.test.tsx` pins the arguments each callback
  receives. The live-turn view and the composer are still inline and are the next
  candidates
- `lib/commands.ts` — slash-command parsing, palette ranking, chip serialisation
  (pure, vitest-covered); `api/commands.ts` + `api/missions.ts` — command
  catalogue/completion/action transport and the mission routes P7 left out;
  `hooks/useCommands.ts` — one catalogue per session; `components/chat/`
  `CommandPalette.tsx` (leading-`/` palette, 44px rows, sheet on phones) +
  `CommandCard.tsx` (mission, status, cost, memory, findings, confirm sheets)

### BrowserOS (`BrowserOS/src/`)

**Parked — see the Project Overview.** The map below is accurate and is here so a
change that *has* to touch BrowserOS lands in the right file, not as an invitation
to build here.

- `os/apps.ts` — the app registry (metadata, geometry, search keywords); `os/` and
  `components/os/` — desktop shell and window management
- `components/apps/` — Individual desktop applications, lazily loaded via `WindowRenderer`
- `contexts/osState.ts` — context objects, published state slices, and the hooks that read
  them; `contexts/OSContext.tsx` — `OSProvider` only (keeping the component alone in its file
  is what lets fast refresh preserve the workspace across edits)
- `api/auth.ts` — the only place the backend auth scheme and token key are defined

---

## Key Architectural Patterns

**A subagent is a configuration, not a graph.** `SubAgent` (table
`orchestrator_subagent`) replaced `Workflow` as the unit: a prompt, a model, the
capabilities it is granted, and — the two fields that make configuration able to
replace code — `output_schema` (a *named* contract from `agents/contracts.py`,
closed registry, because the UI can only render shapes it has a panel for) and
`fanout`. There is deliberately **no `kind` column and no "orchestrator" kind**:
an agent that delegates is one holding the `subAgents` grant, so composition is
checked by the same mechanism as web search rather than by a second code path.
`Workflow` itself is gone: the model and its CRUD went with the DAG product,
and `templates/` survives only for its migrations.

**A template is a starting point, and it travels without ids.** The gallery
(`agents/gallery/`, `/templates`) is **code, not rows** — `templates/models.py`
already said why: an agent template is a `SubAgent` used as a starting point, so
a table would hold columns that already exist on the thing it installs into, and
a migration-seeded row would drift from the serializer that validates it. Each
entry carries a flat `AgentConfig`, which is what makes the install screen
honest: it renders the same `tools` / `guardrails` keys the serializer stores and
the runtime enforces, because there is only one copy of them, and a template the
builder would refuse fails a test rather than 400-ing the first installer.
Install writes through `AgentSerializer` like every other save — a second write
path is a second place to forget the ownership check, and here that check is the
whole reason a shared agent is safe to install. What a template asks for is a
**requirement**, never an id (`{key, type, label, why, optional}`): a config
naming knowledge base 2 would, installed elsewhere, not break — it would
silently read *someone else's* row 2. The API attaches the caller's own
candidates to each requirement, computed with the same predicate the serializer
validates against (`visible_servers_sync`), because a picker offering what the
validator would refuse is worse than an empty one; a `provider` hint reorders
that pool and never filters it, so a mailbox connection named something
unexpected stays choosable. Credentials never travel. Tests:
`agents/tests/test_gallery.py`.

**Publishing writes the requirements the author would not have.** A curated
template is code; a *published* agent is a `SharedAgent` row (2026-09-04),
because it carries what only exists once published — author, install count,
visibility, version. Both are listed and installed by the same code on
`/templates` (Explore), differing only in `source`. Four things carry it.
`agents/publishing.py::to_shareable` **strips every id and mints a requirement
in its place**, and **fails rather than drops** when one no longer resolves — a
dropped id is an agent arriving in a stranger's account missing the corpus it
was written around, answering from nothing and merely looking stupid. The
projection is an **allow-list** (`SHAREABLE_KEYS`), never `to_config()` minus a
few keys: a denylist publishes every field added to `AgentConfig` later, and
the first one carrying something private is a leak nobody wrote a line of code
to cause. A listing is a **snapshot, not a pointer** — rendering the author's
live agent would let them widen the grants of something already listed without
anyone re-consenting, which is also why `subagent` is `SET_NULL` and why
withdrawing **unlists rather than deletes**. And there are **three
visibilities**, the lesser ones being the point: `link` (by slug, still needs
an account) < `platform` (listed to signed-in users) < `public` (readable with
no account at `/a/<slug>`), defaulting to `platform` and never the widest — so
sharing with one colleague is not the same act as publishing to the open
internet. `public` is the app's **second unauthenticated surface** after the
webhook receiver and inherits its rules: every refusal is the same 404 (else it
enumerates what people published privately), the anonymous projection is a
*separate function* rather than the signed-in one with a flag (`candidates` and
`is_mine` are computed from a caller that does not exist there), and the
listing is capped because DRF pagination never reaches `@api_view` function
views. Installing stays authenticated. A visitor sent to sign in carries
`?next=`, guarded by `lib/nextPath.ts::safeNext`, which refuses anything that
is not a same-origin path — an open redirect on a sign-in screen is a
credential-phishing primitive. Requirement labels default to the source rows' own
names (which is a fact about the author's account), so the publish screen shows
every one editable before anything is written — nothing not on that screen
travels. Tests: `agents/tests/test_sharing.py`.

**One door.** Every run starts at `agents/agent/runtime.py::start_agent_run` /
`run_agent`, with a `caller` of `chat | orchestrator | trigger | api`. Callers
differ in configuration, never in code path — a second way to start a run is a
second place for the guardrail checks to be forgotten, which is how the DAG
product ended up with a supervisor, a task queue and a trigger manager that each
started work slightly differently. `caller in UNATTENDED_CALLERS` requires
`SubAgent.allow_unattended`, which is off on every row until someone turns it on.

**Delegation is bounded in three directions, and each compounds.** Depth
(`TurnContext.depth`, `MAX_DELEGATION_DEPTH`, plus workers get a *narrowed*
toolbox so they never inherit `subAgents`); budget (`divide_budget` reserves and
splits the spend cap up front, because `check_guardrails` is read-then-run and N
`gather`ed siblings all see the same "under the cap" answer); and result size
(per-worker cap then a proportional whole-fanout cap — trimming by arrival order
would make the answer depend on which provider replied first). Workers get
throwaway `thread_id`s: the checkpointer, not the `history` list, is what
actually holds a conversation. See `agents/agent/orchestrator.py`.

**Triggers are back, invocation-shaped.** `Trigger` rows carry `mode`
(`schedule | webhook | event`), an indexed `next_due_at`, and an overlap policy.
The sweep runs in-process via `agents/scheduler.py` under a DB lease
(`SchedulerLease`, started on the first HTTP request) — no crontab, no broker;
beat (`orchestrator.sweep_triggers`) and `manage.py run_due_triggers` remain as
alternatives, and the per-slot claim in `sweep.prepare` makes running several
of them at once safe (the second reports `busy`). Gating lives in
`sweep.prepare` (shared by all three callers); only waiting differs — the beat
path blocks via `start_agent_run_and_wait`, the loop and run-now start
detached. The old
node-shaped machinery is *not* back: no `TriggerState` cursors, no polling.
`/api/orchestrator/hooks/<secret>/` is the one unauthenticated route in the app;
it answers **404 for every refusal** so it cannot be used to probe which secrets
are live, and the inbound body is context, never the goal.

**The scheduler loop runs every periodic job, not just triggers (2026-09-26).**
`CELERY_BEAT_SCHEDULE` is the one list of periodic jobs, and production runs no
Celery — so there, a beat entry nothing else ran simply never happened. Run
recovery, the recycle-bin purge and checkpoint pruning ran nowhere (runs cut
off by a deploy read "running" for ever; the 30-day purge promise was not
kept), and the two notification sweeps ran from host cron as whole Django
processes *inside* the backend's 384 MB, which stacked and OOM-killed daphne
(the September restarts, and a 502 on sign-in). `agents/scheduler.py::
PERIODIC_JOBS` now runs each on its beat interval, read from the same settings,
under the same lease, each **detached** (`spawn`) so a slow purge never delays
schedules or lets the lease lapse, and **skipped while its last run is still
going**. `NOT_IN_PROCESS` names the two it does not run and why: the trigger
sweep (the loop itself) and the workspace sweep (its own event loop, no
engine). Missions joined the loop on 2026-09-28 — see "A mission is a chain
of detached runs". A test fails if
a beat entry is in neither table. The scheduled-reminder sweep became
**claim-then-send** in the same change (a conditional UPDATE per firing, handed
back if delivery fails), because during a rollout the old cron job and the new
loop sweep in the same minute; `test_two_sweeps_at_once_send_a_reminder_only_once`
pins it. Tests: `agents/tests/test_scheduler.py::PeriodicJobTests`,
`notifications/tests/test_scheduled_sweep.py`.

**A restart is ~11 s, not 44 (2026-09-26).** The image's `CMD` ran
`collectstatic --clear`, `migrate` and `populate_models` as three processes, each
importing Django again, on every start — crash restarts included — and ran
daphne under `sh -c` without `exec`, so `docker stop` waited out the 10 s grace
and killed it. Now static files are collected at **build** time, and one
`manage.py boot` (`core/management/commands/boot.py`) migrates and seeds the
catalogue **once per container** (a `/tmp` marker, so a deploy re-seeds and a
crash restart does not; `--force-seed` after restoring a database), then
`exec daphne`. Measured in the built image at 384 MB: stop 1.3 s (clean exit),
restart-to-listening 11.4 s; a production deploy (2026-09-26b) was ~20 s of API
downtime, down from ~55, on the box's slower CPU. Why each second matters and what a restart does to
streams, runs, the lease and cron: `learning/16_deploy_downtime_and_background_work.md`.
Tests: `core/tests/test_boot.py`.

**A schedule is read in its own timezone and stored in UTC (2026-08-29).** The
cron walker took no zone, so `0 9 * * *` fired at 09:00 UTC — 14:30 for the
owner — and `agents/triggers.py` said per-user zones were a separate feature.
They are now `Trigger.timezone`: `next_run_after(cron, after, tz)` walks local
wall-clock minutes and converts back, so the indexed column still means one
thing on every row while "every day at 9" means nine in the morning where the
user is. The two DST cases are decided rather than left to chance — the
spring-forward gap **skips** (inventing an instant for an 02:30 that does not
exist fires at an hour nobody asked for) and the autumn fold fires **once**, the
second occurrence filtered by the strictly-increasing check callers already
depend on. Four more things landed with it, each closing a way a schedule could
fail silently. **`overlap='queue'` now exists**: it was a choice the UI offered
and the sweep never implemented, so a queued firing fell straight through and
ran immediately — `queued_for` is where "later" is written down, with a 6h TTL
because a 09:00 report delivered at midnight is not the report anyone asked for.
**`starts_at`/`ends_at`**, so a schedule outside its window is *not live* rather
than broken. **`last_outcome`/`last_error`**, because the reason a firing was
refused existed only in a server log the owner cannot read, while they watched
it fail five times and disable itself. And **an impossible cron is disabled with
a reason** instead of parking `next_due_at` at NULL, which looks exactly like a
working row in every listing. `describe()` renders an expression in words —
`0 9 * * 1` and `9 0 * * 1` are both valid, both plausible, and nine hours
apart, and that is the one mistake nothing downstream can catch.

**The reading is written twice, and the two copies must agree word for word.**
`lib/cron.ts::describe` renders while the user types; `agents/triggers.py::
describe` replaces it ~350ms later when the preview lands. A wording that
differs by one word therefore shows up as the sentence rewriting itself under
the cursor, which reads as a bug even when both readings are correct — so the
expected strings are pinned as the *same table* in
`agents/tests/test_schedules.py::DescribeTests.CANONICAL` and
`src/lib/__tests__/cron.test.ts`. Two rules the wording follows, both learned
from readings that were true and useless: it never enumerates more than six
clock times (`0,30 9-17 * * 1-5` read as "at **18 times a day**", which is not
a sentence, and `0 */4 * * *` answered with six timestamps when the user had
picked "every 4 hours"), and an interval phrase never takes a day clause, so
`* * * * *` is "Every minute" rather than "Every minute, every day".
`POST /api/orchestrator/triggers/preview/` answers **200 with `valid: false`**
for a bad expression, because the caller is a field being typed in. Tests:
`agents/tests/test_schedules.py`, `src/lib/__tests__/cron.test.ts`.

**One cron field cannot own a list of schedules.** An agent may now have several
(a weekday briefing and a Friday wrap-up are two schedules, not one unreadable
expression), so `Trigger.origin` says which row the agent builder's single field
round-trips. `sync_schedule` reconciles `origin='builder'` only — the builder
PATCHes constantly, and an unscoped reconcile means every save from that screen
deletes a schedule added on the Schedules page. Migration `0020` marks every
pre-existing schedule `builder`, which is what they were: until it landed,
`sync_schedule` was the only thing that ever created one. That backfill is what
lets the runtime have a rule instead of a read-time guess — "adopt it if it is
the only one" cannot tell a legacy row from a deliberately manual one, and
quietly overwrites the second. The Schedules page is where schedules are now
made and edited; it could previously only list and delete them.

**Steering needs no `interrupt()`.** `interrupt()` exists to stop and wait for an
actor outside the graph; a steer is already in the mailbox by the time the graph
looks. So it is a plain node (`chat/turn/agent.py::steering_node`) that drains
`chat/turn/steering.py` and returns a `HumanMessage` — which `_split_transcript`
then peels off as the trailing prompt, exactly where a new instruction belongs.
It sits on `tools -> steering -> agent`, the only boundary where a new user
message cannot separate an assistant turn from the `tool` messages answering its
call ids. In-process like `ChatRun`.

**The mailbox is a queue, not a slot (2026-09-04).** It was single-slot,
last-write-wins, on the reasoning that two steers between boundaries mean the
user changed their mind. True of a correction, false of the normal case: people
steer *additively* — "also check pricing", then "and the changelog" — and three
instructions silently became one while the API reported success for all three.
`take()` now drains the whole FIFO and joins it into **one** `HumanMessage`,
which is not a detail: `_split_transcript` peels a single trailing human message
off as the turn's prompt, so returning three would leave two sitting unread in
the transcript and still billed. Bounded in two places because a steer is
re-billed on every later turn of the run — `MAX_STEER_CHARS` per message,
`MAX_BATCH_CHARS` per delivery — and an overfull queue drops the **oldest**
(the user is waiting on the newest) while counting the loss, because an
instruction someone believes was accepted and that vanished is the failure this
module exists to prevent. `autonomy` stays un-drained: a steer is an
instruction to act on once, a mode is a standing answer. Tests:
`chat/tests/test_steering.py`.

**A steer the run never read goes back to the user (2026-09-17).** Steers are
only read on the tools → agent edge, so one sent while the model writes its
final answer has no boundary left. Chat never cleared the mailbox, so it sat
there and was delivered mid-way through the session's *next* turn, after the
API had reported it accepted and the client had reset its counter to zero.
`runs.finish` now drains what is left (`steering.drain_messages`, which keeps
`autonomy`) and appends a `steers_returned` frame after `done`; the client puts
the text back in the input. The status flips before the drain and nothing
awaits in between, so a later steer gets the endpoint's 404 instead of racing
in. `runs.start` also drops anything stale. Tests:
`chat/tests/test_undelivered_steers.py`.

**A long run needs a plan, and the plan cannot live in the transcript.**
`curate_node` folds the oldest part of the transcript into a summary note, and
the oldest part is where the original instruction is — so by iteration 30 an
agent is working from a compressed trace of its own footprints with no
statement of intent anywhere. `chat/turn/todos.py` is the fix, and the design
turns on one structural fact: **curation only ever rewrites `messages`**, so a
plan parked in `metadata` (which `tools_node` returns and the checkpointer
keeps) is immune by construction rather than by anyone maintaining a list of
exclusions. Four rules carry it. The list holds **intent, never results** —
items carrying output would be a second, worse transcript, also billed every
turn. `update_todos` **replaces the whole list**; add/complete/remove need
stable ids the model must track across turns and will eventually address
wrongly, silently, while replacement is idempotent. It is **re-read, not just
written** — open items ride in the trailing context message every turn, because
a list nothing feeds back is theatre — and it must **never go in the system
prompt**, which is the clock trap exactly: it changes most turns and the system
prompt is the session's cached prefix. `blocked` is a real status so a run can
end honestly; without it, a model told not to stop with open work marks things
done to escape the loop. `update_todos` is in `ALWAYS_AVAILABLE`, not behind a
grant — an agent that may not track what it is doing is not safer, just more
forgetful. Tests: `chat/tests/test_todos.py`.

**The graph's step budget is counted in nodes, not in iterations (2026-09-17).**
`run_turn` sized LangGraph's `recursion_limit` as `max_iterations * 2 + 10`,
written when the loop was `agent -> tools`. It is now four node visits per
iteration (`agent -> tools -> curate -> steering`), so a run died with
`GraphRecursionError` at roughly *half* its configured iterations — and died is
the word: the limit fires before `at_limit` can withhold tools and force a final
answer, so a 40-iteration agent lost the whole run instead of ending with a
partial one. `STEPS_PER_ITERATION` is the constant, and
`chat/tests/test_iteration_limit.py` pins it against `_build_graph`'s node set
so adding a node to the loop cannot silently shorten every run again. Alongside
it, a model that issues tool calls on the last permitted iteration — where tools
were withheld — has them **dropped** rather than dispatched, because dispatching
is what walked past the cap into the recursion limit. Found by the work-tier
benchmark on a month-end close, not by any unit test.

**Tool calls in one turn are independent, so the safe ones overlap.** A model
issues every call in a turn *before* it has seen any result, so no call in a
batch can depend on another — the DAG runs between turns, not inside one. The
runtime still dispatched them one at a time, making three web searches cost
three round trips. `tools_node` now runs in four passes: settle approvals, plan
every call in call order, dispatch (`asyncio.gather` for the safe ones, one at a
time for the rest), then observe and record in call order — one function per
pass (`_settle_gates`, `_plan_calls`, `_dispatch_calls`, `_record_results`,
sharing one `_Batch`; split from a 442-line `tools_node` 2026-09-26). Parallelism is
declared per tool (`@tool(..., parallel=True)`) as an **allow-list**, because
the unsafe cases are unsafe for reasons no name reveals: `execute_python`
captures output by swapping the process-global `sys.stdout`, and an MCP tool's
name is minted at runtime so it can never carry the flag — unknown means serial.
Sensitive tools are excluded whatever they declare. Recording stays in call
order deliberately: `_apply_side_effects` does a read-modify-write on the shared
`meta`, and the observer writes one `AgentStep` per call, so completion order
would reshuffle the transcript and the run's own record between runs of the same
turn. Each call also gets its own context copy — `call_id` was written onto one
shared dict, which is exactly the field a concurrent sibling would clobber, and
`invoke_subagent` reads it to record which call spawned a worker. Tests:
`chat/tests/test_parallel_tools.py`.

**...and the model had never been told to batch them (2026-09-13).** The engine
above only helps *within one batch*: a model that calls one tool, waits, then
calls the next gets none of it. Nothing in either prompt asked for that, and
chat's rule 3 (TOOL ECONOMY) pushed the other way — it discourages tool use and
said nothing about issuing several at once. So the parallel path was built and
then fed one item at a time. The guidance now lives in **both** prompts, and the
second is the one that matters: `agents/agent/runtime.py::build_system_prompt`
builds a completely separate prompt that has never included `CORE_RULES`, so a
chat-only edit would have reached everything except the case it was written for
— a chat turn takes a handful of iterations, an agent run may take forty, and
total time is `iterations × (think + write + tools)`, so batching removes whole
round trips rather than shaving one. It is stated to the model as fact because
it is one: `test_read_only_calls_overlap` pins it. Added to chat by *extending
rule 3* rather than appending a rule 14 — `MEMORY_ON_RULE` is already 14, and
the correction belongs where the miscue is.

**A turn is measured from before the graph, not from inside it (2026-09-13).**
`chat/turn/agent.py::_log_latency` starts inside `agent_node`, so everything
`run_chat_turn` does first — preflight, the user-message write, history, user
memory, attachments, the vision witness, the `/Chat/` folder write, recall and
intent seeding — was invisible to the only latency instrument the project had.
That is 15-20 sequential awaits on the path to the first token, each a
`sync_to_async` hop onto a locked SQLite, and every "current state" number in
`docs/ORCHESTRATOR_LATENCY_OPTIMIZATION_PLAN.md` was an estimate because of it.
`pipeline._PhaseTimer` emits one `[Latency] pre-model` line per turn, non-zero
phases only — the same contract `_log_latency` keeps, and for the same reason:
it runs on every turn, so it has to be cheap to emit and cheap to grep. It
earned its place on its first run by showing `vision_witness` as the whole of
the segment. Note what it makes visible about **intent seeding**:
`_seed_intent_tool` runs a full `web_search` (or `deep_research`) *before* the
first model call, and `classify_intent` routes a large share of ordinary
questions — "what is", "how to", "explain", "compare", "tell me about" — into
it, while the frontend sends no explicit intent unless the user picks a
non-default mode. Tests:
`chat/tests/test_pipeline.py::PreModelLatencyInstrumentTests`.

**Approval is settled before anything is dispatched.** `interrupt()` discards a
node's writes and re-runs it from the top, so `tools_node` checking permission
inline would dispatch the safe half of a batch, pause on the sensitive one, and
dispatch the safe half *again* on resume — graph state rolls back, the outside
world does not. Two passes: settle every gate, then run. Rejection is the mirror
of approval (`reject_tool_call`, `POST .../reject/`); before it existed a
declined call left the run paused for ever. Note that LangGraph 1.x **returns**
`__interrupt__` rather than raising, which is what `run_turn` reads — matching
`"Permission required"` against an exception message silently stopped working at
the 1.0 upgrade.

**The turn is the unit an agent is recorded in.** A run is a loop of turns, not a pipeline of steps: each turn the model reasons, issues zero or more calls *together*, gets every result back into the same model, and reasons again. So `AgentTurn` is a row (`logs/models.py`), written by `TurnContext.on_model_turn` — a hook mirroring `on_tool_result`, which chat passes `None` for and is unaffected by. It gets `completion.thinking`, never the accumulated `thinking` state, or each turn's reasoning would be a superset of the last and turn 1's thoughts would be attributed to turn 7. Before this the grouping lived in a `config={'iteration','thought'}` blob reassembled at read time by the canvas projection, and the reasoning was `thinking[-150:]` — the same 150 characters copied onto every call in the turn, with the full text discarded when the run closed. A grouping that must be inferred cannot be queried, and 150 characters is not evidence. `AgentStep` (was `NodeExecutionLog`) hangs off its turn, and is **opened before its tool runs**, because `invoke_subagent` starts worker runs *during* dispatch and each records the step that asked for it. Design: `Backend/docs/AGENT_OBSERVABILITY.md`. Tests: `logs/tests/test_turns.py`.

**Delegation points at a step, not at a run.** `ExecutionLog.parent_step` names the tool call that asked for a run, so one FK answers both halves of "who wanted this?": `parent_step.execution` is the orchestrating run and `parent_step.turn.reasoning` is what it was thinking when it delegated. A run-to-run link gives the first and loses the second — which is what the retired `parent_execution` column was, DAG-subworkflow-shaped and never set by anything. `delegation_task` is stored because a worker's goal is generated by the parent model and exists nowhere else. `caller` (`api|chat|orchestrator|trigger`) is separate from `trigger_type`: the latter says *how* a run was invoked, the former *what* invoked it, and both a chat delegation and a direct API call arrive as `trigger_type='api'`. Tests: `logs/tests/test_delegation.py`.

**A run is pinned to the configuration that produced it.** `SubAgentRevision` snapshots `AgentSerializer.to_config(agent)` — the same flat dict the builder speaks, so a revision is renderable with no second mapping to drift — and `ExecutionLog.revision` is set at run *open* time, because an agent edited mid-run must not retroactively change what its running executions claim to have used. `logs/revisions.py::record` returns None when the diff is empty: the builder PATCHes constantly, and forty identical timeline entries is not a record of decisions. An agent predating revisions gets one minted lazily on its next run rather than by a data migration, so the snapshot goes through the same code path as every other. Tests: `logs/tests/test_revisions.py`.

**There is no supervisor any more.** `KingOrchestrator` (`executor/king.py`, 1570 lines) ran the DAG lifecycle; the emptied `executor` app itself was deleted 2026-09-19: it invoked the compiled LangGraph graph through `executor/engine.py`, generated LLM "thoughts", and paused runs for HITL. It was retired with the workflow product. Its last two callers were already inert — `respond_to_hitl` pushed onto an in-memory queue that only a running DAG could populate, and `update_settings` wrapped a three-field `UserProfile` write in a per-process singleton. `respond_to_hitl` now does the real work directly (`agents/views/hitl.py`); the settings view and its `orchestrator/settings/update/` route were deleted 2026-09-18, because the credential id it wrote was read by no model call — account defaults go through `auth/profile/`. Agent runs never went through King: `agents/agent/runtime.py` dispatches tools via `GRANT_TOOLS` into `chat/tools/`.

**The agent canvas is retired (2026-08-24).** `/agents/:id/canvas` projected a
run onto a ReactFlow graph: `graph_projection.py` turned an agent into a
capability map and a run into a node graph, behind three endpoints
(`agents/{id}/graph/`, `agents/{id}/runs/`, `executions/{eid}/graph/`). All of
it is gone — the projection, `agents/views/canvas.py`, `test_agent_canvas.py`,
`pages/AgentCanvas.tsx`, the whole `components/workflow/` directory,
`lib/executionEvents.ts`, and the `reactflow` dependency, which had no other
consumer. The route redirects to `/agents`. **What did not change is how a run
is recorded**: `ExecutionLog` → `AgentTurn` → `AgentStep` is written exactly as
before, and is read on `/runs`, in the Inbox, and through `/api/logs/`. Only the
graph *view* went; a graph was never the storage.

**LLM-driven workflow authoring is gone with the canvas.** `executor/generation.py` turned a prompt into a node graph for the DAG editor; there is no editor and no graph runtime to receive one. If agent plans become LLM-authored, that is a new thing built against the agent model, not a revival of this — `executor/llm_json.py`'s reply parser went with it.

**An eval score is provisional until a person has been asked.** `eval/` grades an agent's answers with a registry of small assertions (`graders.py`), but the number that matters is `EvalRun.grader_agreement` — how often a human reviewer agreed with those assertions. That is why a verdict **overrides without overwriting**: `EvalResult.auto_passed` keeps the graders' answer for ever and `EvalReview.verdict` is what the score is computed from, because agreement cannot be computed from a column that was overwritten. Three consequences follow. A run with anything queued sits in `awaiting_review` with `passed = NULL`, so a score that can still move is never reported as final. A case with no graders returns `auto_passed = None` and is queued under every policy but `none` — vacuous truth is how an empty suite reports 100%. And the default policy is `disagreement`, which queues exactly the results where the judge and the exact checks disagree, or the judge was uncertain (2026-09-19; deterministic splits are partial failures, not uncertainty): the only policy whose review cost does not grow with the suite. Sweeps abort on a *guardrail* refusal but carry on past a per-case failure, since two hundred rows all reading "spend cap reached" is not a report. Errored and skipped results never enter review; a legacy pending row is visible as **Dismiss** (`unsure`), which removes the result, its eval-only trace and hidden attempt files rather than recording a verdict on a non-answer. Finished sweeps or suites can be deleted from Evals, which cleans their history, eval traces, hidden attempt files and suite worlds; active/cancelling sweeps refuse deletion. Design: `Backend/docs/EVALUATION.md`. Tests: `eval/tests/`.

**Evaluation is production-grade (2026-09-19).** The plan in `Backend/docs/EVALUATION_PRODUCTION_PLAN.md` landed in full: eval runs use their own `caller='eval'` (excluded from spend caps, stats, `/runs` and insights; cost kept as `by_caller['eval']`), sweeps recover after a restart (`eval/recovery.py`, 3 h), judge cost is recorded per grade and on the scorecard, baselines are accepted per suite+model (`benchmark accept`, vs-baseline column), the judge is calibrated (`JudgeCalibration`, `benchmark calibrate`, `/evals` Judge card), the smoke tier gates deploys (`benchmark run --tier smoke --gate`, `DEPLOYMENT.md` step), quality is captured (`Feedback`, `RunSignal`, `failure_category`, `/evals` Quality tab, thumbs on chat + runs), a bad run becomes a case (`POST /api/eval/cases/from-run/`, "Save as eval case"), and external sets arrive through adapters (`ifeval`, `gaia`, `dabench`, `simpleqa`) with the bare-model control (`--bare`, agent-vs-bare deltas). Plan: `Backend/docs/EVALUATION_PRODUCTION_PLAN.md` (status: implemented 2026-09-19; paid runs — baseline, calibration, gate proof — still need the user's go-ahead).

**An eval never stops to ask; it records what it would have asked
(2026-09-24).** An eval ran at the agent's own autonomy, so an `ask` agent
paused at its first gated call — a real `HITLRequest` in the owner's Inbox, the
reminder ladder started for a test, the case ended as an error — and "did it
ask a question" was a keyword scan of the answer. Now `caller='eval'` sets
`TurnContext.record_intents`: the gate is still *decided* under the agent's
own autonomy, but `tools_node` writes it to `metadata['intents']` instead of
calling `interrupt()`, then per `EvalSuite.gated_calls` either **runs** the
call (default, the user's choice — so evaluating a mailbox agent really sends
mail) or **blocks** it (answered as declined; benchmark guardrail suites
install as `block`, because they exist to prove the gate fires). Questions are
a tool: `ask_user` (`chat/tools/ask.py`, `ALWAYS_AVAILABLE`) records the
question plus the assumption the agent proceeds on and, in an eval (or any
run with `can_ask=False`), never blocks — so the eval measures the real
unattended behaviour. (Since 2026-09-25 it *pauses* where someone can answer;
see "Boss, manager, workhorses".) `collect_intents` merges both onto
`AgentRun.intents`, `output_data['intents']` and `EvalResult.intents`; graders
`asked_question` / `requested_approval` read them, and `paused_for_approval` /
`asked_when_ambiguous` accept them. **Test data is generated, never trusted
unreviewed**: `eval/generator.py` has the *judge* model draft cases from the
agent's config (graders from an allow-list needing no fixtures; a case naming a
tool the agent lacks is rejected; each category gets its deterministic anchor)
and turns real runs + feedback into cases; both save **drafts**
(`is_active=False`, `needs-review`) the runner skips until accepted on
`/evals` — **accepting happens on the Evals page only**, never from chat (user decision, 2026-09-24). Built out in the next section (`EVAL_ENVIRONMENTS_PLAN.md`: judge-built test worlds; expected answers set by the judge only). A worker delegated *from* an eval run
(`invoke_subagent`, `run_agent`, `start_tasks`) inherits `caller='eval'` and
the eval's gated-call policy through `chat/tools/agents.py::worker_caller`
(2026-09-28) — it used to run as `orchestrator`, so it could pause on an
approval nobody answers and its cost counted against the real spend cap. In a
world eval the delegation tools are withheld anyway; this matters for cases run
outside a world. Tests: `eval/tests/test_eval_mode.py`,
`eval/tests/test_delegated_eval_workers.py`.

**A mission is a chain of detached runs (2026-09-28).** The mission loop had
never been connected: the sweep passed `mission_id=` to
`start_agent_run_and_wait`, which did not take it (so every launch raised),
`missions/service.py::after_run` had no caller, the mission tools read
`context['mission_id']` that nothing set, and the sweep waited for each run, so
production never ran it. Now `missions/sweep.py::sweep` does two passes.
**Settle**: a mission whose `current_execution_id` names a finished run is read
back once (`complete_mission` / `wait_for` from the trace, todos, spend) and
`after_run` decides done / waiting / next / paused; a failed or timed-out run
goes to `after_failed_run` instead (a failed run's empty plan would otherwise
read as "no open todos" = done), which retries after 10 minutes and pauses after
three runs without progress; a paused run (it asked a question) is left until it
ends — resume keeps its execution id. **Launch**: due missions are claimed by a
conditional UPDATE (two sweeps start one run) and started **detached** with
`caller='mission'` and the plan in the goal; a refusal (spend cap, not
unattended) pauses the mission with the reason. `mission_id` rides
`start_agent_run` → `ExecutionLog.mission` → `TurnContext.mission_id` → the
tool context, and a resumed run reads it back from its log. It runs in
`PERIODIC_JOBS` every `MISSION_SWEEP_SECONDS` (120); Celery and
`manage.py run_missions` call `run_mission_sweep()`, which waits. The Activity
page's Missions section has Pause/Resume again (`MissionsSection.tsx`); resume
re-arms the wake and resets `no_progress_runs`. Still open:
nothing wakes a waiting mission on its *event* — only its timeout does. Tests:
`missions/tests/test_mission_sweep.py`.

**An eval runs inside a world the judge built (2026-09-24).**
`EvalWorld` is one fake situation per suite (brief, surfaces, fixtures,
planted facts), versioned — regenerating mints a new version and never edits
the one old sweeps ran on (`EvalRun.world_version`; cases name their version
and stale ones are kept but never swept). `eval/environment.py::
EvalEnvironment` is built per attempt and handed to `run_agent` as
`environment=` (duck-typed — `agents/` must not import `eval`): the file
scope roots at the attempt folder under the hidden `/.eval/` tree whatever
`fileAccess` says, `kb_scope` is the world's hidden raw KB, `AgentToolbox.
dispatch` answers simulated tools from fixtures, and tools with no simulator
are withheld from `descriptors` and refused at dispatch — fail closed, so
"Record and run" is safe by construction and an eval never touches real data
or real services. Simulators (`eval/sim/`: mail, calendar, drive, web) are
pure and deterministic, mirror the real tools' result shapes field for field
(pinned by a coverage test that fails when a native tool gains no simulator),
and record every call; `GradeContext.env` carries their snapshots to the
`env_*`/`cited` state graders, and `EvalResult.env_changes` carries the
what-changed panel. Generation (`eval/generator.py::generate_world`) is
facts → fixtures → coverage check → cases → blind solve → blind verify →
prove (deterministic checks pass on the ideal outcome and fail on the
untouched world, the work-tier rule) → drafts; the expected answer is the
judge's only, and `reference` tells `llm_judge` the answer instead of a
rubric. All five model-derived write paths go through `eval/api.py::
save_cases`, so chat ("test my invoice agent", `generate_eval_world` with
its judge-cost approval note, run imports, `/eval` storing the question as
the goal) only ever makes drafts. Tests: `eval/tests/test_environments.py`,
`test_kb_worlds.py`, `test_sim_worlds.py`, `test_drive_web_worlds.py`,
`test_eval_chat.py`. Plan: `Backend/docs/EVAL_ENVIRONMENTS_PLAN.md` (E-1–E-5
built; E-6 paid proof runs still need the user's go-ahead).

**...and it tests the agent that really runs (review fixes, 2026-09-25).**
The first build evaluated a *stronger* agent than the real one: simulated
connector tools skipped `native_call_allowed`, the only place the connector
scope is checked, and `dispatch` simulated before the per-tool deny — so a
"Gmail, read-only" agent could send and use Calendar in its eval. Now
`native_call_allowed` waives only the *live-card* check for a simulated tool
(server id from `mcp_integration/native.py::native_server_ids`) and keeps the
scope, `dispatch` simulates **last**, after every check a real call passes,
and `surfaces_for_agent` builds only the connectors in scope. Four more:
`ALWAYS_AVAILABLE` is not all safe — reminders, dashboards and the run list
touch the owner's real account — so a world keeps `EVAL_SAFE_ALWAYS` and
simulates `notify_user` (`eval/sim/notify.py`); hidden world KBs are filtered
by `inference.models.visible_knowledge_bases` in the builder and template
pickers, refused by `validate_knowledgeBases`, and the `.eval/` name is
reserved; **only world generation stamps `world_version`** — imports and
added cases run *outside* the world (`for_attempt` returns None for a
versionless case) because they describe the agent's real situation; and a
sweep pins the world it opened with (`runner._pinned_world`). The blind
solve/verify are matched **by case id**, not list position. World generation
is **detached** (`api.start_world_generation`: 202, row `generating` →
`draft`|`failed`, owner notified, stale rows failed by `eval/recovery.py`)
because five reasoning-model calls outlast a request; worlds no longer need
file access. Tests: `eval/tests/test_world_isolation.py`.

**A queue you can answer, and a question worth answering (2026-09-05).**
The row existed and the ping worked; the two things a person does with them
did not. **`respond_to_hitl` resumed nothing** — it set `status`, wrote
`responded_at` and returned 200, its own comment deferring the resume to
`agents/{id}/approve/`, a route the Inbox has never called. So answering was a
dead end that looked like a working screen: the toast said "Response sent", the
row left the queue, the ladder stood down because nothing is pending any more,
and the agent stayed parked on its `interrupt()` with the one person who could
have rescued it now told it was handled. It runs `agent_approve`'s three steps
through `agent_approve`'s own functions, because a second write path is a
second place for the ownership check and the resume to drift apart. Three
things carry it: the `status='pending'` filter is the **only** guard against
the socket and the Inbox both answering, and it had never been exercised
because nothing resumed; **closing the row is unconditional while resuming is
not**, so a clarification or a row predating `context_data['thread_id']` closes
rather than 500s; and a resume that raises is **logged, not surfaced** — the
decision is already recorded and the user has no second copy of it to send.
Alongside it, `options` was written as `[{label, value}]`, typed `string[]`,
and rendered as `{opt}` — React refuses an object as a child, so the detail
pane went into the error boundary for every genuine request, which is why the
screen was never seen working. Chat's **Deny** was the same shape of bug one
floor down: `clearPendingToolCall()` and nothing else, so the graph stayed
parked and the model was never told it had been refused, while
`reject_tool_call` had existed since agent runs got that exact asymmetry
closed. Tests: `agents/tests/test_hitl_inbox.py`,
`chat/tests/test_tool_approval.py::RequestPlumbingTests`.

**A tool call is rendered once, on the server.** Four surfaces ask a user to
approve one — the chat card, the Inbox, a notification row, a device push —
and each improvised from the raw name and the raw arguments, because nothing
ever turned a call into a sentence. That is one missing layer, not four bugs:
a renderer holding `mcp__7__send_email_ab12cd34` and a dict of unknown shape
can only print them, which is what `JSON.stringify(args, null, 2)` was.
`chat/tools/describe.py::describe_call` is that layer, and it is **synchronous
and does no I/O** for the reason `mcp_reads_only` next door is — the naming a
connection *does* need a row, so `describe_call_async` resolves it at the two
places that pause a run, both already async and already waiting on a human, and
hands it down. A renderer never looks anything up. Three refusals are the
design. It **never renders markup**: values are third-party text and the Inbox
passes `message` through `MarkdownMessage`, so a call's own contents must not
be able to style the screen asking to get past it. It **redacts on the key's
name**, eagerly, because a false positive costs one field that is still in the
raw disclosure while a false negative writes a live credential into a
notification row that lives for ever. And it **shows a shape, not a payload** —
a 4,000-word body is described as "1,180 words", since quoting it pushes the
recipient off the screen. The raw pair still ships to the card behind a closed
disclosure: that view is what an engineer needs when the sentence is wrong, and
is not what the person deciding should read first. Tests:
`chat/tests/test_describe.py`, and `chat/tests/test_turn_output_e2e.py` for the
frame a client actually receives — a unit test on the function cannot catch a
frame that carries nothing to render.

**`data` is routing, and routing is not for the reader.** `NotificationsTab`
printed `JSON.stringify(notification.data)` under every row whenever it was
non-empty — thread ids, session ids, request ids, and for a chat approval the
raw tool arguments. None of it was chosen; it was on screen because nobody had
decided what to show. Two keys are genuinely for the reader (`action_url`,
`pending_count`) and the rest stays in the record, so an unrecognised payload
renders a title and a message and **nothing more** — the correct answer, not a
fallback. `action_url` is matched against a small allow-list rather than linked
directly: it is server-written today, but a link built from a stored value is
exactly the shape that becomes an open redirect the first time a writer starts
echoing something a user supplied, which is the trap `lib/nextPath.ts` already
documents.

**Chat is the orchestrator, and it holds only basic tools (2026-09-25).**
Chat cannot be configured the way a subagent can — no grants, no scopes, no
per-tool permissions — so it was the widest reach in the product with the
fewest controls. Now it reads, plans and delegates, and everything that
writes, sends, publishes, renders or spends is a subagent's job, where the
user configured what it may touch. `chat_orchestrator_allowed`
(`chat/tools/__init__.py`) is the rule: `effect="read"` tools,
`ALWAYS_AVAILABLE`/`RETRIEVAL_TOOLS` infrastructure, and
`CHAT_ORCHESTRATOR_EXTRA` (delegation, `create_agent`/`update_agent`,
`remember_about_user`/`forget_about_user`, `start_mission`); MCP tools are cut
to names `looks_read_only` accepts. Enforced at both doors —
`get_available_tools` withholds, and **`execute_chat_tool`** refuses with
`ORCHESTRATOR_REFUSAL`, which tells the model to find a specialist and pass
findings by file rather than retry. The dispatch check lives in
`execute_chat_tool` and **never in `execute_tool`**: `AgentToolbox.dispatch`
ends in `execute_tool` after its own grant checks, so putting it there
refuses every subagent the very tools chat now hands it (the first cut did
exactly that; `test_orchestrator_scope.py::SharedDispatcherTests` pins it).
The direct `/api/chat/execute-tool/` endpoint stays on `execute_tool` — a
person is the caller there, and it keeps its own approval refusal.
`CORE_RULES` 8 (files) and 12 (connected accounts) describe the manager role;
rule 12 stays static, because a *list* of connections changes and would belong
in `build_context_update` (the clock trap). **Adding a critical tool to
`CHAT_ORCHESTRATOR_EXTRA` undoes the design** — give it a grant instead.
Tests: `chat/tests/test_orchestrator_scope.py`.

**The row is the queue; the notification is the ping.** The reminder engine
(escalation ladder, hourly nudge, daily digest) was built, tested and
*unreachable*: **nothing outside the test suite had ever created a
`HITLRequest`** — the DAG supervisor did, and it went with the DAG product. So
`agents/hitl/pending/` always answered empty, `notifications/signals.py` never
armed a schedule, and a paused agent produced only a socket frame plus one
ad-hoc `Notification` written by `chat/turn/agent.py::_require_approval`. That
is what the builder's toggle was apologising for with *"Coming soon — you'll be
notified for now even if this is off"*: `guardrails['notifyOnHitl']` was the
third dead switch of its kind, after `allowUnattended` and `connectors`.
`agents/agent/hitl.py` is the missing write — `open_request` from
`stream._approval_requested`, `resolve_request` from the approve and reject
views — and one row lights up everything already there. Four things it has to
hold. **`notifyOnHitl` gates delivery, never the write**: a suppressed row would
take the pause out of the Inbox and leave the run unanswerable, turning a
notification preference into "abandon this run". **Opening is idempotent** on
`(execution, node_id=call_id)`, because `interrupt()` re-runs the node from the
top and two rows would mean two ladders nudging about one question.
**Resolution happens before `resume_agent_run`**, which reopens the log — close
it after and the lookup races the resume, leaving an answered question nudging
for ever. And the **digest is deliberately unfiltered** while the pushes are
not: `reminders.pending_for_nudges` drops opted-out agents from escalation and
the hourly nudge, but the once-a-day roll-up reads `HITLRequest` directly,
because a summary that hides pending work is worse than no summary. That filter
is spelled as three positive `Q` alternatives rather than
`exclude(...=False)` — on a JSON key path `NOT (key = False)` is NULL when the
key is absent, so the obvious spelling silences exactly the agents that never
opted out. Chat is untouched: it has no `ExecutionLog`, so `TurnContext.
approval_queue` stays False and it keeps its inline notification. Tests:
`notifications/tests/test_agent_notifications.py`.

**HITL reminders escalate, then back off:** an unanswered `HITLRequest` is nudged at +0, +1h and +1d and then left alone; `notifications/reminders.py` also runs an opt-in hourly nudge and a daily digest at a per-user local time. The channels are split on purpose — escalation and hourly are device-only (`ws/hitl/` → browser/BrowserOS notification), and **email belongs to the digest alone**, hard-capped at one per calendar day by `NotificationPreference.last_digest_sent_on`. One sweep drives all three, run by the in-process scheduler loop (`agents/scheduler.py::PERIODIC_JOBS`, which is how production runs it) and reachable both as the Celery beat task `notifications.sweep_hitl_reminders` and as `manage.py send_hitl_reminders`, because local dev runs without Redis and a beat-only design would silently never fire. Tests: `notifications/tests/test_reminders.py`.

**A cap is enforced against the number the run actually records.** `spendCapRupees` was compared against `ExecutionLog.credits_used` — a column no code path has ever written — so the guardrail was a no-op and the agent list showed every agent a spend of zero. `tokens_used` is the only usage figure a run writes, so both readers now go through `agents/spend.py::rupees_for` (one blended rate, `RUPEES_PER_MILLION_TOKENS` in `workflow_backend/thresholds.py`, rounded *up* so no run is free). The rate is deliberately not a per-model price table: the cap is a blast-radius control, not billing, and a table that must be kept current per model would be neither right nor maintained. The point is that the number the UI displays and the number `check_guardrails` refuses on are the same number — before this they were the same *column*, and it was the wrong one. Tests: `agents/tests/test_agent_runtime.py::SpendCapTests`, `agents/tests/test_regressions.py::AgentStatsTests`.

**A rename that leaves string arguments behind is invisible until it 500s.** `Workflow` → `SubAgent` left `select_related('execution__workflow')` in `agents/views/hitl.py` and `workflow_id=` in `agents/views/conversations.py`'s `.create()`. Neither is reachable by a type checker, neither had a test, and both broke live frontend call sites on every request. Same class as the LEFT JOIN in `_with_stats`: `Count('id')` alongside a `filter=Q(hitl_requests__isnull=True)` counts execution×approval pairs, so one run with three approvals reported as three runs and triple the spend — an aggregate whose join nobody read. Regressions for all of these live in `agents/tests/test_regressions.py`, grouped by the mistake rather than by module.

**A grant says whether, a scope says which — and `mcp` had only the first.**
`tool_grants['mcp']` was a boolean, so an agent holding it was handed every
connection the *account* owned: an inbox-triage agent could also post to Slack,
write Notion pages and read the calendar, and 70+ tool descriptors rode every
turn. The autonomy ladder could not help — it decides whether a call is
*paused*, never whether the tool should have been in the toolbox at all. So
`agent_context['connectors']` is now the second axis, exactly as
`sandbox['fileAccess']` is to `fileOps`: the grant says *may it reach
connectors*, the selection says *which ones*. Four things make it hold. It
stores **`MCPServer` ids**, not names — the old field was a hardcoded set of six
presentation slugs (`'gdrive'`, `'photos'`) that had drifted from the catalogue
in both directions and that nothing on the run path ever read, and a closed list
in code cannot work here for the same reason MCP tool names cannot be
allow-listed: a user's own server is a row, minted after the file was written.
It is enforced at **both doors** — `AgentToolbox.descriptors` narrows what is
offered and `mcp_server_allowed` re-checks at dispatch, because a model names
tools it saw in an earlier turn and "we didn't advertise it" is not access
control. The selection is **intersected with what the user can see** rather than
trusted, so a deleted or switched-off connection can only ever take tools away,
never resolve one an agent's stale config still remembers. And **empty means
unrestricted** — the field sat in the builder long before anything read it, so
enforcing it must not silently strip the toolbox of every agent that never made
a choice; that is the trap `kb_scope_for` documents, and migration `0021` clears
the legacy slugs rather than mapping the four that would resolve, because
mapping them would newly *narrow* agents that have always run wide. Tests:
`agents/tests/test_connector_scope.py`.

**A grant says whether, a scope says which — and the last two got their
second half (2026-09-03).** `mcp` had a *connection* scope but nothing finer, so
choosing a mailbox handed over sending and deleting along with reading; the only
thing in between was `permissions.looks_read_only`, which decides whether a call
*pauses*, not whether the tool is in the toolbox — and `autonomy: full` or an
unattended schedule removes it. `agents/connector_scope.py` adds the third
question as a **mode per connection** (`all` | `read` | `selected`) rather than a
stored list of names, because MCP names are minted at runtime by a third party: a
renamed tool would silently narrow the agent and a new one would silently widen
it. `read` is therefore *derived* per turn from the tool's own name, and
`selected` is intersected with the live catalogue, deny-by-default on additions.
Enforced at both doors — `AgentToolbox.descriptors` passes a `tool_filter` into
`get_openai_tool_descriptors` (the only place original names exist; everything
downstream sees the encoded form) and `mcp_call_allowed` re-checks at dispatch,
returning *why* it refused, because a model told only "denied" retries until the
iteration cap ends the run. Both stored shapes are read for ever: a bare id is
`all`, so no migration and no existing agent narrows. `subAgents` was the same
gap one floor up and worse — `search_agents` and `run_agent` filtered on
`user_id` alone, so a delegating agent could run *every* agent on the account,
including ones holding grants it had been refused; `agent_context['delegatesTo']`
is its scope, carried on `TurnContext` exactly like `kb_scope`. Tests:
`agents/tests/test_connector_scope.py`, `agents/tests/test_delegation_scope.py`.

**Five knobs were exposed and five retired in the same change (2026-09-03).**
`description`, `tags`, `status`, `output_schema` and `fanout` were all read by
the runtime and settable only through Django admin or `agents/stock.py` — the
first is what a delegating agent reads to choose, and the last two are what the
design leans on for "an agent that can only return prose cannot stand in for a
coded tool". Going the other way: `workdir`, `venv` and `useOrgContext` were
stored, validated, round-tripped and read by nothing (the `cpu`/`memoryMb` story
again); `egress` was read once, to add a sentence to the system prompt, and its
two wider values could never have been honoured on a sidecar with no network, so
the sentence is now unconditional; and `trigger` is derived from whether a
schedule exists, which was the only rule it ever carried. `reviewAgent` is
retired (`logs/revisions.py::RETIRED_KEYS`; the decision went the other way —
no wiring to `eval/api.py::grade_execution`).

**A switch the user flips has to be the switch the runtime reads.** Tools are
code and stay code, so what a user configures is *which of them exist for their
workspace* and *how much each is allowed to return* — `tools_config.ToolConfig`,
one row per (user, tool), where **an absent row is the code default**. That is
the whole design: a fresh `migrate` yields zero rows, "reset to default" is a
DELETE rather than a second notion of what default means, and a row that has
drifted back to the defaults is deleted on save so a changed default still
reaches everyone who once opened the panel. Enforcement is deliberately *not*
in that app: `chat/tools/disabled_tools_for` is the single read, consulted by
`get_available_tools` (chat), `AgentToolbox.descriptors` (agents) and
`execute_tool` (both) — the last one because a model will name a tool it saw
earlier in the transcript, and "we didn't offer it" is not a switch. A failed
read means *nothing* is off, never everything: a cache miss must not strip a
running agent's toolbox. The knobs are declared in one table
(`settings_schema.TOOL_SETTINGS`, integers with a floor, ceiling and default)
and read at the one line in each tool that used to hold a constant, and a test
fails if a declared knob is never read — a control that moves nothing is the
same lie as a switch that writes an unread row. `LOCKED_TOOLS` cannot be
switched off because our own prompts name them (`read_tool_output`,
`recall_context`): an escape hatch nobody can open is worse than none. This is
a *second* axis from the per-agent grants, and the page says so — a grant
decides what one agent may reach, this decides what exists to be granted.
Tests: `tools_config/tests/test_config.py`.

**Personalisation needed a substrate before it needed a prompt (2026-09-04).**
`UserProfile` holds tier and credits; `ChatSession.memory_enabled` replays one
conversation. Nothing anywhere answered *what do I know about this person*, so
an assistant told to personalise could only re-derive it from the current
transcript — the context curation folds away on a long run and discards
entirely between sessions. `core.UserMemory` + `core/memory.py` is that store:
flat text, not a schema, because the useful facts ("prefers code first", "works
in IST") are a shape nobody can enumerate in advance and a schema would put
every new kind of fact behind a migration. The risk it carries is not failure
but *filling* — every fact rides in every future system prompt — so: an exact
repeat is a **touch, not an insert** (and a touch protects it from eviction,
since a fact that keeps coming up is evidently worth keeping), caps are **per
category** so a burst of project facts cannot evict who the user is, eviction is
by least-recently-**used**, and the rendered block is cut on **whole lines**
because half a sentence about someone reads as a fact and can be flatly wrong.
It goes in `build_system_message`, a deliberate exception to the clock rule:
session-stable is the bar for a cached prefix, and this changes only when a fact
is written. Agents **read it and cannot write it** — the tools are chat's alone,
so a scheduled run is personalised without being able to rewrite the person
while nobody is watching. Tests: `core/tests/test_memory.py`.

**Memory exists so the user never says the same thing twice (2026-09-28).**
That purpose is now what the code optimises for (`PROMPT_AND_MEMORY_PLAN.md`
Phase 2). The block was cut after sorting categories by *name*, so `context`
("Anything else") filled the 1,500 characters before `profile` ("Who they
are") was reached — the opposite of the per-category cap's intent.
`core/memory.py::_select` now fills in `CATEGORY_PRIORITY` order
(`profile, preference, project, context`), **one fact per category per round**,
skipping a fact that does not fit rather than stopping, under
`MAX_PROMPT_CHARS = 2_000`. It is the one selection both `for_prompt` and the
Memory tab read (`in_prompt` on `GET /api/memory/`), so "stored but not shown"
on screen is exactly what the model is missing. A repeat is matched by
`normalise` (case, spacing, end punctuation), in `remember` and `forget`
alike; deeper near-duplicates are the model's job, so `remember_about_user`
returns the category's other facts. Correcting the paragraph above: eviction
is by least recently **saved**, not used — tracking reads would cost a write
on every turn. The block opens with its purpose ("do not ask for it again")
for chat and agents both; agents see it labelled read-only.

**An agent can be built by describing it, through the same door as the builder.**
`chat/tools/authoring.py` (`create_agent`, `update_agent`) writes through
`AgentSerializer` — same validation, same `apply`, same `sync_schedule`, same
revision — because a second write path is a second place to forget the ownership
checks on knowledge bases, connections and delegation targets, and those checks
are the only reason a config is safe to accept from a model at all. Two walls,
both invisible from the tool schema and both tested. They are **chat tools and
nothing else**: in no `GRANT_TOOLS` value and not `ALWAYS_AVAILABLE`, so an
agent holding `subAgents` cannot mint a worker with grants it was itself refused
— which would make every grant a suggestion while depth and budget bounds went
on holding. They were **`sensitive`** (the user approved every proposed
configuration); since 2026-09-25 they run without asking — the orchestrator
staffs its own team, and a worker's *actions* still meet its own gates at run
time (see "Boss, manager, workhorses"). `allowUnattended` is writable for a
reason worth keeping — the serializer already refuses a schedule without it, so
the pair is validated together; withholding it would not have been safer, only
broken. The writable set is a fraction of the serializer's: spend caps, run
limits and context toggles stay the builder's, because a model has no basis for
choosing a spend cap and a wrong one is either a surprise bill or a run that
dies half-way. Tests: `chat/tests/test_authoring.py`.

**A chart is data, not markup (2026-09-04).** `render_html_artifact` could
always draw one, and that was the problem: it asked a model to be a rendering
engine, in a frame with no network so no chart library can load, so every chart
was hand-authored SVG and every chart looked like a different product — labels
off the edge, dark mode from memory, the same question twice giving two
designs. `render_chart` takes `{kind, title, series}` and
`components/chat/ChartArtifact.tsx` owns every visual decision. Three things
follow. The **caps are the palette's, not a budget's**: the categorical ramp is
a fixed validated order of eight hues, so a ninth series is *refused* (an
invented hue is one nobody checked under colour-vision deficiency), and scatter
caps at three because it compares every pair at once rather than neighbours —
and both refuse rather than truncate, since a silently dropped series is a
chart quietly wrong about its subject and the model can be told to fold the
tail into "Other". **A gap is not a zero**: a non-numeric `y` stays `None` all
the way to the renderer, which breaks the line, because a line drawn through a
hole invents a measurement. And the **spec is stored, never a picture**, so a
reopened conversation redraws with today's component. The palette was validated
against this app's real surfaces; light mode fails 3:1 on three hues, which is
why the table view exists — identity never rests on colour alone. There is
deliberately **no plotting library in the sandbox**: `execute_python` computes
and hands numbers to `render_chart`, so there is one renderer and one design
system rather than a second path producing PNGs nobody can restyle. Tests:
`chat/tests/test_charts.py`, `src/lib/__tests__/chartScale.test.ts`.

**An office file is a spec our code renders, not code the model writes
(2026-09-19).** `render_deck`, `render_workbook` and `render_document`
(`chat/tools/office.py`, rendering in `office/`) take slides / sheets / blocks and produce real `.pptx`,
`.xlsx` and `.docx` files with python-pptx, xlsxwriter and python-docx, in-process
— the `render_chart` rule one level up: the model says what each slide says and
which of ten layouts says it, and `office/themes.py` (three themes, the chart
palette) decides everything visual. Five things carry it. **Bytes live on the
row's own `Document.file`** through `vfs.write_binary` — the storage uploads use,
at a server-derived path — with the extracted text in `content_text` (so
`find_files`/`read_file` still work) and the spec in `metadata.spec` (so the
browser can preview a slide it cannot parse from bytes); `write_file` now refuses
binary extensions, and `edit_file` refuses a binary. **They only create**: a taken
name becomes `name (2).ext`, and `overwrite` replaces the file **in place**
(same document id) after keeping what it held as a version
(`inference/versions.py`), which is why they are `effect="reversible"` and *not*
`sensitive` — chat does not ask before making a deck. **Formulas stay formulas**:
`=` starts one, `{r}` is "this row", `totals: true` writes `SUM`, and
WEBSERVICE/HYPERLINK/DDE-style formulas are refused. **Limits refuse, never
shrink** — a slide over its bullet or character cap comes back as "split it",
because auto-fitting is how a deck grows a 9-point slide. And **a chart on a slide
takes exactly `render_chart`'s spec** (`charts.build_spec` is now public), drawn
as a native, editable PowerPoint chart; a Word file gets the chart's data as a
table, and says so. Agents reach them through a new **`office` grant**, which like
`fileOps` needs a `fileAccess` scope to save into. `run_agent` now hands the
caller's write folder to the run it starts, as `invoke_subagent` already did, so a
specialist can answer with a path. The benchmark grades the real files: the
`work-office` suite and `eval/office_files.py`, whose `xlsx_value` *evaluates*
formulas through an AST-whitelisted evaluator, so typed-in totals fail even when
right. Plan and the phases after this one: `Backend/docs/SPECIALIST_AGENTS_PLAN.md`.
Tests: `chat/tests/test_office.py`, `inference/tests/test_vfs_binary.py`,
`eval/tests/test_office_graders.py`, `src/lib/__tests__/officeSpec.test.ts`.

**The apps are applications now, in six phases (2026-09-25).**
`Backend/docs/OFFICE_SUITE_PLAN.md` — no external office server (2–4 GB RAM
against 913 MB, AGPL), so MIT/Apache editor libraries inside our own apps,
and agent tools editing the same real files. **A: frame + safety net.**
`/apps/:appId` runs full-screen in `AppFrame` (no Topbar/Sidebar/BottomNav)
under one `AppBar` (home, app switcher, click-to-rename, File menu, save
status); tabs per app in `sessionStorage` with `?file=` active; a collapsible
file panel (drawer on phones); an in-app Save/Don't-save/Cancel dialog fed by
editors registering `save()` through `SaveContext` (never `window.confirm`).
`DocumentVersion` keeps what every overwrite replaced (5-minute per-source
coalescing, last 25, nothing over 25 MB; failing to keep one never fails the
save); `write_binary(overwrite)` replaces in place so an open file never
disappears; `write_file`/`edit_file` go through `save_text`, which also fixed
agent edits never reaching downloads. Export (`FORMATS` drives route, menu
and tool alike) covers docx→pdf/md/txt, md/txt→pdf/docx, pptx→pdf, xlsx↔csv;
`file_versions` is read, `restore_file_version` sensitive, `export_file`
reversible-never-overwrites, all in `fileOps`. Tests:
`inference/tests/test_versions.py` (its Word→PDF case once failed empty —
the test read a streaming body twice), `src/hooks/__tests__/appTabs.test.ts`.
**B: autosave + undo.** Office autosaves park the spec/grid in
`metadata.draft` (`POST draft/`) and rebuild after 30 s of quiet (debounced
`spawn()`) or on any read needing the bytes (`ensure_rendered` on download,
export, copy, office grid and every vfs file access); the render goes through
the ordinary edit paths so one burst keeps one `app` version. A render moves
`updated_at` under the app, so it leaves `metadata.last_render` in its own
transaction — an etag from before the render still lands while nothing else
wrote, and any real overwrite clears drafts and closes that door. The door is
in `office_edit.is_stale`, so Ctrl+S, restore and import honour it too, and a
render writes only if its draft is still the stored one (row lock), so a draft
saved mid-render survives. A rename leaves `updated_at` alone: it is every
editor's etag, and a rename is not a content conflict. Text autosaves directly; the
Save button is gone everywhere, the bar shows Saving…/Saved, and a hide/close
flushes. Undo is a small coalescing stack in `lib/history.ts` for text, specs
and the sheet grid (Ctrl+Z/Y/Shift+Z, fields keep native keys); Univer,
TipTap and CodeMirror bring their own. Tests: `inference/tests/test_drafts.py`.
**C: Sheets on Univer.** `office/sheets.py` translates `.xlsx` to a Univer
`IWorkbookData` snapshot (values, formulas, styles, number formats, widths,
heights, merges, freeze, order, names) and applies one back onto the existing
workbook with openpyxl — charts and everything untouched survive; sheets
match by name, one rename renames. `office/formulas.py` grows the
`eval/office_files.py` evaluator (comparisons, IF/IFERROR/AND/OR/NOT,
CONCAT/&, text fns, TODAY, SUMIF/COUNTIF/AVERAGEIF, VLOOKUP/XLOOKUP, real
cycle detection; interpreted, never `eval`'d) and `eval/office_files.py`
re-exports it lazily so the benchmark and the app agree. `office/edit.py`
gains mid-sheet insert/delete (formula refs shifted in every sheet, merges
moved, `#REF!` for the deleted band), format, freeze and widths;
`read_workbook` (read, plan-safe) joins the `office` grant and CSV export plus
the office grid show calculated values. `SheetEditor` is a lazy Univer mount
(formula engine in a worker, dirty by normalised snapshot compare ignoring
`rev` and derived values) with CSV in the same grid saving back as values.
Tests: `inference/tests/test_formulas.py`, `test_sheets.py`.
**D: Docs on TipTap, Slides on the slide.** The document spec gains inline
`runs` plus `align` (old marker text still validates; both renderers draw
them; links are hand-built oxml; edge spaces need `xml:space="preserve"`).
`inference/importers.py` converts uploads to specs (best effort, labelled;
original upload stays version 1; images saved beside the file): `POST
import/`, `GET asset/` (spec-named paths only), image upload beside the doc.
`edit_document`/`edit_deck` (fileOps, sensitive, reversible) apply block/slide
ops through the same edit paths with `version_source='agent'`, converting
uploads first. Docs is a lazy TipTap page (`lib/docSpec.ts` converts TipTap
JSON both ways, pure and tested; the title renames the file); Slides edits
text on the slide itself (inputs in the slide's own type), drags thumbnails,
picks layout/theme, keeps a notes strip, and measures the presenter from its
container. Tests: `inference/tests/test_import.py`,
`src/lib/__tests__/docSpec.test.ts`.
**E: one preview, CodeMirror.** `PreviewFrame` (name, location, Open in
`<app>`, Download, Export ▸, Close) serves the Files pane, the dialog (now
portalled to the body at a fixed size) and the chat drawer. Previews are the
editors read-only (Univer `setEditable(false)`, TipTap `editable: false`,
DeckSlide with navigation). Markdown lists are context-proofed against the
chat container's own bullets and file previews clip at block boundaries.
CodeMirror 6 (lazy: per-extension languages, find/replace, brackets, indent,
own light/dark, Format JSON kept). **F: every file type.** pdf.js (lazy,
thumbnails/search/zoom/count, also the PDF Reader); legacy Office gets its
own types (never near the new-format code) and a sentence; TIFF/BMP/HEIC
convert server-side to cached PNGs; zips list (never serve) capped at 500;
ODF/RTF/email extract text; media that will not play says so; unknown types
name their extension and size. `manage.py retype_documents` repairs old rows.
Tests: `inference/tests/test_previews.py`,
`src/lib/__tests__/filePreview.test.ts`.

**Recently opened is a record, not a sort (2026-09-26).** "Recent" meant
`Document.updated_at` — recently *changed* — so a file read every morning never
rose, and open tabs lived only in `sessionStorage` and died with the window.
`inference/recents.py` adds `RecentFile` (one row per user+document:
`opened_at`, `open_count`, last `app`, and `view_state`, the small flat bag a
viewer keeps so a file reopens where it was left — the PDF's page and zoom) and
`AppSession` (one app's tab ids + active id). Readability is checked on the way
in *and* re-applied on the way out (trashed, unshared or eval-tree files drop
out without anyone deleting rows); everything is capped (100 rows, 20 tabs,
`view_state` ≤16 scalar keys/2 KB); `app` is a shape-checked label because the
catalogue is frontend code. Frontend: `useRecordOpen` in `AppWorkspace` and
`PreviewFrame` (app `preview`), "Jump back in" on `/apps`, "Recently opened"
on each app's welcome screen, and `useAppTabs` restores from the server only
when the browser tab has no list of its own and never writes before that
restore settles (else an empty first render wipes the saved session).
**The PDF reader was rebuilt with it**: one shared `workerPort` meant pdf.js
destroyed the cached worker when *any* document closed, so switching files or
a StrictMode remount broke the next PDF — it now uses `workerSrc` (a worker
per document); cmaps/standard fonts/iccs/JPX+JBIG2 wasm are served at
`/pdfjs/` by the `pdfjsAssets` plugin in `vite.config.ts` (scans were blank
without them); nginx maps `.mjs` explicitly because a module worker needs a JS
type. Continuous fitted scroll, lazy draw/release per page, canvas capped at
16 MP (iOS draws nothing above it), text layer, search highlight, password
prompt. Tests: `inference/tests/test_recents.py`,
`src/hooks/__tests__/appTabs.test.ts`, `src/lib/__tests__/pdfView.test.ts`.

**The sandbox reads files through a second tool, not a second param
(2026-09-20).** `execute_python` is declared `read` so `plan` mode keeps
offering it (the plan critic computes there); a file-writing `plan` tool breaks
that mode's whole promise, so the bridge is `run_python_on_files`
(`requires="files"`, `effect="reversible"`) over the same `sandbox.engine`.
`arun_code(code, files=, collect=)` on both engines, base64 legs on the sidecar
protocol, a confined `open` + ephemeral cwd in the dev fallback. Inputs resolve
through the caller's `FileScope`, outputs save into its write folder and never
overwrite (a taken name becomes `name (2).ext`, the office rule). The grant is
`codeExecution`; the scope comes from `fileAccess`, so `build_file_scope` builds
for `fileOps`/`office`/`codeExecution` and the toolbox withholds the new tool
with no scope. Tests: `sandbox_service/tests/test_files.py`,
`chat/tests/test_sandbox_files.py`.

**A specialist is a template with a contract and a pack to install it
(2026-09-20).** `analyst` (code + files + office), `slides` (files + office +
web) and `writer` (files + office + rag) in `agents/gallery/`, all
`read_all_write_own`/`auto` with `outputContract: files` — `{summary, files}`,
so a run answers with paths and `/runs` renders file cards rather than prose
mentioning paths. `SubAgent.template_slug` (`orchestrator.0024`) makes `POST
/api/orchestrator/templates/install-pack/` (`{"pack": "office"}` →
`{installed, skipped}`) idempotent; requirement-bearing templates are listed as
"needs setup", never half-installed. Chat's rule 8 carries the routing in
place: one file yourself, a multi-step job via a specialist passing findings by
file. Tests: `agents/tests/test_install_pack.py` (idempotent, skips, ownership);
`test_gallery.py` covers the new templates by construction.

**A third axis: which tools (2026-09-20).** The grant says *whether*, the scope
says *which rows*, and `agent_context['toolScope']` says **which tools** — a
list of built-in names, empty meaning everything the grants unlock (the default
every scope here takes, because the field arrives after the agents that
predate it). It exists because the toolbox grew: an orchestrator holding six
grants carried every tool in them into every turn, and a model picks worse from
a longer list. It is validated against `GRANT_TOOLS` so a name no grant can
unlock is a 400 rather than a dead entry on a screen that implies otherwise, it
can only ever narrow, and it never touches `ALWAYS_AVAILABLE`/`RETRIEVAL_TOOLS`
— an agent that may not keep its own plan is not narrower, only more forgetful.
MCP tools stay out of it: their names are minted at runtime by a third party,
which is the question `connector_scope` already answers per connection.

**A fourth axis: how each tool may be used (2026-09-21).**
`agent_context['toolPermissions']` is `{tool_name: allow|ask|deny}` per
subagent — the autonomy ladder was one dial for the whole agent, so freeing
one noisy tool meant freeing everything and tightening one dangerous tool
meant interrogating the user about all of them. Same closed world as the
third axis (built-ins only, unknown/MCP/infra names are 400, empty means
today's behaviour), enforced at both doors: `deny` withholds from
`allowed_names` and refuses in `dispatch` with its own reason (the grant
*is* held, so "was not granted" would send the owner to flip a dead
switch), while `ask`/`allow` only move the approval gate via
`permissions.apply_tool_permission_overrides` after the mid-run switch is
resolved — so they survive a switch. They never widen past the grants
(`allow` on an ungranted tool stays unoffered), never touch the policies
(which return False for built-ins anyway), and flow parent → worker
most-restrictive-wins in `invoke_subagent`, or delegation becomes a way
around your own rules. Builder renders tri-state rows over the same
`grantedTools` memo as `toolScope` and prunes stale entries at save.
Tests: `agents/tests/test_tool_permissions.py`,
`src/lib/__tests__/toolPermissions.test.ts`.

**A coding team is a roster, a lead, and leases (2026-09-22).** The `code`
pack installs seven coding templates plus the `coding-lead` that orchestrates
them — scout, architect, implementer, test-writer, debugger, the existing
reviewer, and the integrator, the only role holding commit/push/PR — each with
its own tools, autonomy, contract (`code_plan` for the architect, `patch` for
the workers) and playbooks (`agents/playbooks/code/*.md`, shipped as code
because templates travel without ids). Two new per-agent limits follow the
existing grant/scope pattern: `writePaths` (which files) and `commandScope`
(test | lint | build | run | install | any, resolved against
`CodeProject.commands`), both empty-means-unrestricted and both intersected
parent → worker most-restrictive-wins — where `None` is unrestricted and `()`
is "may write nothing", because disjoint restrictions intersecting to
"unrestricted" would widen exactly the runs refused. Writing takes a
`CodeLease` (`workspaces/leases.py`): claims are leased atomically at dispatch
and implicitly at write, overlap is refused naming the holder, and leases
release on every terminal path plus the recovery sweep. The real guarantee is
the stale-write guard — `ws_read` returns the sha256 into the run's read set
and `ws_edit`/`ws_apply_patch` refuse what changed since, so a change from
another worker, the editor or a checkout is caught even when its notice was
missed. Decisions from §11: shared tree with leases (not worktrees), 3 workers
(`MAX_CODE_WORKERS`), implementer `auto` inside its claims, strongest model
for the lead, pack card with the roster under it in Explore. Tests:
`agents/tests/test_code_scopes.py`, `workspaces/tests/test_leases.py`,
`workspaces/tests/test_stale_write.py`, `agents/tests/test_install_pack.py::CodePackTests`.

**A lead dispatches without waiting (2026-09-22).** `invoke_subagent` blocks
until every worker ends, so a lead using it has no turn in which to react.
`chat/tools/tasks.py` splits starting from waiting: `start_tasks` leases
claims, opens each worker's log and spawns its run detached, returning handles
immediately (deps unfinished, batch-overlapping claims, missing claims for a
writer, and a fourth concurrent worker are all refused with the reason);
`wait_tasks` returns on the first event — done, failed, paused for approval, a
C3 file-change line, or timeout with progress. `task_status` snapshots leases
held and spend; `steer_task` posts into the worker's mailbox;
`stop_task` cancels the detached task (leases release, changes stay); and
`revert_task` (`sensitive`) restores `git checkout --` for tracked edits and
removes worker-created files, refusing anything someone else changed since.
Workers run depth+1 with a narrowed toolbox (no `subAgents`, so depth stays 1
for code), the spend share divided up front, and the write set narrowed to
scope ∩ claims — a claim outside the lead's scope writes nothing rather than
widening past it. The panel's per-worker buttons reach the same three verbs
over HTTP, addressed by execution rather than by agent
(`runs/<id>/steer|autonomy/`, and `cancel/` falls back to the detached cancel
for code tasks). Tests: `agents/tests/test_code_dispatch.py` (including the
lead-plus-two-stub-workers frame test the plan demands).

**A file change tells whoever read it (2026-09-22).** `_record_change` writes
the `CodeChange` row and then asks `workspaces/awareness.py` who is affected:
every live run whose read set holds the path or whose task claims cover it
(except the writer), told through the steering mailbox as a `notice` — drained
on the same edge but rendered as a `system` context message, never a user
turn, coalesced per path so three edits arrive as one line. The lead is always
told as one compact `wait_tasks` event, and may re-steer a worker whose target
changed shape. Correctness never rests on delivery: the stale-write guard
holds even when a notice is missed, and the bus (`code:<project_id>`) is the
same event the UI consumes, so there is no second copy. Tests:
`workspaces/tests/test_awareness.py`, `chat/tests/test_steering.py::NoticeTests`.

**The plan panel watches the team (2026-09-22).** `task_update` /
`lease_update` / `code_change` frames publish to the lead's sink (chat SSE
carries them as `data:` frames with no transport change) and `output_data`
gains `tasks`, so `/runs` redraws the lanes after the fact the way it redraws
todos and charts. `usePlanStream` + `lib/planStream.ts` hold lanes, locks and
changes beside `useChatStream` (worker heartbeats must never re-render the
transcript); `components/orchestration/PlanPanel.tsx` is a sticky right rail
on chat and `/runs` and a bottom sheet behind a progress pill on phones, with
per-lane Steer / Ask… / Stop / Open-run actions and elapsed timers in a leaf
component. When a run has tasks the transcript shows a "Plan updated (4/9)"
pill focusing the panel instead of repeating the list; chats without
delegation use the plan dock (next paragraph). Todo items carry optional
`owner`/`task_id` (ignored by `render`, so old lists read identically).
Tests: `src/lib/__tests__/planStream.test.ts`.

**A plan shows how it changed, not just where it is (2026-09-26).**
`update_todos` replaces the whole list, so the latest list alone made a step
dropped unfinished look exactly like progress. Now: `todos.record_revision`
keeps every distinct revision in `metadata.todo_history` (cap
`MAX_REVISIONS`, the **original plan is never trimmed**), which rides onto the
saved message and `output_data`; `todos_update` frames carry `revision`.
Items take an optional `note` — required in the tool's wording for `blocked`,
accepted-but-named when missing (a refusal would leave the old list
standing) — and `render` feeds it back as `(blocked: why)`. Each tool-call
trace entry carries `step`, the item `doing` when the batch was planned
(`todos.current_step`; `update_todos` itself is not filed). Frontend:
`lib/planView.ts` (pure, vitest) matches revisions by normalised text — no
ids, by design, so a reworded step reads as dropped + added — and tags
`added` (not in the original), `dropped` (removed unfinished), `removed`
(removed after done). One component draws it everywhere,
`components/plan/PlanView.tsx` (reasons, per-step actions, "Plan history");
`PlanDock` pins it above the composer (it used to stream inside the reply
and scroll away), `PlanSummary` is the one-liner on saved replies, and
`PlanPanel`/`/runs` render the same view. `TodoPanel` is deleted. Tests:
`chat/tests/test_todos.py::TransparencyTests`,
`src/lib/__tests__/planView.test.ts`.

**A worker's approval names the worker (2026-09-22).** HITL rows opened by a
detached task carry its label, task id and title (stamped into
`input_data` at launch), and `describe_call` renders them — "Implementer #2
(task t3: add retry) wants to run …" — passed in, never looked up. The `code`
pack installs with per-template overrides (`overrides: {slug:
{autonomy, writePaths, commandScope, …}}`) through the same serializer the
builder saves through, and the builder chat proposes the three new knobs
(`writePaths`, `commandScope`, `playbooks`).

**Evaluation for the team (2026-09-22).** The seven guardrail cases in
`CODING_AGENTS_PLAN.md` §9 are covered deterministically — leases, stale
writes, scopes, dispatch, awareness, recovery, command scope — each pinned in
the unit file named above rather than in paid model runs, because the
coordination refusals need a live workspace engine this environment does not
configure. What the benchmark harness gains is the grader the team suite will
need: `code_changes_within` (every `CodeChange` inside the task's claims,
populated by the runner from the execution) plus `code-lead` /
`code-implementer` bench agents. `work-code-team` itself — fixture repo, three
repeats, scored against `repo-assistant` alone — is defined in the plan and
still needs a workspace engine and the paid-runs go-ahead before it runs.

**Six tools, and the two that spend money ask first (2026-09-20).**
`download_file` (a URL the user named, kept as their file — the gap that made
"use the image from this page" impossible), `render_pdf` (the same blocks
`render_document` takes, because a `.docx` is what you edit and a `.pdf` is
what you send), `edit_workbook` (append rows and set cells while keeping the
formatting, charts and formulas nobody named — `edit_file`'s argument one
format up), `render_diagram` (boxes and arrows as data, laid out left-to-right
here: Mermaid would need a headless browser, and a model hand-authoring SVG
draws a different picture every time), `extract_data` (the extraction engine,
which had schemas, confidence and a review queue reachable only from its own
page) and `notify_user` (an unattended run's only way to say "this needs you";
capped per run so a loop cannot turn the feed into a log). `generate_image` is
now **`sensitive`**: a generation is billed per call, and a model that decides
to make four variations has spent four times what was asked for. Audio and
video generation stay off the tool surface deliberately — they cost far more
per call than anyone asking for them expects. Tests:
`chat/tests/test_new_tools.py`.

**Keep the file, admit the gap (2026-09-20).** Uploads were an allow-list of
seven readable formats, so the library was smaller than the platform: an agent
could *write* a `.xlsx` its owner could not *upload*, `.pptx` was refused
outright, and `.docx`/`.xlsx` attached to a chat message extracted to an empty
string while the UI showed an attachment. Now uploads are **allowed by default
and refused by exception** — native executables only (`BLOCKED_MIME_TYPES`), on
the reasoning that bytes here are inert (nothing executes an upload, downloads
are `as_attachment`, the sandbox runs the model's code and not the file) and
the one thing a shared library must not become is a malware channel. What the
platform cannot read it *keeps*: `file_type='other'`, no extracted text, and
`run_python_on_files` is how a rare format gets opened — which is why
`vfs.is_binary` now asks what a type is *not* (`TEXT_FILE_TYPES`), so those
bytes reach the sandbox as bytes. The default file type moved from `txt` to
`other` for the same reason the `.docx` bug existed: reading an unknown binary
as UTF-8 put zip noise in the search index, and an empty index entry is the
honest one. `.xlsx`/`.pptx` extractors were added on both doors (uploads and
chat attachments). Tests: `inference/tests/test_file_types.py`,
`chat/tests/test_attachment_types.py`.

**Outputs and hands: pages, images, a browser (2026-09-20).** Phases 5–7 of
`Backend/docs/SPECIALIST_AGENTS_PLAN.md`, each a grant-gated tool module so a new
"agent" is a gallery template rather than code. **Pages** (`publish_page`,
`inference/pages.py`): one write path for the API and the tool; a snapshot, not
a pointer; `link < platform < public`, default `platform`; every refusal the
same 404; HTML rendered at `/p/:slug` in an iframe sandboxed *without*
`allow-same-origin` under a no-network CSP, so a published page never runs with
this origin. An unattended run may publish only `link`. **Images**
(`generate_image`): the Imagine OpenRouter path, saved into the file scope so a
deck embeds it by path; `irreversible` because it spends money, and its cost is
read back from the `AgentStep.result` it already writes (`runtime._tool_costs`)
— no new column, resume-safe for the reason the turn rollup is. Unpriced is
*estimated*, never free. **Browser** (`browse_page`, `browser_act`,
`browsing/engine.py`): a remote Chromium behind `BROWSER_ENGINE` (`none` by
default — the tools are then not offered at all). Steps are data for one fixed
script over five verbs; nothing a model writes runs as JavaScript. Acting is
scoped by `agent_context['browserDomains']`, and **empty means read-only** — the
reverse of the older scopes, because no agent predates this one. Tests:
`inference/tests/test_published_pages.py`, `chat/tests/test_media.py`,
`chat/tests/test_browser.py`.

**A feature that passes every test and reaches nobody (2026-09-04).** The todo
list was built, streamed as an event and stored on the message — and no
component rendered it, so the whole feature was invisible while six suites
reported green. Each unit test covered one hop (tool → side effect → graph
state → metadata), which is exactly the arrangement that lets a chain pass
everywhere and connect nowhere. `chat/tests/test_turn_output_e2e.py` is the
answer: it drives the real graph and asserts on the two things a client
actually consumes — the events emitted, and the metadata left behind. It found
a real one immediately (a chat file write pauses for approval, since
`write_file` is in `SENSITIVE_TOOLS`; that is now pinned rather than
accidental, because `sensitive_tools_for` resolves the agent runtime's default
`ask` autonomy from the same list and clearing the tool flag would silently
stop every agent asking before it writes). Three surfaces followed: `TodoPanel`
and `ChartArtifact` in the transcript, the same two on `/runs` — which needed
`output_data` to carry `charts` and `todos`, because a run's metadata dies with
the graph and an agent that charted its findings was drawing for nobody — and
`render_chart` joining `ALWAYS_AVAILABLE`, on the same terms as `update_todos`:
it writes nothing, reaches nothing, and the drawing happens in the reader's
browser.

**A file the agent wrote is a card, not a sentence (2026-09-19).** The only
trace of a written file used to be whatever path the model chose to repeat in
prose. `chat/turn/agent.py::_on_file` turns every `write_file`/`edit_file`
result into `meta['files']` (one entry per `document_id`, updated in place;
`created` survives later edits; edits keep capped before/after text for a
diff), streamed as `files_update` and carried onto `output_data['files']` for
`/runs`. The card links by **id**, the one locator the file browser accepts —
`/documents?doc=<id>`. Paths in prose are linked too (`lib/vfsPath.ts`), but
only under `/Chat/` and `/Agents/`, and they resolve by **walking** folders one
`foldersService.list` hop at a time, mirroring `vfs._folder_at`, so no route
ever accepts a path. Inside a `FilePreviewProvider` (chat, runs) a plain click
opens a side drawer instead of navigating. Every surface previews through one
body, `components/files/FilePreview.tsx`, and draws code through one
`CodeView` (highlight.js core + registered grammars, a lazy chunk; plain text
first, colour when it lands, none past 150k chars). HTML files render in a
frame **stricter than `HtmlArtifact`** — empty `sandbox` plus a CSP refusing
all network — because a previewed file may be someone else's shared upload.
Tests: `chat/tests/test_file_cards.py`, `src/lib/__tests__/vfsPath.test.ts`,
`src/lib/__tests__/filePreview.test.ts`.

**Steering had no way in.** The mailbox, the queue, the node and both HTTP
endpoints existed; nothing in the frontend called them, so a person could not
steer anything. `handleSend` returned early while a turn was running, which
meant typing mid-turn did nothing at all. It now routes to
`chatService.steer`, and the composer's send button carries two meanings while
busy — with text it queues a steer, empty it stops the run — expressed at the
call site because four other screens share `SendButton` and none of them can
steer. `queued` and `dropped` are shown beside it: `dropped` is non-zero only
on overflow, and an instruction someone believes was accepted and that vanished
is the failure the queue exists to prevent.

**What a fan-out trims stays reachable.** Worker answers have been capped since
delegation existed — per worker, then proportionally across the fan-out — but
the cut text was simply *gone*: the notice said "[trimmed to N characters]",
the parent had paid for a whole worker run it could only partly see, and the
only way to the rest was to delegate the same task again. `bound_results` now
archives the full answer through `chat/tools/tool_output.py::spill` (public for
this caller) and names the id, so `read_tool_output` fetches it — the same
promise that tool already keeps for oversized tool results, through the same
store and the same retention. It became async for this, and it stays
best-effort: an archive that fails produces a notice saying the text was *not
kept* rather than one naming an id nobody wrote, which is the rule curation
already follows with indexing off. Tests:
`agents/tests/test_delegation.py::TrimmedAnswersStayReachableTests`.

**Async-Optional:** `RUN_WORKFLOWS_ASYNC=True` in `.env` routes execution through Celery workers. When `False`, workflows execute synchronously in the request cycle — useful for development and testing without Redis.

**Safe Code Execution:** the `execute_python` tool runs in a hardened sidecar
container (`sandbox_service/`) in production — a separate image with numpy/pandas,
on an internal-only docker network (no egress), `cap_drop: ALL`, read-only root,
non-root user, memory/pids caps, plus per-run `setrlimit` + `killpg` and a
best-effort seccomp filter. Even a full interpreter breakout lands in a
throwaway container holding no secrets. Local dev with no sidecar falls back to
the weaker in-process AST engine. Engine selection: `sandbox/engine.py`. Design:
`docs/SANDBOX_EXECUTION.md`.

**Credential Encryption:** All API keys are AES-encrypted at rest using `CREDENTIAL_ENCRYPTION_KEY`. The `credentials/` app handles key storage and is a dependency for any node that calls external services.

**Dual-Database:** Development uses SQLite (`db.sqlite3`, WAL + `transaction_mode=IMMEDIATE`). Production uses PostgreSQL through Django's own psycopg 3 **pool** (`settings/base.py::_postgres_connection`) — no PgBouncer. `docker-compose.prod.yml` is what production runs (its SQLite/Celery predecessor `docker-compose.ec2.yml` was deleted 2026-09-19). `DEPLOYMENT.md` (repo root) covers deploying and the migration steps and type coercions needed (NUL chars, booleans, line endings).

**OS state split by mutability (BrowserOS):** `OSProvider` publishes five contexts, not one.
`OSActionsContext` holds every method and never changes identity; `useOSWindows`,
`useOSShell`, `useOSNotifications` and `useOSAgent` carry state that changes at different
rates. Most apps only call actions (`notify`, `openApp`), so they subscribe to the stable
context alone and do not re-render when an unrelated notification or clipboard write lands.
`useOS()` remains as a wide compatibility facade — prefer the narrow hooks in anything that
renders often.

**Fail before you look busy:** a turn that cannot be paid for is reported, never performed. `chat/turn/pipeline.py` calls `llm.preflight()` before the first `STATUS` event and before the user message is persisted, so a missing credential raises `TurnError` while the screen is still empty. Provider failures are classified by `llm.classify_provider_error()`: 401/403 → `LLMAccessDenied`, 402 or insufficient-credit wording → `LLMQuotaExhausted` (both `LLMAccountError`), 410 or end-of-life wording → `LLMModelUnavailable`; everything else stays a transient error. The first three share the base `LLMUserActionable` — that, not `LLMAccountError`, is what callers catch to decide "raise, don't render". A retired model is deliberately *not* an account error: nothing is owed, so `agent_execute` answers 400 rather than 402. Unclassified provider bodies still reach the user, but through `llm.humanize_provider_body()`, which pulls the RFC 7807 `detail` / OpenAI `error.message` sentence out of the JSON — the raw payload used to be rendered verbatim in the assistant's own bubble behind a . Account errors propagate out of `agent.run_turn` as an `error` frame rather than being rendered as the assistant's reply — the old behaviour showed a spinner and then an apology in the model's voice for a problem only the user could fix. A transient provider failure that ends an agent run is **not** an answer either (2026-09-17): chat still shows the humanised sentence, but `Completion.error` carries it to `AgentState.provider_error` → `TurnResult.error`, and `run_agent` raises `AgentTurnFailed` so the run is recorded `failed` — the benchmark caught a run closed as `completed` whose answer was "⚠️ Upstream error from Alibaba: …" (`agents/tests/test_run_cancellation.py::CrashedTurnTests`). Agent runs enforce the same rule: `agents/agent/runtime.py` preflights in `start_agent_run` (before the `ExecutionLog` exists, so `agent_execute` answers 402 naming the provider instead of 202-then-a-dead-run) and again inside `run_agent`, for the schedules and triggers that never pass the view. Tests: `chat/tests/test_account_errors.py`, `agents/tests/test_agent_runtime.py::MissingCredentialTests`.

**A text-only model gets a witness, not a caption:** an image a model cannot see is not a dead end. `chat/vision/` is a second agent — a cheap NIM VLM (`nvidia/nemotron-nano-12b-v2-vl`) that holds the image in its own context — and the main agent interrogates it through the `ask_vision` tool. A caption is written before anyone knows what will be asked; a witness still has the pixels when the question arrives, and can be asked again. Three things make it safe rather than merely clever. It is **offered only when a witness resolves** (`get_available_tools` filters `ask_vision` out otherwise) because an advertised tool that cannot run is worse than one never offered. It is **bounded** — six questions per image per turn, counted against `TurnContext.turn_id`, which exists for exactly this. And it **surfaces doubt by disagreement**: the measured failure mode is a misread decimal (`4.8` → `48`) that is silent, plausible, deterministic at temperature 0 and unfixed by zooming, so retries and self-consistency cannot catch it — the only signal available is asking `nvidia/nemotron-parse` the same question and reporting when the two readings diverge. The answer is testimony, not sight: `chat/turn/prompts.py` rule 7 forbids "I can see that…". Blocked attachments now carry ids into the system prompt (`history.describe_for_model`) because an agent told a file exists but not its id can only apologise. Design and NIM measurements: `Backend/docs/VISION_AGENT.md`. Tests: `chat/tests/test_vision.py`.

**Resolving the witness is cached, because it was the pre-model hot spot
(2026-09-13).** `resolve_witness` is three uncached queries (`_configured`,
`_has_key`, `_retired`), and it ran *twice* per chat turn and then again on
every agent iteration — once in `run_chat_turn` and once per pass inside
`get_available_tools` via `_requirement_met("vision")` — for an answer that
cannot change while a run is going. The new `[Latency] pre-model` line put it at
the *entire* pre-model segment on an empty test database, before any real
credential table existed to scan. It is now cached per user for
`WITNESS_CACHE_TTL` (60s, matching `tools_config.overlay` and for its reason:
there is no invalidation hook here, so the TTL is the whole bound). Two things
are load-bearing. **The absence of a witness is cached too** — a user with no
vision credential is exactly the caller who pays all three queries, so caching
only the hit would leave them resolving live on every pass. And a **cache
failure resolves live** rather than answering "no witness": losing the fast path
must not silently take away someone's eyes. Note the test hazard this creates —
the key is a user id and test databases restart their sequences, so cases that
resolve a witness must `cache.clear()` in `setUp`, the same trap
`CredentialManager`'s process-global cache documents.

**The system prompt is a baseline, not a scratchpad:** `prompts.build_system_message` may only contain what is stable for the whole session — the session's own prompt, the core rules, the memory rule. Everything that moves goes to `prompts.build_context_update` and rides as a trailing `system` message in history (the shape `llm.clamp_input` already uses for its trim notice), landing after the prior conversation and before the user's prompt. The clock used to sit in the system message, which meant the request prefix differed on *every single turn* and no provider could ever reuse a cached prefix. Memory-off means no prior conversation, not an empty `history` list — the clock is not recall. The update also carries the session's approval mode (`AUTONOMY_NOTES`: `plan`, `review`, `auto`; nothing for `ask`) — the model planned to delegate in `plan`, where delegation is withheld — and, when `to_wire_history` had to drop the oldest window messages for budget, how many. Tests: `chat/tests/test_context.py`.

**A chat's earlier turns come from one place: the database (2026-09-28).** Chat keys the checkpointer by session id, and `AgentState.messages` uses the `add_messages` reducer, so each new turn's `[HumanMessage]` was *appended* to every earlier turn's checkpointed transcript — and `agent_node` sent `turn.history + checkpoint`. Every request carried the conversation twice: once windowed and summarised from `ChatMessage`, once in full with every old tool call and result, growing without bound (chat had no curation; `prune.py` drops old checkpoint *rows*, never messages in the latest). It also made `_turn_number` count the whole session's iterations against this turn's limit, so a long chat reached the tool-call cap on a turn's first call. `run_turn(fresh_transcript=True)` (chat only) starts a new turn with `RemoveMessage(REMOVE_ALL_MESSAGES)`; a **resume** never clears, so approvals still resume from their checkpoint. Agent runs don't pass it: their thread is new every run. With one turn in the checkpoint, chat now also curates (`curation.CHAT_POLICY`: compaction + indexing, no paid fold), because as the orchestrator one chat turn can run many iterations. Found by a test that asserts on what reached the provider on turn 3; every unit test passed with the bug. Tests: `chat/tests/test_chat_transcript.py`.

**A long run curates its own transcript, and what it cuts stays reachable.** An agent run has no conversation, only a transcript that grows: `agent_node` resends `history + to_wire(state["messages"])` every iteration, 40 iterations are allowed, and each tool result may be 64k chars. The only thing between that and the provider was `llm.clamp_input`, which had three faults — it dropped one *message* at a time, so an assistant turn could leave while the `tool` messages answering it stayed (a `tool_call_id` referring to nothing, which providers answer with a **400**, so a long run did not degrade, it died); it summed only `content`, and a tool-calling entry keeps its payload in `tool_calls[].arguments`, so the largest entries scored zero; and it applied a flat 96k to an 8k model. All three are closed in `llm/budget.py`, whose unit is the **segment** (an assistant tool-call turn plus its results, indivisible). Above that, `chat/turn/curation.py` is the deliberate version, wired to the builder's three long-dead toggles: `compaction` replaces old tool *results* with a record naming the call (free), `recursiveContext` folds the oldest steps into **exactly one** running note via a cheap model (the agent's own `summaryModel`, else `CONTEXT_SUMMARY_MODEL` — pinned to NVIDIA because that is the provider the platform holds a key for, so the fold works for a user who has connected nothing; charged to `total_tokens` so it counts against the spend cap), and `indexing` archives everything removed to `ToolOutput` so `recall_context` / `read_tool_output` can fetch it — which is why those two are in `RETRIEVAL_TOOLS`, dispatchable always and *offered* only once the run has stored something. Three properties carry it. It **edits graph state**, not the outgoing copy: replacements carry the ids they replace so `add_messages` substitutes them, or every later turn re-archives the same text. It fires at a **watermark** (0.70 of budget, cutting to 0.45) rather than trickling, because curating every turn would rewrite the request prefix on every call and forfeit prefix caching — the clock-in-the-system-prompt trap. And **with indexing off the notices say the text is gone** rather than naming an id nobody wrote. Chat passes `curation.CHAT_POLICY` (compaction + indexing, no fold) since 2026-09-28 — see "A chat's earlier turns come from one place". Design: `Backend/docs/CONTEXT_LIFECYCLE.md`. Tests: `chat/tests/test_curation.py`, and `chat/tests/test_curation_e2e.py` — twenty real turns through the real graph against a stub provider, asserting on what actually left for the provider, because every unit test here passes with the pieces wired to each other wrongly.

**A default has to be runnable, and a platform key is what makes it so.**
The shipped defaults are `openrouter` + `openrouter/free` + `medium` effort
(2026-09-03), set on `ChatSession`, on `UserProfile`, and in the frontend's
`DEFAULT_PROVIDER` / `DEFAULT_MODEL` / `DEFAULT_EFFORT` — three copies that
`llm/tests/test_effort.py::ShippedDefaultTests` pins to each other. They moved
off NVIDIA because every `nvidia/*` row answers **410 Gone** upstream, so the
previous default named a model that could not answer; a *router* id is the only
default that survives individual models being retired, because which model
serves it is chosen upstream per request. Two consequences, both load-bearing.
**`OPENROUTER_API_KEY` is now required** — NVIDIA shipped a platform key and
OpenRouter does not, so the move traded a dead model for a missing key, and
without it the picker still *offers* the free router (`is_free` models are
offered before any credential exists) while the turn fails at preflight:
offered but unrunnable. And **whatever the default provider is must have a key
in `settings/test.py`**, which is what 13 `chat/tests/test_pipeline.py` tests
discovered when the default moved — they assert nothing about the provider,
they rely on the shipped default being runnable, which is exactly what a
platform key provides. The seed script's row for the default model must also
declare an `effort=` covering the default level, or the shipped effort is
snapped away on the first message and is not the shipped effort.

**Effort is a preference; which rungs exist is a capability, and they are
decided in different places.** Every current reasoning model takes some version
of "how hard should you think", and every provider spells it differently —
OpenAI sends `reasoning_effort`, OpenRouter wraps it as `reasoning: {effort}`,
Ollama calls it `think`. `llm/effort.py` holds the vocabulary all three
translate from (`LADDER` = `none | minimal | low | medium | high`), and the
spelling stays in the handlers as a `reasoning_payload` hook returning a
*fragment* rather than a value, because the providers disagree about shape and
not just about the field name. Four things carry it. **An empty
`AIModel.effort_levels` is a claim, not an absence** — it says the model has no
effort control, which is why nothing reaches the wire for it; sending
`reasoning_effort` to a model that does not take it is a hard 400 on OpenAI, so
"we have not checked" and "it has none" must look identical downstream, and the
catalogue's default is therefore `()`. **The snap happens in `llm/access.py`
and nowhere else**: it is the only place that knows both what the caller asked
for and what this model serves, and a level the model lacks is moved to its
nearest rung rather than refused — a user picks `high`, then picks a different
model in the same conversation, and failing a turn over a preference is the
wrong trade (ties break *downward*, so a tie-break never costs money). Because
the resolution is synchronous on the hot path, support is read from a cache
`preflight` primes, exactly as `budget.context_window` is and for the same
reason: an `await` added inside `_build_request` is a suspension point in every
model call. **`""` and absent are different values** all the way through — on
the wire (`llm_effort`), in `TurnRequest`, and in the session sync: absent means
the client said nothing so a stored level stands (which is how a client
predating the field keeps working), while `""` is an explicit request for the
model's default and is the only way back *off* the knob. Spelling that guard as
truthiness makes the setting one-way, which is the bug the tests pin. And the
ancillary calls a turn makes on the user's behalf — the curation fold, the
follow-up questions — pass `effort="none"` deliberately: the user chose an
effort for their *answer*, and paying a reasoning pass to compress a transcript
or format three questions is the one place the knob costs money for nothing.
The control is **always rendered**, including for a model with no
rungs, where it says so: hiding it meant a returning user — whose stored model
is whatever they picked before the feature existed, and 19 of 64 catalogue
models have no effort control — saw nothing at all, which reads as "never
built" rather than "not supported here". Absence cannot explain itself, and it
cannot say *pick a different model*.
Tests: `llm/tests/test_effort.py`, `llm/tests/test_effort_funnel.py`,
`chat/tests/test_effort_plumbing.py`, `agents/tests/test_effort.py`,
`src/hooks/__tests__/effort.test.ts` (which pins the ladder against the
backend's, the same way the cron wording is pinned).

**A knowledge base an agent may search is a scope, not a label.** The builder's KB selection was read only to print names into the system prompt: `knowledge_base_search` resolved any KB the *user* owned, so an agent configured for one corpus could read every other one — and with `kb_id` omitted it fell through to the user's **default** KB, which need not be one of the agent's at all, so an answer from the wrong corpus looked exactly like an answer from the right one. It is now `kb_scope_for(gathered)` → `TurnContext.kb_scope` → the tool context, built and carried exactly like `FileScope`. **`None` is unrestricted and an empty selection is `None`**, because an agent built before enforcement never had one applied and turning it on must not empty its corpus. No `kb_id` resolves *within the scope* — the single KB if there is one, otherwise a request to name one — never the user's default. All five KB tools honour it including `read_document`, which addresses a *document* id rather than a KB and would otherwise be one call away from making the other four irrelevant. `GRANT_TOOLS['rag']` unlocks all five for a related reason: it unlocked two, while `list_knowledge_bases`' own description tells the model to use `keyword_search` on a keyword KB and `list_documents`/`read_document` on a raw one — the catalogue was instructing the agent to call tools it would then be refused, and a keyword- or raw-backed KB was unreadable. The prompt now carries id, backend and doc count rather than names, because the id is what the tools take and the backend decides which tool can read it at all — a semantic search against a keyword index returns *nothing*, not an error. Tests: `chat/tests/test_context_acquisition.py`.

**What a fan-out sends down is bounded too, and shared once.** Worker answers have been capped since delegation existed; the *instructions* were not, and that is the direction that multiplies — a task is copied into every worker's window. `check_delegation_payload` caps task length, briefing length and worker count (`MAX_PARALLEL_WORKERS` capped concurrency only, so fifty tasks still meant fifty full runs), and **refuses rather than truncates**: a trimmed instruction is a worker confidently doing the wrong job, and unlike a tool result arriving from outside, the author is a model that can be told to shorten it. `invoke_subagent` takes a **`briefing`** sent to each worker once instead of the same background pasted into all N tasks; it lands in the worker's system prompt as *context, not instruction*, because a worker that treats its briefing as the job does the wrong one. And `TurnContext.archive_scopes` gives a worker **read-through to its parent's archive** — one hop, read-only, ownership still checked per query — because otherwise curation and delegation work against each other: the parent curates a detail away, delegates a task needing it, and the worker (a fresh thread) cannot reach the text the parent could no longer restate. Tests: `chat/tests/test_context_acquisition.py`, `chat/tests/test_curation_e2e.py`.

**Tool output is bounded centrally, and what is cut stays reachable:** every tool that knows what its result costs caps it (deep research 60k, `read_url` 15k, sandbox stdout 20k); nothing capped the ones that don't, above all MCP tools, whose responses come from a third-party server. `chat/tools/tool_output.py` enforces `TOOL_OUTPUT_CHAR_LIMIT` as a backstop *above* every deliberate budget, so a tool that spent its own allowance is never trimmed twice. Over the limit, the full text lands in `ToolOutput` and the model gets a preview that names the omission, the id, and `read_tool_output` — the point is that a truncated result and a genuinely short one must not look alike, which is exactly what `clamp_input`'s silent middle-trim did. Bounding happens *after* the observer and the UI side effects, since by then the only reader left is the model. A failed spill does not fail the tool call; the notice just stops promising an id. `read_tool_output` is withheld until the session has actually spilled something, and is scoped to owner *and* session. Tests: `chat/tests/test_tool_output.py`.

**Approval is a policy over the call, not a list of names:** `SENSITIVE_TOOLS` holds built-ins, and could never hold MCP tools — their names are minted at runtime from a third-party catalogue, while `credential_injector` hands them the user's real keys. `chat/tools/permissions.py` closes that: a credentialed MCP call is gated unless its name starts with a read-only verb. The allowlist is that way round on purpose — guessing "write" costs a click, guessing "read" sends the email. Reads are exempt in chat because a human wrote the message and is watching; `unattended_policy` withdraws that exemption for agent runs, where neither is true, and `autonomy='full'` opts out entirely via `permissions.never`. `ToolPermission` stores "always allow" so the surviving prompts stay ones the user has not already thought about. `/api/chat/execute-tool/` consults the same policy — it was a way to run exactly the call the loop would have paused for. Tests: `chat/tests/test_permissions.py`.

**Autonomy is a ladder with five rungs, and the middle three are the point.** A user given only "ask about side effects" and "run unattended" picks the second one — once, in advance — and stops reading every prompt thereafter, which is how a permissions system becomes decorative. `AUTONOMY_LADDER` (`agents/agent/runtime.py`) is `plan | review | ask | auto | full`, and each level resolves to a *pair*: the names that gate on sight, and the policy judging the calls no name list could contain. It has to be a pair because MCP names are minted at runtime, so a level defined by names alone would exempt exactly the tools holding the user's credentials. **`auto` gates on `effect`, not on `sensitive`**, because those answer different questions — "what happens if nobody was asked" versus "ask a watching human in chat" — and they disagree in both directions: `write_file` is sensitive yet recoverable (a delete goes through `recycle.trash` into the user's own recycle bin), while `execute_python` is neither. Every tool declares `effect="read" | "reversible" | "irreversible"` on `@tool()`, the same way `parallel` and `sensitive` are declared, and it **defaults to irreversible** so an unregistered name — every MCP tool, always — can never make a loose level looser by accident. **`plan` withholds rather than gates**: a gate the user can approve is `review` with a better name, so the toolbox removes the mutating tools and drops MCP wholesale, and with nothing left to approve `approval_policy_for('plan')` is `never`. Tests: `agents/tests/test_autonomy.py`.

**A mode chosen before the run cannot answer a question raised during it.** `SubAgent.guardrails['autonomy']` is build-time configuration, decided before anyone knows what the run will do; a person watching it pause for the sixth time on the same recycled file write could otherwise only kill it and edit the agent. So the level is also a *mid-run* message, and it rides the mailbox that already exists for exactly this shape of thing — `chat/turn/steering.py`, drained on the `tools -> steering -> agent` edge. It is a second field rather than an `extras` key because of one difference that matters: a steer is **drained** when delivered, being an instruction to act on once, while a mode is a standing answer that has to survive every later batch. `tools_node` reads it per batch (`TurnContext` is frozen, so nothing can be mutated in place) against `approval_modes`, a table the runtime precomputes because resolving `review` needs the run's toolbox and `chat/turn/` knows nothing about grants. Two deliberate refusals: `plan` is not switchable (the toolbox is already built, so it could only gate, not withdraw), and a change is **not retroactive** — a call already paused still needs an answer, because the looser setting arrived after the question and treating it as an answer is how consent gets laundered. `POST /api/orchestrator/agents/{id}/autonomy/`. Tests: `agents/tests/test_autonomy.py::MidRunSwitchTests`.

**An approval that only has "once" and "for ever" will be answered "for ever".** `approve_tool_call` took a boolean `remember`, which wrote `ToolPermission` with an empty `session_key` — a standing allowance over, say, the user's mailbox — and the button offering it said only "remember". Someone who wants to stop being asked for the rest of the run they are watching had no way to say that, so they said "for ever" to get through the afternoon. `scope` is now `once | session | always`, and `session` fills in a column that had existed unwritten since the model was added. The key is passed in rather than taken from `thread_id`, because the two coincide only sometimes: an agent run uses its thread id as its session id, while a chat turn with memory off gets a throwaway `<id>:nomem:<uuid>` and `permissions.is_remembered` matches on the real session id — key it on the thread there and the row is written, matches nothing, and the user is asked again having been told they would not be. Still keyed on the tool and not on the call's arguments: narrowing further needs a way to *show* the user what they are agreeing to, which is a question about the prompt, not about storage. Tests: `agents/tests/test_autonomy.py::ApprovalScopeTests`.

**Routes are lazy; the auth screens are not.** Every page in `App.tsx` is a
`lazyPage(() => import(...))` behind one `<Suspense>`, except Login / Signup /
ForgotPassword / GoogleCallback, which are the first paint. Before this the app
shipped as a single 1.23 MB chunk — the markdown stack and every page's deps
downloaded behind a login screen that uses none of them. (ReactFlow and dagre
were the worst of it; both left with the canvas.) Adding a page means adding it
to the lazy block, not to the static imports.

**Nothing returns an unbounded list.** DRF's `DEFAULT_PAGINATION_CLASS`
(`PAGE_SIZE: 20`) never applies to `@api_view` function views, and most of this
API is function views — so "pagination is configured" was true and meaningless.
Caps live in `workflow_backend/thresholds.py` (`EXECUTION_NODE_LOG_LIMIT`,
`EXECUTION_STREAM_LOG_LIMIT`) and a capped response says so in its own body
(`node_logs_truncated`, `truncated`), because a truncated list and a complete
one must not look alike. When adding a list endpoint on a function view, the
cap is yours to set.

**A ticking clock belongs in its own component.** `components/chat/ThinkingTimer.tsx`
owns the 10 Hz interval that used to live in `StandaloneChat` and `ChatPanel`,
where each tick re-rendered the whole transcript and re-parsed every message's
markdown. `MarkdownMessage` is `memo`'d for the same reason. Anything that
updates faster than the user reads gets isolated the same way.

**A command is structured input, not a prompt template (2026-09-21).**
`chat/commands/` is the P10 registry, declared the way tools are
(registration *is* the schema): `registry.py` (`@command`, `Arg` kinds,
`client | action | turn`), `resolve.py` (parse + validate + complete, sharing
predicates with `AgentSerializer`, `visible_servers_sync` and `vfs`), one
module per domain (`agents`, `missions`, `memory`, `review`, `session`,
`library`, `shortcuts`). The client sends `TurnRequest.command = {name, args,
text}` and the backend resolves it; a typed `/line` is parsed by the same
code. Three rules carry it. **One copy**: a frontend template would drift
from the tools, grants and contracts it depends on (the cron-wording
problem), bypass validation, and leave other clients with nothing — so the
registry is backend code. **Consent covers the first action only**: `/agent`
starts the run without the `run_agent` card (like the Run button), `/goal`
does nothing until its confirm sheet is pressed; every later tool call is
gated as usual. **The turn is unchanged**: the expansion rides the trailing
context message (never the system prompt — the clock trap, pinned by the
prefix-cache test), the command is stored on both messages
(`metadata.command`) so the transcript shows a chip and regenerate replays
it, and an unknown line is a 400 under the input, never a model turn.
`/agent` delegates (never hands off) with `caller='chat'` and refuses in
`plan` mode; `/code-review` runs the `reviewer` template under `plan` with
read tools and the new `findings` contract; `/memory` writes through
`core/memory.py`. The mission routes P7 left out (`POST /api/missions/` +
list/pause/resume/cancel) ship here, through the same service
`start_mission` uses. GUI: `CommandPalette.tsx` (leading-`/` only, 44px rows,
sheet on phones) + `CommandCard.tsx` (confirm sheets are the approval).
Tests: `chat/tests/test_commands.py`, `src/lib/__tests__/commands.test.ts`.

**A finished run drops its checkpoints; a paused one keeps them.**
`MemorySaver` has no eviction — no `maxsize`, no TTL — so every super-step it
ever wrote stayed resident for the life of the process, and a run's transcript
grows quadratically in its own iteration count. Agent runs made it sharpest:
each gets a fresh uuid `thread_id` and every fanout worker gets another, so a
finished run's checkpoints could never be reached again and nothing deleted
them. `chat/turn/agent.py::forget_thread` is called on all three terminal paths
(completed, failed, cancelled) and deliberately *not* on `paused`, which is the
one case that still needs its checkpoint — the approval resumes from it. It is
best-effort: failing to free memory must not fail a run that already has its
answer. Tests: `logs/tests/test_checkpoints.py`.

**Whether a run survives its process is a setting (2026-09-04).**
`chat/turn/checkpoints.py` selects `memory | sqlite | postgres` from
`AGENT_CHECKPOINTER`, the same one-door shape as `sandbox/engine.py`. In-process
was fine while a run meant a chat turn; an agent run goes 40 iterations across
up to two hours as a *detached task*, so a deploy took it with no error
anywhere — the `ExecutionLog` simply stayed `running` for ever and the user
watched a stream with no producer. Three consequences. The graph is now
**compiled lazily** (`agent.py::get_graph`, with PEP 562 `__getattr__` keeping
`chat_agent_graph` importable): `AsyncSqliteSaver.__init__` calls
`get_running_loop()`, so an eagerly compiled graph could only ever hold an
in-process saver — it silently did, which is the failure this whole change is
about. The saver gets its **own SQLite file**, never `db.sqlite3`, because
checkpoint writes would otherwise take the single write lock on the application
database on every super-step. And a misconfigured `postgres` saver **raises at
startup** rather than degrading to `memory`: durability that silently is not is
worse than never claiming it, because the recovery sweep would then find rows
to resume and no state behind them. Dev defaults to `sqlite`; `settings/test.py`
pins `memory`, since one shared checkpoint file across a test run leaks state
between cases that reuse thread ids.

**A run whose process died is swept up, not left running for ever.**
`agents/recovery.py` finds `running` rows and either resumes or closes them.
The orphan test uses **only the row and the agent's own declared
`maxRunSeconds`** plus a grace — deliberately not process ids or boot times,
which report every run started by a *sibling* worker as orphaned and kill it
mid-flight. What happens next depends on two separate questions, and conflating
them is the trap: `checkpoints.is_durable()` is about configuration, while
`_has_state(thread_id)` is about *this* run — a saver switched on after a run
started answers yes to the first and no to the second, and resuming there would
redo work already charged for. So a resume needs both, and everything else is
failed with a message saying the run was interrupted. It resumes on the
**original execution id**, for the reason `resume_agent_run` gives: a trace
split across two ids cannot be joined. `_fail` re-reads under the write because
the sweep may run beside the process that owns the run. Reachable as the beat
task `orchestrator.recover_runs` and as `manage.py recover_runs` — the same
split as every other sweep here, and the reason is sharpest for this one: it is
the recovery path for a dead process, so a broker-only design would be missing
exactly when it is needed. Tests: `agents/tests/test_recovery.py`.

**A call that produced nothing is retried; a provider's own error is not
(2026-09-17).** `openai_compatible.stream_execute` failed a whole run on one
`httpx.ConnectError` — the stress benchmark lost two 20-minute runs to a DNS
blip, reported as the bare "OpenRouter error: " because that exception
stringifies to "" — and lost a 12-iteration month-end close to one read timeout.
Two retries (`STREAM_CONNECT_RETRY_DELAYS`, ~4s total) cover failures to *reach*
the provider and timeouts, and only while nothing has been emitted:
once tokens have reached the caller a retry would repeat them, which is why the
guard is `emitted`, not a count. An HTTP status the provider actually answered
with is never retried — 401 and 402 are not transient, and retrying a 429 is how
a rate limit becomes an outage. `_describe()` falls back to the exception type
so no error is reported as empty. Tests: `llm/tests/test_stream_retry.py`.

**A sandbox timeout kills the code, it does not just stop waiting.**
`Thread.join(timeout=...)` returns; it interrupts nothing, and a daemon thread
only dies with the process — so an overrunning execution was reported to the
model as "Execution Timeout" and then kept running, a `while True` burning a
core behind a turn that looked like it had failed cleanly. `safe_execution.py::
_stop_thread` raises `SystemExit` into the thread via CPython's
`PyThreadState_SetAsyncExc`, which lands at the next bytecode boundary. It
cannot interrupt one long C-level call (`[0] * 10**10` allocates in a single
step), so it *reports* whether the thread actually died and the error message
says so rather than claiming a kill that failed — and that honest ceiling is
why the in-process engine is a dev-only fallback: the production sidecar
(`sandbox_service/`) runs each snippet in its own process and `killpg`s the
whole group on timeout, with a kernel memory cap, so a runaway cannot survive.
Tests: `sandbox/tests/test_timeout_kill.py`, `sandbox/tests/test_engine.py`,
`sandbox_service/tests/`.

**A connection is reused, not reopened (2026-09-17).** Three per-call
handshakes were on the hot path. **Postgres** ran `CONN_MAX_AGE=0` — right
under ASGI, where a held connection per Daphne thread exhausted the server —
but with nothing in its place, so every request connected and authenticated
from scratch; `_postgres_connection` now configures Django 5.1's psycopg 3
pool, whose `max_size` is a hard per-process cap that must stay under
`max_connections` (25 in prod). A pooled connection is only returned when
`close_old_connections` runs, which `spawn()` already does when a task ends —
so a detached run holds one for its whole life, and the pool is sized for
concurrent runs. **Outbound HTTP** opened `async with httpx.AsyncClient()` per
model call, discarding the pool httpx exists to provide; provider, guest,
Google and vision calls now use `workflow_backend/httpclient.py::shared_client`
(one client per event loop — a connection belongs to the loop that opened it,
and tests and commands each run their own). Pass `timeout=` per request and
never `async with shared_client()`, which closes it for everyone. And the
three **custom middleware** were sync `MiddlewareMixin` hooks that Django hopped
onto a thread for on every request; `core/http/middleware.py::HybridMiddleware`
runs them inline in both modes, handing hooks a user id rather than the lazy
`request.user`, which reads the session store and raises in async. Tests:
`workflow_backend/tests/test_httpclient.py`,
`core/tests/test_hybrid_middleware.py`, `chat/tests/test_session_list.py`.

**Detached background tasks:** anything that outlives its HTTP response — a streamed chat turn (`chat/turn/runs.py`), an agent run (`agents/agent/runtime.py`), a periodic log flush (`logs/logger.py`) — must be started with `workflow_backend.background.spawn()`, never bare `asyncio.create_task` / `ensure_future`. Django's ASGI handler runs each request inside a `ThreadSensitiveContext`, and sync middleware calling into an async view installs a `CurrentThreadExecutor`; both live in contextvars that `create_task` copies, so a detached task inherits an executor that dies with the response and every later ORM call raises `RuntimeError: CurrentThreadExecutor already quit or is broken` — logged *after* the request's own 200 line. `spawn()` starts the task in a fresh context with its own executor. Regression tests: `workflow_backend/tests/test_background.py`.

**MCP with Credential Injection:** `mcp_integration/` wraps MCP server responses with tool caching and user-scoped access control. Credentials are injected from `credentials/` app at tool invocation time, never exposed to the client.

**Curated connections are shared templates:** `MCPServer` rows with `user IS NULL` are
visible to everyone, so their config is read-only over the API. Enable/disable is *not*
config — it is per-user state in `MCPServerPreference`, and `effective_enabled` on the
serializer is what a UI renders. Flipping the shared `enabled` flag instead was the
source of `PATCH /api/mcp/servers/<id>/ -> 403`: the page offered a toggle the API was
right to refuse. `_visible_servers_queryset` honours the preference, so turning a
connection off actually withdraws its tools from the agent rather than just greying a
switch. Tests: `mcp_integration/tests/test_connections.py`.

**Connector metadata is data, not code:** name, tagline, category, icon slug, and help
URL live on `MCPServer`. Adding a connector is a fixture row. The frontend maps only
`icon_slug` → icon component, because an icon cannot be serialised — never key
presentation off `name`.

**A catalogue row is a claim that something starts, and the claim is checked.** The
curated set shipped six rows naming npm packages that were never published, and it went
unnoticed for months because `/tools/` timed out at 5 s — shorter than the ~8 s `npx -y`
needs to resolve *anything* — so a healthy connector and a fictional one returned the
same bare 502. Three separate faults produced that one log line, and each is now closed:
the budgets are split by caller (`CONNECT_TIMEOUT` 25 s, `LIST_TOOLS_TIMEOUT` 30 s for
the page, `AGENT_LIST_TOOLS_TIMEOUT` 8 s for a turn); every failure carries a `code` and
a message built from the child's own stderr, so a missing package says `npm error 404`
(`_StderrTap`, plus `_describe` to flatten anyio's `ExceptionGroup`); and a failed
connect is remembered for 60 s so a broken row is not re-dialled per click.
`test_fresh_install.py::CuratedPackageTests` pins each enabled row to a package that was
verified by starting it and reading back its tool list, so a repoint is a deliberate
edit rather than a silent one. Google Workspace is disabled rather than repointed: every
available server authenticates through a browser flow against an on-disk
`gcp-oauth.keys.json`, which env-var credential injection cannot drive. The `Dockerfile`
pre-warms the npx cache for the enabled set — cold `npx -y` is 21 s against 3 s warm, so
without it the first click on every connector times out.

**A connector gets an allowlisted environment, never ours.** A stdio MCP server
is third-party code we spawn, and its env was built as `{**os.environ, ...}` —
which under `docker-compose`'s `env_file` is the whole of `Backend/.env`. Every
curated npm package was therefore handed `SECRET_KEY`, `POSTGRES_PASSWORD` and
`CREDENTIAL_ENCRYPTION_KEY`, the master key for *every* user's vault, undoing
in one dict splat the entire point of resolving per-user and injecting only
mapped fields. `client.py::_build_subprocess_env` replaces it with
`_ENV_PASSTHROUGH` plus `_ENV_PASSTHROUGH_PREFIXES` (`NODE_`/`NPM_`/`UV_`),
precedence `passthrough < server.env < resolved.env_vars`. Two names are
load-bearing and must never be dropped: `PATH` (npx is unfindable without it)
and `NPM_CONFIG_CACHE` (the Dockerfile's pre-warm cache — without it every
connector goes cold and races `CONNECT_TIMEOUT`). Match case-insensitively:
Windows spells them `Path`/`Temp` and upper-cases `os.environ` keys, POSIX does
neither. Tests: `mcp_integration/tests/test_subprocess_env.py`.

**A credential file is rendered by the injector and owned by the worker.** Some
servers read credentials from disk rather than the environment
(`@isaacphi/mcp-gdrive`, `@cocal/google-calendar-mcp`), which is the only reason
Drive, Sheets and Calendar could not ship alongside Gmail. `credential_file_map`
is the *same* `{slug:field}` substitution `credential_header_map` already does,
with a different sink: `{"filename", "target": "file"|"dir", "content"}`, where
`content` is a JSON tree whose string leaves are filled (keys are not — a
placeholder in a key would make the document's *shape* depend on a secret).
`resolve()` renders and returns; it deliberately writes nothing, because
`validate()` calls it on every Connections page load and a dry run must not
scatter refresh tokens across the filesystem. `_SessionWorker` materialises into
a fresh `mkdtemp` (0700, files opened 0600 before the first byte) and removes it
on unwind — **the same task that created it**, which is the rule that class
already exists to enforce, and here it is what stops a plaintext refresh token
outliving the session. One directory per `(server_id, user_id)` falls out of the
pool key, so two users of one curated row never share one. Filenames are
rejected if they contain a separator or `..`: the map is editable on a user's
own server. Tests: `mcp_integration/tests/test_credential_files.py`.

**Credential resolution has one door.** `credential_injector` used to carry its
own lookup and its own decrypt, so it had neither the 5-minute cache nor the
OAuth refresh that `credentials/manager.py` already implemented; it now resolves
through `CredentialManager.lookup_by_slug_sync` + `get_credential`. Three things
learned in the merge, all pinned by tests. A blob field **wins** over the
same-named token column — the blob is where a hand-entered credential lives, and
shadowing it with a leftover column is how a credential the user just typed in
stops working (`test_credential_bridge.py::test_a_blob_field_wins_over_the_column`);
do not "unify" this to column-wins. `refresh_token` is merged as well as
`access_token`, because MCP connectors are handed the refresh token and renew
for themselves. And `refresh_oauth_token` must `refresh_from_db()` after
delegating to `Credential.get_valid_access_token`, which writes through a
`select_for_update` re-fetch and leaves the caller's instance stale. Note the
manager's cache is a **process-global singleton**: tests that resolve
credentials clear it in `setUp`, because test databases restart ids at 1 and
`{user_id}:{credential_id}` then collides across cases.

**A pooled MCP session lives in its own task.** `_SessionWorker` opens the transport and
unwinds it in the same task, because both transports are anyio task groups and a task
group may only be exited by the task that entered it. Previously a session opened by one
request and evicted by another raised `Attempted to exit cancel scope in a different
task`, which `_evict` swallowed — orphaning the stdio subprocess, one per eviction, for
the life of the process.

**The pool is bounded by use, and the tool catalogue has a floor (2026-09-13).**
Two separate cold-start failures, fixed together. **`_pool` had a TTL and no
size cap**, so the number of live stdio subprocesses was set by how many
connectors people happened to touch rather than by configuration — on a
RAM-tight box that is the shape of an OOM, not of a cache. It is now an
`OrderedDict` with `MAX_POOLED_SESSIONS` (`MCP_MAX_POOLED_SESSIONS`, default 6);
`_touch` marks recency where a session is actually *borrowed*, because evicting
by age throws out the connector every turn is calling and keeps one touched an
hour ago. The TTL stays alongside the cap — they answer different questions
("how many may live" vs "how long may an idle one hold a subprocess"), and
`_trim_pool` now reaps expired entries on every insert, which is what makes the
TTL mean something on a quiet box where nothing ever asks for that key again.
The cap is **soft**: a session someone is mid-call on is never evicted, because
sitting one over it for the length of a call beats breaking the call. Eviction
still routes through `_evict`/`_SessionWorker.close`, and an LRU evicts *more*
often than a TTL did, so that constraint takes more load rather than less — the
close is detached (`spawn`) because it waits up to `CLOSE_TIMEOUT` and this runs
while a caller is waiting for a session.

Separately, **`MCPServer` had no tools column**: the whole catalogue lived only
in Redis, so the chain was Redis → *nothing*, and a restart, an eviction, a
deploy or the 24h hard TTL lapsing all produced the same cliff — a cold `npx` in
front of the first token *and* a turn with no connector tools at all, slower and
less capable at once with nothing able to say why. `MCPToolCatalogue` is the
floor, so the chain is **Redis → database → live handshake**. It lives entirely
inside `tool_cache.py` because `MCPToolCache` was already the only reader and
the only writer, so `client.py` did not change. Three rules carry it. A stored
listing is **always reported stale**, so the caller re-lists behind the answer
and refills Redis — a floor, not a replacement. **Invalidation drops the row
too**: this tier survives *cache loss*, never an *edit*, so a user who just
changed a connection still falls through to a live listing exactly as before.
And an **empty listing is never stored**, because every failure path in
`get_openai_tool_descriptors` returns `[]` and persisting one would record a
timeout as "this connector has no tools" and keep answering that way. Rows are
keyed `(server, user)` to mirror the Redis key exactly; whether `list_tools`
genuinely differs per user is **still unverified**, and the partial unique
constraints already reserve one null-user row per server should a shared
baseline turn out to be right. Tests:
`mcp_integration/tests/test_pool_lru.py`,
`mcp_integration/tests/test_tool_catalogue.py`.

**A count is not a budget, and listing is not a reason to start anything
(2026-09-17).** The cap above is a *cache* policy — which already-connected
session to drop — and it could not stop the production OOM that killed daphne
on 2026-09-16, because nothing it counts existed yet: one chat turn asked all
eight connectors what tools they had, each answer a cold `npx` (two Node
processes), inside a 384 MB container. Three separate faults, closed together.
**Listing never starts a connector**: which tools exist is a question about a
catalogue, the catalogue is already on disk (`MCPToolCatalogue`), and
`list_tools(cached_only=True)` answers from it or returns nothing and queues a
refresh — a connector starts when a tool is *called*. The 5 s
`AGENT_LIST_TOOLS_TIMEOUT` it replaces could never be met by the ~21 s cold
start it bounded, so the common case was five seconds of silence per connector
*and* no tools; it is retired rather than tuned. Refreshes drain through **one
serial queue**, because a detached task per connector is the same stampede
moved somewhere harder to see. **What does start is admitted against
megabytes**, not a count: `mcp_integration/supervisor.py` reserves an estimate
*before* the spawn (the moment nothing else accounted for), evicts
least-recently-used *idle* sessions to make room, and refuses inside
`ADMIT_WAIT_SECONDS` when nothing can be freed — measuring `/proc` after the
fact so the next admission reasons in what a connector actually cost. Four
things carry it. The **cgroup is the backstop, and it is checked against what
is about to be spent**: a *fraction* answers one start too late — daphne at
220 MB plus a 69 MB connector is 76% of a 384 MB container, under any sane
ceiling, and the next connector is the Gmail one at ~150 MB, so admitting it
reaches 440 MB and the kernel kills daphne with nothing ever having looked over
the mark. Both ceilings are independent, so `MCP_MEMORY_BUDGET_MB=0` switches
off the connector budget and **not** the backstop protecting the web server.
Those two figures are also why the default estimate is 110 MB rather than the
70 it shipped as: 70 was the floor of the measured range, not its middle. Eviction **frees the accounting
synchronously and reaps behind the caller** — a close waits up to
`CLOSE_TIMEOUT`, which is longer than an admission waits, so releasing only on
close would refuse starts it had just made room for; the kill is filtered to
processes still descended from us, since a recorded pid is reused and on a
single-container host could by then be Postgres. A **refusal is remembered for
`BUDGET_FAILURE_TTL` (10 s), not `FAILURE_TTL`**, because "not right now" is a
different claim from "this connector is broken". And it **degrades to
permissive**: no `/proc` falls back to counting live sessions, and
`MCP_MEMORY_BUDGET_MB=0` disables the ceiling — losing the ability to measure
must not take away the ability to run. Alongside it, `launch.py` rewrites
`npx -y <pkg>` to `node <pkg>/<bin>` when the image has the package installed
at `MCP_PACKAGE_ROOT`, halving per-connector memory: the launcher process
otherwise sits there for the life of the session holding a pipe. Rows keep
saying `npx -y`, which is what works on a machine with nothing installed.
Tests: `mcp_integration/tests/test_supervisor.py`,
`mcp_integration/tests/test_listing_never_spawns.py`,
`mcp_integration/tests/test_launch.py`.

**A connector card is not a process (2026-09-17).** The budget above bounded
the damage and could not fix the shape: every curated connector was a Node
process on a 384 MB container, so the budget refused the very refreshes that
build tool lists and connectors silently never appeared in chat. Gmail, Drive,
Sheets and Calendar are now `MCPServer` rows of `type='native'` (migration
`0019`) whose tools are **ours** — `chat/tools/google/`, Google's REST APIs
called from this process with the user's `google-oauth2` token — declared
`@tool(connector=<icon_slug>)`. The row is kept because it is what *governs*
the connector: the Connections switch, the required credential, and an agent's
`connectors` scope are all keyed on it, so none of them had to change; only
the tool source did. Four things carry it. **Both doors, as for MCP**:
`mcp_integration/native.py::live_native_connectors` (card enabled for the user
*and* credential held) filters chat's `get_available_tools` and the agent
toolbox's `descriptors`, and is re-checked in `execute_tool` and
`AgentToolbox.dispatch` — a failed read there answers *nothing is live*, the
opposite of the tool-library overlay, because handing out mailbox tools
without the switch having been checked is the worse failure. **The `mcp` grant
unlocks them and the scope narrows them**, with `read` mode judged by the
tool's declared `effect` rather than `looks_read_only`, which exists only
because an MCP name is a third party's claim. **They carry credentials**:
`permissions.carries_credentials` is True, so an unattended run still gates a
mailbox read exactly as it did when the tool lived in a subprocess. And a
native row is **excluded from `get_openai_tool_descriptors`** (or every tool
would be offered twice) and refused by `_session`. Google's own hosted MCP
servers were checked the same day and are a Workspace Developer Preview, so
REST was the stable base; Gmail's scopes and `drive.readonly` are *restricted*
either way, so past 100 users the OAuth app needs a CASA assessment. The four
no-credential utility rows (Filesystem, Fetch, Memory, Sequential Thinking)
were disabled as duplicates of built-ins, `MCP_ALLOW_STDIO=False` (deployment
default) refuses stdio at save **and** at connect, and the image no longer
installs Node. The supervisor, pool and `launch.py` above still apply to local
dev. The Google OAuth callback also stopped writing an empty refresh token
over the stored one on re-consent — every native tool depends on refreshing.
Tests: `chat/tests/test_google_tools.py`,
`mcp_integration/tests/test_native_connectors.py`.

**Credential mapping sources:** `credential_env_map` values are normally
`"<slug>:<field>"` from the user's vault. `"@settings:VAR"` reads from Django settings
instead, for platform-owned values like the Google OAuth client — otherwise every user
would need their own GCP project to read their own calendar. Field lookup also falls
back to a Credential's `access_token`/`refresh_token` columns, where the OAuth flow
stores tokens; without that, an OAuth-connected account looked empty to the injector.
`mcp_integration/tests/test_credential_bridge.py::CuratedCatalogIntegrityTests` fails if a curated mapping names
a field its credential type does not define — the failure mode that shipped six
connectors that could never work.

**A fresh `migrate` must yield a working install:** curated MCP servers come from a
migration, so the credential types they reference do too (`credentials.0005`), which
imports its data from `manage.py seed_connector_credentials` rather than copying it.
Before that, a deploy that skipped the command had a full connector catalog with no
types behind it — every credentialed connection stuck at "Not connected", nothing
logged. `mcp_integration/tests/test_fresh_install.py` asserts on migration-only state and is
the test that fails if migrations stop being sufficient. Consequence for tests: the
`CredentialType` table is **not empty** at test start, so use `update_or_create`, never
`create`, when a test needs a type with a specific schema.

**Knowledge Base Management:** `inference/` handles document ingestion and hierarchical RAG indexing — see `Backend/docs/RAG_STRATEGY.md`.

**Folders organise, knowledge bases index, and the move path cannot re-index.**
`Folder` (2026-08-25) is a per-user tree that is deliberately orthogonal to
`KnowledgeBase`: a document has both, independently, and moving it between
folders is a column write. That is structural rather than promised —
`inference/filesystem.py` does not import `inference/tasks.py`, so the code that
would re-index is not reachable from the code that moves, and a test fails if
that stops being true. Three things carry the isolation requirement ("a user can
only reach their own files"). **Root is `NULL`, not a row**: `folder_id IS NULL`
*is* the user's root, so the most-used location is unforgeable, and every
pre-existing `Document` was correctly placed the moment the column appeared — no
backfill, no lazy root creation, which is also why a fresh `migrate` still yields
a working install. **The API is id-addressed, never path-addressed**: `path` is
returned for display but holds *ids* (`/12/45/`), so rename is O(1), cycle
detection is `target.path.startswith(folder.path)` with no queries, a subtree is
one indexed prefix match — and no route accepts a path as a locator, which keeps
traversal off the table instead of guarded against. **One choke point**: every
inbound folder id resolves through `filesystem.resolve_folder`, which answers
404 for unknown and foreign ids *alike*, because a 403 for "exists but not
yours" is an ownership oracle. `test_filesystem.py::ChokePointTests` fails if
`Folder.objects` is used outside the modules allowed to touch it. Tests:
`inference/tests/test_filesystem.py`.

**An agent's filesystem is artificial, and that is the safety property.**
`inference/vfs.py` gives an agent POSIX-shaped paths (`/reports/q1.md`, list,
read, write, edit, delete) over the user's own `Folder`/`Document` rows. `os` is never
imported and nothing opens a handle, so the worst a traversal bug reaches is
another row — never another file, and never the host. Three things carry it.
**Paths are walked, never matched**: a path becomes name segments resolved one
`filesystem.child_by_name` hop at a time from the scope root, so no query joins
a caller string to `Folder.path` and `filesystem.py`'s "no route accepts a path
as a locator" survives a module whose whole API is paths. **`..` is clamped, not
refused** — popping at the root is a no-op, because models emit `../` constantly
and an error just teaches them to try another spelling, while a clamp gives them
what a chroot would. **Two switches, not one**: the `fileOps` grant says *may it
touch files*, `sandbox['fileAccess']` says *which* (`none` | `readonly` |
`scoped`, its own folder under `/Agents/<name>/` | `read_all_write_own` |
`full`), and with no scope the toolbox withholds the file tools rather than
advertising ones that refuse. **Readable and writable are two subtrees, not a
subtree and a flag**: in four of the five modes they coincide, so the walk
confines both and a write needs no further check — `read_all_write_own` breaks
that identity on purpose (read the whole tree, write only the agent's home),
which is why `FileScope` carries a `write_prefix` of scope-relative segments
that every write is checked against. Segments rather than resolved rows,
because `write_file` does `mkdir -p` and has to be refused *before* it creates
parents for a write that will not happen; and `list_dir` reports `writable`
per-directory, since a flat scope-wide flag would tell the model it may write
in every folder it lists. `read_all_write_own` is the combination the other
four cannot express and the one most tasks actually want — read the user's
documents, save the output somewhere bounded. A write is
`status='stored'` and touches no KB — folders organise, KBs index, for agents
too — and a delete goes through `recycle.trash`, so an agent's mistake lands in
the user's recycle bin. The scope is keyed to the **agent, not the run**,
deliberately: a run is the right unit for isolating compute and the wrong one
for a workspace the user is meant to open afterwards. `UNSERVED_GRANTS` is
now empty — `fileOps` was its last member and `shell` is served too. Tests:
`inference/tests/test_vfs.py`,
`chat/tests/test_rework.py::FileToolsAreGatedByAScopeTests`.

**Chat writes files too, and its scope is fixed rather than configured
(2026-09-04).** *(Superseded in part 2026-09-25: chat now holds only the read
half of these tools — writes go to a subagent; see "Chat is the orchestrator".
`chat_scope` still gives chat the whole tree to read, and `/Chat/` remains
the folder a delegating chat shares with its workers.)* `requires="files"` was an unconditional `False` in chat, so the
five file tools were withheld there by construction — correct while the names
meant the *host* filesystem, and stale once they meant rows in the user's own
tree. `vfs.chat_scope` is the missing half: `read_all_write_own` over the whole
tree, writing into `/Chat/`. Fixed and not a setting because the two callers
are different in kind — an agent is built once and runs unattended, so which
files it may touch is worth deciding per agent, while chat is the user's own
hands on their own documents. Three details are load-bearing. `/Chat/` is a
**sibling of `/Agents/`**, not a folder inside it, because the one tree the
user browses should not claim chat is an agent. There is **no folder per
session** — a summary asked for yesterday is findable under `/Chat/`, not under
a uuid nobody saw, and a conversation that cannot read what an earlier one
wrote is a filing cabinet that forgets. And a failure to build the scope
**degrades to `None`** rather than failing the turn, the same rule
`build_file_scope` and `descriptors` follow: an unreachable tree costs the
conversation its file tools, never its answer. What did not change is that the
host filesystem stays gone (`RemovedCapabilityTests`) and that an agent still
reaches files only through the `fileOps` grant. Tests:
`inference/tests/test_chat_files.py`,
`chat/tests/test_rework.py::FileToolsAreGatedByAScopeTests`.

**A filesystem you cannot search is a drop box.** `vfs.find` / the `find_files`
tool (2026-09-04) matches a substring against document *names and contents*
inside the scope, because with only `list_files` and `read_file` locating last
month's report means walking the tree a directory at a time and reading
candidates in full — a tool call per guess, usually ending with the model
asking the user where they put it. It is deliberately **not** KB search and the
distinction is what keeps writing free: a KB answers "what does the corpus say
about X" and costs an embedding job to build, this answers "which file is
called X, or mentions it" and costs one indexed `LIKE`. That is why the rule
this module opens with — folders organise, KBs index, and a write is never a
silent embedding bill — survives the addition rather than being bent by it.
Substring, never ranked: a model handed a ranked list of near-misses treats the
top one as the answer, while one told "three files contain this string" goes
and reads them. Confinement holds for search as it does for the walk, but by a
different mechanism — `filesystem.subtree`'s indexed `path` prefix off a
*resolved root row*, never a caller string, so "no route accepts a path as a
locator" is untouched. Results carry per-file `writable` from the same
`may_write_at` that `list_dir` uses, so a file reached by search and one reached
by a walk agree about it. (Under `scoped`, `render` returns a *label* —
`/Agents/Reporter/own.md` — while paths resolve from the home, so that exact
string used to read back as "No such file" and, written to, nested a second
home inside the first. Fixed 2026-09-17 after the benchmark caught an agent
failing to read back its own file: `vfs._scope_parts` strips the scope's own
label, which can only ever map onto the scope root.)

**Whole-file writes lose the file (2026-09-04).** `write_file` replaces a
document entirely, and for a while it was the only way to change one. Editing a
line of a long note therefore meant reading every character in and emitting
every character back out — both payloads billed, and the model quietly
paraphrasing away the parts it was not thinking about, so the longer the file
the more likely an edit was to lose something nobody asked it to touch.
`vfs.edit_file` / the `edit_file` tool is exact-match-or-refuse, and the
refusals are the design. Text that is **not present is an error, never a no-op
reported as success** — a model told "done" builds its next three steps on a
file it believes it has already fixed. Text appearing **more than once is also
an error** unless `replace_all` says otherwise, because silently taking the
first occurrence lands the edit in the wrong paragraph and nothing downstream
can detect that it did. Both messages name the count, since the model's next
move differs: zero means re-read the file, several means include more
surrounding text. It is `sensitive` and `effect="reversible"` like `write_file`,
sits under the same `fileOps` grant and the same `FileScope` (an edit is a
write, so `_require_write_at` runs *before* the file is even looked up — an
editable location is not something a read-only scope should be able to probe
for). Tests: `inference/tests/test_vfs.py::EditTests`.

**Concurrent writers, and the verbs a filesystem was missing (2026-09-26).**
`Document` has **no unique name constraint and must not get one**: uploads,
chat attachments, Imagine, the eval world and `filesystem.move` all create
same-named siblings by design, so a constraint would 500 the second upload of
`report.pdf`. Instead every VFS write (`write_file`, `write_binary`,
`edit_file`, `move`, `copy`) does look-up-then-write under
`vfs._name_lock` (Postgres advisory xact lock; SQLite's IMMEDIATE transaction),
and `_document_in` orders by id so existing duplicates resolve to the oldest
for every verb. Reads return `version` (`updated_at`), and `write_file` /
`edit_file` take `expected_version`, refused when stale through
`office_edit.is_stale` — the check the apps' autosave uses. Also added:
`move_file`/`copy_file` (`fileOps`, reversible; id and history kept; both ends
write-checked; taken names refused, never renumbered; the writable roots and
top-level `/Agents`, `/Chat`, `.eval` cannot be moved), `read_file`
`start_line`/`end_line`, `find_files` snippets with line numbers plus
`inference.0024` trigram indexes on `UPPER(...)` (Postgres only, skipped
rather than fatal), `list_files` `depth` ≤3 under one entry budget, and
case-insensitive folder handling — a read hints "did you mean", a write reuses
the *single* other-case folder. Folder queries still go through
`filesystem.py` (`other_case_children`, `folder_name_taken`) — the choke-point
tests enforce it. Plan: `Backend/docs/VFS_HARDENING_PLAN.md`. Tests:
`inference/tests/test_vfs_hardening.py`.

**A .docx was read as zip noise (2026-09-04).** `docx` has been in
`ALLOWED_MIME_TYPES` and in `Document.FILE_TYPE_CHOICES` since the first
migration, and `extract_text_from_file` had no branch for it — so a Word upload
fell through to `open(..., errors='ignore')`, and the *zip container* was stored
as `content_text`, then chunked and embedded. Silent in both directions: the
upload succeeded and the index filled with text that matched nothing.
`utils.extract_docx_text` walks `word/document.xml` with `zipfile` +
`ElementTree` and no new dependency — the job is `w:t` runs in document order,
OOXML is stable, and a wheel in the image is a real cost on a 1.9 GB box for
forty lines of walking. Two details: a **table row stays one line** (tab-joined
cells), because a four-column row flattened to four paragraphs loses which value
belonged to which heading; and a legacy OLE2 `.doc` — which
`normalize_file_type` also files as `docx` — returns **`''` rather than
garbage**, which `vfs.read_file` already explains to the model. Tests:
`inference/tests/test_regressions.py::DocxExtractionTests`.

**A worker gets a second writable folder, and that is how delegation returns
paths (2026-09-04).** Delegation could only ever hand back prose: a worker's
findings came home through the transcript, so every fan-out paid its whole
result into the parent's context window, and anything over the cap was archived
and had to be fetched back out. `FileScope.shared_prefix` is the fix — the
delegating scope's *own* `write_prefix`, granted to the worker, so both write
to one folder and the answer becomes "wrote findings-2.md". Four things carry
it. The prefix is **passed down from the caller, never rebuilt from an agent
name**: the shared folder is by definition the one the parent writes to, so
there is no second rule to drift — and it works unchanged when the delegator is
chat, whose folder is `/Chat/` and not an agent home at all. It is a **named
second subtree rather than a list of prefixes**, because the two are not
interchangeable — "your own files" and "the folder you share with whoever
asked" — and both the system prompt and `list_dir`'s per-directory `writable`
flag have to say which is which. It **only ever adds**, and declines in four
cases, each for its own reason: a `scoped` worker (its config says confine me,
and re-rooting would make one brief write to two places depending on the
caller), a `readonly` worker (being delegated to is not consent to start
writing), an **empty prefix** (`()` matches every path, so passing a `full`
parent's prefix through would quietly upgrade the worker to write anywhere —
the one outcome this must never produce), and a prefix the worker already
holds. And the worker is **told to prefer it**, not merely permitted: one that
can write there and is not told to will still return its whole report in the
transcript, which is the cost the folder exists to avoid. Tests:
`inference/tests/test_workspace.py`.

**Trash is a state, not a place.** Deleting sets `deleted_at`; `LiveManager` is
the *default* manager on `Folder` and `Document`, so a trashed row leaves every
listing in the codebase — `chat/tools/knowledge.py`, `kb.documents`,
`inference/signals.py` — without one of them being edited. A reserved "Trash"
folder would instead have made every query responsible for remembering to
exclude one magic id. `_base_manager` stays unfiltered (never set
`base_manager_name`), which is what lets restore and the purge still reach those
rows. Two consequences worth knowing: the vector index is dropped at *trash*
time, not at purge, because a file the user cannot see must not keep answering
RAG queries — and `post_delete` does **not** fire on a trash, so the trash path
calls the extracted `signals.recount_kb` or `doc_count` drifts. The permanent
delete is `inference/recycle.py::run_recycle_sweep`, reachable both as the beat
task `inference.sweep_recycle_bin` and as `manage.py purge_recycle_bin` — the
same split as `agents/sweep.py`, for the same reason. It takes documents before
folders; that was going to be a `PROTECT` FK, but Django evaluates `on_delete`
during the collector's *collection* pass, so `PROTECT` made account deletion
impossible — the ordering lives in the sweep and is pinned by its tests. Tests:
`inference/tests/test_recycle.py`.

**Social Authentication:** `core/` app integrates `django-allauth` for OAuth2/social login. CSRF protection enforced on OAuth flows.

**Foundations the later packs share (P0, 2026-09-21).** Four pieces every
capability phase would otherwise build four times. **Secret references**
(`credentials/refs.py`): a tool argument names a credential
(`{"secret_ref": "slug.field"}` or `{{secret:slug.field}}`), never contains
one; `aresolve_refs` runs inside dispatch, after approval, against an
allow-list of slugs, so the approval card shows the reference and the value is
scrubbed out of results (`refs.redact`) before the model sees them — a blob field wins over
a same-named token column, and a foreign user's slug refuses. **Cost ledger**
(`logs.CostEntry` + `logs/costs.py::record`, the only writer): non-token spend
filed per call, summed with tokens by `agents/spend.py::aggregate_rupees` for
the spend cap; `image` is excluded there because it already rides inside
`ExecutionLog.cost_usd` through the step-result rollup, and counting both
would charge one image twice — every other kind counts only in the ledger.
Unpriced is estimated, never free, and zero is not a charge. **Egress guard**
(`core/safety/net.py::check_egress`): the SSRF guard first (a refused host
stays refused whatever any allowlist says), then the per-scope allowlist
(`apiHosts`, `dbHosts`, `browserDomains`, `workspaceEgress`) matched on
registrable domain; the reason names the fix because a model told only
"denied" retries to the iteration cap. **Capability registry**
(`GET /api/orchestrator/capabilities/`): tools, scope field, engine liveness
and a risk line per grant, derived from `GRANT_TOOLS` + `UNSERVED_GRANTS` so
the builder greys out what cannot run. Tests: `credentials/tests/test_refs.py`,
`logs/tests/test_ledger.py`, `core/tests/test_net.py::EgressGuardTests`,
`agents/tests/test_capabilities.py`.

**Auto mode is switchable everywhere and auditable afterwards (P3,
2026-09-21).** Chat has Ask · Auto · Plan on `ChatSession.autonomy` (new
sessions inherit `UserProfile.default_autonomy`; `full` is refused — it stays
an agent-builder choice), picked in the composer, cycled with Shift+Tab, Auto
visibly amber so nobody is in it unknowingly, and switched mid-turn through
the steer mailbox (`POST .../steer/ {"autonomy": "auto"}`; `plan` refused
mid-run because the toolbox is already built). `auto` keeps ask as the floor
and adds `chat/turn/reviewer.py`, which may only downgrade ask → allow: never
for spends, above-`link` publishes, unseen recipients, first-seen browser
hosts or tainted arguments, and a dead or slow judge (>3 s) is an ask — a
failure is never an allow. Every decision rides the trace entry and
`AgentStep.approval` (`{mode, verdict, reason, reviewed_by}`). `plan`
withholds via a `tool_source` filtered to `READ_ONLY_TOOLS`, the same set the
agent ladder intersects, so chat plan and agent plan withhold identically.
Trust is argument-shaped (`ToolPermission.match`, exact keys, empty means the
tool) and `UserProfile.paused_until` is the one button that stops everything,
refused in `check_guardrails` before any model call. Tests:
`chat/tests/test_auto_mode.py`, `src/lib/__tests__/chatMode.test.ts`.

**The Auto judge had never run (fixed 2026-09-24).** `reviewer._model_judge`
did `import llm; llm.complete(...)` — `llm/__init__.py` is empty, the funnel
is `llm.access` — so every call raised `AttributeError`, `review` logged it as
"reviewer unavailable", and `auto` behaved as `ask` plus a delay. Every test
faked `_model_judge`; `chat/tests/test_auto_reviewer.py` now drives the real
one. Four fixes landed with it. The judge is a **fixed fast model**
(`AUTO_REVIEWER_PROVIDER/MODEL`, default `openrouter` +
`meta-llama/llama-4-scout`, 1.0–1.8 s warm), never the chat model: the default
`openrouter/free` has no `none` effort rung and measured 6 s / 22 s / 1.7 s with
disagreeing verdicts against a 3 s budget. **A verdict is reached once per
call** (cached by `(session, call_id)` in-process), because the resumed node
re-runs Pass 1 and re-judging could turn an allowed call into a second card;
Pass 1 also **skips calls already in `approved_tool_calls`** and **decides
gates concurrently** (`asyncio.gather`), acting on them in call order. The
judge reads the **last 4 user messages** (`pipeline.reviewer_text`, also what
recipients are matched against) and the **live todos**, and a `status` frame
(`phase: reviewing`) shows while it thinks. Each verdict logs
`[Latency] reviewer <ms> allow|ask|fail <tool>`.

**Indirect injection is contained by provenance, not detected (2026-09-25).**
Two gaps closed together. `static_check`'s `tainted` rule had no production
caller, so it never fired; `tools_node` now scans each batch's *tool results*
(never the user's message — the user is the principal) with
`core/safety/provenance.py::instruction_shaped` and passes the first matching
tool as `tainted_by`, after which `auto` asks before anything irreversible
for the rest of the turn. And the read tools were a zero-approval send channel:
`read_url`, `scrape_webpage`, `browse_page` and `download_file` are
`effect="read"`/ungated and only SSRF-checked, so "open
evil.example/?d=<inbox>" leaked whatever the model appended. `tools_node` now
hands them `known_urls` (URLs in the user's words, the system prompt, history
and earlier tool results); a URL seen verbatim is fetched as before, and a
*composed* one only if it carries no data (no query, userinfo, email, long or
encoded segment) — refused, the model is told to search or ask the user to
paste it. `known_urls` absent (a person calling `/execute-tool/`) refuses
nothing. The zero-click twin was in the browser: `MarkdownMessage` rendered
`![](remote)` as an `<img>`, fetched on render; remote images are now links.
Residual, stated: a few bits in a short composed path, and link-choice
encoding. Tests: `core/tests/test_provenance.py`,
`chat/tests/test_injection_defences.py`.

**The input sanitizer refuses or passes; it never rewrites (2026-09-25).**
`InputSanitizationMiddleware` used to swap matched words for `[BLOCKED]` and
HTML-escape every `<`/`>`, then hand the altered text to the view unannounced
("bypass the paywall bug" arrived as "[BLOCKED] the paywall bug", pasted code
as `&lt;`). Now any blocking match refuses the whole request with
`{code: 'SECURITY_VIOLATION', message: USER_NOTICE, saved: false}` *before the
view runs*, so the message is never saved and never enters history; anything
else passes byte for byte. It is stronger by reading through disguises —
NFKC + invisible characters stripped + Cyrillic/Greek look-alikes mapped,
leetspeak undone, a letters-only "squashed" view (`i-g-n-o-r-e p r e v…`),
decoded base64 — while single words (`bypass`, `jailbreak`) only log, and
blocking patterns are aimed at *your* prompt, not the topic (users ask about
their own agents' system prompts). The notice never names the matched pattern.
The chat page reads `code` off `StreamRequestError` → `chatRuns` status frame
and drops the optimistic bubble, shows the notice, and deletes a conversation
created only for that message. Direct attempts only: indirect injection is
`provenance.py`'s. Tests: `core/tests/test_sanitizer.py` (attacks, disguises,
false positives this product gets, not-saved through the real stack).

**Boss, manager, workhorses (2026-09-25).** The human is the boss, the chat
orchestrator the manager, subagents the workhorses; configurable power lives
in the subagents. Four changes carry it. **Staffing is automatic**:
`create_agent`/`update_agent` are no longer `sensitive` (still chat-only,
still through `AgentSerializer`). **A worker's request comes to the manager**:
`run_agent`, `get_agent_run` and `invoke_subagent` report a paused run's
`waiting_on` (read from its `HITLRequest` rows), and `answer_subagent`
(`chat/tools/agents.py`, also in `GRANT_TOOLS['subAgents']`) answers it
through the same three steps as the Inbox — checkpoint, close row, resume on
the original execution id — then waits for the result. Answering a question
or refusing is the manager's call in every mode
(`subagent_answer_needs_user`); *approving* meets the normal gates: in `ask`
the person gets the card, which shows the worker's request
(`describe._describe_worker_request`) with no "always allow" (it would
approve every future request from every agent), and their Approve/Deny *is*
the decision (a denied card is still dispatched as a refusal, or the worker
waits for ever); in `auto` the manager decides with no judge, under the floor
`auto` keeps for its own calls (`reviewer.subagent_floor` runs
`static_check` on the worker's pending call). **Questions pause**: `ask_user`
(`chat/tools/ask.py`, now offered in chat too) takes `choice` /
`multi_choice` / `number` / `text` and pauses on `interrupt()` like an
approval — `ask_question` frame → `QuestionCard` in chat, `clarification` row
(with `context_data['question']`) → the same card in the Inbox — and the
answer is checked against the question in the checkpoint
(`answer_question`, never trusted from a client) and comes back as the
tool's result; a skip is a rejection and the run proceeds on its stated
assumption. `TurnContext.can_ask` is False for `trigger`/`eval` callers, where
the tool records and never blocks (eval grading unchanged). And **`auto`
actually applies from the first batch**: the pipeline now passes the session
mode's gate set as `sensitive_tools`; before, a chat saved as `auto` still
gated every sensitive tool by name until a mid-run switch set the steering
slot, so the reviewer never saw them. Tests: `chat/tests/test_questions.py`,
`src/lib/__tests__/question.test.ts`.

**What an organisation solved stays in that organisation (2026-09-28).**
`core.Organization` + `Membership` (`core/orgs.py`, `/api/orgs/`) reverse the
2026-08-14 "no org context" decision for one purpose: a junior asking what a
senior already fixed. A chat takes the owner's **active org at creation and
keeps it for ever** (`ChatSession.org`, read-only in the API), so a person in
two orgs cannot carry one org's fix into the other; `share_solutions` is the
per-chat switch, starting at the org's `share_by_default`. `solutions/access.py::
visible` is the only read: from org X you see X's shared rows (while a member,
checked live) and your own private rows *captured in X*; from a personal chat,
only your org-less private rows. Foreign and unknown ids are the same 404. The
chat tools (`chat/tools/solutions.py`: `search_solutions`, `get_solution`,
`save_solution`, `review_solution`, all `ALWAYS_AVAILABLE`, withheld in eval
worlds) take the org from `TurnContext.org_id`, never from an argument. Capture
is automatic (`solutions/capture.py`): a thumbs-up or the person saying "that
worked" (a regex, no model cost) spawns one cheap-model call that decides
skip / new / same-as / replaces; an exchange that read instruction-shaped text
is never captured, and writes refuse in a tainted turn (memory poisoning, one
org wide). Each claim carries a kind (`principle` … `time_sensitive`), and
freshness is computed **at read time** from `valid_as_of`: stale claims are
labelled `check`, never hidden, and CORE_RULES 13 obliges the model to verify
or say "may have changed". The orchestrator can flag a fix **doubtful** with a
reason; reviews record the model, so a better model later can clear or raise
it. Search (`solutions/search.py`) is signature + keyword + meaning, merged by
RRF, re-scored by Wilson track record, and **abstains** below its evidence bar.
Vectors are float16 rows loaded per scope (an in-memory index per org does
not fit 384 MB). Agent runs have no `org_id` yet and search only their owner's
personal library. Tests: `solutions/tests/` (start at `test_isolation.py`),
`core/tests/test_orgs.py`.

**Guardrails from the external review (2026-09-26).** A web review (OWASP
Agentic Top 10 2026, LLM Top 10, NIST AI 600-1, the lethal trifecta, MCP tool
poisoning, memory poisoning, India IT Rules/DPDP/TRAI, EU AI Act Art. 50)
closed seven gaps; the whole picture is `Backend/docs/SAFETY_AND_GUARDRAILS.md`
— keep it current when a guardrail changes. **Content policy**
(`core/safety/content_policy.py`): the platform's own floor for the three
categories where *we* carry the legal duty — minors + sexual, sexual deepfakes
of real people, CBRN weapon instructions — deterministic, read through the
sanitizer's disguise views, never quoting the request; on the request
middleware (400 `CONTENT_POLICY`, never saved, the chat page drops the bubble
like `SECURITY_VIOLATION`), image prompts (the tool's `_prepare` and Imagine's
`run_generation`, before any provider or money), outbound messages and
`inference/pages.publish`. Near-miss phrases ("nude lipstick", "sex
education", "sarin attack history") are pinned as passing. **Image labels**
(`core/safety/labels.py`): visible "AI-generated" tag + PNG text / EXIF on
every generated image (tool and Imagine persist); unreadable bytes are
returned unchanged, never dropped. **Memory guard**: `remember_about_user`
refuses in a `tainted_by` turn and refuses instruction-shaped "facts".
**MCP tool pinning** (`mcp_integration/pinning.py`, `MCPToolPin`, migration
`0023`): trust on first use, quarantine a new tool whose text addresses an
AI, withhold one whose digest changed until approved on Connections
(`HeldToolsPanel`, `GET held-tools/`, `POST {pk}/held-tools/approve/`),
refused at dispatch as `tool_held`; a pin read that fails is fail-open like
the catalogue. **Outbound floor** (`core/safety/outbound.py`): content
policy + `OUTBOUND_DAILY_CAP` across `message_send`/`gmail_send_message`
counted from completed `AgentStep`s + an AI disclosure line on unattended
messages (`OUTBOUND_AI_DISCLOSURE`). **No CAPTCHA bypass** in `browser_act`
(a person solves it via `ask_user`). **Retention** (`logs/retention.py`,
beat `logs.redact_old_run_detail`, `manage.py purge_run_detail`): after
`RUN_DETAIL_RETENTION_DAYS` (180) a finished run's turn reasoning and step
payloads are cleared, the run record kept; paused runs never age. Published
pages carry an AI notice. **Model moderation** (2026-09-28,
`core/safety/moderation.py`): after the patterns pass, image prompts (tool and
Imagine) and published pages are classified by `openai/gpt-oss-safeguard-20b`
against *our* three-category policy, on the platform key. It can only refuse
more, fails open (the patterns already ran), caches verdicts 10 min, and is off
when `CONTENT_MODERATION_MODEL` is blank (as in tests). Not on every chat
message — a second model call per turn costs latency where users wait most.
Llama Guard 4 was measured and rejected: it flagged "nude lipstick" and filed a
nerve-agent recipe under S5 (defamation). Open, and listed in the doc: chat
messages are pattern-only, TOFU pins, no C2PA, DPDP consent/export
before May 2027, no robots.txt check. Tests: `core/tests/test_content_policy.py`,
`core/tests/test_moderation.py`,
`chat/tests/test_safety_guards.py`, `mcp_integration/tests/test_tool_pins.py`,
`logs/tests/test_retention.py`.

---

## Environment Variables

Copy `Backend/.env.local` (or `Backend/.env.ec2.example` for EC2) to `Backend/.env`. Critical vars:

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
NOTIFICATIONS_EMAIL_ENABLED=False  # Digest email only; nudges are always device-only
VAPID_PUBLIC_KEY=                  # Web Push public key (GET /api/notifications/push/vapid-key/); blank = closed-browser push off
VAPID_PRIVATE_KEY=                 # Web Push private key — never leaves the server (`manage.py generate_vapid_keys`)
VAPID_SUBJECT=mailto:no-reply@aiaas.local  # VAPID contact claim
OPENROUTER_API_KEY=                 # Platform key for the DEFAULT provider — required
CONTEXT_SUMMARY_PROVIDER=nvidia     # Provider for the context fold (platform key)
CONTEXT_SUMMARY_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b  # Agent's summaryModel overrides
EVAL_JUDGE_PROVIDER=openrouter      # Default provider for the llm_judge grader
EVAL_JUDGE_MODEL=meta/muse-spark-1.3-contributor  # Judge for llm_judge; see "Model IDs" below
AUTO_REVIEWER_PROVIDER=openrouter   # Chat `auto` judge; must be fast + non-reasoning
AUTO_REVIEWER_MODEL=meta-llama/llama-4-scout  # Blank = the chat's own model
AUTO_REVIEWER_TIMEOUT_S=3           # Over this, the call asks
MCP_MEMORY_BUDGET_MB=150           # Total resident MB for all MCP connectors; 0 disables
MCP_MAX_CONCURRENT_STARTS=1        # Connectors that may be starting at once
MCP_MAX_POOLED_SESSIONS=2          # Live sessions kept (cache policy under the budget)
MCP_SESSION_TTL=120                # How long an idle connector holds its subprocess
MCP_ALLOW_STDIO=True               # Local-process MCP servers; deployment defaults False (no Node in image)
SOLUTION_CAPTURE_ENABLED=True      # Auto-save solved problems (thumbs-up / "that worked")
SOLUTION_CAPTURE_PROVIDER=         # Blank = CONTEXT_SUMMARY_PROVIDER (platform key)
SOLUTION_CAPTURE_MODEL=            # Blank = CONTEXT_SUMMARY_MODEL
RUN_DETAIL_RETENTION_DAYS=180      # Finished runs lose reasoning + tool payloads after this (record kept)
OUTBOUND_DAILY_CAP=100             # Messages an account's agents may send per 24 h, all channels
OUTBOUND_AI_DISCLOSURE=unattended  # AI line on sent messages: unattended | always | never
CONTENT_MODERATION_MODEL=openai/gpt-oss-safeguard-20b  # Model check on image prompts + pages; blank = off
CONTENT_MODERATION_TIMEOUT_S=4     # Over this, the check passes (patterns already ran)
MISSION_SWEEP_SECONDS=120          # Mission sweep interval (in-process scheduler)
SENTRY_DSN=                        # Error reporting for web + worker; blank = off (workflow_backend/observability.py)
SENTRY_TRACES_SAMPLE_RATE=0        # Performance tracing; off by default on the small box
BACKUP_S3_BUCKET=                  # manage.py backup_db uploads here when set; BACKUP_DIR / BACKUP_KEEP for local copies
ALLOWED_HOSTS=*                    # Frontend, BrowserOS, and API hosts
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

---

## Internal Documentation

**Beginner docs (2026-09-24).** `START_HERE.md` (repo root) is the plain-language
tour: what the product is, how a chat message and an agent run travel, a map of
every app, and step-by-steps for common jobs. Every backend app has a `README.md`
(file-by-file, in reading order), `Backend/docs/README.md` sorts the docs below
into *reference* / *built plans* / *open plans* / *history*, and
`better-n8n-frontend/BEGINNER_GUIDE.md` is the frontend tour. Keep them in step
when you move or add a file: a guide naming a file that no longer exists is worse
than no guide. Write them in short sentences and plain words; the design history
belongs in this file, not in them.

Detailed technical docs live in `Backend/docs/`:
- `API.md` — **Endpoint map / code-review index**: every HTTP route with its Django app,
  purpose, access, complexity, test coverage, serializer, DB tables, atomicity, and gotchas.
 **Keep this current** — whenever you add, remove, or change a route (any `urls.py`),
  its permission, or its serializer, update the matching row in `Backend/docs/API.md` in
  the same change. It is the first stop for reviewing the backend surface.
- `CHAT_AGENT.md` — Tool-loop architecture for the chat agent with Python sandbox execution
- `RAG_STRATEGY.md` — Hierarchical RAG design decisions for knowledge base
- `SANDBOX_EXECUTION.md` — The `execute_python` sandbox: the hardened sidecar container, its layered isolation, and the in-process dev fallback
- `tool_calling_architecture_review.md` — Tool invocation patterns and review
- `MCP_ARCHITECTURE.md` / `MCP_INTEGRATION.md` — MCP client design with credential injection and tool caching
- `SAFETY_AND_GUARDRAILS.md` — **Every AI guardrail in one place** (reach, approvals,
  injection, containment, limits, content and legal duties), mapped to OWASP Agentic
  Top 10 and to Indian/EU law, with the open gaps. Update it when a guardrail changes
- `CREDENTIALS_AND_SECURITY.md` — Credential storage and security model
- `AGENT_TEMPLATES.md`, `NOTIFICATION_SERVICE.md` — Agent templates and notification delivery
- `CONTEXT_LIFECYCLE.md` — How a long agent run stays inside its context window: the
  segment rule, the watermark, and the three builder toggles that drive it
- `EVALUATION.md` — Sub-agent evaluation: the grader registry, the sweep runner, and the supervision model (who checks the checker, and how agreement is measured)
- `EVALUATION_PRODUCTION_PLAN.md` — The plan (proposed 2026-09-19, not yet built) to make eval production-grade: trustworthy numbers + a deploy gate, feedback capture for future traffic, and external benchmarks (IFEval, GAIA, DABstep, …) including the "platform tax" comparison against the bare model
- `EVAL_ENVIRONMENTS_PLAN.md` — The plan (proposed 2026-09-24; E-1–E-5 built 2026-09-24, E-6 paid proof runs still need the user's go-ahead) for judge-generated test worlds: an `EvalWorld` per suite (planted facts + fixtures across files, KB, mailbox, calendar, drive, a frozen web), simulators behind `AgentToolbox.dispatch` so an eval never touches the owner's real data or real services, expected answers set by the judge only and re-derived blind, and chat tools that only ever make drafts
- `PLATFORM_CAPABILITIES_PLAN.md` — The plan (P0–P10 built 2026-09-21; P0+P3 committed, the rest in the working tree; the `/code` page is still not built — `/missions` landed with the gap-closure pass and `/dashboards` already existed) for messaging (Slack/WhatsApp/Teams/SMS), SQL + generic API caller, browser sessions and vault logins, a per-user compute plane, the Code tab (serves the `shell` grant), long-horizon missions, dashboards, auto mode, voice/OCR/e-sign, and slash commands (§18, P10). Payments deliberately out
- `CODING_AGENTS_PLAN.md` — The plan (built 2026-09-22) for a coding subagent roster (scout, architect, implementer, test-writer, debugger, reviewer, integrator + a coding lead), `writePaths`/`commandScope` scopes, file leases with a stale-write guard, change notices through the steering mailbox, detached `start_tasks`/`wait_tasks`/`steer_task`/`stop_task` dispatch, and an OpenCode-style side plan panel
- `IMAGINE.md` — OpenRouter-backed image/video/audio generation; per-user credential vault lookup, endpoint reference, and video polling state machine
- `CONCURRENCY_LAG_FIX_PLAN.md` — The plan (proposed 2026-09-24; Phases 0–5 built 2026-09-24, Phase 5 as the t3.small option — needs the instance resize to take effect; Phase 6 conditional on measurements) for the "lags with several runs, even one user" problem: DB connections held across model calls (pool of 10), the SQLite checkpointer's global lock + full-state serialise on the event loop, per-run/global single-thread `sync_to_async`, memory overcommit on the 913 MB box; Phase 0 measures first
- `GAP_CLOSURE_PLAN.md` — The plan (proposed 2026-09-24, implemented 2026-09-24) from a codebase-wide gap sweep: digest-only email default, pack availability in Explore, the order-dependent test failures, lint back to zero, Memory and Missions UI, and CLAUDE.md drift
- `SECURITY_REVIEW_FIX_PLAN.md` — The whole-project security review of 2026-09-25 and its fixes (implemented, undeployed): Google sign-in no longer links into an unverified password account (pre-account takeover), `UserProfile.tokens_valid_after` revokes every JWT on password/email change (`core/auth/revocation.py`, checked by REST, refresh and WebSocket), `token_blacklist` actually installed, no `?token=` HTTP auth, API keys stored as SHA-256, the workspace job hook scoped to its owner and detached, `CSP: sandbox` on file responses. Learning: `learning/15_whole_project_security_review.md`
- `SOLUTION_MEMORY_PLAN.md` — The plan (S0–S4 built 2026-09-28, undeployed; S5 benchmark not built) for org-scoped solution memory: solved problems captured automatically as structured records, found again with `search_solutions`, each claim labelled by how fast it goes stale and re-verified or flagged before it is stated. Adds an `Organization` model (reversing the 2026-08-14 "no org context" decision); the rule is that nothing leaves the org it was captured in (§3a)
- `PROMPT_AND_MEMORY_PLAN.md` — The plan (built 2026-09-28) fixing the chat and agent system prompts (chart/mode/`can_ask` wording, an untrusted-content rule, dates, notes for repeating agents), user memory's prompt selection (categories were cut alphabetically), and the chat double-send of earlier turns (checkpoint + DB history), which Phase 0 proved with a test before the fix
- `OPENCODE_ZEN_PLAN.md` — The plan (built 2026-09-22; chat-completions answers, streaming and `tool_calls` still need verification with a real Zen key, §8) for OpenCode Zen as a fifth, bring-your-own-key-only LLM provider — no proxy, no platform key (ToS)

## Frontend-Specific Docs

- `better-n8n-frontend/docs/` — UI concepts and prototypes (`v2-ui-concept.md`, `prototype/`)
- `better-n8n-frontend/BEGINNER_GUIDE.md` — onboarding: every page, the folder layout, the
  data-fetching pattern to copy. `APIs.md` and `FEATURES.md` are now stubs pointing at
  `Backend/docs/API.md` and the README (both described the retired canvas)
