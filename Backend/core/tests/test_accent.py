"""B10: the accent colour is a closed set, and new profiles start on teal."""
from types import SimpleNamespace

from django.contrib.auth.models import User
from django.test import TestCase

from core.models import UserProfile
from core.serializers import UserProfileSerializer


class AccentDefaultTests(TestCase):
    def test_the_field_default_is_teal(self):
        self.assertEqual(UserProfile._meta.get_field('accent_color').default, 'teal')

    def test_a_new_profile_starts_on_teal(self):
        user = User.objects.create_user(username='newaccent', password='pw')
        profile, _ = UserProfile.objects.get_or_create(user=user)
        self.assertEqual(profile.accent_color, 'teal')

    def test_the_closed_set_is_the_four_the_ui_draws(self):
        self.assertEqual(
            [value for value, _ in UserProfile.ACCENT_CHOICES],
            ['teal', 'ink', 'blue', 'magenta'],
        )


class AccentDataMigrationTests(TestCase):
    """0017 moves the old default 'blue' to 'teal' and leaves the rest alone."""

    def setUp(self):
        import importlib

        from django.apps import apps

        self.migration = importlib.import_module(
            'core.migrations.0017_accent_color_choices')
        self.apps = apps

    def _profile(self, name, accent):
        user = User.objects.create_user(username=name, password='pw')
        profile, _ = UserProfile.objects.get_or_create(user=user)
        UserProfile.objects.filter(pk=profile.pk).update(accent_color=accent)
        return profile

    def test_forward_moves_blue_to_teal_and_keeps_magenta(self):
        blue = self._profile('mig-blue', 'blue')
        magenta = self._profile('mig-magenta', 'magenta')
        ink = self._profile('mig-ink', 'ink')

        self.migration.blue_to_teal(self.apps, None)

        blue.refresh_from_db()
        magenta.refresh_from_db()
        ink.refresh_from_db()
        self.assertEqual(blue.accent_color, 'teal')
        self.assertEqual(magenta.accent_color, 'magenta')
        self.assertEqual(ink.accent_color, 'ink')

    def test_reverse_moves_teal_back_to_blue(self):
        teal = self._profile('mig-teal', 'teal')
        magenta = self._profile('mig-magenta-rev', 'magenta')

        self.migration.teal_to_blue(self.apps, None)

        teal.refresh_from_db()
        magenta.refresh_from_db()
        self.assertEqual(teal.accent_color, 'blue')
        self.assertEqual(magenta.accent_color, 'magenta')


class AccentSerializerTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='accentser', password='pw')
        self.profile, _ = UserProfile.objects.get_or_create(user=self.user)

    def _save(self, value):
        # `update` reads the request body for nested user fields, so a save
        # needs a request in context, as the view supplies one.
        serializer = UserProfileSerializer(
            instance=self.profile, data={'accent_color': value}, partial=True,
            context={'request': SimpleNamespace(data={})},
        )
        return serializer, serializer.is_valid()

    def test_each_member_of_the_closed_set_is_accepted(self):
        for value in ('teal', 'ink', 'blue', 'magenta'):
            serializer, valid = self._save(value)
            self.assertTrue(valid, serializer.errors)
            self.assertEqual(serializer.validated_data['accent_color'], value)

    def test_anything_else_is_refused(self):
        for value in ('purple', 'red', '', '#00ff00'):
            serializer, valid = self._save(value)
            self.assertFalse(valid, value)
            self.assertIn('accent_color', serializer.errors)

    def test_matching_is_exact_not_case_folded(self):
        serializer, valid = self._save('Magenta')
        self.assertFalse(valid)
        self.assertIn('accent_color', serializer.errors)

    def test_the_saved_value_is_returned_on_read(self):
        serializer, valid = self._save('ink')
        self.assertTrue(valid)
        serializer.save()
        self.profile.refresh_from_db()
        self.assertEqual(UserProfileSerializer(self.profile).data['accent_color'], 'ink')

    def test_an_existing_blue_profile_keeps_blue(self):
        UserProfile.objects.filter(pk=self.profile.pk).update(accent_color='blue')
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.accent_color, 'blue')
        self.assertEqual(UserProfileSerializer(self.profile).data['accent_color'], 'blue')
