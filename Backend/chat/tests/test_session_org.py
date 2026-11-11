"""A chat is started in an org the person chooses, or in none.

`org` on the create request names an org the caller must be in (checked live
through `core.orgs.is_member`); `null` makes a personal chat; no key keeps the
old behaviour of taking the active org. The org is chosen once — a PATCH that
names another org is ignored, because `org` is read-only on the serializer.
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from chat.models import ChatSession
from core import orgs
from core.models import Membership

User = get_user_model()


def _user(name):
    return User.objects.create_user(username=name, email=f"{name}@example.test", password="x")


class SessionOrgTests(TestCase):
    def setUp(self):
        self.me = _user("me")
        self.other = _user("other")
        # Both orgs have `me` as a member. `acme` is created first and is
        # therefore the active org; `beta` is the one the tests move to.
        self.acme = orgs.create(self.me, "Acme")
        self.beta = orgs.create(self.other, "Beta")
        # Membership directly: these tests are about chats, not the invite flow.
        Membership.objects.create(org=self.beta, user=self.me, role="member")
        self.client = APIClient()
        self.client.force_authenticate(self.me)

    def _create(self, **body):
        return self.client.post("/api/chat/sessions/", {"title": "Hello", **body}, format="json")

    def test_creating_with_a_member_org_starts_the_chat_there(self):
        response = self._create(org=self.beta.id)
        self.assertEqual(response.status_code, 201)
        session = ChatSession.objects.get(id=response.json()["id"])
        self.assertEqual(session.org_id, self.beta.id)
        # The org's own default for sharing applies, as it does on every chat.
        self.assertEqual(session.share_solutions, self.beta.share_by_default)

    def test_creating_with_a_non_member_org_is_refused(self):
        stranger_org = orgs.create(_user("stranger"), "Elsewhere")
        response = self._create(org=stranger_org.id)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "You are not in that organisation."})
        self.assertFalse(ChatSession.objects.filter(user=self.me).exists())

    def test_an_unknown_org_gets_the_same_refusal_as_a_foreign_one(self):
        stranger_org = orgs.create(_user("stranger2"), "Elsewhere2")
        foreign = self._create(org=stranger_org.id)
        unknown = self._create(org=999999)
        self.assertEqual(foreign.status_code, unknown.status_code)
        self.assertEqual(foreign.json(), unknown.json())

    def test_null_makes_a_personal_chat_even_with_an_active_org(self):
        # `acme` is the active org here; an explicit null must not fall back to it.
        self.assertEqual(orgs.active_org_id(self.me), self.acme.id)
        response = self._create(org=None, share_solutions=True)
        self.assertEqual(response.status_code, 201)
        session = ChatSession.objects.get(id=response.json()["id"])
        self.assertIsNone(session.org_id)
        self.assertFalse(session.share_solutions)

    def test_without_the_key_the_chat_takes_the_active_org(self):
        response = self._create()
        self.assertEqual(response.status_code, 201)
        session = ChatSession.objects.get(id=response.json()["id"])
        self.assertEqual(session.org_id, self.acme.id)

    def test_updating_org_is_ignored(self):
        session = ChatSession.objects.create(user=self.me, title="Mine", org=self.acme)
        response = self.client.patch(
            f"/api/chat/sessions/{session.id}/", {"org": self.beta.id}, format="json",
        )
        self.assertEqual(response.status_code, 200)
        session.refresh_from_db()
        self.assertEqual(session.org_id, self.acme.id)
