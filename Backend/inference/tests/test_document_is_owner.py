"""`is_owner` on the document API (preview pane plan, Phase 3).

The flag only unlocks the owner's "Run scripts" button, so the properties to
defend are: the owner gets True; every other reader gets False, whether the
file is shared into the public library or sits in a team knowledge base; and a
serializer built without a request, or with an anonymous one, fails closed.
"""
from __future__ import annotations

from types import SimpleNamespace

from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from django.test import TestCase
from rest_framework.test import APIClient

from core.models import Membership, Organization
from inference.models import Document, KnowledgeBase
from inference.serializers import DocumentListSerializer, DocumentSerializer

User = get_user_model()


def _as(user):
    """The part of a request the serializer reads: `request.user`."""
    return {'request': SimpleNamespace(user=user)}


class IsOwnerTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user('owner', 'owner@example.test', 'pw-owner-1')
        self.reader = User.objects.create_user('reader', 'reader@example.test', 'pw-reader-1')
        self.kb = KnowledgeBase.objects.create(user=self.owner, name='Mine', backend='fulltext')
        self.doc = self._doc(self.owner, self.kb)

    def _doc(self, owner, kb, **extra):
        return Document.objects.create(
            user=owner, knowledge_base=kb, name='page.html', file_type='html',
            file_size=12, content_text='<p>hi</p>', status='indexed', **extra,
        )

    def _flag(self, serializer_cls, doc, user):
        return serializer_cls(doc, context=_as(user)).data['is_owner']

    def test_the_owner_gets_true_on_both_shapes(self):
        self.assertIs(self._flag(DocumentSerializer, self.doc, self.owner), True)
        self.assertIs(self._flag(DocumentListSerializer, self.doc, self.owner), True)

    def test_another_user_gets_false_for_a_private_file(self):
        self.assertIs(self._flag(DocumentSerializer, self.doc, self.reader), False)
        self.assertIs(self._flag(DocumentListSerializer, self.doc, self.reader), False)

    def test_a_file_shared_into_the_public_library_is_not_the_readers_own(self):
        shared = self._doc(self.owner, self.kb, sharing_mode='shared_read', is_shared=True)
        self.assertIs(self._flag(DocumentSerializer, shared, self.reader), False)
        self.assertIs(self._flag(DocumentListSerializer, shared, self.reader), False)
        # Sharing never changes who owns it.
        self.assertIs(self._flag(DocumentSerializer, shared, self.owner), True)

    def test_an_org_member_reading_a_file_in_a_team_kb_is_not_the_owner(self):
        org = Organization.objects.create(name='Acme', created_by=self.owner)
        Membership.objects.create(org=org, user=self.owner, role='owner')
        Membership.objects.create(org=org, user=self.reader, role='member')
        team_kb = KnowledgeBase.objects.create(
            user=self.owner, name='Handbook', backend='fulltext',
            org=org, shared_with_org=True,
        )
        team_doc = self._doc(self.owner, team_kb)
        self.assertIs(self._flag(DocumentSerializer, team_doc, self.reader), False)
        self.assertIs(self._flag(DocumentListSerializer, team_doc, self.reader), False)

    def test_no_request_in_the_context_fails_closed(self):
        self.assertIs(DocumentSerializer(self.doc).data['is_owner'], False)
        self.assertIs(DocumentListSerializer(self.doc).data['is_owner'], False)

    def test_an_anonymous_request_is_not_an_owner(self):
        self.assertIs(self._flag(DocumentSerializer, self.doc, AnonymousUser()), False)

    def test_the_flag_is_read_only(self):
        self.assertTrue(DocumentSerializer().fields['is_owner'].read_only)


class IsOwnerApiTests(TestCase):
    """What the detail route returns for a file another user shared."""

    def setUp(self):
        self.owner = User.objects.create_user('owner2', 'owner2@example.test', 'pw-owner-2')
        self.reader = User.objects.create_user('reader2', 'reader2@example.test', 'pw-reader-2')
        kb = KnowledgeBase.objects.create(user=self.owner, name='Shared', backend='fulltext')
        self.shared = Document.objects.create(
            user=self.owner, knowledge_base=kb, name='notes.txt', file_type='txt',
            file_size=5, content_text='hello', status='indexed',
            sharing_mode='shared_read', is_shared=True,
        )

    def test_a_reader_of_a_shared_file_is_not_told_they_own_it(self):
        client = APIClient()
        client.force_authenticate(user=self.reader)
        response = client.get(f'/api/inference/documents/{self.shared.id}/')
        self.assertEqual(response.status_code, 200)
        self.assertIsNot(response.data.get('is_owner'), True)

    def test_the_owner_is_told_they_own_it_on_detail_and_list(self):
        # Every view must pass the request (or the user) to the serializer;
        # without it the flag fails closed and "Run scripts" never shows.
        client = APIClient()
        client.force_authenticate(user=self.owner)
        detail = client.get(f'/api/inference/documents/{self.shared.id}/')
        self.assertEqual(detail.status_code, 200)
        self.assertIs(detail.data.get('is_owner'), True)
        listing = client.get('/api/inference/documents/')
        self.assertEqual(listing.status_code, 200)
        mine = [d for d in listing.data['my_documents'] if d['id'] == self.shared.id]
        self.assertEqual(len(mine), 1)
        self.assertIs(mine[0]['is_owner'], True)
