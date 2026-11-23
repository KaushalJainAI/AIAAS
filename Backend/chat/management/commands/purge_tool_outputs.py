"""`manage.py purge_tool_outputs` — delete stored tool output past its expiry.

The same job the in-process scheduler and the beat task `chat.purge_tool_outputs`
run; here for a host without either.
"""
from django.core.management.base import BaseCommand

from chat.tools.tool_output import purge_expired


class Command(BaseCommand):
    help = 'Delete stored tool output (spills, curated results) past its expiry.'

    def handle(self, *args, **options):
        removed = purge_expired()
        self.stdout.write(f'Purged {removed} expired row(s).')
