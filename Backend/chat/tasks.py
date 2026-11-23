"""Celery tasks for the chat app. The in-process scheduler runs the same jobs
in production (`agents/scheduler.py::PERIODIC_JOBS`); these are the beat path."""
from __future__ import annotations

import logging

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(name='chat.purge_tool_outputs', ignore_result=True)
def purge_tool_outputs():
    """Delete stored tool output past its expiry (`tool_output.purge_expired`)."""
    from chat.tools.tool_output import purge_expired

    removed = purge_expired()
    if removed:
        logger.info('[ToolOutput] Purged %d expired row(s)', removed)
    return removed
