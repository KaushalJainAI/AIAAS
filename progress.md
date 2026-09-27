# Backend Progress Report

> Compiled: 2026-09-22 (previous compile 2026-09-21). Covers every Django app in `Backend/`.
> Repos are separate per directory (no root git repo): `Backend/` HEAD `6184cc6`
> (2026-09-21) + **103 modified / deleted files uncommitted**; `better-n8n-frontend/`
> HEAD `1ced6f8` + **38 modified files uncommitted**. The "essentially clean at
> `94a9292`" line from the last compile no longer holds — two commits plus the
> whole P10 slash-commands + new-capability work since are uncommitted.

## Deployment readiness — 2026-09-22 (NOT READY)

Verdict: **do not deploy this tree.** Verified just now (`manage.py check` passes;
`makemigrations --check` fails; `docker compose -f docker-compose.prod.yml config`
loads the root `.env` and resolves `DB_ENGINE: sqlite` with no `POSTGRES_*` keys).

**Blockers (fix before any push):**
1. **Dirty trees, no SHA to pin.** 103 modified/deleted files in `Backend/`, 38 in
   `better-n8n-frontend/`, nothing committed since `6184cc6`/`1ced6f8`. The rollback
   plan (SHA-tagged images) is unusable until this is committed in logical chunks.
2. **Pending migration.** `agents` needs `0026_alter_subagent_llm_provider`
   (`llm_provider` choices, incl. the `opencode` label) — `makemigrations --check`
   fails, which is also the Backend CI gate (`Backend/.github/workflows/tests.yml`).
   Choices-only, no column change; generate and commit it.
3. **Prod compose would boot SQLite.** `docker-compose.prod.yml` reads `env_file: .env`
   (repo-root legacy dev file: `DB_ENGINE=sqlite`, empty `DATABASE_URL`, zero
   `POSTGRES_*` keys). That is the exact silent-SQLite failure `DEPLOYMENT.md` §5
   warns about. The EC2 deploy dir needs its own production `.env`
   (`DB_ENGINE=postgres` + `POSTGRES_DB/USER/PASSWORD/HOST`, real `SECRET_KEY`,
   `CREDENTIAL_ENCRYPTION_KEY`); never copy the root `.env` there.
4. **CI never runs.** Both workflows live in nested dirs (`Backend/.github/`,
   `better-n8n-frontend/.github/`) — GitHub only reads a root `.github/`. The gates
   the deploy flow relies on (migration check, pytest, tsc, lint, build) execute
   nowhere. Move them to a root `.github/workflows/`.
5. **Deploy gate not evidenced on this tree.** `pytest -q` + `benchmark run --tier
   smoke --gate` (§2) have not been run against the current dirty tree; paid eval
   runs (baseline, calibration, gate proof) still need the funding go-ahead (open
   item 8 below).

**Non-blocking gaps (fix alongside, in priority order):**
6. `DEPLOYMENT.md` drift: §2/`Quick Reference` still pass `VITE_* --build-arg`s the
   frontend `Dockerfile` explicitly ignores (relative `/api`, `/ws` + nginx proxy —
   verified in `src/api/client.ts`, `vite.config.ts`, `nginx.conf`); references a
   `Backend/.env.example` that does not exist; says `.github/` at root; documents
   only 3 of ~10 periodic sweeps for host cron (missing `recover_runs`,
   `purge_recycle_bin`, `run_missions`, `sweep_workspaces`, `sweep_browser_sessions`,
   `purge_inbound`, `backup_db`); no `aiaas-sandbox` build/push line (§2 covers only
   backend/frontend).
7. Prod hardening: `CORS_ALLOW_ALL_ORIGINS: "True"` alongside a specific
   `CORS_ALLOWED_ORIGINS` (contradictory; the OAuth allowlist reads the latter —
   see `scripts/fix_oauth_origins.sh`); `ALLOWED_HOSTS` hardcodes an IP that may be
   stale; `mem_limit` sum (~1.3 GB) overcommits the 913 MB box; no boot-time
   `recover_runs` (interrupted runs wait for the first cron tick); no backup cron
   (`backend_media` + `pgdata` have no scheduled job; `USE_S3=False`); Sentry off.
