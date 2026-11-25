"""
The send window: a message sent while a person is watching waits a few
seconds so they can cancel it (docs/UNDO_PLAN.md §5, decisions D12-D14).

Every change of state goes through one conditional UPDATE in this module, so
the timer, Cancel, Send now and the periodic sweep cannot send the same message
twice. A row in `sending` is never sent again: if the process died mid-send, the
sweep says so to the user instead of retrying.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

from asgiref.sync import sync_to_async
from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)

#: A send stuck in `sending` this long is treated as interrupted (D14).
STUCK_AFTER = timedelta(minutes=5)
#: The sweep leaves a held row alone until it is this far past its send time,
#: so it does not race the timer that is about to fire.
SWEEP_GRACE = timedelta(seconds=5)
#: Rows one sweep pass handles at most.
SWEEP_CAP = 100


class DeliveryError(Exception):
    """A send that did not go out, with plain words for the user.

    `code` is set only where a caller needs the provider's own code back
    (Gmail). `sent_unrecorded` means the provider accepted the message and only
    our outbox write failed, so the message did go out.
    """

    def __init__(self, message: str, code: str = ''):
        super().__init__(message)
        self.code = code


def hold_seconds() -> int:
    """`OUTBOUND_HOLD_SECONDS`, never negative. A bad value means no hold."""
    try:
        return max(0, int(settings.OUTBOUND_HOLD_SECONDS))
    except (TypeError, ValueError):
        return 0


def should_hold(context: dict) -> bool:
    """True when a person is watching this send, so it waits for them to cancel."""
    from agents.grants import UNATTENDED_CALLERS

    # Nobody watches an eval, and a held send would land after the run that
    # asked for it had ended. Evals keep the immediate send they always had.
    caller = context.get('caller')
    if caller in UNATTENDED_CALLERS or caller == 'eval':
        return False
    return hold_seconds() > 0 and bool(context.get('user_id'))


def create(user_id, tool: str, payload: dict, label: str, context: dict):
    """Queue a send for `hold_seconds()` from now. Does not send it."""
    from messaging.models import PendingSend

    return PendingSend.objects.create(
        user_id=user_id,
        tool=tool,
        payload=payload,
        label=label[:200],
        send_at=timezone.now() + timedelta(seconds=hold_seconds()),
        chat_session_id=str(context.get('session_id') or '')[:100],
        execution_id=str(context.get('execution_id') or '')[:64],
    )


async def deliver(hold_id: int) -> str:
    """Send one held message if nobody has claimed it yet.

    Returns the row's new status, or 'skipped' when it was already claimed,
    cancelled or sent.
    """
    from messaging.models import PendingSend

    now = timezone.now()
    # The claim. Exactly one caller can move a row out of `held`; any other
    # caller matches no row. `updated_at` is set by hand because a queryset
    # update does not bump `auto_now`, and the sweep reads it.
    claimed = await PendingSend.objects.filter(
        pk=hold_id, status='held', send_at__lte=now,
    ).aupdate(status='sending', updated_at=now)
    if not claimed:
        return 'skipped'

    row = await PendingSend.objects.aget(pk=hold_id)
    try:
        result = await _send(row)
    except DeliveryError as exc:
        if exc.code == 'sent_unrecorded':
            # It went out; only our record of it failed. Say "sent", never
            # "not sent", or the user may send it a second time.
            await PendingSend.objects.filter(pk=hold_id).aupdate(
                status='sent', error=str(exc), updated_at=timezone.now())
            return 'sent'
        return await _failed(row, str(exc))
    except Exception:  # noqa: BLE001 - the send is over either way; never retry
        logger.exception('[Holds] Held send %s could not be sent', hold_id)
        return await _failed(row, 'The message could not be sent.')

    await PendingSend.objects.filter(pk=hold_id).aupdate(
        status='sent', result=result, error='', updated_at=timezone.now())
    return 'sent'


async def _send(row) -> dict:
    if row.tool == 'message_send':
        from chat.tools.talk import deliver_message, record_held_cost

        result = await deliver_message(row.user_id, row.payload)
        # Charged on delivery, not on queueing: a cancelled hold costs nothing.
        await record_held_cost(row.user_id, row.payload)
        return result
    if row.tool == 'gmail_send_message':
        from chat.tools.google.gmail import deliver_gmail

        return await deliver_gmail(row.user_id, row.payload)
    raise DeliveryError('This kind of message can no longer be sent.')


async def _failed(row, error: str) -> str:
    from messaging.models import PendingSend

    await PendingSend.objects.filter(pk=row.pk).aupdate(
        status='failed', error=error, updated_at=timezone.now())
    await sync_to_async(_notify)(
        row, 'A message was not sent', f'{row.label}: {error}')
    return 'failed'


def _notify(row, title: str, message: str) -> None:
    from notifications.utils import create_notification

    # Device-only: email is for the daily digest alone (notifications/utils.py).
    create_notification(row.user, 'outbound_failed', title, message,
                        data={'hold_id': row.id}, send_email=False)


async def deliver_after(hold_id: int, delay: float) -> None:
    """The timer for one hold. Started with `spawn()`; it never raises."""
    try:
        await asyncio.sleep(delay)
        await deliver(hold_id)
    except Exception:  # noqa: BLE001 - a lost timer is the sweep's job
        logger.exception('[Holds] Timer for held send %s failed', hold_id)


def status_of(user, hold_id: int) -> str | None:
    """The status of this user's hold, or None for unknown and foreign ids alike."""
    from messaging.models import PendingSend

    return (PendingSend.objects.filter(pk=hold_id, user=user)
            .values_list('status', flat=True).first())


