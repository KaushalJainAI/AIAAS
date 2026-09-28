"""
Organisations: who belongs, who manages, and which org a new chat starts in.
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APITestCase

from chat.models import ChatSession
from core import orgs


def user(name):
    return get_user_model().objects.create_user(username=name, email=f'{name}@example.test',
                                                password='x')


class OrgRuleTests(TestCase):
    def setUp(self):
        self.owner = user('owner')
        self.member = user('member')
        self.org = orgs.create(self.owner, 'Acme')
        orgs.add_member(self.owner, self.org.id, self.member.email)

    def test_the_creator_owns_it_and_it_becomes_active(self):
        self.assertEqual(orgs.role_of(self.owner.id, self.org.id), 'owner')
        self.assertEqual(orgs.active_org_id(self.owner), self.org.id)

    def test_members_cannot_manage(self):
        with self.assertRaises(orgs.OrgError):
            orgs.add_member(self.member, self.org.id, 'someone@example.test')
        with self.assertRaises(orgs.OrgError):
            orgs.update(self.member, self.org.id, name='Mine now')

    def test_the_last_owner_cannot_leave(self):
        with self.assertRaises(orgs.OrgError):
            orgs.remove_member(self.owner, self.org.id, self.owner.id)

    def test_leaving_clears_the_active_org(self):
        orgs.set_active(self.member, self.org.id)
        orgs.remove_member(self.member, self.org.id, self.member.id)
        self.assertIsNone(orgs.active_org_id(self.member))

    def test_a_foreign_org_is_indistinguishable_from_a_missing_one(self):
        stranger = user('stranger')
        with self.assertRaises(orgs.OrgError) as foreign:
            orgs.get_for_member(stranger, self.org.id)
        with self.assertRaises(orgs.OrgError) as missing:
            orgs.get_for_member(stranger, 999999)
        self.assertEqual((foreign.exception.status, str(foreign.exception)),
                         (missing.exception.status, str(missing.exception)))

    def test_admins_cannot_make_owners(self):
        admin = user('admin')
        orgs.add_member(self.owner, self.org.id, admin.email, role='admin')
        with self.assertRaises(orgs.OrgError):
            orgs.set_role(admin, self.org.id, self.member.id, 'owner')


class ChatOrgTests(APITestCase):
    def setUp(self):
        self.owner = user('owner')
        self.org = orgs.create(self.owner, 'Acme')
        self.client.force_authenticate(self.owner)

    def create_chat(self, **extra):
        resp = self.client.post('/api/chat/sessions/', {'title': 'x', **extra}, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        return resp.json()

    def test_a_new_chat_starts_in_the_active_org_sharing_by_default(self):
        body = self.create_chat()
        self.assertEqual(body['org'], self.org.id)
        self.assertEqual(body['org_name'], 'Acme')
        self.assertTrue(body['share_solutions'])

    def test_the_share_switch_can_be_flipped_but_the_org_cannot_be_moved(self):
        body = self.create_chat()
        other = orgs.create(self.owner, 'Other')
        resp = self.client.patch(f"/api/chat/sessions/{body['id']}/",
                                 {'share_solutions': False, 'org': other.id}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        session = ChatSession.objects.get(id=body['id'])
        self.assertFalse(session.share_solutions)
        self.assertEqual(session.org_id, self.org.id)

    def test_a_personal_chat_has_no_org(self):
        orgs.set_active(self.owner, None)
        body = self.create_chat()
        self.assertIsNone(body['org'])
        self.assertFalse(body['share_solutions'])

    def test_org_endpoints(self):
        listing = self.client.get('/api/orgs/').json()
        self.assertEqual(listing['active_org_id'], self.org.id)
        member = user('member')
        resp = self.client.post(f'/api/orgs/{self.org.id}/members/', {'email': member.email},
                                format='json')
        self.assertEqual(resp.status_code, 201)
        self.client.force_authenticate(member)
        self.assertEqual(self.client.delete(f'/api/orgs/{self.org.id}/').status_code, 403)
        self.client.force_authenticate(user('stranger'))
        self.assertEqual(self.client.get(f'/api/orgs/{self.org.id}/members/').status_code, 404)
