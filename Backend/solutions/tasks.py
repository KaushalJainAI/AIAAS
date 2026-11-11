"""Celery beat entry for the weekly stale sweep. The work is in `stale.py`,
shared with `manage.py solutions_stale_sweep` and the in-process scheduler."""
from celery import shared_task


@shared_task(name='solutions.sweep_stale', ignore_result=True)
def sweep_stale():
    from .stale import run_stale_sweep

    return run_stale_sweep()
