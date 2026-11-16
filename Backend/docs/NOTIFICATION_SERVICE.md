# Notification Service & real-time updates

Persistent database notifications plus real-time WebSocket streams. Two
layers: an in-app alert you see later, and a live channel for active
executions and decisions.

Route list: [API.md](API.md) §16.

## Persistent notifications (REST)

`notifications` app. For events the user needs to see even if they were
offline — "workflow failed", "image ready".

`Notification`: `type` (`workflow_failed`, `new_message`, `hitl_request`,
`image_ready`, `system`, …), a `User` FK, a title, a message, a `data`
JSONField (e.g. `execution_id`), and `is_read`.

From any backend code:

```python
from notifications.utils import create_notification

create_notification(
    user=user_instance,
    type='workflow_failed',
    title='Workflow failed',
    message='Workflow "Data Sync" failed at node "PostgreSQL"',
    data={'execution_id': '...'},
)
```

### Email delivery

`NOTIFICATIONS_EMAIL_ENABLED=True` enables SMTP fan-out;
`NOTIFICATIONS_EMAIL_TYPES` optionally limits it to a comma-separated type
list; `NOTIFICATIONS_EMAIL_SUBJECT_PREFIX` prefixes subjects. SMTP itself is
via `EMAIL_*` / `DEFAULT_FROM_EMAIL`. Per call you can force or suppress it:
`send_email=True` or `data={'send_email': False}`.

## HITL reminders

A blocked run waits on a human. The reminder engine
(`notifications/reminders.py`) keeps that wait bounded without turning one
blocked agent into an inbox full of mail. Three independent channels, no
shared transport:

| Channel | When | Transport | Off switch |
|---|---|---|---|
| **Escalation** | +0, +1h, +1d after an unanswered request, then stops | Device push + in-app | `hitl_escalation_enabled` |
| **Hourly** | Once an hour while anything is pending | Device push + in-app | `hourly_reminders_enabled` (off by default) |
| **Daily digest** | The user's chosen local time | **Email** + in-app + device push | `daily_digest_enabled` |

Escalation offsets are measured from the request's `created_at`, so a late
sweep cannot push the ladder forward. Email is the digest's alone —
escalation and hourly pass `send_email=False` explicitly. The digest is
capped at one per calendar day by `NotificationPreference.last_digest_sent_on`
(a date in the user's timezone; read-only over the API, because clearing it
would re-open the cap), and it claims its day even when nothing is pending.

- **`NotificationPreference`** (one per user, created on first access) — the
  toggles, `daily_digest_time`, `timezone` (blank falls back to
  `UserProfile.timezone`, then UTC), quiet hours, and the two bookkeeping
  fields enforcing the caps.
- **`HITLReminderSchedule`** (one per `HITLRequest`) — `stage`, `next_due_at`,
  `reminders_sent`. `next_due_at` is the only field the sweep queries; set to
  NULL when the ladder is exhausted or the request stops being pending.

`notifications/signals.py` hooks `post_save` on `HITLRequest` rather than the
call sites, so a new request-creation site cannot silently opt out. The
stage-0 nudge fires from `transaction.on_commit`.

Running the sweep (idempotent — each channel records what it sent):

```bash
python manage.py send_hitl_reminders            # no broker required
python manage.py send_hitl_reminders --dry-run
celery -A workflow_backend beat -l info          # production; beat is a singleton
```

`HITL_REMINDER_SWEEP_SECONDS` (default 300) sets the beat interval. Local
dev runs without Redis — which is why the management command exists.

## Device notifications

Every notification that reaches a device goes through one function,
`notifications/push.py::send_push`, which fans out to web push and Expo
push, so a caller gets both channels and cannot forget one.

**Browser (closed tabs).** The browser subscribes with the server's VAPID
key (Settings → Background notifications, `hooks/useWebPush.ts`); the
subscription is stored in `notifications.PushSubscription`. Setup:
`python manage.py generate_vapid_keys` → `VAPID_PUBLIC_KEY` /
`VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` in `.env`. Blank keys = push silently
off; sockets, toasts and the digest email keep working. Expired endpoints
(push service 404/410) are pruned on send. Quiet hours and the device toggle
gate both transports — the in-app row is still written either way.

**Native phones.** The mobile app (`mobile-native/`, Expo) registers an
`ExponentPushToken[...]` with `POST /api/notifications/push/devices/`; rows
live in `notifications.DeviceToken`. The backend sends through the **Expo
Push Service** (`notifications/expo_push.py`), holding no Google or Apple
credentials. Messages carry `sound: 'default'`, `priority: 'high'`,
`channelId: 'default'`; `data` holds `kind` and an in-app `action_url`
(never an external or protocol-relative URL). Up to 100 messages per
request; a failed chunk does not stop the rest; a `DeviceNotRegistered`
ticket deletes that token. Settings: `EXPO_PUSH_ENABLED` (default on; off in
`settings/test.py`) and optional `EXPO_ACCESS_TOKEN`.

The sender is synchronous on purpose: its callers (sweeps, worker threads,
the signature callback) have no running event loop.

Settings UI: `NotificationsTab` → `ReminderPreferences`
(`components/settings/`). The permission prompt fires from the toggle's
click handler — browsers ignore or reject an ungated `requestPermission()`.

## Real-time WebSocket streams (Django Channels, `streaming/routing.py`)

- **`ws/execution/{execution_id}/`** — per-run updates (`execution.event`
  for node start/finish/fail; `execution.state_sync` on connect).
- **`ws/hitl/`** — user-wide HITL stream. `new_request` when an agent needs
  approval or input from *any* active execution; `response_ack` when your
  decision is processed.
- **`ws/imagine-agent/`** — the imagine agent.

## HITL flow

1. An agent run that needs approval or input creates a `HITLRequest` (`agents/agent/hitl.py::open_request`, called from
   `stream._approval_requested`).
2. A `Notification` row is created and a WebSocket message pushed to the
   `hitl_{user_id}` group.
3. You respond via WebSocket (`type: 'hitl_response'`) or REST.
4. `resolve_request` closes the row; the run resumes.

On the frontend, `hooks/useHITLReminders.ts` maintains the user-wide
connection, built on `useSocket` (`src/lib/websocket.ts`, which owns URL
resolution, reconnect backoff and the remount race guard).