8. Static/media serving: `nginx.conf` proxies `/api/`, `/ws/`, `/admin/`, `/media/`
   but not `/static/` — with `DEBUG=False` the backend serves no static/media itself,
   so Django-admin CSS/JS (`/static/admin/...`) falls through to the SPA `index.html`
   and direct `/media/` file URLs 404 (API download endpoints are unaffected).
9. Per-app audit below is behind the tree: `urls.py` now mounts `esign`, `messaging`,
   `missions`, `workspaces` (plus `browsing/` helper and `missions`/`run_missions`)
   that have no section here; `data/` app deleted (uncommitted); `OBJECTIVES.md`
   Phase 3 boxes still unchecked (no verified deployed-URL walkthrough).
10. Secrets hygiene: live keys sit in the root `.env` (git-ignored if a root repo
    existed — it does not, so any folder copy leaks them); `docker compose config`
    echoes them into logs — redact or use `config --no-interpolate`-aware handling
    when sharing output.

**Overall picture:** 15 local Django apps + three non-app packages (`sandbox/`,
`browsing/`, `sandbox_service/`), 148 migrations, **~2,750 test functions across
171 files** (venv excluded). The DAG/workflow product is fully retired and the
emptied **`executor` app is deleted** (was an empty husk at the last compile);
`nodes`, `compiler` and `buddy` remain gone. One helper package is new since the
last compile: `browsing/` (remote-Chromium engine behind `BROWSER_ENGINE`, not a
Django app — no models, no migrations).

Test count grew 2,046 → ~2,750 (+~34%), driven by `chat` (24 → 38 files),
`agents` (17 → 24), `mcp_integration` (13 → 19), `eval` (5 → 14), `logs`
(7 → 13) and `llm` (9 → 11). Migration count grew 121 → 148.

---

## Delivery Status — 2026-09-21 (runtime reality check)

The per-app audit below measures **code and test suites that exist on disk**. Separately, what
has been **exercised against a live server with real credentials**:

- **Verified end-to-end this cycle:** the Imagine studio (catalogue fetch, form generation, agent
  chat — real OpenRouter key, real images returned); the agent-builder configure endpoint (a real
  model turning "hi" plus a brief into a valid config with real connector/KB ids); connector and
  delegation scope (an agent scoped `read` on a connection is offered no writing tools and its
  `send_message` is refused at dispatch); agent CRUD across the whole new config surface.
- **Verified by test suite only:** agent runs end-to-end, delegation fan-out, HITL approval and
  the reminder ladder, triggers/schedules, RAG, recovery sweep, curation, eval sweeps, the new
  office/media/browser tools, native Google connectors, the MCP memory supervisor.
- **Known unverified:** anything requiring Celery + Redis (async image dispatch, beat-driven
  sweeps) — local dev runs the inline path by design, so the broker path is exercised by tests
  and not by hand.
- **Production reality changed:** production runs **PostgreSQL, not SQLite** (see
  `docs/POSTGRES_PRODUCTION_MIGRATION_PLAN.md` and `DEPLOYMENT.md`); Caddy terminates TLS for
  `aiaas.kaushaljain.com` in `docker-compose.prod.yml`. Backups, Sentry and CI landed this
  cycle (`manage.py backup_db`, `workflow_backend/observability.py`, `.github/`).

`OBJECTIVES.md` still holds the deliver-fast plan. The gap between "tested" and "walked through"
is narrower than at the last compile but has not closed.

---

## Per-App Progress

*Ordered by weight (module count, test depth, migrations, architectural load).*

