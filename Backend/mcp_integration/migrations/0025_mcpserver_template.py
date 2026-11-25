"""API-card template column (Phase 9b of CONNECTOR_CATALOGUE_PLAN).

`template` says how an `kind='api'` card builds the user's `ApiConnection`. It is
data only: curated rows set it in a later migration, and an empty dict means the
row is not an API card yet. Nothing reads it for other kinds. Reversing drops the
column and leaves the rest of the data alone.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('mcp_integration', '0024_kind_and_setup_guide'),
    ]

    operations = [
        migrations.AddField(
            model_name='mcpserver',
            name='template',
            field=models.JSONField(
                blank=True,
                default=dict,
                help_text='API-card template (see card_template.py). Empty for other kinds.',
            ),
        ),
    ]
