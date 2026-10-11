"""
Data migration: the `chatgpt` credential type (Continue with ChatGPT).

Holds a user's ChatGPT plan sign-in: tokens in the two token columns, the
issued client id in the encrypted blob. See `credentials/chatgpt.py`.

Two things are deliberate. The row is written **here, inline**, not imported
from `seed_connector_credentials.CREDENTIAL_TYPES`: `0010` imported its row
from that list and broke the day the entry was deleted. And it is
**`is_active=False`**: the type list the "add a credential" screen offers is
the active ones, and that screen's OAuth button runs the Google flow. A
ChatGPT credential is only ever made by the Continue with ChatGPT button;
looking one up never checks the type's own switch.
"""
from django.db import migrations


def seed(apps, schema_editor):
    CredentialType = apps.get_model('credentials', 'CredentialType')
    CredentialType.objects.update_or_create(
        slug='chatgpt',
        defaults={
            'name': 'ChatGPT plan',
            'service_identifier': 'chatgpt',
            'auth_method': 'oauth2',
            'description': 'Your ChatGPT sign-in. Turns on the ChatGPT provider use your plan.',
            'icon': 'Brain',
            'fields_schema': [],
            'is_active': False,
        },
    )


def unseed(apps, schema_editor):
    Credential = apps.get_model('credentials', 'Credential')
    CredentialType = apps.get_model('credentials', 'CredentialType')
    Credential.objects.filter(credential_type__slug='chatgpt').delete()
    CredentialType.objects.filter(slug='chatgpt').delete()


class Migration(migrations.Migration):

    dependencies = [
        ('credentials', '0011_remove_opencode'),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