### chat — COMPLETE (largest suite, most active)
- Modules: `turn/` (pipeline, agent, curation, steering, todos, history, prompts, extraction, events, runs, checkpoints), `tools/` (web, knowledge, conversation, agents, sandbox, artifacts, vision, internal, clock, authoring, office, google + permissions, tool_output, describe, registry), `transport/`, `sources/`, `guest/`, `vision/`
- Tests: 38 files — account errors, permissions, curation (incl. a 20-turn e2e through the real graph), steering + undelivered-steer return, todos, parallel tool dispatch, charts, tool-output bounding, vision, authoring tools, context acquisition, office files, media/images, browser, Google native tools, new tools (download/pdf/diagram/extract/notify), sandbox files, effort plumbing, file cards
- Migrations: 18 (was 14)
- Since last compile: office-file renderers (`render_deck`/`render_workbook`/`render_document`), six new tools (`download_file`, `render_pdf`, `edit_workbook`, `render_diagram`, `extract_data`, `notify_user`), `run_python_on_files` sandbox bridge, native Google connector tools, browser tools (`browse_page`/`browser_act`), published pages, `generate_image`→`sensitive`, undelivered steers returned, `outputContract: files` specialist routing
- Note: `chat/README.md` is still **stale**; `docs/CHAT_AGENT.md` is the live reference

### agents — COMPLETE (the core product)
- **App label `orchestrator`** (tables `orchestrator_*`, HTTP surface `/api/orchestrator/...`)
- Modules: `agent/` (runtime, orchestrator, stream, hitl), `views/` (agents, builder, runs, triggers, hitl, conversations, responses, system), plus `connector_scope`, `contracts`, `publishing`, `gallery`, `stock`, `triggers`, `sweep`, `recovery`, `admission`, `budget`, `spend`
- Tests: 24 files — CRUD/validation/isolation, autonomy ladder + mid-run switching + approval scopes, connector scope, delegation scope, schedules/cron wording, triggers, recovery, run limits, contracts, sharing, gallery, builder chat, capabilities registry, install-pack, spend cap, crashed-turn handling
- Migrations: 24 (was 22 — incl. `SubAgent.template_slug`, trigger outcome fields, native-connector rows)
- Since last compile: `GET /api/orchestrator/capabilities/` registry, `toolScope` third axis, `outputContract`, template install-pack (`POST .../templates/install-pack/`), specialist gallery templates (analyst/slides/writer), blocking trigger runs, approval records, longer sessions; `reviewAgent` still deliberately unwired

### inference — COMPLETE (RAG + filesystem + extraction + pages)
- Modules: engine (FAISS + versioning), `filesystem.py` (per-user `Folder` tree), `vfs.py` (the agent-facing virtual filesystem), `recycle.py`, `pages.py` (published pages), extraction (engine, views, `/api/extraction/` routes), tasks, migration_tasks
- Tests: 17 files — filesystem choke-point, vfs scopes, chat file scope, recycle sweep, chunking, RAG pipeline, extraction engine, schema CRUD + review, published pages, binary uploads, file types
- Migrations: 19 (was 14)
- Since last compile: published pages (`publish_page`, snapshot + `link < platform < public`), uploads allow-by-default (block executables only), `.xlsx`/`.pptx` extraction on both doors, binary `Document.file` via `vfs.write_binary`, `file_type='other'` default

### mcp_integration — COMPLETE (heavily tested)
- Modules: client, credential_injector, tool_cache (+ `MCPToolCatalogue` floor), tool_provider, supervisor (memory-admission budget), native (Google REST connectors), launch
- Tests: 19 files — connections/visibility, credential bridge + curated-catalogue integrity, subprocess env allowlist, credential files, session pooling + LRU, fresh-install migration sufficiency, supervisor budget, listing-never-spawns, launch rewrite, native connectors
- Migrations: 20 (was 17 — incl. native-connector rows, catalogue table)
- Since last compile: memory-budget supervisor (reserve-before-spawn, LRU eviction, cgroup backstop), listing never starts a connector (catalogue → live → refresh queue), `MCPToolCatalogue` DB floor under Redis, native Google rows (`type='native'`, tools ours in `chat/tools/google/`), `MCP_ALLOW_STDIO=False` in deployment, Node removed from image

