# interactive-tests — Browser Automation Harness

Mimics a **regular user** in a real browser (Playwright) across the 7-stage journey in `instance/docs/USER_JOURNEY.md`. Same journey as `instance/scripts/simulate_user_journey.py`, but visual — asserts what the UI renders, not just what the API returns.

## Setup

```bash
cd instance/interactive-tests
npm install
npx playwright install --with-deps   # or: npx playwright install chromium --with-deps

# Backend + frontend must be running (or let config start frontend):
#   Backend:  cd Backend && python manage.py runserver 0.0.0.0:8000
#   Frontend: cd better-n8n-frontend && npm run dev  # :5173

# Seed dummy world first:
python ../scripts/seed_instance.py
```

## Run

```bash
npm test                  # headless, serial
npm run test:headed       # watch the browser
npm run test:ui           # Playwright UI mode
npm run test:trace        # keep trace every run
npm run report            # open html report after failure
npx playwright codegen http://localhost:5173  # record selectors

# Run one journey:
npx playwright test scenarios/001-regular-user-smoke.spec.ts --headed
```

## Structure

```
helpers/
  auth.ts        # register_or_login via API + inject localStorage tokens
  seed.ts        # API helpers (create folder, doc, agent) for test setup
  assertions.ts  # shared expect helpers (auth, nav, status pill, etc.)
scenarios/
  001-regular-user-smoke.spec.ts   # signup → chat → docs → agents → runs → overview
  002-hit-permission-flow.spec.ts  # approval scopes once|session|always + plan withholds
  003-rag-kb-scope.spec.ts         # KB scope + RAG search shape
fixtures/
  trace/         # gitignored
```

## Conventions (read before adding a spec)

- **One scenario = one journey file**, named `NNN-kebab-case.spec.ts`. Each seeds its own data via `helpers/seed.ts` — no cross-file state.
- **Auth via API + localStorage injection** (fast, mirrors `better-n8n-frontend/tests/e2e/connections.spec.ts:freshLogin`). After `register_or_login`, call `injectAuth(page, access)` which does `page.addInitScript(localStorage.setItem('access_token', …))` + `refresh_token`. No UI login unless the spec is testing login UX itself.
- **Selectors**: prefer `getByLabel` / `getByRole` / `aria-label` (stable today). `data-testid` migration is planned but specs already work without it — see `instance/docs/USER_JOURNEY.md:115` for the target list.
- **Human timing**: type with `delay: 30`, wait for SSE/stream Idle via `expect(page.getByRole('button', {name: /stop/i})).toBeHidden({timeout: 30000})`, not fixed `waitForTimeout`.
- **Trace/video**: kept `retain-on-failure` — open with `npx playwright show-report` or `--trace on`.

## CI

`--no-run` variant of `simulate_user_journey.py` runs without LLM. Browser harness is serial (`fullyParallel: false`) because journeys share backend state. To shard, give each worker its own `email = smoke_${workerIndex}@example.com`.

## See also

- `instance/docs/USER_JOURNEY.md` — the contract under test
- `instance/scripts/utils/api_client.py` — same API surface the helpers wrap
- `better-n8n-frontend/tests/e2e/` — existing e2e patterns to follow
