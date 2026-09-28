"""
Two receivers.

* A thumbs-up on an assistant answer starts automatic capture. Listening to
  `logs.Feedback` here, rather than calling us from `logs`, keeps the lower
  layer unaware this app exists.
* Deleting an account deletes that person's **private** solutions. Shared ones
  belong to the org and stay (the author FK is SET_NULL); a private row with
  no author would be readable by no one and kept for ever.
"""
from __future__ import annotations

import asyncio
import logging

from django.conf import settings
from django.db import transaction
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

logger = logging.getLogger(__name__)


def _start_capture(message_id: int) -> None:
    from .capture import capture_answer

    coro = capture_answer(message_id, trigger='thumbs up')
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    if loop is not None:
        from workflow_backend.background import spawn

        spawn(coro, name=f'solution-capture-{message_id}')
        return
    # A sync request (DRF view): no loop here, so the job gets a thread of
    # its own rather than holding the response.
    from workflow_backend.background import run_in_thread

    run_in_thread(coro, name=f'solution-capture-{message_id}')


@receiver(post_save, sender='logs.Feedback')
def capture_on_thumbs_up(sender, instance, **kwargs):
    if getattr(settings, 'SOLUTION_CAPTURE_ENABLED', True) is False:
        return
    if instance.rating != 1 or not instance.chat_message_id:
        return
    message_id = instance.chat_message_id
    transaction.on_commit(lambda: _start_capture(message_id))


@receiver(post_delete, sender=settings.AUTH_USER_MODEL)
def drop_orphaned_private_solutions(sender, instance, **kwargs):
    from .models import Solution

    Solution.objects.filter(author__isnull=True, shared=False).delete()