### llm — COMPLETE (absorbed the `nodes` app)
- Modules: `providers.py`, the `AIProvider`/`AIModel` registry (still in `nodes_*` tables), `handlers/` (base, registry, llm_base, llm_nodes/Ollama, llm_providers, openai_compatible), `access.py` (the one funnel), `budget.py` (segment-aware clamping), `effort.py`, `context.py`
- Tests: 11 files — effort ladder + funnel, budget/segment clamping, stream parsing + connect-retry, model-list payload, legacy alias guard
- Migrations: 4
- Since last compile: stream connect-retry (2 retries before first token, provider errors never retried), shared HTTP client (`workflow_backend/httpclient.py`), model seed refresh, shipped default pinned (`openrouter` + `openrouter/free` + `medium`)

### eval — COMPLETE (production-grade 2026-09-19)
- Modules: graders (registry), runner (sweeps through the same `run_agent` door), supervision (review policy + scoring), api (the public surface other apps import), queries, recovery, benchmarks (`benchmarks/` — suites as code + scorecards), office graders, adapters (ifeval/gaia/dabench/simpleqa)
- Tests: 14 files (was 5) — graders, sweeps, supervision/agreement, benchmarks pinning shipped model ids, office graders, work-tier suites
- Migrations: 4 (was 1 — incl. `JudgeCalibration`, `Feedback`, `RunSignal`)
- Since last compile: `caller='eval'` (excluded from caps/stats), sweep recovery (3h), judge-cost accounting, per-suite+model baselines, judge calibration, smoke-tier deploy gate, quality capture (`Feedback`/`RunSignal`/`failure_category`), "save as eval case" from a run, external adapters + `--bare` control, **work tier** (fixture workspaces, file graders, pass@1 + pass^k, 3 runs per case)

### logs — COMPLETE (agent observability + cost ledger)
- Modules: models (ExecutionLog → AgentTurn → AgentStep + SubAgentRevision + **CostEntry**, **Feedback**, **RunSignal**), queries, revisions, costs (`costs.py::record`, the only writer), thin sync views
- Tests: 13 files (was 7) — every route, turn/delegation/revision semantics, checkpoint lifecycle, ledger accounting, migration backfills
- Migrations: 24 (was 17)
- Since last compile: `CostEntry` ledger (non-token spend per call, summed with tokens by `agents/spend.py::aggregate_rupees`; `image` excluded — already in `cost_usd` rollup), quality models, approval records

### imagine — COMPLETE
- Modules: `agent/` (graph, hitl, intent), `services/` (capabilities, catalog, dispatcher, documents, openrouter, events), `validation.py`, consumers, tasks
- Tests: 5 files — API contract, catalogue normalization, dispatcher split, **dials** (per-model parameter validation), intent routing
- Migrations: 5; Docs: `docs/IMAGINE.md`
- Since last compile: reached as a tool (`generate_image`, now `sensitive` + `irreversible`, cost read back from `AgentStep.result`); audio/video generation deliberately stay off the tool surface

### core — COMPLETE
- Modules: `auth/`, `http/` (incl. `HybridMiddleware`), `realtime/`, `safety/` (incl. `net.py::check_egress` SSRF + per-scope allowlist), plus `memory.py` (`UserMemory`)
- Tests: 7 files (was 4) — sanitizer, content policy, tiered throttling, password OTP, cursor pagination, memory eviction/caps, hybrid middleware, egress guard, net safety
- Migrations: 11 (was 9)

### credentials — COMPLETE
- Modules: manager (AES), oauth, resolution (one door), verification, browser_utils, **refs.py** (secret references: `{"secret_ref": "slug.field"}` / `{{secret:slug.field}}`, resolved post-approval, redacted from results)
- Tests: 4 files — manager, refs, bridge + curated-catalogue integrity
- Migrations: 8
- Note: `seed_connector_credentials` is required by the curated MCP servers, and `test_fresh_install.py` fails if migrations stop being sufficient on their own

### notifications — COMPLETE
- Modules: reminders (escalation ladder + hourly nudge + daily digest), tasks, signals
- Tests: 3 files
- Migrations: 3 (was 2); Docs: `docs/NOTIFICATION_SERVICE.md`
- Since last compile: `notify_user` tool gives unattended runs a capped way to say "this needs you"

