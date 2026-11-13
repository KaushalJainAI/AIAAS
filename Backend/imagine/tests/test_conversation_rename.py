"""Renaming an Imagine conversation.

The web app's rename called PATCH on a viewset that allowed only GET and
DELETE, so it answered 405 and the rename never happened.
"""
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from imagine.models import ImagineConversation


class ConversationRenameTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='owner', email='owner@example.com', password='x')
        self.other = User.objects.create_user(username='other', email='other@example.com', password='x')
        self.conversation = ImagineConversation.objects.create(user=self.user, title='Old')
        self.client.force_authenticate(self.user)

    def url(self, pk):
        return f'/api/imagine/conversations/{pk}/'

    def test_rename_sets_the_title(self):
        response = self.client.patch(self.url(self.conversation.pk), {'title': '  Logo ideas  '}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['title'], 'Logo ideas')
        self.conversation.refresh_from_db()
        self.assertEqual(self.conversation.title, 'Logo ideas')

    def test_only_the_title_changes(self):
        before = self.conversation.status
        self.client.patch(self.url(self.conversation.pk), {'title': 'New', 'status': 'something-else'}, format='json')
        self.conversation.refresh_from_db()
        self.assertEqual(self.conversation.status, before)

    def test_a_title_must_be_a_string_under_the_limit(self):
        self.assertEqual(self.client.patch(self.url(self.conversation.pk), {'title': 5}, format='json').status_code, 400)
        self.assertEqual(
            self.client.patch(self.url(self.conversation.pk), {'title': 'x' * 500}, format='json').status_code, 400,
        )

    def test_someone_elses_conversation_is_not_found(self):
        self.client.force_authenticate(self.other)
        response = self.client.patch(self.url(self.conversation.pk), {'title': 'Mine now'}, format='json')
        self.assertEqual(response.status_code, 404)
