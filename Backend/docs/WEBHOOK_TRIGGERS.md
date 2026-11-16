# Webhook triggers

An external system can start an agent run with an HTTP POST — no account.
The receiver is `webhook_receive` (`agents/views/triggers.py`), the same
handler that owns the `Trigger` model. Agents use it directly; anything
about "the workflow receiver" is gone.

## How it works

- `Trigger` is a row with `mode='webhook'` and a unique generated 48-hex
  `secret` (`agents/models.py`). An agent may carry several hooks (staging
  and production, or one per calling system); revoking one is deleting a
  row.
- The URL is `/api/orchestrator/hooks/<secret>/`. The secret is the *only*
  credential; a user id never appears in the path. Every refusal — wrong
  secret, disabled trigger, agent not cleared for unattended runs — answers
  an identical 404.
- On success the receiver answers 202 and nothing else. The body is capped
  at 64 KB and appended as *context*, never as the goal. `_note_failure`
  counts refusals and disables the row at five.
- The serializer refuses to save a webhook whose trigger has no goal and
  whose agent's prompt is blank (with a sentence), and the receiver's
  matching branch counts the failure so the row surfaces it.
- `POST /triggers/<id>/rotate/` rotates the secret. A URL that is the only
  credential and can never change would make a leak permanent; rotation
  keeps the row (and its `last_fired_at`, failure count) and changes the
  credential.
- The frontend's *New trigger* asks schedule or webhook first; a webhook
  opens `WebhookEditor`, and the card shows the full URL and a copyable
  `curl` (not *Run now*).

Tests: `agents/tests/test_triggers.py::WebhookTests`.

## Deliberate cuts (not built)

- **`overlap`** — the receiver calls `start_agent_run` directly and never
  consults the policy; offering skip/queue/cancel would be a switch that
  moves nothing.
- **`timezone`, `starts_at`/`ends_at`** — `window_state` is read by the
  sweep, and the sweep is not on the webhook path. A live window for
  webhooks needs a backend change first.
- **Run now** — a test button that bypassed the unauthenticated path would
  prove the button works and nothing else. The editor shows the `curl`
  that exercises the real path.
- **HMAC signature verification** — the right long-term answer for a sender
  that supports it; needs a per-sender shared key, a header name per
  provider, and a replay window. A named decision, not an omission.
