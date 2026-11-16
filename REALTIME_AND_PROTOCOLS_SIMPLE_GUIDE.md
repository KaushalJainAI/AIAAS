# Live Connections and Protocols: Simple Guide

> How the parts of AIAAS talk to each other while work is still running. For where the servers live, read [INFRASTRUCTURE_SIMPLE_GUIDE.md](./INFRASTRUCTURE_SIMPLE_GUIDE.md).

---

## 1. HTTP: One Question, One Answer

The browser asks, the server answers, and the connection closes. Most of the API works this way.

```
POST /api/chat/sessions/123/message/   { "message": "hi" }   ->  200 OK + JSON
```

- `GET` reads, `POST` does or sends, `PATCH` edits, `DELETE` removes.
- Status codes: `200` done, `202` accepted (the run started, the result comes later), `400` bad input, `401`/`403` not signed in or not allowed, `404` not found, `413` too large, `429` slow down, `500` our fault.
- HTTP cannot keep telling the browser things while an agent thinks for ten minutes. Two tools fill that gap.

---

## 2. Which Tool, Where

| Tool | Direction | Used for |
|---|---|---|
| **SSE** (server-sent events) over a `POST` | Server to browser | Chat turns: the answer streams in as it is written |
| **WebSocket** | Both ways | Live run view, approval and reminder pings |
| **Polling** | Browser asks again and again | Status checks, such as the scheduler banner |
| **Plain HTTP POST** | Browser to server | Every control action: steer, stop, approve, answer |

Stop and steer are **not** WebSocket messages. They are `POST`s. (The socket can also answer an approval, see §4.)

- `POST /api/chat/sessions/<id>/message/stop/` stops the turn.
- `POST /api/chat/sessions/<id>/message/steer/` queues an instruction for a running turn. The same call changes the autonomy mode, for example `{"autonomy": "auto"}`.

Plan updates from a coding lead (`task_update`, `lease_update`, `code_change`) travel as SSE frames on the chat stream, not over the WebSocket.

---

## 3. SSE: How Chat Streams

**Files:** backend `chat/transport/sse.py` and `chat/transport/streaming_http.py`. Frontend `better-n8n-frontend/src/api/sse.ts` (`streamSse`) and `src/lib/followTurn.ts`.

The server sends lines like this:

```
data: {"type": "token", "content": "hello"}

data: {"type": "done"}

```

Why `POST` and not the browser's `EventSource`? `EventSource` can only send a `GET` with no headers. A chat turn needs a request body and a `Bearer` token. So the frontend reads the body with `fetch()`. Django authenticates the stream by hand, because DRF decorators cannot wrap a streaming response.

**Three layers must not buffer**, or the stream freezes until it ends:

1. **Django** sends `Cache-Control: no-cache` and `X-Accel-Buffering: no`.
2. **nginx** (`/api/`): `proxy_buffering off`, `proxy_read_timeout 300s`.
3. **Caddy**: `flush_interval -1`.

**Keep-alive.** A turn can be silent while a tool waits, for example on a delegated agent. Every 20 seconds of silence the server writes `: keep-alive`. It is an SSE comment, so the browser ignores it and it does not count as a frame.

**Re-attach, don't resend.** A closed stream does not mean the turn ended. The client treats only a `done` or `error` frame as the end. Otherwise it asks for active runs and re-attaches from the last frame it saw. It never sends the message again. The run keeps going on the server (`chat/turn/runs.py`), so a refresh replays and does not restart the work.

---

## 4. WebSocket: Live View and Pings

**Files:** backend `streaming/routing.py` (routes) and `streaming/consumers.py`, plus `core/realtime/` (auth). Frontend `src/lib/websocket.ts` (`useSocket`).

| Route | What it carries |
|---|---|
| `ws/execution/<execution_id>/` | Run progress, state sync on connect, approval requests |
| `ws/hitl/` | Pending approvals and reminders for the signed-in user |
| `ws/imagine-agent/` | Imagine's agent (media generation) |

**Auth.** A browser cannot set headers on a WebSocket, so the access token travels in the query string (`?token=`). `JWTAuthMiddleware` checks it. A user who is not signed in is closed with code `4001`. A user who may not see that execution is closed with `4003`.

**Client messages.** Execution socket: `hitl_response`, `subscribe`, `unsubscribe`, `ping`. HITL socket: `respond`, `refresh`. Anything else gets an `error` frame.

**Nginx** sends `/ws/` with the `Upgrade` header and a 24-hour read timeout.

**Scale rule.** A socket lives in one process. Messages reach it through the Redis channel layer, so any process can publish. Two backends still need sticky sessions at the balancer (see INFRASTRUCTURE §9).

---

## 5. Webhooks: Doorbells from Outside

A webhook is a call from another system into ours. Nobody logs in. The secret in the URL is the only key.

**Agent triggers.** `POST /api/orchestrator/hooks/<secret>/` is handled by `webhook_receive` in `agents/views/triggers.py`.

