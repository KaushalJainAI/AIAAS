"""
Knowledge bases bound to folders: ownership, the scope rule, and the folder tree.

The rules under test:

* A knowledge base may only be bound to a folder its owner holds. The model
  refuses a foreign folder; the REST route answers a foreign id with the same
  404 as an unknown one (`filesystem.resolve_folder`).
* Deleting a folder unbinds its knowledge bases and never deletes them.
* A run may use a knowledge base that is in its selection, or bound to a folder
  inside its file scope, and nothing else (`inference/kb_folders.py`).
* A write needs the bound folder to be writable in the file scope.
* The children of a knowledge base are the knowledge bases bound beneath its
  folder, by the folder tree, not by any stored parent link.
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APITestCase

from inference import filesystem as fs
from inference import kb_folders, vfs
from inference.models import KnowledgeBase
from inference.vfs import FileScope


def _scope(user, root, *, write=True, write_prefix=()):
    """A scope rooted at `root` (None for the whole tree), writable as asked."""
    return FileScope(
        user=user, root=root, mode='scoped',
        label=('/' + root.name) if root else '/',
        write_prefix=write_prefix if write else None,
        write_label=('/' + root.name) if root else '/',
    )


class OwnershipTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user(username='owner', password='pw12345')
        self.stranger = User.objects.create_user(username='stranger', password='pw12345')
        self.mine = fs.create_folder(self.owner, 'Mine', None)
        self.theirs = fs.create_folder(self.stranger, 'Theirs', None)
        self.kb = KnowledgeBase.objects.create(
            user=self.owner, name='Owner KB', backend='raw')
        self.client.force_authenticate(user=self.owner)

    def _patch(self, body):
        return self.client.patch(
            f'/api/inference/knowledge-bases/{self.kb.id}/', body, format='json')

    def test_the_model_refuses_a_foreign_folder(self):
        self.kb.folder = self.theirs
        with self.assertRaises(ValueError):
            self.kb.save()
        self.kb.refresh_from_db()
        self.assertIsNone(self.kb.folder_id)

    def test_clean_reports_a_foreign_folder_as_a_validation_error(self):
        self.kb.folder = self.theirs
        with self.assertRaises(ValidationError) as cm:
            self.kb.clean()
        self.assertIn('folder', cm.exception.message_dict)

    def test_owner_binds_and_unbinds_through_the_api(self):
        response = self._patch({'folder': self.mine.id})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()['folder'], self.mine.id)
        self.kb.refresh_from_db()
        self.assertEqual(self.kb.folder_id, self.mine.id)

        response = self._patch({'folder': None})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.kb.refresh_from_db()
        self.assertIsNone(self.kb.folder_id)

    def test_a_foreign_folder_is_the_same_404_as_an_unknown_one(self):
        foreign = self._patch({'folder': self.theirs.id})
        unknown = self._patch({'folder': 987654})
        self.assertEqual(foreign.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(unknown.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(foreign.json(), unknown.json())
        self.kb.refresh_from_db()
        self.assertIsNone(self.kb.folder_id)

    def test_the_list_shows_the_folder_id(self):
        self.kb.folder = self.mine
        self.kb.save()
        rows = self.client.get('/api/inference/knowledge-bases/').json()['knowledge_bases']
        row = next(r for r in rows if r['id'] == self.kb.id)
        self.assertEqual(row['folder'], self.mine.id)

    def test_deleting_a_folder_unbinds_its_knowledge_base_and_keeps_it(self):
        self.kb.folder = self.mine
        self.kb.save()
        self.mine.delete()
        self.kb.refresh_from_db()
        self.assertIsNone(self.kb.folder_id)
        self.assertTrue(KnowledgeBase.objects.filter(id=self.kb.id).exists())


class ScopeRuleTests(TestCase):
    """`reachable`, `folder_bound_below` and `write_parts` on a real tree."""

    def setUp(self):
        self.user = get_user_model().objects.create_user(username='scoper', password='pw')
        self.research = fs.create_folder(self.user, 'Research', None)
        self.q3 = fs.create_folder(self.user, 'Q3', self.research)
        self.other = fs.create_folder(self.user, 'Other', None)

        self.parent = KnowledgeBase.objects.create(
            user=self.user, name='Research index', backend='hybrid', folder=self.research)
        self.child = KnowledgeBase.objects.create(
            user=self.user, name='Q3 index', backend='hybrid', folder=self.q3)
        self.outside = KnowledgeBase.objects.create(
            user=self.user, name='Other index', backend='hybrid', folder=self.other)
        self.loose = KnowledgeBase.objects.create(
            user=self.user, name='Loose index', backend='hybrid')

    def test_an_unrestricted_caller_reaches_every_knowledge_base(self):
        for kb in (self.parent, self.child, self.outside, self.loose):
            self.assertTrue(kb_folders.reachable(kb, None, None))

    def test_a_selected_knowledge_base_is_reachable_without_files(self):
        self.assertTrue(kb_folders.reachable(self.loose, (self.loose.id,), None))

    def test_a_knowledge_base_bound_inside_the_file_scope_is_reachable(self):
        scope = _scope(self.user, self.research, write=False)
        self.assertTrue(kb_folders.reachable(self.child, (self.parent.id,), scope))

    def test_a_knowledge_base_bound_outside_the_file_scope_is_not(self):
        scope = _scope(self.user, self.research, write=False)
        self.assertFalse(kb_folders.reachable(self.outside, (self.parent.id,), scope))

    def test_an_unbound_knowledge_base_outside_the_selection_is_not(self):
        scope = _scope(self.user, None, write=False)
        self.assertFalse(kb_folders.reachable(self.loose, (self.parent.id,), scope))

    def test_children_are_the_knowledge_bases_beneath_by_the_tree(self):
        children = list(kb_folders.folder_bound_below(self.user.id, self.parent))
        self.assertEqual([kb.id for kb in children], [self.child.id])
        self.assertEqual(list(kb_folders.folder_bound_below(self.user.id, self.child)), [])

    def test_a_trashed_child_folder_is_not_a_child(self):
        self.q3.deleted_at = self.q3.updated_at
        self.q3.save(update_fields=['deleted_at'])
        children = list(kb_folders.folder_bound_below(self.user.id, self.parent))
        self.assertEqual(children, [])

    def test_a_write_lands_only_in_a_writable_folder(self):
        scope = _scope(self.user, self.research, write=True)
        self.assertEqual(kb_folders.write_parts(self.child, scope), ['Q3'])

    def test_a_read_only_scope_refuses_the_write(self):
        scope = _scope(self.user, self.research, write=False)
        with self.assertRaises(vfs.VfsError) as cm:
            kb_folders.write_parts(self.child, scope)
        self.assertIn('read but not write', str(cm.exception))

    def test_a_write_prefix_limits_writes_inside_the_readable_subtree(self):
        scope = _scope(self.user, None, write=True, write_prefix=('Research',))
        self.assertEqual(kb_folders.write_parts(self.child, scope), ['Research', 'Q3'])
        with self.assertRaises(vfs.VfsError):
            kb_folders.write_parts(self.outside, scope)

    def test_a_knowledge_base_with_no_folder_has_nowhere_to_write(self):
        scope = _scope(self.user, None, write=True)
        with self.assertRaises(vfs.VfsError) as cm:
            kb_folders.write_parts(self.loose, scope)
        self.assertIn('not bound to a folder', str(cm.exception))

    def test_a_knowledge_base_in_the_recycle_bin_is_not_writable(self):
        self.research.deleted_at = self.research.updated_at
        self.research.save(update_fields=['deleted_at'])
        scope = _scope(self.user, None, write=True)
        with self.assertRaises(vfs.VfsError) as cm:
            kb_folders.write_parts(self.parent, scope)
        self.assertIn('recycle bin', str(cm.exception))
