# User Journey — Input → Output → Experience

> How a **regular user** moves through AIAAS, what they send, what the system returns, and what the UI must show at each step. This is the contract the `instance/` harness simulates via API + browser automation.

---

## 1. Mental Model

```
User Intent (natural language goal)
        │
        ▼
Frontend (React/Vite)  ──REST / SSE / WS──►  Backend (Django + LangGraph)
        │                                          │
        └───────────◄── streaming tokens ────────────┘
```

Every journey has three layers to simulate:
- **Input** — what the user types/clicks/selects
- **Output** — what the API returns (JSON, SSE frames, WS events)
- **Experience** — what the UI renders, latency, loading, error, empty, and success states

A good simulation asserts all three, not just that the API returned 200.

---

## 2. Journey Map (7 stages)

### Stage 0 — Onboarding (Auth)

| Step | User Input | API Input → Output | UI Experience |
|------|------------|--------------------|---------------|
| Signup | name, email (`@example.com`), password ≥8, confirm | `POST /api/auth/register/` `{username=email, email, password, password2, first_name}` → `201 {access, refresh, user}` | Redirect `/ai-chat`, toast success, Sidebar shows avatar |
| Login | email, password | `POST /api/auth/login/` `{email, password}` → `{access, refresh, user}` or `401` | On 401: inline banner (never navigate away). Rate limit `5/min` shows throttle message |
| Forgot password | email → OTP (6 digits) → new password | `POST /api/auth/password-reset-request/` → `POST /api/auth/password-reset-verify/` → `{verification_token}` → `POST /api/auth/password-reset-confirm/` | 3-step wizard, each step has own validation, OTP input filters `\D` |
| Guest chat | none (landing `/`) | `POST /api/chat/guest/sessions/` → session id (no JWT) | Same `StandaloneChat` UI in minimal shell, "Log in" toasts on restricted actions |
| Google OAuth | click Google button | `GET /api/auth/google/` redirect → `/auth/google/callback?code=` → `POST /api/auth/google/` | Popup `600×700`, `postMessage OAUTH_SUCCESS` then close |

**UX checks simulation must cover:**
- Empty fields → inline validation, submit disabled
- XSS in email (`<script>`) → no `dialog` alert, field sanitized
- Rapid double-click submit → debounced, ≤1 request (see `better-n8n-frontend/tests/e2e/auth.spec.ts:59`)
- Protected route while logged out (`/agents`) → redirect `/login`

---

### Stage 1 — Explore (Chat + Knowledge)

#### 1a. Chat (`/ai-chat` → `StandaloneChat`)

| User Input | API | UI |
|------------|-----|----|
| Types message, picks `intent` (`normal/search/image/video/research`), picks model (`nvidia/...`), uploads file, toggles memory | `POST /api/chat/sessions/` `{title, memory_enabled}` → session id. `POST /api/chat/sessions/{id}/upload/` multipart `file` → `{attachment}`. `POST /api/chat/sessions/{id}/message/stream/` `{content, intent, llm_provider, llm_model, reference?}` SSE frames `status → thinking_chunk → content_chunk → sources_update → done` | Empty hero: `BrainCircuit` + "What should I take off your plate?" + 4 starters (`Mail`, `FolderSearch`, …). Composer `textarea` auto-resizes 200px, `Enter` sends, `ThinkingTimer` isolated 10Hz, live markdown streaming, stop button while `isLoading`, history drawer (`Conversation history`) with delete/rewind |
| Approves tool | `POST …/message/stream/` `{approve_tool_call, approval_scope: once|session|always}` | Banner `pendingToolCall` with Approve / Remember + Reject. After approval stream resumes |
| Edits/deletes message | `DELETE /api/chat/sessions/{id}/messages/{mid}/?rewind=true` | Transcript updates, `localStorage` transcriptCache cleared |

**UX invariants:**
- Preflight runs before `STATUS` event and before persisting user message — quota/auth errors show as error frame, never as assistant apology
- `llm_model` text-only + image attachment → `ask_vision` witness offered; otherwise withheld
- `read_tool_output` only offered after a spill

#### 1b. Documents (`/documents`)

