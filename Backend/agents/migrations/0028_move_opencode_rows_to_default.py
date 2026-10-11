"""
Data migration: nothing may still name the removed `opencode` provider.

OpenCode Zen was removed on 2026-10-11. A chat, a profile or an agent that
still says `opencode` would fail at preflight on its next turn, so each moves
to the shipped default (`openrouter` + `openrouter/free`), the router id that
survives individual models being retired. A stored effort level is left as it
is: `llm/access.py` snaps a level the new model lacks to its nearest rung.

`SharedAgent.config` is moved too, because an installer must not receive a
provider that no longer exists. `SubAgentRevision` rows are deliberately left
alone — they record what a past run really used.

Not reversible (which rows were `opencode` is not kept); the reverse is a
no-op.
"""
from django.db import migrations

DEFAULT_PROVIDER = 'openrouter'
DEFAULT_MODEL = 'openrouter/free'


def move_rows(apps, schema_editor):
    moved = {'llm_provider': DEFAULT_PROVIDER, 'llm_model': DEFAULT_MODEL}
    for app_label, model_name in (
        ('chat', 'ChatSession'),
        ('core', 'UserProfile'),
        ('orchestrator', 'SubAgent'),
    ):
        model = apps.get_model(app_label, model_name)
        model.objects.filter(llm_provider='opencode').update(**moved)

    SharedAgent = apps.get_model('orchestrator', 'SharedAgent')
    for row in SharedAgent.objects.all().only('id', 'config').iterator():
        config = row.config
        if isinstance(config, dict) and config.get('provider') == 'opencode':
            config['provider'] = DEFAULT_PROVIDER
            config['model'] = DEFAULT_MODEL
            row.config = config
            row.save(update_fields=['config'])


class Migration(migrations.Migration):

    dependencies = [
        ('orchestrator', '0027_subagent_provider_choices'),
        ('chat', '0012_add_session_effort'),
        ('core', '0008_effort_defaults'),
    ]

    operations = [
        migrations.RunPython(move_rows, migrations.RunPython.noop),
    ]
