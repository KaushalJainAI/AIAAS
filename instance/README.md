# instance/

Local simulation harness — **dummy data, dummy permissions, and interactive browser-automation test cases** that act like a regular user. Nothing in here is real credentials or PII; everything is synthetic and safe to replay locally.

> **Goal:** simulate a realistic user record end-to-end — seed data → permissions → browser clicks through the UI — so agents, HITL, RAG, and tool policies can be exercised the way a real user would.

---

## Structure

```
instance/
├── README.md                 # this file
├── test.env                  # ONE config both harnesses read (dummy values only)
├── docs/
│   ├── USER_JOURNEY.md       # happy-path contract (input → output → UI)
│   └── SUSPICIOUS_USER.md    # adversarial threat model + triage guide
├── scripts/                  # automation scripts (API + ORM)
│   ├── seed_instance.py              # ORM seeder — wipes ONLY instance personas
│   ├── simulate_user_journey.py      # happy-path API journey (7 stages via HTTP + SSE)
│   ├── simulate_suspicious_user.py   # adversarial API harness (40+ probes, 2 users, IDOR)
│   ├── setup.ps1 / setup.sh          # one-command bootstrap
│   └── utils/ {api_client, fixtures, payloads}.py
├── dummy-data/
│   ├── users|agents|knowledge-bases|documents|folders  # happy fixtures
│   └── suspicious-payloads.json      # XSS / injection / traversal / prompt lists
├── dummy-permissions/        # permission matrices (tool overlay, autonomy, MCP, roles)
└── interactive-tests/        # browser-automation (Playwright)
    ├── playwright.config.ts
    ├── helpers/ {auth, seed, assertions}.ts
    └── scenarios/
        ├── 001-smoke … 003-rag.spec.ts          # happy paths
        ├── 004-suspicious-inputs … 006-permission-abuse.spec.ts  # adversarial
        ├── 007-google-connectors-demo.spec.ts   # recorded: one-click Google connect
        └── 008-normal-user-day.spec.ts          # recorded: a normal user's session
```

All fixture schemas are **git-tracked but generated artifacts are ignored** — see `instance/.gitignore` + `interactive-tests/.gitignore`.

---

## 1. `dummy-data/` — synthetic records

Seed data that looks like production without being production.

| File pattern | Purpose |
|---|---|
| `users.json` | Fake users (names, emails `@example.com`, roles) |
| `agents/*.json` | Fake `SubAgent` configs — prompt, model, `output_schema`, `fanout`, `allow_unattended` |
| `knowledge-bases/*.json` | KB metadata + `documents/*.md|pdf` for RAG indexing |
| `folders/*.json` | `Folder` / `Document` trees for `inference/filesystem.py` + `inference/vfs.py` |
| `workflows/*.json` | Legacy `Workflow` JSON if testing the DAG surface |
| `credentials/*.json` | Fake credential *shapes* (never real secrets; `CREDENTIAL_ENCRYPTION_KEY=test` only) |

**Rules:**
- All emails end in `@example.com` / `@test.local`.
- All secrets are `dummy-*` or `test-*` — greppable and never valid.
- Each dataset has a `seed.py` or `seed.ts` that idempotently loads it via Django ORM / API.
- Documents that should be RAG-indexed go under `dummy-data/knowledge-bases/` and are ingested via the same path as user uploads (`inference/` pipeline).

Example:
```json
// dummy-data/users/regular-user.json
{
  "username": "demo_user",
  "email": "demo_user@example.com",
  "role": "member",
  "note": "regular non-admin user for permission boundary tests"
}
```

---

## 2. `dummy-permissions/` — synthetic permission fixtures

Declarative permission states to test the two axes that actually gate behaviour:

- **Per-agent grants** (`GRANT_TOOLS` / `SubAgent.grants`) — what one agent may reach.
- **Per-user tool overlay** (`tools_config.ToolConfig`) — what exists to be granted.
- **Autonomy ladder** (`plan | review | ask | auto | full`) and `ToolPermission` remembers (`once | session | always`).
- **MCP / credential injection** — which MCP servers are enabled and which credential maps resolve.
- **File scopes** (`none | readonly | scoped | read_all_write_own | full`) and KB scopes.

| File | Covers |
|---|---|
| `tool-configs/*.json` | `ToolConfig` rows — enabled/disabled + knob values vs. `TOOL_SETTINGS` defaults |
| `autonomy/*.json` | `guardrails.autonomy` per agent + `ToolPermission` fixtures |
| `mcp/*.json` | `MCPServer` + `MCPServerPreference.effective_enabled` states |
| `files/*.json` | `FileScope` / `write_prefix` expectations for `read_all_write_own` etc. |
| `roles/*.json` | End-to-end role matrix (viewer / member / admin) |

