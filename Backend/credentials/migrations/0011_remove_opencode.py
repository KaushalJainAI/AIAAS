"""
Data migration: remove the `opencode` (OpenCode Zen) credential type.

The provider was removed on 2026-10-11 (see
`docs/CHATGPT_PLAN_PROVIDER_PLAN.md`, Phase 1). A key nothing can spend any
more should not stay in the vault, so the users' `opencode` credentials are
deleted first — `Credential.credential_type` is `PROTECT`, and the type cannot
go while they exist — and then the type itself.

Not reversible: the keys are gone. The reverse is a no-op so the migration
graph can still be walked backwards.
"""
from django.db import migrations


def remove_opencode(apps, schema_editor):
    Credential = apps.get_model('credentials', 'Credential')
    CredentialType = apps.get_model('credentials', 'CredentialType')
    Credential.objects.filter(credential_type__slug='opencode').delete()
    CredentialType.objects.filter(slug='opencode').delete()


class Migration(migrations.Migration):

    dependencies = [
        ('credentials', '0010_opencode_credential_type'),
    ]

    operations = [
        migrations.RunPython(remove_opencode, migrations.RunPython.noop),
    ]