def cancel(user, hold_id: int) -> str:
    """'cancelled', 'too_late' (already claimed or finished) or 'not_found'."""
    from messaging.models import PendingSend

    changed = PendingSend.objects.filter(
        pk=hold_id, user=user, status='held',
    ).update(status='cancelled', updated_at=timezone.now())
    if changed:
        return 'cancelled'
    return 'too_late' if status_of(user, hold_id) else 'not_found'


def send_now(user, hold_id: int) -> bool:
    """Make a held send due at once. The caller then starts `deliver`."""
    from messaging.models import PendingSend

    now = timezone.now()
    return bool(PendingSend.objects.filter(
        pk=hold_id, user=user, status='held',
    ).update(send_at=now, updated_at=now))


async def sweep() -> dict:
    """The periodic job. Delivers held sends whose timer was lost, and marks
    sends stuck in `sending` as unknown. Each pass handles at most SWEEP_CAP rows.
    """
    from messaging.models import PendingSend

    now = timezone.now()
    due_ids = [pk async for pk in PendingSend.objects.filter(
        status='held', send_at__lte=now - SWEEP_GRACE,
    ).order_by('send_at').values_list('pk', flat=True)[:SWEEP_CAP]]
    delivered = 0
    for pk in due_ids:
        if await deliver(pk) == 'sent':
            delivered += 1

    stuck_before = now - STUCK_AFTER
    stuck = [row async for row in PendingSend.objects.filter(
        status='sending', updated_at__lte=stuck_before,
    ).order_by('updated_at')[:SWEEP_CAP]]
    unknown = 0
    for row in stuck:
        # Conditional, so a row that finished between the two queries is left alone.
        changed = await PendingSend.objects.filter(
            pk=row.pk, status='sending', updated_at__lte=stuck_before,
        ).aupdate(status='unknown', updated_at=now,
                  error='The server stopped while this was being sent. It may or '
                        'may not have gone out. It was not sent again.')
        if changed:
            unknown += 1
            await sync_to_async(_notify)(
                row, 'A message may not have been sent',
                f'{row.label}: it may or may not have gone out. It was not sent again.')
    return {'delivered': delivered, 'unknown': unknown}
