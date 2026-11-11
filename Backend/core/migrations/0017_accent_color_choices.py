from django.db import migrations, models


def blue_to_teal(apps, schema_editor):
    # 'blue' was the old default every account received, so it is not a choice
    # people made. Those rows move to the new default. 'magenta' is left alone.
    UserProfile = apps.get_model('core', 'UserProfile')
    UserProfile.objects.filter(accent_color='blue').update(accent_color='teal')


def teal_to_blue(apps, schema_editor):
    UserProfile = apps.get_model('core', 'UserProfile')
    UserProfile.objects.filter(accent_color='teal').update(accent_color='blue')


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0016_org_capture_and_curators'),
    ]

    operations = [
        # Choices and the new default. An AlterField does not rewrite data.
        migrations.AlterField(
            model_name='userprofile',
            name='accent_color',
            field=models.CharField(
                choices=[('teal', 'Teal'), ('ink', 'Ink'), ('blue', 'Blue'), ('magenta', 'Magenta')],
                default='teal',
                help_text='Accent colour: teal, ink, blue or magenta',
                max_length=20,
            ),
        ),
        migrations.RunPython(blue_to_teal, teal_to_blue),
    ]
