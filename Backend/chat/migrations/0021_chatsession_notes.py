# Conversation notes: the per-conversation notes file and its structure.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0020_chatsession_run_state'),
        ('inference', '0026_kb_org_sharing'),
    ]

    operations = [
        migrations.AddField(
            model_name='chatsession',
            name='notes_document',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='+', to='inference.document',
            ),
        ),
        migrations.AddField(
            model_name='chatsession',
            name='notes_state',
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
