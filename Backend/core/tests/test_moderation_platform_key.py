"""
The model checks in `core/safety/moderation.py` find the platform key where it
actually lives: the environment, read by `credentials.resolution.platform_api_key`.

Until 2026-11-26 they read only `settings.OPENROUTER_API_KEY`, which no settings
module defines, so content moderation, the injection check on text and the
vision injection check were all silently off in every deployment.
"""
from __future__ import annotations

import os
from unittest.mock import patch

from django.conf import settings
from django.test import SimpleTestCase, override_settings

from core.safety import moderation


class PlatformKeyFromEnvironmentTests(SimpleTestCase):
    def setUp(self) -> None:
        # The real-world shape: nothing in settings, the key in the environment.
        self.assertFalse(hasattr(settings, "OPENROUTER_API_KEY"),
                         "this test assumes no settings module defines the key")

    @override_settings(CONTENT_MODERATION_MODEL="vendor/guard")
    def test_content_moderation_is_on_with_an_environment_key(self):
        with patch.dict(os.environ, {"OPENROUTER_API_KEY": "env-key"}):
            self.assertEqual(moderation._enabled(), ("vendor/guard", "env-key"))

    @override_settings(INJECTION_IMAGE_PROVIDER="openrouter", INJECTION_IMAGE_MODEL="vendor/eyes")
    def test_the_vision_check_is_on_with_an_environment_key(self):
        with patch.dict(os.environ, {"OPENROUTER_API_KEY": "env-key"}):
            self.assertTrue(moderation.image_check_enabled())

    @override_settings(CONTENT_MODERATION_MODEL="vendor/guard")
    def test_the_alternative_variable_name_counts_too(self):
        env = {k: v for k, v in os.environ.items() if k != "OPENROUTER_API_KEY"}
        env["OPEN_ROUTER_KEY"] = "alt-key"
        with patch.dict(os.environ, env, clear=True):
            self.assertEqual(moderation._enabled(), ("vendor/guard", "alt-key"))

    @override_settings(CONTENT_MODERATION_MODEL="vendor/guard")
    def test_no_key_anywhere_keeps_it_off(self):
        env = {k: v for k, v in os.environ.items()
               if k not in ("OPENROUTER_API_KEY", "OPEN_ROUTER_KEY")}
        with patch.dict(os.environ, env, clear=True):
            self.assertEqual(moderation._enabled(), ("", ""))
