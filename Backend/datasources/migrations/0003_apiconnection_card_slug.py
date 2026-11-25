from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('datasources', '0002_sharedtool'),
    ]

    operations = [
        migrations.AddField(
            model_name='apiconnection',
            name='card_slug',
            field=models.CharField(blank=True, default='', max_length=64),
        ),
    ]
