"""
What a profile picture may be.

`AvatarUploadView` assigned the upload straight to `UserProfile.avatar` and
called `save()`, which runs no validators — so the "image" field accepted any
file type up to the proxy's 55 MB body limit, and each new picture left the
previous one on disk.
"""
from __future__ import annotations

import io
import os
import shutil
import tempfile
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from core.models import UserProfile
from workflow_backend import thresholds

User = get_user_model()
URL = '/api/auth/profile/avatar/'


def picture(fmt='PNG', size=(8, 8)) -> bytes:
    buffer = io.BytesIO()
    Image.new('RGB', size, (20, 120, 200)).save(buffer, format=fmt)
    return buffer.getvalue()


class AvatarUploadTests(TestCase):
    def setUp(self):
        self._media = tempfile.mkdtemp()
        self._override = override_settings(MEDIA_ROOT=self._media)
        self._override.enable()
        self.user = User.objects.create_user('owner', 'owner@example.com', 'pw')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def tearDown(self):
        self._override.disable()
        shutil.rmtree(self._media, ignore_errors=True)

    def send(self, name, data, content_type='image/png'):
        return self.client.post(URL, {
            'avatar': SimpleUploadedFile(name, data, content_type=content_type),
        }, format='multipart')

    def stored(self) -> list[str]:
        return [name for _f, _d, names in os.walk(self._media) for name in names]

    def test_a_small_picture_is_accepted(self):
        response = self.send('me.png', picture())

        self.assertEqual(response.status_code, 200)
        self.assertTrue(UserProfile.objects.get(user=self.user).avatar)

    def test_jpeg_and_webp_are_accepted(self):
        self.assertEqual(self.send('me.jpg', picture('JPEG'), 'image/jpeg').status_code, 200)
        self.assertEqual(self.send('me.webp', picture('WEBP'), 'image/webp').status_code, 200)

    def test_a_picture_over_the_size_limit_is_refused(self):
        with patch.object(thresholds, 'MAX_AVATAR_BYTES', 50):
            response = self.send('me.png', picture(size=(64, 64)))

        self.assertEqual(response.status_code, 400)
        self.assertIn('limit', response.data['error'])
        self.assertEqual(self.stored(), [])

    def test_a_file_that_is_not_an_image_is_refused_whatever_it_is_called(self):
        response = self.send('me.png', b'%PDF-1.4 this is not a picture')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.stored(), [])

    def test_svg_is_refused(self):
        svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'

        self.assertEqual(self.send('me.svg', svg, 'image/svg+xml').status_code, 400)

    def test_an_image_format_a_browser_does_not_draw_is_refused(self):
        self.assertEqual(self.send('me.tiff', picture('TIFF'), 'image/tiff').status_code, 400)

    def test_a_new_picture_replaces_the_old_file(self):
        self.send('first.png', picture())
        self.send('second.png', picture(size=(9, 9)))

        self.assertEqual(len(self.stored()), 1,
                         'Each new avatar used to leave the last one on disk.')
