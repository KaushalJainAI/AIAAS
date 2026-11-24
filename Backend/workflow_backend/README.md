# `workflow_backend/`: project settings and shared plumbing

The Django project, not an app. The name is left over from the retired workflow
product. Nothing user-facing lives here, but almost every app imports from it.

## Settings (`settings/`)

| File | Used by |
|---|---|
| `base.py` | Everything shared. **Add new settings here** |
| `local.py` | `manage.py` and local dev: SQLite, no Redis needed |
| `test.py` | Tests: in-memory checkpoints, no outside services |
| `deployment.py` | The production Docker image |

Each entry point names its settings file. There is no top-level `settings.py`.

## Files

| File | What it does |
|---|---|
| `urls.py` | The root URL table: mounts every app under `/api/...` |
| `asgi.py` | The server entry point (HTTP and WebSockets) |
| `wsgi.py`, `celery.py` | Other entry points |
| `background.py` | `spawn()`: **the way to start work that outlives a request.** Do not use bare `asyncio.create_task` for that |
| `httpclient.py` | `shared_client()`: one reused HTTP client. Never wrap it in `async with`, which closes it for everyone |
| `thresholds.py` | Limits and numbers shared across apps (caps, prices, token rates) |
| `observability.py` | Error reporting (Sentry). Off unless `SENTRY_DSN` is set |
| `loopwatch.py` | Measures how often the event loop stalls |
| `testclock.py` | Tests only: freeze the clock and move it (`frozen_clock`, `freeze_for`). See `Backend/docs/TESTING.md` |

## Tests

`workflow_backend/tests/`: `test_background.py`, `test_httpclient.py`,
`test_import_contracts.py` (the layer rules in `Backend/.importlinter`),
`test_release_db.py`, `test_testclock.py` (the clock, JWT expiry, a daily
schedule).