| User Input | API | UI |
|------------|-----|----|
| Browses folders, creates/renames/deletes folder, drags to move | `GET /api/inference/folders/?parent=<id>` → `{folders, breadcrumbs, count, truncated}`, `POST {name, parent_id}`, `POST /api/inference/fs/move/ {folder_ids, document_ids, target_folder_id}` | `FolderTile`, `Breadcrumbs`, drag ghost `dropEffect copy`, Grid/List toggle, `FolderPickerModal` |
| Uploads file, links to KB + folder | `POST /api/inference/documents/` multipart `file, kb_id?, folder_id?` → `201 {id, status: indexed}` background `process_document` | `Upload` modal with drag zone, optimistic card `id=-Date.now()`, progress, toast, folder count updates |
| Searches, toggles share, downloads, trash/restore | `POST /api/inference/rag/search/ {query, top_k}`, `POST documents/{id}/share/`, `GET documents/{id}/download/`, `DELETE documents/{id}/` (→ `deleted_at`), `GET /api/inference/trash/`, `POST /api/inference/trash/restore/` | Tabs `My Documents | Public Library | Extraction | Trash`, shared badge, `Move to Trash` confirms `purges_after_days`, `Restore` / `Empty Trash`, parent-still-trashed error |

**UX invariants:**
- Trash is a state (`deleted_at`) not a folder — `LiveManager` hides trashed rows by default
- Move uses `id` not `path` — no route accepts a path string
- Download validates `validate_attachment_path` — traversal rejected
- `my_next_cursor` / `public_next_cursor` pagination, `truncated` flag when capped

---

### Stage 2 — Build (Agent Builder `/agents/new` + `/agents/:id`)

**Builder is a split view:** left mini-chat (`propose`) + right knob board (`2xl:columns-2`).

| Section | Input widget | API field → Output |
|---------|--------------|--------------------|
| Identity (`Bot`) | `input[placeholder="Finance agent"]` name, `textarea` brief | `name` (required, unique per user, dedup `(1)`), `brief → description + prompt` |
| Model (`Brain`) | `Select` provider + model, `range 0-1 step0.1` temperature | `provider`, `model`, `temperature` 0-2 default 0.2 |
| Files (`FolderLock`) | `Choice` fileAccess | `fileAccess: none\|readonly\|scoped\|read_all_write_own\|full` (scoped = `/Agents/<name>/`) |
| Run limit (`Timer`) | `number 1-120` mins + quick 5/15/30/60, `Toggle venv` | `maxRunSeconds`, `venv` |
| Tools (`Wrench`) | 7 toggles | `tools: {codeExecution, shell, webSearch, scrape, fileOps, rag, mcp}` gated by `GRANT_TOOLS` |
| Context (`Plug`) | `MultiSelect` connectors/skills, toggles `useOrgContext/useEnvironment` | `connectors[]` (validated via `visible_server_ids_sync`), `skills[]`, `knowledgeBases[]` |
| When it runs (`Clock`) | `Choice TriggerMode`, `ScheduleEditor` cron+timezone | `trigger, schedule, scheduleTimezone, allowUnattended, extraSchedules` |
| Safety (`ShieldCheck`) | `Choice Autonomy`, `Choice Egress`, toggles `notifyOnHitl/reviewAgent`, `₹ spendCap` | `autonomy: plan\|review\|ask\|auto\|full`, `egress: none\|allowlist\|full` (shell+full → 400), `spendCapRupees`, `notifyOnHitl` |
| Lifecycle (`Layers`) | Toggles + `Select summaryModel` | `compaction, recursiveContext, indexing, summaryModel` |
| History (`History`) | read-only | `GET /api/logs/agents/{id}/revisions/` → `v{n} diff` 6 fields |

**Save:** `POST /api/orchestrator/agents/` (create 201) or `PATCH /api/orchestrator/agents/{id}/` then `invalidateQueries(['agents'])`, toast, nav. Validations: `schedule` cron 5 fields → `next_run_after != null`, `maintenance` requires schedule, schedule requires `allowUnattended=True`.

**UX invariants:**
- `fileOps=false` + `fileAccess != none` is inconsistent — builder should warn
- `plan` withholds mutating tools wholesale; `approval_policy_for('plan')=never`
- Revision history shows `is_delegated` badge if spawned by another agent
- Delete asks confirm, Reset restores `initialConfig`

---

### Stage 3 — Connect (Credentials + Connections)

