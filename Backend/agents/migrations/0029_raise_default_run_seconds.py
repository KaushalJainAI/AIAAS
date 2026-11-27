"""Move agents saved at the old 15-minute run limit to the new 60-minute default.

The builders saved the default explicitly, so every agent nobody tuned carries
`maxRunSeconds: 900` and would keep the old limit for ever. A value anything
other than exactly 900 was chosen by a person and is left alone (H-185).
"""
from django.db import migrations

OLD = 15 * 60
NEW = 60 * 60


def forwards(apps, schema_editor):
    SubAgent = apps.get_model('orchestrator', 'SubAgent')
    for agent in SubAgent.objects.only('id', 'guardrails').iterator():
        guards = agent.guardrails if isinstance(agent.guardrails, dict) else None
        if guards and guards.get('maxRunSeconds') == OLD:
            agent.guardrails = {**guards, 'maxRunSeconds': NEW}
            agent.save(update_fields=['guardrails'])


class Migration(migrations.Migration):

    dependencies = [
        ('orchestrator', '0028_move_opencode_rows_to_default'),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
