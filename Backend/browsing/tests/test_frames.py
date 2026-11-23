"""The frame store (`browsing/frames.py`): owner-only, bounded, short-lived.

Pinned: a frame is found only under the user who made it; a made-up, malformed
or expired id finds nothing; a picture over the cap is not kept; the lifetime
is the setting, with a sane fallback when the setting is junk.
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings

from browsing import frames

User = get_user_model()
JPEG = b'\xff\xd8\xff\xe0' + b'frame'


class FrameStoreTests(TestCase):
    def setUp(self):
        cache.clear()
        self.owner = User.objects.create_user('frame-owner', 'fo@example.com', 'pw')
        self.other = User.objects.create_user('frame-other', 'fx@example.com', 'pw')

    def test_the_owner_reads_back_their_own_picture(self):
        frame_id = frames.put(self.owner.id, JPEG)
        self.assertTrue(frame_id)
        self.assertEqual(frames.get(self.owner.id, frame_id), JPEG)

    def test_another_user_finds_nothing_under_the_same_id(self):
        frame_id = frames.put(self.owner.id, JPEG)
        self.assertIsNone(frames.get(self.other.id, frame_id))

    def test_a_made_up_or_malformed_id_finds_nothing(self):
        frames.put(self.owner.id, JPEG)
        for bogus in ('', 'AAAAAAAAAAAAAAAA', '../../etc/passwd', 'x' * 200, None, 12):
            with self.subTest(frame_id=bogus):
                self.assertIsNone(frames.get(self.owner.id, bogus))

    def test_nothing_is_kept_without_a_picture_or_a_user(self):
        self.assertIsNone(frames.put(self.owner.id, None))
        self.assertIsNone(frames.put(self.owner.id, b''))
        self.assertIsNone(frames.put(None, JPEG))
        self.assertIsNone(frames.get(None, 'AAAAAAAAAAAAAAAA'))

    def test_an_oversized_picture_is_refused_not_cut(self):
        too_big = b'\x00' * (frames.MAX_FRAME_BYTES + 1)
        self.assertIsNone(frames.put(self.owner.id, too_big))

    def test_a_picture_at_the_cap_is_kept(self):
        at_cap = b'\x00' * frames.MAX_FRAME_BYTES
        frame_id = frames.put(self.owner.id, at_cap)
        self.assertEqual(frames.get(self.owner.id, frame_id), at_cap)

    @override_settings(BROWSER_FRAME_TTL_SECONDS=0)
    def test_an_expired_picture_is_gone(self):
        # A zero timeout expires at once, which is how the TTL is exercised
        # without sleeping.
        frame_id = frames.put(self.owner.id, JPEG)
        self.assertTrue(frame_id)
        self.assertIsNone(frames.get(self.owner.id, frame_id))

    @override_settings(BROWSER_FRAME_TTL_SECONDS=120)
    def test_the_lifetime_is_the_setting(self):
        self.assertEqual(frames.ttl_seconds(), 120)

    @override_settings(BROWSER_FRAME_TTL_SECONDS='soon')
    def test_a_junk_lifetime_falls_back_to_an_hour(self):
        self.assertEqual(frames.ttl_seconds(), 3600)