| User Input | API | UI |
|------------|-----|----|
| Creates credential (apiKey / oauth2) | `POST /api/credentials/ {name, credential_type: slug|id, data:{key:val}}` validated via `CredentialManager.validate_against_schema`, encrypted via `CREDENTIAL_ENCRYPTION_KEY` | `Credentials.tsx` tabs `verified/unverified`, `SearchInput`, card with `View/Edit/Verify/Delete`, `••••••` mask + Eye toggle |
| Enables MCP server | `GET /api/mcp/servers/` visible `Q(user=user)|Q(user__isnull)`, `POST /api/mcp/servers/{id}/set-enabled/ {enabled}` writes `MCPServerPreference` (system rows are read-only config, toggle is per-user `effective_enabled`) | `Connections.tsx` curated grid (`Ready/Connected/Not connected/Off/Unavailable`), per-system switch `role="switch" aria-checked`, `What it can do` lazy `GET /api/mcp/servers/{id}/tools/`, Advanced disclosure for custom servers |
| Validates credential | `GET /api/mcp/servers/{id}/validate_credentials/` dry run | Status dot + amber `setup_notes` if unavailable |
| Uses in agent | Agent builder `connectors` MultiSelect → `agent_context.connectors` | Only `effective_enabled` servers appear in picker |

**UX invariants:**
- Platform-owned values `@settings:VAR` need no per-user credential
- Credential file injection (`credential_file_map`) materializes into `mkdtemp` 0700/0600 per `(server_id, user_id)` and is removed on session unwind
- `PATH` + `NPM_CONFIG_CACHE` must stay in subprocess env or `npx` is unfindable / cold

---

### Stage 4 — Configure Tools (`/tools`)

| Input | API | UI |
|-------|-----|----|
| Toggles tool, edits knob (`maxResults` etc.) | `GET /api/tools/` catalogue overlaid with `ToolConfig`, `PATCH /api/tools/ {tool_name, enabled, config}` or bulk `{tools:{name:{enabled,config}}}` — `LOCKED_TOOLS (read_tool_output, recall_context)` cannot be disabled, absent row = default, row that drifts to defaults is DELETE'd | `Tools.tsx` grouped `ToolRow` with `EffectBadge read/reversible/irreversible`, `Switch`, `ToolDrawer width 480px role="dialog"` with `SettingsEditor` (`min/max w-28`, Save + Defaults) |

**Enforcement:** `chat/tools/disabled_tools_for(user)` is the single read consulted by `get_available_tools` (chat), `AgentToolbox.descriptors` (agents), `execute_tool` (both).

---

### Stage 5 — Run (Execute + Stream + HITL)

| Step | Input | API | UI |
|------|-------|-----|----|
| Start run | Goal text `1..8000` chars, optional `thread_id` (resume) | `POST /api/orchestrator/agents/{id}/execute/ {goal, thread_id?}` → checks `_check_unattended` + `check_guardrails` (spend via `spend.rupees_for(tokens)`) + `llm.preflight` → `202 {execution_id, status: running, unserved_grants}` via `background.spawn()` or `402/400` refusal | `Agents.tsx` card `Execute`, list shows `running` `Loader2` + `pending HITL Hand` badge |
| Stream | Open WS/SSE | `GET /api/streaming/executions/{id}/stream/?token=<jwt>` or `ws/execution/{id}/` frames `run_started, tool_result, curation, run_finished` | `Runs.tsx` row expands → `RunDetail` with `Turn[]` (reasoning, `AgentStep` tool, duration bar, `error_message`, `delegated_runs CornerDownRight`) poll `10s` if running |
| Approve / Reject | Click Approve with `scope once|session|always` | `POST /api/orchestrator/agents/{id}/approve/ {thread_id, call_id, scope}` → `approve_tool_call` + `resume_agent_run`, or `POST …/reject/ {reason}` | `Overview` HITL queue (`Hand` list `request_id`, `timeAgo`, `timeLeft`, `stage`, Approve/Reject with scope radios). `ws/hitl/` raises OS notifications for escalation/hourly/digest |
| Steer | Send new instruction mid-run | `POST /api/orchestrator/agents/{id}/steer/ {message 1..4000}` → `steering.post(thread_id)` mailbox (last-write-wins, drained on `tools→steering→agent` edge) | Banner "Steered" |
| Switch autonomy mid-run | Select `review|ask|auto|full` | `POST /api/orchestrator/agents/{id}/autonomy/ {level}` → `steering.set_autonomy` (not retroactive, `plan` not switchable) | Autonomy chip updates |
| Observe | Poll logs | `GET /api/logs/executions/?limit=20&cursor&workflow_id&status`, `GET /api/logs/executions/{id}/` → `{revision, turns, delegation}`, `GET /api/logs/agents/{id}/revisions/`, `GET /api/logs/insights/stats/?days=7` | `Overview` four questions: HITL queue, `% handled without you`, stats `PlayCircle/Hand/XCircle/CheckCircle2`, `ActivityChart/Table`, `Most used tools`, `Repeat failures` |

