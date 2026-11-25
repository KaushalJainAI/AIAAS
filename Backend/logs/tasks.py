"""Celery entry points for `logs/`. Dispatch wrappers only."""
from celery import shared_task


@shared_task(name='logs.redact_old_run_detail', ignore_result=True)
def redact_old_run_detail():
    """Beat entry point for the run-detail retention sweep (`logs/retention.py`),
    shared with `manage.py purge_run_detail` for broker-less deployments."""
    from .retention import run_retention_sweep

    result = run_retention_sweep()
    return {'turns': result['turns'], 'steps': result['steps']}


@shared_task(name='logs.purge_change_sets', ignore_result=True)
def purge_change_sets():
    """Beat entry point for the change-log retention sweep
    (`logs/changes.py::purge_old_sets`): sets older than CHANGE_HISTORY_DAYS."""
    from .changes import purge_old_sets

    return {'purged': purge_old_sets()}
