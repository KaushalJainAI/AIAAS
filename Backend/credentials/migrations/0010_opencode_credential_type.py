"""
Was: seed the `opencode` (OpenCode Zen) credential type.

Now a no-op. The provider was removed on 2026-10-11 and its entry deleted from
`seed_connector_credentials.CREDENTIAL_TYPES`, which this migration used to
import and search — so on a fresh database it would raise `StopIteration`.
The file stays because every existing database has it recorded in
`django_migrations`; `0011_remove_opencode` deletes the row where it exists.
"""
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('credentials', '0009_slack_user_token'),
    ]

    operations = [
        migrations.RunPython(migrations.RunPython.noop, migrations.RunPython.noop),
    ]
