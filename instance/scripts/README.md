# instance/scripts — Simulation Scripts

Three harnesses, same codebase (`instance/docs/USER_JOURNEY.md` + `instance/docs/SUSPICIOUS_USER.md`):

| Harness | Entry point | Fidelity | Needs | Speed |
|---------|-------------|----------|-------|-------|
| **ORM seed** | `seed_instance.py` | Direct Django ORM — wipes ONLY instance personas | `Backend/.env` + migrated DB | ~2s |
| **API happy** | `simulate_user_journey.py` | HTTP like a browser — 7 stages (auth→observe) | Backend `:8000` | ~10–40s |
| **API adversarial** | `simulate_suspicious_user.py` | 40+ probes, 2 users (A/B) — XSS/IDOR/permissions/caps/SSRF | Backend `:8000` | ~15–30s |
| **Browser happy** | `../interactive-tests/scenarios/001-003` | Playwright — real clicks, happy paths | Backend + Frontend `:5173` | ~60s |
| **Browser adversarial** | `../interactive-tests/scenarios/004-006` | Playwright — XSS/IDOR/permission abuse in real UI | Backend + Frontend `:5173` | ~60s |
| **Subagents** | `simulate_subagents.py` | Delegation: workers spawned, linked, bounded | Backend `:8000` | ~30s |
| **Evaluation** | `simulate_eval.py` | Graded suite — did the agent answer *correctly*? | Backend `:8000` | ~2-5min |

### Subagents and evaluation — the two questions the others cannot answer

The four harnesses above prove the **plumbing**: a run starts, a model is
called, an answer comes back, a cost is recorded. Two things they cannot tell
you, each with its own harness:

**Did it delegate?** (`simulate_subagents.py`) A parent that quietly did the
work itself returns exactly the same shape as one that delegated — same status,
same answer, same tokens. The only proof is the record: child `ExecutionLog`
rows pointing at the tool call that asked for them (`parent_step`), one level
deeper (`depth=1`). So the harness asserts the delegation *tree*, not the reply,
and separately checks that no worker inherited `subAgents` — the bound that
stops one delegating agent becoming an unbounded one.

> **The trap it documents:** delegation runs a worker with `caller='orchestrator'`,
> which is in `UNATTENDED_CALLERS`, so the *worker* must have `allowUnattended`
> on. It is off on every agent by default and no migration sets it. A first
> orchestrator therefore fails with *"<worker> is not enabled for unattended
> runs"* — and the flag is on the worker, not on the agent being edited.

**Did it get it right?** (`simulate_eval.py`) Drives the `eval/` app: a suite of
cases, each with small graders (`contains`, `tool_used`, `regex`, `no_error`,
`max_length`). Pairing a correctness grader with a behavioural one is the point
— `contains` alone passes an agent that guessed, `tool_used` alone passes one
that ran the tool and reported nonsense. `tool_used` is the only way to assert
*how* an answer was reached.

```bash
python instance/scripts/simulate_subagents.py
python instance/scripts/simulate_eval.py

# both run against production with a pasted token, never a password
python instance/scripts/simulate_subagents.py --base https://aiaas.kaushaljain.com --token "$PROD_JWT"
```

Both create only `e2e-`prefixed rows and delete them on the way out (cleanup
runs even when an assertion fails), which is what makes them safe to point at a
real deployment.

## Quick start

```bash
# 1. One-time: migrate + populate credential types / models
cd Backend
python manage.py migrate
python manage.py shell < populate_credentials.py
python manage.py shell < populate_models.py

# 2. Seed dummy world (idempotent)
python instance/scripts/seed_instance.py
# re-run anytime; --fresh to wipe instance users first
python instance/scripts/seed_instance.py --fresh

# 3a. Simulate a regular user via API (fast, happy path)
python instance/scripts/simulate_user_journey.py
python instance/scripts/simulate_user_journey.py --goal "Summarize the ACME invoice" --verbose
python instance/scripts/simulate_user_journey.py --no-run   # no LLM needed

# 3b. Simulate a suspicious/bad user (finds issues while still being functional)
python instance/scripts/simulate_suspicious_user.py --verbose
python instance/scripts/simulate_suspicious_user.py --json-out instance/report-adversarial.json
# PASS = guard works, WARN = known gap, FAIL = 500/leak/silent success → open issue

# 4. Simulate via browser (visual) — happy + adversarial
cd instance/interactive-tests
npm install
npx playwright install --with-deps
npx playwright test                    # all 6 scenarios, serial
npx playwright test scenarios/001-regular-user-smoke.spec.ts --headed
npx playwright test scenarios/004-suspicious-inputs.spec.ts --headed
npx playwright test --trace on
```

