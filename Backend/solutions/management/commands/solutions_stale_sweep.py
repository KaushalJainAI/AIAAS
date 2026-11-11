"""
Send this week's "team solutions may be out of date" digests (K4.2).

The same sweep the in-process scheduler and the Celery beat task run. Use it
on a machine with no Celery, or to see what would be sent:

    python manage.py solutions_stale_sweep
"""
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Send the weekly stale-solutions digests.'

    def handle(self, *args, **options):
        from solutions.stale import run_stale_sweep

        stats = run_stale_sweep()
        self.stdout.write(self.style.SUCCESS(
            f"Stale sweep: {stats['flagged']} flagged in {stats['orgs']} org(s), "
            f"{stats['notified']} digest(s) sent, {stats['skipped_recent']} skipped "
            "(told within 6 days)."
        ))
