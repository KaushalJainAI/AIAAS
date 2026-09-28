from django.apps import AppConfig


class SolutionsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'solutions'
    label = 'solutions'
    verbose_name = 'Solutions'

    def ready(self):
        from . import signals  # noqa: F401 — connects the receivers