> **Invariant:** an absent `ToolConfig` row = code default. Fixtures must assert that, and a "reset" fixture is a DELETE.

---

## 3. `interactive-tests/` — browser-automation scenarios

Scenarios open the app **like a real user** and assert on what a human would see.

### Happy paths (regular user — keep green)

- Login / signup / OAuth callback (`/oauth/callback`)
- Creating an agent, picking a model (`/api/llm/models/`), assigning grants + KB scope
- Running an agent (`POST /api/orchestrator/agents/{id}/execute/`) and watching `ws/` / SSE streaming
- HITL approve / reject (`scope=once|session|always`)
- Connections (`/connections`), chat with attachments, `ask_vision`, VFS file ops, trash restore, schedules (`cron.ts` ↔ `agents/triggers.py` preview parity)
- `001-regular-user-smoke.spec.ts` · `002-hitl-permission-flow.spec.ts` · `003-rag-kb-scope.spec.ts`

### Adversarial paths (suspicious / bad user — proves good paths hold)

- **004-suspicious-inputs** — XSS / injection / prompt injection typed into real inputs, no `dialog` alert, `400` not `500`, leak checks (`CREDENTIAL_ENCRYPTION_KEY` never in DOM)
- **005-idor-traversal** — two users (A=regular, B=power), A's browser tries `GET /agents/<B_…>` / `fs/move` into B's folder → `404` oracle-safe, not `403`
- **006-permission-abuse** — locked `read_tool_output` stays `400`, disabled `web_search` stays gated at `execute-tool`, `plan` withholds
- Mirrors `simulate_suspicious_user.py` but at browser fidelity — same `docs/SUSPICIOUS_USER.md:2.x` gap map.

### Layout per scenario

```
interactive-tests/
├── README.md
├── playwright.config.ts
├── helpers/ {auth, seed, assertions}.ts
├── scenarios/
│   ├── 001-regular-user-smoke.spec.ts
│   ├── 002-hitl-permission-flow.spec.ts
│   ├── 003-rag-kb-scope.spec.ts
│   ├── 004-suspicious-inputs.spec.ts
│   ├── 005-idor-traversal.spec.ts
│   └── 006-permission-abuse.spec.ts
├── fixtures/trace/                # Playwright traces / videos (gitignored)
└── .gitignore
```

### Conventions

- One scenario = one user journey, named `NNN-kebab-case.spec.ts`.
- Each scenario seeds its own data via `helpers/seed.ts` — no cross-scenario state.
- Selectors prefer `data-testid` over CSS; add the attribute in the frontend when missing.
- Every scenario records trace/video on failure; artifacts are gitignored.
- Sensitive tool calls are mocked or run against `dummy-permissions/` — never against real keys.
- `filePath:line_number` references in comments point to the code under test (e.g. `Backend/agents/agent/runtime.py:1`).

### Recording a walkthrough

`008-normal-user-day.spec.ts` is the "watch a real person use it" take: it signs
in by **typing into the real login form** (every other scenario injects a JWT,
which is right for a test but means the login screen is never filmed), asks the
assistant a question, opens Documents and Agents, runs an agent, and reads the
run record — paced so a viewer can follow.

```bash
cd instance/interactive-tests
E2E_RECORD=1 npx playwright test scenarios/008-normal-user-day.spec.ts
# → test-results/008-.../video.webm
ffmpeg -i "test-results/008-.../video.webm"   -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2"   -c:v libx264 -pix_fmt yuv420p -crf 23 normal-user-walkthrough.mp4
```

`E2E_RECORD=1` turns video on for every scenario, sizes the viewport from
`test.env`, and enables the per-step `beat()` pauses. Without it the same file
runs as an ordinary (slightly slower) test — which is the point: **the recording
and the test are the same code**, so a walkthrough cannot drift away from a
suite that still passes.

It asserts like a test, not like a screensaver: the run stage requires a
non-empty answer and non-zero tokens, because `status == "completed"` alone was
exactly what let a provider error through as a green run.

It also pins the chat model in `localStorage` (`standalone_chat_llm_provider` /
`standalone_chat_llm_model`). The picker does **not** read `UserProfile.llm_model`,
so seeding the profile alone left chat on the platform default — the model
measured at roughly 50% "Service temporarily overloaded". A demo must not gamble
on the provider.

### Running — browser harness