- Success returns a bare `202`, with no agent name and no run id.
- Every refusal (wrong secret, disabled trigger, agent not allowed to run unattended) returns `404`. Otherwise an attacker could tell which secrets are live.
- A body over 64 KB gets `413` before the secret is checked.
- The body is **context, never the goal.** The goal comes from the trigger and its agent. The payload is appended as `Inbound webhook payload:`. Anyone holding the URL must not be able to direct the agent.
- Rotate a secret without deleting the trigger.

**Messaging channels.** `POST /api/messaging/hooks/<channel>/<secret>/` (in `messaging/views.py`) verifies the provider's signature and fails closed: Slack signing secret, Telegram secret token, WhatsApp `X-Hub-Signature-256`, Twilio `X-Twilio-Signature`. Teams is refused until Bot Framework token validation exists. A refusal is the same `404`. An accepted message is stored as data for its owner. It never becomes the goal.

**Outbound.** The code has no sender that posts webhooks to other systems. If one is added, it needs an HMAC signature, retries with backoff, and an idempotency key.

**Local testing.** A tunnel such as `cloudflared tunnel --url http://localhost:8000` gives a public URL to a laptop. Use a throwaway secret and never point a tunnel at the production database. Production has a public address and needs no tunnel.

---

## 6. Browser Security That Bites

- **CORS** is an allow-list of the one production origin. Allowing every origin while credentials are on lets any site read signed-in responses.
- **CSRF**: the API takes a `Bearer` token in a header, which a foreign site cannot set.
- **Revocation**: a password or email change revokes every token issued before it (`tokens_valid_after`). REST calls, token refresh and WebSockets check it.
- **Rate limits** (DRF throttles) return `429`. Retry later, not at once.

---

## 7. How Schedules Fire: the Scheduler Loop

Production has no cron and no Celery. The backend runs the scheduler itself. **Files:** `agents/scheduler.py`.

1. **Lease.** One process at a time holds a row in `SchedulerLease`. The loop ticks every 30 seconds. A lease lasts 90 seconds. A dead holder loses it after that, and another process takes over.
2. **Slot claim.** A schedule slot is claimed once. A second firing (a loop, a beat and a button press at the same moment) reports `busy`. "Run once now" is safe to double-click for the same reason.
3. **Detached jobs.** Each periodic job runs in its own task. A slow job never delays schedules or loses the lease. If a job is still running when its next run is due, that run is skipped.

The jobs in `PERIODIC_JOBS`, with the setting that sets each interval in `workflow_backend/settings/base.py`:

| Job | Interval setting |
|---|---|
| `orchestrator.sweep_triggers` (the loop itself) | 30 s tick |
| `notifications.sweep_scheduled` | `SCHEDULED_SWEEP_SECONDS` |
| `notifications.sweep_hitl_reminders` | `HITL_REMINDER_SWEEP_SECONDS` |
| `inference.sweep_recycle_bin` | `RECYCLE_SWEEP_SECONDS` |
| `orchestrator.recover_runs` | `RUN_RECOVERY_SWEEP_SECONDS` |
| `orchestrator.prune_chat_checkpoints` | `RUN_RECOVERY_SWEEP_SECONDS` |
| `missions.sweep_missions` | `MISSION_SWEEP_SECONDS` |
| `logs.redact_old_run_detail` | `RUN_DETAIL_RETENTION_SWEEP_SECONDS` |
| `solutions.sweep_stale` | `SOLUTION_STALE_SWEEP_SECONDS` |

Production uses neither host cron nor Celery beat (beat runs locally only). Do not add host cron lines for these jobs: each one starts a whole Django process inside the backend's memory limit.

---

## 8. Rules That Bite

1. **Turn buffering off at every hop** for any stream. A buffered stream looks broken.
2. **Keep silent streams alive.** A 20-second keep-alive comment on SSE. Proxy timeouts of 300 s (API) and 24 h (WebSocket).
3. **A closed stream is not a finished turn.** Re-attach from the last frame. Never resend the message.
4. **Never retry `401`, `402` or `429` blindly.** They are not transient. Retry only connection failures and timeouts, and only before any output has been sent.
5. **Time out the code, not just the wait.** A sandbox timeout kills the process group.
6. **Queues are bounded.** A steer queue drops the oldest message and counts the loss. Large tool output is saved and previewed, with a `read_tool_output` id.
7. **A restart drops streams.** Clients reconnect and re-attach. The recovery sweep resumes or closes runs whose process died.
8. **Inbound refusals are silent.** Every refusal of a webhook is a `404` (or `413` for an oversized body). Do not add detail to the refusal.
9. **Scale up first.** More than one backend needs sticky sessions, Redis pub/sub for chat-run subscriptions, one scheduler lease holder (already true), and a bigger Postgres connection budget.

Open items for live connections are listed in [Backend/docs/OPEN_WORK.md](./Backend/docs/OPEN_WORK.md).
