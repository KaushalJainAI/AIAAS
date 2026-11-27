# `streaming/`: live updates over WebSockets

Plumbing that pushes live events to the browser. The Activity page uses it to
follow a running agent, and the notification bell uses it to hear about new
approval requests.

Chat does **not** use this app. Chat streams over the HTTP response itself
(`chat/transport/`).

## WebSockets (`routing.py`)

| Path | Consumer | Used for |
|---|---|---|
| `ws/execution/<id>/` | `ExecutionConsumer` | Live steps of one agent run (`useLiveRun.ts`) |
| `ws/hitl/` | `HITLNotificationConsumer` | Per-user approval reminders and new notifications (`useHITLReminders.ts`) |
| `ws/imagine-agent/` | `imagine.consumers.ImagineAgentConsumer` | The Studio's conversational agent (lives in `imagine/`) |

## Files

| File | What it does |
|---|---|
| `routing.py` | The WebSocket URL table, loaded by `workflow_backend/asgi.py` |
| `consumers.py` | The two consumers above |
| `broadcaster.py` | Sends run events to the right channel group. `agents/agent/stream.py` calls it |
| `views.py`, `urls.py` | Server-sent-event endpoints under `/api/streaming/` (`executions/<id>/stream/`, `executions/<id>/events/`, `status/`, and a `test/` route for trying events out). The web app does not call them; it uses the WebSocket |
| `models.py` | `StreamEvent` |

## Rules

- Production needs Redis (`REDIS_URL`) so events reach every server process. Locally an in-memory layer is used (`CHANNEL_LAYERS` in `workflow_backend/settings/base.py`).

## Tests

`streaming/tests/test_streaming.py`, `streaming/tests/test_units.py`.
