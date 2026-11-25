# Frontend Tests

Three layers:

| Layer | Tool | Where | What it touches |
|-------|------|-------|-----------------|
| Unit | Vitest + RTL | `src/**/__tests__/*.test.ts(x)` | Pure functions, components with mocked APIs |
| Integration | Vitest + RTL + MSW | `tests/integration/*.test.tsx` | Whole pages, with the network mocked |
| E2E | Playwright | `tests/e2e/**/*.spec.ts` | A real browser, the web app and the backend |

Adversarial rule: every test file pairs the happy path with at least one **sad**
case (a 4xx, an empty list, a missing field) and one **angry** case (a huge or
malformed input, a race). See `tests/integration/Connections.test.tsx` and
`tests/e2e/auth.spec.ts`.

## One-time install

```bash
cd better-n8n-frontend
npm install
npx playwright install --with-deps chromium
```

## Run

```bash
npm test                  # unit (vitest, through scripts/vitest.mjs)
npm run test:integration  # integration, mocked network, no backend
npm run lint              # eslint: should report 0 problems
npx tsc -b --force        # type check. Plain `tsc --noEmit` checks nothing here
```

CI (`.github/workflows/frontend.yml`) runs type check, lint, unit, integration
and a build. It does not run E2E: it has no backend.

## E2E: free and live specs

**Free (`npm run test:e2e:free`).** No model is called. The specs register
throwaway accounts through the API and put the tokens into the browser, so they
do not click through the login form. They cover `auth`, `code-page` (the `/code`
placeholder), `connections` and `connector-cards` ("Coming soon" cards cannot be
connected), `key-balance` (a fake OpenRouter key shows the reason, not a broken
row), `page-gutter` (the 24px gutter on the hub pages) and `mobile-layout` (phone
size, controls at least 44px).

**Live (`npm run test:e2e:live`) costs real money.** The specs in `tests/e2e/live/`
(`chat-basic`, `chat-tool`, `image-injection`, `undo-run`, `long-horizon`) send
real messages to `anthropic/claude-haiku-5.5` through OpenRouter and run real
agents. Each one is tagged `@live` and is skipped unless `E2E_LIVE_MODEL=1`. The
group stops once `E2E_BUDGET_USD` is spent.

`tests/demo/` holds the walkthrough recorded for the demo video
(`playwright.demo.config.ts`). It is not part of either run.

### Environment variables

| Variable | What it does |
|----------|--------------|
| `E2E_BASE_URL` | The web app to test. Default `http://localhost:5173`. |
| `E2E_API_URL` | The API the specs call directly. Default `http://localhost:8000`. |
| `E2E_NO_SERVER` | Set to `1` so Playwright does not start `npm run dev`. |
| `E2E_THROTTLE_BYPASS_TOKEN` | Sent as `X-E2E-Bypass-Token` on every request, so the test client skips the API rate limits (registration allows 3 a minute). Set the same value on the backend, and leave both unset in production. |
| `E2E_LIVE_MODEL` | Set to `1` to allow the live specs. Anything else skips them. |
| `E2E_OPENROUTER_KEY` | An OpenRouter key the live specs add to each test account. Required with `E2E_LIVE_MODEL=1`. Never printed. |
| `E2E_BUDGET_USD` | Dollars the whole live run may spend. Default `2`. |

The budget comes from OpenRouter's own usage figure: read once at the start, and
again before each live test. Live specs run one at a time. Results go to
`test-results/live-results.json` (name, pass or fail, seconds, dollars spent),
and the run prints the total. `test-results/long-horizon.json` holds the
measurements of the long agent run.

### Running the free specs

The dev server compiles each lazy page on first visit, which is too slow for the
specs. Run them against a production build instead. `vite preview` has no `/api`
proxy, so build with the API address:

```bash
# Terminal 1: the backend
cd Backend && python manage.py runserver 0.0.0.0:8000

# Terminal 2: the built app on :5173
cd better-n8n-frontend
VITE_API_ORIGIN=http://localhost:8000 npm run build
npx vite preview --port 5173

# Terminal 3: the free specs, against the servers already running
E2E_NO_SERVER=1 npm run test:e2e:free
```

In PowerShell, set the variable first: `$env:VITE_API_ORIGIN="http://localhost:8000"`.

### Running the live specs

```bash
E2E_LIVE_MODEL=1 E2E_OPENROUTER_KEY=sk-or-... E2E_BUDGET_USD=2 npm run test:e2e:live
```

### Against production (free specs only)

```bash
E2E_BASE_URL=https://aiaas.kaushaljain.com E2E_API_URL=https://aiaas.kaushaljain.com E2E_NO_SERVER=1 npm run test:e2e:free
```

**Every test creates throwaway users** with the address `e2e_<id>@example.com`.
They are real accounts in the database and are not deleted afterwards, so do not
point these tests at a database whose users matter.
