# Backend Integration Tests

Cross-app tests that wire several Django apps together against an in-memory
SQLite DB. They use Django's `TestCase` (so each test runs inside a
transaction that gets rolled back) and the test settings module, which means
**no Redis, no PostgreSQL, no external network**.

## Run

```bash
# Whole integration suite
python manage.py test tests.integration --settings=workflow_backend.settings.test --verbosity=2

# Single module
python manage.py test tests.integration.test_auth_flow --settings=workflow_backend.settings.test
```

Or with pytest:
```bash
pytest tests/integration -v
```

## What's covered

| File | Apps exercised | Adversarial focus |
|------|----------------|-------------------|
| `test_auth_flow.py` | `core`, `dj_rest_auth` | Credential reuse, throttling, token tampering |
| `test_credentials_mcp.py` | `credentials`, `mcp_integration` | Cross-user credential leak, decryption failures, mapping injection |
| `test_adversarial_credentials.py` | `credentials` | Encryption tampering, wrong key, malformed input |

## Conventions

- Every adversarial file has three classes: a Happy, a Sad and an Angry one.
  - **Happy** — the documented golden path works.
  - **Sad** — predictable failures (missing field, wrong type, empty string).
  - **Angry** — hostile input designed to break invariants
    (huge strings, recursion bombs, unicode tricks, IDOR, race conditions).
- No mocking of DB layers — use real models against in-memory SQLite.
- Mock external services (HTTP, MCP subprocess, LLM SDK) only at their boundary.