## What a good run looks like

### Happy harness

```
========================================================================
  Stage 0 — Auth (register_or_login)
========================================================================
[OK] POST /api/auth/register/ → 201 (42ms)
  ✓ authenticated as regular_user@example.com tier=pro
  ✓ session abc123 created
  ✓ chat stream completed
  ✓ created agent 'Smoke 48211' id=7
  ✓ trigger preview: valid=True desc=At 09:00 on Monday
========================================================================
  Summary
========================================================================
  ✓ auth  ✓ chat  ✓ documents  ✓ build  ✓ connect  ✓ run  ✓ observe
Journey complete
```

### Adversarial harness

```
========================================================================
  Suspicious user simulation — adversarial harness
========================================================================
  ✓ [PASS] XSS in login email — sanitized (no alert)
  ✓ [PASS] IDOR GET agent 99 — 404 oracle-safe
  ! [WARN] prompt injection via webhook goal — 202 accepted (gap: goal not sanitized)
  ✗ [FAIL] disabled web_search bypass — 200 (should be 400)
  ...
========================================================================
  Summary
========================================================================
  PASS: 34  WARN: 5  FAIL: 1
  FAILs are unexpected 500 / leak / silent success — open an issue.
```

- Happy `403/402` with named `error` = good UX (refusal surfaced).
- Adversarial `FAIL` = `500` / leak / silent success — **this is what finds issues while keeping the good path functional.**
- `WARN` = known gap from `CLAUDE.md` (spend cap race, `goal` not sanitized) — tracked.

## Utils

- `utils/api_client.py` — `InstanceClient` (auto-refresh, retry, SSE, `wait_for_execution`)
- `utils/fixtures.py` — `PERSONAS`, `FINANCE_AGENT`, `KB_DEFS` … (single source of truth)
- `utils/payloads.py` + `dummy-data/suspicious-payloads.json` — XSS / injection / traversal / prompt lists

## Adding a new scenario

1. **Happy** — add persona/agent shape to `utils/fixtures.py` → `seed_instance.py` upserts → copy `001-*.spec.ts` for browser, add API check in `simulate_user_journey.py`.
2. **Adversarial** — add payload to `dummy-data/suspicious-payloads.json` + `utils/payloads.py` → add probe in `simulate_suspicious_user.py:PROBES` (`method, path, body, expect 400/404/429`) → add browser step in `004/005/006` (type payload, assert error banner + no `dialog`).

   If the probe finds a `FAIL` that is by design (e.g. shared docs readable), move it to `WARN` with a comment pointing to `docs/SUSPICIOUS_USER.md:2.x`.

## Safety

- Only instance emails (`*@example.com` personas + `smoke-*` folders) are ever deleted — never `User.objects.all().delete()`.
- No real secrets: all fixtures use `dummy-*` and `CREDENTIAL_ENCRYPTION_KEY=test` is fine locally.
- `instance/.gitignore` keeps `generated/`, `trace/`, `test-results/`, `*.key` out of git.

## See also

- `../docs/USER_JOURNEY.md` — happy-path contract
- `../docs/SUSPICIOUS_USER.md` — threat model + PASS/WARN/FAIL triage
- `../dummy-data/` + `../dummy-permissions/` — declarative fixtures
- `../../Backend/docs/API.md` — full route map
- `../../CLAUDE.md` — per-pattern design notes
