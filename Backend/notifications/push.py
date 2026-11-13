"""
The one door for every notification that reaches a person's device.

Callers (reminders, scheduled reminders, agent notify, signature callbacks)
call `send_push`, not the channels. It fans out to the browser (`webpush.py`,
closed-tab OS notifications) and to native phones (`expo_push.py`, the React
Native app). A new channel is added here and every caller gets it. Two
callers that reach a channel directly would be two places to forget a gate,
and `notifications/tests/test_expo_push.py` fails if one appears.

The caller has already applied the device gates (device toggle, quiet hours);
this function does not re-check them.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def _internal_path(value) -> bool:
    """An in-app path only: a value that becomes a link must never be an open redirect."""
    return (
        isinstance(value, str)
        and value.startswith('/')
        and not value.startswith('//')
        and '\\' not in value
    )


def send_push(user, *, title: str, body: str, action_url: str = '/inbox',
              kind: str = 'notification') -> int:
    """
    Push to every browser and phone of `user`. Returns total deliveries accepted.

    Never raises. A failure on one channel is logged and the other still runs.
    """
    from .expo_push import send_expo_push
    from .webpush import send_web_push

    target = action_url or '/inbox'
    reached = 0

    try:
        reached += send_web_push(user, title=title, body=body, action_url=target, kind=kind)
    except Exception:  # noqa: BLE001
        logger.exception("Web Push fan-out failed")

    data = {'kind': kind}
    if _internal_path(target):
        data['action_url'] = target
    try:
        reached += send_expo_push(user, title=title, body=body, data=data)
    except Exception:  # noqa: BLE001
        logger.exception("Expo push fan-out failed")

    return reached
