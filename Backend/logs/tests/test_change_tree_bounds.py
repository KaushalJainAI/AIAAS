"""
The walk over a change set's workers is limited to one user and a breadth cap (H-181).

Before, `_tree_ids` followed every child set whatever its owner and without
a limit, so a summary or a retention sweep could read or delete another
account's sets, and a huge tree could make one request unbounded.
"""
from __future__ import annotations

from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase

from logs import changes
from logs.models import ChangeSet
from workflow_backend import thresholds

User = get_user_model()


class TreeIdsTests(TestCase):
    def setUp(self):
        cache.clear()
        self.me = User.objects.create_user('me', 'me@example.test', 'pw')
        self.other = User.objects.create_user('other', 'other@example.test', 'pw')
        self.root = ChangeSet.objects.create(user=self.me, owner_kind='chat')

    def child(self, parent, user=None):
        return ChangeSet.objects.create(user=user or self.me, owner_kind='run', parent=parent)

    def test_a_child_owned_by_another_user_is_not_walked(self):
        mine = self.child(self.root)
        foreign = self.child(self.root, user=self.other)
        ids, cut = changes._tree_ids(self.root.pk, self.me.id)
        self.assertEqual(ids, [self.root.pk, mine.pk])
        self.assertNotIn(foreign.pk, ids)
        self.assertFalse(cut)

    def test_a_root_that_is_not_the_users_gives_an_empty_tree(self):
        ids, cut = changes._tree_ids(self.root.pk, self.other.id)
        self.assertEqual(ids, [])
        self.assertFalse(cut)

    def test_the_walk_stops_at_the_breadth_cap_and_says_so(self):
        with mock.patch.object(thresholds, 'CHANGE_LIST_LIMIT', 3):
            for _ in range(5):
                self.child(self.root)
            ids, cut = changes._tree_ids(self.root.pk, self.me.id)
        self.assertEqual(len(ids), 3)
        self.assertTrue(cut)

    def test_a_summary_over_the_cap_is_marked_incomplete(self):
        with mock.patch.object(thresholds, 'CHANGE_LIST_LIMIT', 2):
            for _ in range(4):
                self.child(self.root)
            counted = changes.summary(self.root)
        self.assertTrue(counted['incomplete'])

    def test_a_summary_of_a_small_tree_is_complete(self):
        self.child(self.root)
        counted = changes.summary(self.root.pk)
        self.assertFalse(counted['incomplete'])

    def test_a_summary_ignores_another_users_child(self):
        self.child(self.root, user=self.other)
        counted = changes.summary(self.root)
        self.assertEqual(counted['total'], 0)
        self.assertFalse(counted['incomplete'])

    def test_a_purge_never_deletes_a_partial_tree(self):
        from datetime import timedelta

        from django.utils import timezone

        old = timezone.now() - timedelta(days=400)
        with mock.patch.object(thresholds, 'CHANGE_LIST_LIMIT', 2):
            for _ in range(4):
                self.child(self.root)
            ChangeSet.objects.filter(pk=self.root.pk).update(created_at=old)
            purged = changes.purge_old_sets()
        self.assertEqual(purged, 0)
        self.assertTrue(ChangeSet.objects.filter(pk=self.root.pk).exists())