```bash
cd instance/interactive-tests
npm install
npx playwright install --with-deps
npm test                          # all (happy + adversarial, serial)
npx playwright test scenarios/001-regular-user-smoke.spec.ts --headed  # one happy
npx playwright test scenarios/004-suspicious-inputs.spec.ts --headed   # one adversarial
npm run test:trace                # keep trace every run
```

### Running — API harnesses (fast, no browser)

```bash
# seed once (idempotent, wipes only instance personas)
python instance/scripts/seed_instance.py

# happy path
python instance/scripts/simulate_user_journey.py --no-run --verbose
python instance/scripts/simulate_user_journey.py --goal "Summarize the ACME invoice"

# adversarial — the "ill help me find issues while trying to be function well" harness
python instance/scripts/simulate_suspicious_user.py --verbose
python instance/scripts/simulate_suspicious_user.py --json-out instance/report-adversarial.json

# one-command bootstrap (migrate + populate + seed + both smokes)
powershell -ExecutionPolicy Bypass -File instance/scripts/setup.ps1
bash instance/scripts/setup.sh
```

### Before any of the above — two things that decide whether a run means anything

**1. One database.** `SQLITE_PATH` in `Backend/.env.local` is relative, and a
relative path used to resolve against the *current working directory* — so
`manage.py` (run from `Backend/`) and the harnesses (documented as run from the
repo root) used two different `db.sqlite3` files. The seeder wrote personas into
a stale database the server never read, and the app came up empty. `settings/base.py`
now resolves a relative `SQLITE_PATH` against `BASE_DIR`, so every entry point
agrees. If you ever see a seeded persona that cannot log in, check this first.

**2. The test-client rate lane.** Auth is throttled for humans (`login` 5/minute,
`register` 3/minute) and that limit is deliberately still asserted by the
adversarial harness's brute-force probe. A suite signing three personas into
nineteen scenarios is not brute force, so it presents a token instead:

It lives in `instance/test.env`, which both harnesses load automatically —
`instance/scripts/utils/testenv.py` for the Python side,
`instance/interactive-tests/helpers/testenv.ts` for the browser side — so there
is nothing to export by hand. The real process environment always wins over the
file, so CI can override any value without editing it.

```bash
# only needed if you are NOT using instance/test.env
export E2E_THROTTLE_BYPASS_TOKEN=instance-local-e2e   # must match Backend/.env.local
```

The header goes on the **harness's own** API calls, never on `use.extraHTTPHeaders`:
attaching a custom header to every browser request turns cross-origin font
fetches into preflighted ones, and Google Fonts then fails CORS — which shows up
in a recording as the app silently rendering in fallback fonts.

Without it the browser suite pays the limiter and fails on timing rather than on
what it tests. It exempts **rate limits only** — authentication, permissions and
ownership are untouched — and the whole mechanism is off wherever
`E2E_THROTTLE_BYPASS_TOKEN` is unset, which is the default and what any real
deployment should keep.

Full guide: `scripts/README.md` + `docs/USER_JOURNEY.md`. CI needs `CREDENTIAL_ENCRYPTION_KEY=test` and `RUN_WORKFLOWS_ASYNC=False`.

---

## Adding new content

1. **New dummy record** → add JSON under `dummy-data/` + update `dummy-data/seed.py` to load it. Keep `id` stable.
2. **New permission case** → add JSON under `dummy-permissions/` + a test in `tools_config/tests/` or `chat/tests/test_permissions.py` that asserts enforcement via `chat/tools/disabled_tools_for`.
3. **New scenario** → add `scenarios/NNN-*.spec.ts` under `interactive-tests/`; helpers in `helpers/` are shared, scenario-local fixtures stay in the file.

## What NOT to put here

- Real API keys, real OAuth tokens, real user exports — use `dummy-*` values only.
- Production DB dumps or `Backend/.env` — `.gitignore`d everywhere.
- Large binaries / model weights — link or generate them.

## See also

- `docs/USER_JOURNEY.md` — **start here** for happy-path input→output→experience
- `docs/SUSPICIOUS_USER.md` — threat model + `PASS/WARN/FAIL` triage for adversarial harness
- `scripts/README.md` — how to run all harnesses
- `Backend/docs/API.md` — full route map the scenarios drive
- `CLAUDE.md` — architecture, execution pipeline, and per-app notes
- `Backend/workflow_backend/thresholds.py` — caps and limits the harnesses respect
- `scripts/utils/fixtures.py` + `payloads.py` — personas and adversarial payloads (single source of truth)
- `dummy-data/suspicious-payloads.json` — declarative XSS/injection/traversal lists
