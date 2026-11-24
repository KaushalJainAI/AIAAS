from celery import shared_task


@shared_task(name='messaging.purge_inbound', ignore_result=True)
def purge_inbound():
    from messaging.retention import purge_expired

    return purge_expired()


@shared_task(name='messaging.deliver_held_sends', ignore_result=True)
def deliver_held_sends():
    """Deliver held sends whose timer was lost, and mark stuck sends unknown."""
    from asgiref.sync import async_to_sync

    from messaging.holds import sweep

    return async_to_sync(sweep)()