**UX invariants:**
- `caller in UNATTENDED_CALLERS` requires `allow_unattended=True`
- Delegation bounded: depth (`MAX_DELEGATION_DEPTH`), budget (`divide_budget` reserves up front), result size (per-worker + proportional whole fanout), workers get throwaway `thread_id` + narrowed toolbox (no `subAgents`)
- `spendCapRupees` vs `tokens_used` via `RUPEES_PER_MILLION_TOKENS` — same number UI and guardrail read
- `ExecutionLog.parent_step` FK answers "who delegated?" + stores `delegation_task`
- Curation watermark `0.70 → 0.45` edits graph state not outgoing copy, archives to `ToolOutput` for `recall_context`/`read_tool_output`

---

### Stage 6 — Schedule / Automate (`/schedules`)

| Input | API | UI |
|-------|-----|----|
| Picks agent, cron `* * * * *`, timezone IANA, overlap `skip|queue|cancel`, window `starts_at/ends_at` | `POST /api/orchestrator/triggers/ {subagent, mode:schedule, cron, timezone, name, goal, enabled, overlap, starts_at, ends_at}` origin `manual`, `_arm()` via `next_run_after(cron, after, tz)` walks local minutes → UTC, `GET /api/orchestrator/triggers/` capped 200 + `truncated`, `POST /api/orchestrator/triggers/preview/ {cron, timezone}` → `{valid, description, upcoming[3]}` (200 even when `valid:false`), `POST /api/orchestrator/triggers/{id}/run_now/`, `POST /api/orchestrator/hooks/<secret>/` (AllowAny 404 on refusal, 64KB cap) | `Schedules.tsx` card with `CalendarClock/Webhook/Zap`, cron `mono`, `goal` line-clamp-2, `enabled` toggle `sr-only peer`, `next_due_at` relative + absolute, `last_outcome/last_error`, `timezone Globe`, `queued_for` banner, webhook `Copy→Check`, failures + self-disable after 5 |

**UX invariants:**
- Local wall-clock walk + UTC storage — `0 9 * * *` is 09:00 in `Trigger.timezone`
- DST: spring-forward gap **skips**, autumn fold fires **once**
- `overlap=queue` stores `queued_for` with 6h TTL; `starts_at/ends_at` window gates liveness; `last_outcome/last_error` surfaced; impossible cron disables with reason (not `NULL next_due_at`)
- `describe()` wording pinned same table `agents/tests/test_schedules.py::DescribeTests.CANONICAL` ↔ `src/lib/__tests__/cron.test.ts`

---

### Stage 7 — Observe & Iterate (Runs + Overview + Settings)

- **Runs (`/runs`)** filter `all|completed|failed|running` persisted `runs.filter`, `limit 50`, `execution_id` expand → revision, delegation banner, turns, steps. Poll 10s.
- **Overview (`/overview`)** window `7|30|90` days → `GET /api/logs/statistics/?days=`, cost breakdown, HITL queue, autonomy %, charts.
- **Settings (`/settings`)** tabs `general|account|insights|billing|notifications|appearance|api` — timezone, language, theme `light|dark|system`, `PATCH /api/auth/profile/`, avatar `POST …/avatar/` multipart, API key `GET/POST /api/auth/api-keys/`.
- **Profile (`/profile`)**, **Skills (`/skills`)**, **Evals (`/evals`)**, **Imagine (`/imagine`)** — read their specific docs.

---

## 3. Input/Output Contract Summary (copy-paste for scripts)