### sandbox — package (not a Django app)
- Modules: `engine.py` (the one door, selects by `SANDBOX_ENGINE`), `service_client.py` (hardened sidecar + file legs), `safe_execution.py` (dev-only in-process fallback with confined `open` + ephemeral cwd)
- Tests: 3 files — engine selection, timeout kill semantics, sandbox files
- Since last compile: `arun_code(code, files=, collect=)` on both engines, base64 file legs on the sidecar protocol, outputs saved into the caller's write folder (never overwrite)

### browsing — NEW helper package (not a Django app), 2026-09-20
- Modules: `engine.py` only (remote Chromium behind `BROWSER_ENGINE`: `none` default → tools not offered; `remote` → Browserless-compatible `/function`)
- Steps are data for one fixed five-verb script; model-written JS never runs; URL guard still applies
- Tests live with the tool surface: `chat/tests/test_browser.py`

### tools_config — COMPLETE
- Modules: models (`ToolConfig`, one row per user+tool), `settings_schema.py` (the declared knobs), overlay, signals, views
- Tests: 1 file / 15 tests
- Migrations: 1; Docs: `docs/TOOL_CONFIGURATION_PLAN.md`
- Rule the app enforces on itself: a declared knob that no tool reads fails the suite

### streaming — COMPLETE
- Modules: consumers, broadcaster, routing
- Tests: 2 files / 15 tests
- Migrations: 1

### skills — MINIMAL
- Modules: services, models, views + `seed_skills`
- Tests: 1 file / 14 tests
- Migrations: 3

### templates — CARRIES THREE MIGRATIONS
- `models.py` is empty by design: the DAG template gallery was dropped in `0003_delete_template_gallery`, and agent templates are a `SubAgent` used as a starting point (`agents/gallery.py`), needing no table
- Tests: 0 — no longer a gap, because there is nothing left to test

### executor — DELETED 2026-09-19
- Was an empty husk at the last compile; now removed from `INSTALLED_APPS` and the tree. The King supervisor, generation and engine went with the DAG product.

---

## Cross-Cutting

