# `notifications/`: the bell, reminders and the digest

The user sees this as the bell menu. It carries:

- **Notifications**: rows in the bell menu, pushed live over `ws/hitl/` and, if
  enabled, as browser or phone push.
- **Approval reminders**: a run waiting for an answer is nudged at +0, +1 hour
  and +1 day, then left alone. An opt-in hourly nudge is also available.
- **Daily digest**: one summary a day of what is waiting on you, by email if
  email is on.
- **Scheduled reminders**: reminders a user (or the assistant) sets for a time
  or an interval.

Design: [`docs/NOTIFICATION_SERVICE.md`](../docs/NOTIFICATION_SERVICE.md).

## Data (`models.py`)

| Model | What it is |
|---|---|
| `Notification` | One row in the bell menu |
| `NotificationPreference` | Digest time, hourly nudge, and the digest's day mark |
| `HITLReminderSchedule` | The reminder timetable for one pending approval |
| `ScheduledNotification` | A reminder set for a time or an interval |
| `PushSubscription` | A browser registered for push |
| `DeviceToken` | A phone's Expo push token (the React Native app) |

## Files

| File | What it does |
|---|---|
| `utils.py` | `create_notification`: **the way to create a notification**. Saves it, pushes it live, may email it |
| `push.py` | `send_push`: **the way to reach a person's devices**. Fans out to browsers and phones |
| `webpush.py` | Browser push, which works with the tab closed |
| `expo_push.py` | Phone push through the Expo Push Service |
| `reminders.py` | The approval-reminder engine and the digest |
| `scheduled.py` | User-set reminders. Claims each firing before sending it |
| `signals.py` | Keeps the reminder timetable in step with its approval request |
| `tasks.py` | Celery entry for the sweeps |
| `views.py`, `urls.py`, `serializers.py` | `/api/notifications/`: preferences, reminders, scheduled reminders, and push subscriptions and devices |
| `admin.py`, `apps.py` | Django admin and app config |

## Rules

- Email is off unless `NOTIFICATIONS_EMAIL_ENABLED` is set. The digest is the normal email; `send_email=False` on `create_notification` opts a notification out.
- A scheduled reminder the user asked to be emailed is the one other email.
- Send devices only through `push.send_push`, never a channel directly. `test_expo_push.py::OneDoorTests` checks it.
- The two sweeps run inside the server on the scheduler loop. Each firing is claimed before it is sent, so two sweeps never send one reminder twice.

## Management commands

`send_hitl_reminders` and `send_scheduled_notifications` run the same sweeps by
hand. `generate_vapid_keys` makes the browser push keys.

## Tests

`notifications/tests/`. Start with `test_reminders.py`, `test_scheduled_sweep.py`,
`test_email_policy.py` and `test_expo_push.py`. The others are
`test_agent_notifications.py`, `test_notifications.py`, `test_scheduled_api.py`
and `test_webpush.py`.
