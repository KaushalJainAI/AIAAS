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
