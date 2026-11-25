# Frontend Tests

Three test layers, mirroring the backend split:

| Layer | Tool | Where | What it touches |
|-------|------|-------|-----------------|
| Unit | Vitest + RTL | `src/**/__tests__/*.test.ts(x)` | Pure functions, components in isolation (mocked APIs) |
| **Integration** | Vitest + RTL + MSW | `tests/integration/*.test.tsx` | Whole pages with mocked `axios` / `fetch` boundary |
| **E2E** | Playwright | `tests/e2e/*.spec.ts` | Real browser → Vite dev server → live backend |

## One-time install

```bash
cd better-n8n-frontend
npm install
npx playwright install --with-deps chromium
```

## Run

```bash
# Unit (existing tests under src/**/__tests__/)
npm test

# Integration (mocked API boundary, no backend)
npm run test:integration

# E2E (requires backend up on :8000 and Vite on :5173)
# Terminal 1: cd Backend && python manage.py runserver
# Terminal 2: npm run dev
# Terminal 3:
npm run test:e2e
```

## Adversarial mindset (sad/angry tests)

Every test file should pair the happy path with at least one **sad** (predictable
failure: 4xx response, empty list, missing field) and one **angry** (hostile
input: huge payload, malformed JSON, race-condition simulation) case.

See `tests/integration/Connections.test.tsx` and `tests/e2e/auth.spec.ts` for
the canonical pattern.

## E2E: what runs free, what costs money

The Playwright specs in `tests/e2e/` come in two kinds.

**Free (`npm run test:e2e:free`).** No model is called. The specs sign in by
registering throwaway accounts through the API and writing the tokens into the
browser, so they never click through the login form. They check the `/code`
placeholder, the API connector cards (Todoist, Cal.com show "Coming soon" and
cannot be connected), the 24px page gutter on three hub pages, and the balance
line of a fake OpenRouter key (it shows the reason, it does not crash). These
run in every local `npm run test:e2e` too. CI does not run e2e: it has no
backend, so the free specs would fail there for the wrong reason.

**Live (`npm run test:e2e:live`) costs real money.** These specs in
`tests/e2e/live/` send real messages to `anthropic/claude-haiku-5.5` through
OpenRouter and run real agents. Each live test is skipped unless
`E2E_LIVE_MODEL=1` is set, and the whole group stops once the budget is spent.

Environment variables:

| Variable | What it does |
|----------|--------------|
| `E2E_BASE_URL` | The web app to test. Default `http://localhost:5173`. |
| `E2E_API_URL` | The API the specs call directly. Default `http://localhost:8000`. |
| `E2E_NO_SERVER` | Set to `1` so Playwright does not start `npm run dev` itself. |
| `E2E_LIVE_MODEL` | Set to `1` to allow live specs. Anything else skips them. |
| `E2E_OPENROUTER_KEY` | An OpenRouter key the live specs add to each test account. Required with `E2E_LIVE_MODEL=1`. Never printed. |
| `E2E_BUDGET_USD` | Dollars the whole live run may spend. Default `2`. |

The budget is read from OpenRouter's own usage figure, once at the start and
again before each live test. Live specs run one at a time. Every live result is
appended to `test-results/live-results.json` (name, pass or fail, seconds, the
dollars that test spent), and the run prints the total at the end.
`test-results/long-horizon.json` holds the measurements of the long agent run.

Run against local servers:

```bash
npm run test:e2e:free                                  # free, needs Backend on :8000
E2E_LIVE_MODEL=1 E2E_OPENROUTER_KEY=sk-or-... npm run test:e2e:live
```

Run against production (free specs only, unless you mean to spend money):

```bash
E2E_BASE_URL=https://aiaas.kaushaljain.com E2E_API_URL=https://aiaas.kaushaljain.com E2E_NO_SERVER=1 npm run test:e2e:free
```

**Every test creates throwaway users** with the address pattern
`e2e_<timestamp>@example.com`. They are real accounts in the database and are
not deleted afterwards, so do not point these tests at a database whose users
matter.