### Infrastructure (workflow_backend/)
- `settings/` package: `base.py` + `local.py` / `deployment.py` / `test.py` — no top-level `settings.py`
- `celery.py`: autodiscover + the special `migration_tasks` registration for inference
- `background.py`: `spawn()` — detaches tasks from the request context
- `httpclient.py` (new): one `httpx.AsyncClient` per event loop — provider, guest, Google and vision calls share it; never `async with shared_client()`
- `observability.py` (new): Sentry wiring; blank DSN = off
- `thresholds.py`: central caps/budgets, now several hundred constants (run time, admission, curation, spend, eval, observability, MCP budget, browser)
- Sweeps are dual-entry by design — Celery beat **and** a management command — because local dev has no Redis: `run_due_triggers`, `send_hitl_reminders`, `purge_recycle_bin`, `recover_runs`
- New: `manage.py backup_db` (S3 + local retention), `DB_POOL` (psycopg-3 pool, `DB_POOL_MAX_SIZE` under the db's `max_connections=25`)

### P0 foundations (2026-09-21) — shared by every capability phase
- Secret references (`credentials/refs.py`), cost ledger (`logs.CostEntry`), egress guard (`core/safety/net.py`), capability registry (`GET /api/orchestrator/capabilities/`)
- Tests: `credentials/tests/test_refs.py`, `logs/tests/test_ledger.py`, `core/tests/test_net.py`, `agents/tests/test_capabilities.py`

### Tests
- 171 files / ~2,750 test functions across the apps above (venv excluded)
- `tests/integration/` — cross-app (auth flow, credentials+MCP, adversarial credentials)
- `tests/e2e/` — scripts against a live server (not pytest): smoke, websocket, chaos, contract audit
- `sandbox_service/tests/` — the sidecar's own suite (incl. `test_files.py`)
- `browsing/` has no suite of its own; covered through `chat/tests/test_browser.py`

### Docs (Backend/docs/, 29 files)
- Live: `API.md` (endpoint/code-review index — kept current per change), AGENT_OBSERVABILITY, CONTEXT_LIFECYCLE, EVALUATION, CHAT_AGENT, MCP_ARCHITECTURE/INTEGRATION, IMAGINE, NOTIFICATION_SERVICE, RAG_STRATEGY, SANDBOX_EXECUTION, CREDENTIALS_AND_SECURITY, VISION_AGENT, AGENT_TEMPLATES, TOOL_CONFIGURATION_PLAN, SPECIALIST_AGENTS_PLAN, PLATFORM_CAPABILITIES_PLAN, ENGINEERING_DECISIONS, WEBHOOK_TRIGGERS, POSTGRES_PRODUCTION_MIGRATION_PLAN, ORCHESTRATOR_LATENCY_OPTIMIZATION_PLAN
- Planning: AGENT_WORKFLOW_MERGE_PLAN, AGENT_WORKFLOW_UNIFICATION, AGENT_BLOCKS_PLAN, WORKFLOW_RETIREMENT, EXTRACTION_MERGE, EVALUATION_PRODUCTION_PLAN (status: implemented 2026-09-19)
- **Stale** (describe deleted systems): root `Backend/README.md`, `chat/README.md`

### Requirements
- 196 pinned lines (was 213). `wasmtime` and `RestrictedPython` gone with the WASM sandbox; `openpyxl`/`python-docx` added for office files; `beautifulsoup4` pinned (production never had it); Node removed from the image with the stdio connectors

---

## Recent work (2026-09-05 → 09-21)

- **2026-09-21 — P0 foundations.** Secret references, cost ledger, egress guard, capability registry (`GET /api/orchestrator/capabilities/`); blocking trigger runs; longer sessions; trimmed coming-soon notes (`94a9292`).
- **2026-09-20 — six tools + tool scope.** `download_file`, `render_pdf`, `edit_workbook`, `render_diagram`, `extract_data`, `notify_user`; `generate_image`→`sensitive`; `agent_context['toolScope']` third axis (narrows only, never `ALWAYS_AVAILABLE`) (`7685450`).
- **2026-09-20 — uploads + extraction.** Allow-by-default uploads (executables refused), `.xlsx`/`.pptx` extractors on both doors, `file_type='other'` default so unknown binaries no longer index zip noise (`faca4ce`).
- **2026-09-20 — specialists.** Office renderers, sandbox file bridge, published pages, images, browser engine + five grant-gated tool modules; gallery templates (analyst/slides/writer) with `outputContract: files`; install-pack endpoint (`c9e3c96`).
- **2026-09-19 — eval work tier.** Fixture workspaces, file/json/csv graders, 3-runs-per-case pass@1 + pass^k, stream connect-retry, node-counted step budget (`STEPS_PER_ITERATION`), eval production plan implemented (`23d34e9`); `executor` husk deleted.
- **2026-09-17 — native Google + perf.** Gmail/Drive/Sheets/Calendar as native REST tools (`type='native'`), benchmark suite (`eval/benchmarks/`), shared HTTP client, session-list index; MCP memory supervisor (listing never spawns, serial refresh queue, admit-against-megabytes); undelivered steers returned to the user.
- **2026-09-13 — latency + catalogue floor.** Pre-model `[Latency]` timer, cached vision witness (60s TTL, absence cached), `MCPToolCatalogue` DB floor (Redis → DB → live), model seed refresh.
- **2026-09-05/06 — HITL + files.** Inbox resume that actually resumes, `describe_call` renderer (sync, no I/O, redacted, shaped), worker shared-prefix file workspace, turn-output e2e test.
- **Earlier cycle (09-02 → 04)** — see previous compile: publishing, recovery, charts, todos, memory, authoring tools, connector/delegation scopes, effort ladder, OpenRouter default, WASM deletion, `buddy` removal.

---

## Known Gaps / Open Items

1. **Stale docs:** root `Backend/README.md`, `chat/README.md` — both describe systems that no longer exist. Deleting them is a smaller job than the rewrite they look like.
2. **`reviewAgent` is a switch that reads nothing** — the last of its kind on the builder board, kept deliberately pending a decision on wiring it to `eval/api.py::grade_execution`.
3. **Connector `selected` mode has no picker.** The API accepts it and the runtime enforces it; the builder offers only *Everything* / *Read only*, because per-tool checkboxes need the live catalogue from `GET /api/mcp/servers/<id>/tools/`. Small follow-up, not a design question.
4. **Thin coverage:** `skills` (14 tests), `streaming` (15), `tools_config` (15) — proportionate to their size, but they are the first places a regression would go unnoticed. `browsing/` has no suite of its own (covered via chat).
5. **No `transaction.atomic()` on most writes** — still the systemic issue `docs/API.md` calls out.
6. **Broker path unexercised by hand:** everything behind `RUN_WORKFLOWS_ASYNC` and Celery beat is covered by tests only, since local dev runs inline.
7. **No per-agent run envelope.** `maxIterations` (40), total tool calls (unbounded), delegation depth/width, curation watermarks and tool-output ceilings are all module constants, identical for a two-second lookup and an overnight research run. Audited and planned; not built.
8. **Paid eval runs still need go-ahead:** baseline acceptance, judge calibration and gate proof need a funded OpenRouter key (benchmark agents run `deepseek/deepseek-v4.1-flash`, judge is `meta/muse-spark-1.3-contributor` — never the same model).

---

## Deploy record — 2026-09-22 (production live on this tree)

- **Code:** `Backend/` `6184cc6` → `1d15563` (7 commits: migration-test restore fix,
  coding-team pack, schedules, messaging, llm fallback/Zen, data→datasources
  rename, docs/wiring, `is_durable` fix), `better-n8n-frontend/` `1ced6f8` →
  `077462f` (plan panel, chat/draft/builder updates). Both pushed to `agent`.
- **Triage found and fixed before push:** `logs/tests/test_migrations.py` rewound
  `logs` without restoring dependents (`workspaces.0002`, `agents.0025`),
  dropping their tables for the rest of the session; `is_durable()` read runtime
  `active_backend` instead of configuration, so `recover_runs` reported a sqlite
  deployment as memory-backed. Both fixed, covered, green.
- **Suite on the deploy tree:** 3053 passed; remaining failures are dev-box-only
  (broken faiss/numpy on Windows; `sentry_sdk` installed mid-triage) plus
  timing-sensitive flakes (scheduler sweep, egress) that pass in isolation —
  none reproduce on a clean run of their own files. Full-suite green on this
  Windows box is not provable; CI still needs moving to a root `.github/` so
  GitHub proves it (blocker 4 above stands).
- **Images:** `kaushaljainai/aiaas-{backend,frontend,sandbox}:latest` +
  `:2026-09-22` (+ SHA tags `1d15563`/`077462f`) built and pushed from this machine.
- **EC2:** host moved (DNS now `13.127.148.207`; the `15.252.76.239` in the repo
  compose is stale — updated on the box, and in the repo file). Pre-deploy
  `pg_dump` at `~/predeploy_2026-09-22.dump` (23 MB). `pull` + `up -d`: all six
  services healthy, migrations current through `orchestrator.0026`, catalogue
  re-synced at boot. Public checks: `/api/health/` → healthy, `/` serves the app.
- **Schedulers turned on (was empty crontab):** installed `cronie` (absent on
  AL2023 minimal) and the three documented host-cron lines (triggers every
  minute, HITL reminders every 5 min, model refresh weekly). `recover_runs` +
  `run_due_triggers` verified working; **no orphaned runs, nothing due.**
  Added `AGENT_CHECKPOINTER: sqlite` to the box compose (was unset → memory) so
  paused runs survive restarts; verified `recover_runs` now reports
  `sqlite (durable)`.
- **Still not done against the live URL:** logged-in walkthrough (one agent run
  + one approval gate), which needs a user session — that is OBJECTIVES Phase 3's
  remaining box.
