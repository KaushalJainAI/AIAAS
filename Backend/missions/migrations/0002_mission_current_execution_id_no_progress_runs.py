from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('missions', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='mission',
            name='current_execution_id',
            field=models.CharField(blank=True, default='', max_length=64),
        ),
        migrations.AddField(
            model_name='mission',
            name='no_progress_runs',
            field=models.IntegerField(default=0),
        ),
    ]
