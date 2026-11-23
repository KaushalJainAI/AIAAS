"""The spend ledger entry for one browser call.

Lives here, not in `chat/tools/browser.py`, so the browser preview endpoint
(`browsing/views.py`) can record its spend without importing the tool library.
The provider meters the real cost; we record one estimated browser minute per
call, because an unpriced call must never read as free.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


async def record_browser_minute(user_id, source: str) -> None:
    """One browser minute in the ledger, estimated. Best-effort: a ledger error
    is logged, never raised into the call that already ran."""
    from asgiref.sync import sync_to_async

    from django.contrib.auth import get_user_model

    if not user_id:
        return
    try:
        user = await get_user_model().objects.filter(id=user_id).afirst()
        if user is None:
            return
        from logs.costs import record

        await sync_to_async(record)(
            user=user, kind='browser', amount_inr=2, units=1, unit='minute',
            estimated=True, source=source,
        )
    except Exception:  # noqa: BLE001
        logger.exception('[Browser] Failed to record browser cost')
