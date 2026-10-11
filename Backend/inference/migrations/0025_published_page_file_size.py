from django.db import migrations, models


def backfill_sizes(apps, schema_editor):
    """Record the size of snapshots published before the column existed.

    Best effort: a snapshot whose file is gone holds nothing, and stays 0.
    Without this the storage quota would not count any page already shared.
    """
    PublishedPage = apps.get_model('inference', 'PublishedPage')
    for page in PublishedPage.objects.exclude(file='').only('id', 'file').iterator():
        try:
            size = page.file.size
        except Exception:  # noqa: BLE001 — a missing blob must not stop a deploy
            continue
        PublishedPage.objects.filter(pk=page.pk).update(file_size=size)


class Migration(migrations.Migration):

    dependencies = [
        ('inference', '0024_document_trigram_search'),
    ]

    operations = [
        migrations.AddField(
            model_name='publishedpage',
            name='file_size',
            field=models.IntegerField(default=0),
        ),
        migrations.RunPython(backfill_sizes, migrations.RunPython.noop),
    ]