```python
# Auth
POST /api/auth/register/  {username, email, password, password2, first_name, last_name} → {access, refresh, user}
POST /api/auth/login/     {email, password} → {access, refresh, user}
POST /api/auth/token/refresh/ {refresh} → {access}

# Sessions / Chat
POST /api/chat/sessions/  {title*, memory_enabled?} → {id, title}
POST /api/chat/sessions/{id}/upload/  multipart file → {attachment}
POST /api/chat/sessions/{id}/message/stream/  {content*, intent?, llm_provider?, llm_model?, approve_tool_call?, approval_scope?} → SSE data: frames

# Folders / Docs / RAG
POST /api/inference/folders/ {name*, parent_id?} → {id, path}
POST /api/inference/documents/ multipart file, kb_id?, folder_id? → {id, status}
POST /api/inference/rag/search/ {query*, top_k?, kb_id?} → {results[]}
POST /api/inference/trash/restore/ {folder_ids[], document_ids[]} → {restored}

# Agents
POST /api/orchestrator/agents/  AgentSerializer flat JSON → {id, status, spend, runs, unserved_grants}
PATCH /api/orchestrator/agents/{id}/  partial → {id}
POST /api/orchestrator/agents/{id}/execute/ {goal*, thread_id?} → 202 {execution_id} | 402/400
POST /api/orchestrator/agents/{id}/approve/  {thread_id, call_id, scope} → {approved, resumed}
POST /api/orchestrator/agents/{id}/reject/   {thread_id, call_id, reason?}
POST /api/orchestrator/agents/{id}/steer/    {message} → {steered}
POST /api/orchestrator/agents/{id}/autonomy/ {level: review|ask|auto|full}

# Triggers / Schedules / Webhooks
POST /api/orchestrator/triggers/ {subagent, mode, cron, timezone, ...}
POST /api/orchestrator/triggers/preview/ {cron, timezone} → {valid, description, upcoming}
POST /api/orchestrator/triggers/{id}/run_now/ → {outcome}
POST /api/orchestrator/hooks/<secret>/  (no auth, 64KB cap) → 202 or 404 oracle-safe

# Credentials / MCP / Tools / Logs
POST /api/credentials/ {name, credential_type, data}
GET  /api/mcp/servers/ → {servers: [{effective_enabled}]}
POST /api/mcp/servers/{id}/set-enabled/ {enabled}
GET  /api/tools/ → {categories, enabledTools} + PATCH {tool_name, enabled, config}
GET  /api/logs/executions/?limit&cursor&workflow_id&status → page
GET  /api/logs/executions/{id}/ → {revision, turns: [{reasoning, steps}]}
GET  /api/llm/models/ → {providers: [{slug, has_credentials, models}]}
```

All protected routes: `Authorization: Bearer <access>` or `X-API-Key: <key>` or `?token=<jwt>` for SSE/WS. Throttles: anon `100/hr`, user `1000/hr`, login `5/min`, register `3/min`, chat `20/hr`.

---

## 4. What "Good Experience" Means — Checklist the harness must assert

1. **Fail before you look busy** — quota/auth errors surface before `STATUS` event, never as assistant apology
2. **No unbounded lists** — every list caps (`TRIGGER_LIST_LIMIT 200`, `FOLDER_CHILDREN_LIMIT`, `EXECUTION_STREAM_LOG_LIMIT`, `PAGE_SIZE 20`) and says `truncated`
3. **One door** — every run via `start_agent_run`/`run_agent` with `caller` check; `allow_unattended` enforced
4. **Approval is policy over the call** — MCP credentialed non-read verb → gated, `plan` withholds, `session` scope uses real `session_key` not throwaway `thread_id`
5. **Tool output bounded centrally** — `TOOL_OUTPUT_CHAR_LIMIT` backstop; over limit → spill to `ToolOutput` + `read_tool_output` preview
6. **Curation edits graph state, not copy** — `add_messages` substitutes by id; watermark `0.70→0.45` preserves prefix-cache
7. **Thrashing safe** — `Thread.join` doesn't kill; `PyThreadState_SetAsyncExc` + `forget_thread` on terminal paths only
8. **Detached tasks via `background.spawn()`** — never bare `create_task`, or `CurrentThreadExecutor` breaks post-200
9. **Routes are lazy, auth is eager** — loading skeletons, `Suspense` fallback, `isLoading → AppLoader`
10. **Selectors are stable** — `getByLabel` / `getByRole` / `aria-label`; `data-testid` migration is P1 but harness already works without it

If a simulation passes API status but misses these, it is not simulating a regular user.

---

## 5. Where instance/ fits

```
instance/
├── docs/USER_JOURNEY.md          # this file — the IO contract
├── scripts/
│   ├── seed_instance.py          # ORM seed (idempotent, wipes only instance-owned rows)
│   ├── simulate_user_journey.py  # API-level journey (requests, SSE, polling)
│   └── utils/api_client.py       # Bearer + refresh + retry
├── dummy-data/                   # fixtures loaded by seed_instance.py
├── dummy-permissions/            # ToolConfig / autonomy / MCP matrices
└── interactive-tests/            # Playwright journey (real browser, same journey)
```

Both harnesses run the **same 7-stage journey** at two fidelities:
- **API harness** — fast, CI-friendly, asserts contracts + logs
- **Browser harness** — slow, visual, asserts rendering + timing + accessibility

