"""
Organisations: who belongs, who manages, which org a new chat starts in, and
how someone joins (an invitation they accept from their own verified account).
"""
from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, TransactionTestCase
from django.utils import timezone
from rest_framework.test import APITestCase

from chat.models import ChatSession
from core import orgs
from core.models import Membership, OrgInvite, UserProfile
from notifications.models import Notification


def user(name):
    return get_user_model().objects.create_user(username=name, email=f'{name}@example.test',
                                                password='x')


def verified(account):
    """Give an account a proven inbox (what Google sign-in, a password reset or
    an email change records). Accepting an invitation requires this."""
    UserProfile.objects.update_or_create(
        user=account, defaults={'email_verified_at': timezone.now()},
    )
    return account


def join(owner, org, member, role='member'):
    """Invite and accept: the only way someone becomes a member now."""
    orgs.invite(owner, org.id, member.email, role=role)
    invite = OrgInvite.objects.filter(org=org, email=member.email.lower()).latest('id')
    return orgs.respond(member, invite.id, True)


class OrgRuleTests(TestCase):
    def setUp(self):
        self.owner = verified(user('owner'))
        self.member = verified(user('member'))
        self.org = orgs.create(self.owner, 'Acme')
        join(self.owner, self.org, self.member)

    def test_the_creator_owns_it_and_it_becomes_active(self):
        self.assertEqual(orgs.role_of(self.owner.id, self.org.id), 'owner')
        self.assertEqual(orgs.active_org_id(self.owner), self.org.id)

    def test_members_cannot_manage(self):
        with self.assertRaises(orgs.OrgError):
            orgs.invite(self.member, self.org.id, 'someone@example.test')
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
        admin = verified(user('admin'))
        join(self.owner, self.org, admin, role='admin')
        with self.assertRaises(orgs.OrgError):
            orgs.set_role(admin, self.org.id, self.member.id, 'owner')


class InviteTests(TestCase):
    def setUp(self):
        self.owner = verified(user('owner'))
        self.org = orgs.create(self.owner, 'Acme')
        self.invitee = verified(user('invitee'))

    def test_inviting_does_not_create_a_membership(self):
        orgs.invite(self.owner, self.org.id, self.invitee.email)
        self.assertIsNone(orgs.role_of(self.invitee.id, self.org.id))
        self.assertEqual(OrgInvite.objects.filter(org=self.org).count(), 1)

    def test_the_answer_is_the_same_for_a_registered_and_an_unregistered_email(self):
        registered = orgs.invite(self.owner, self.org.id, self.invitee.email)
        unregistered = orgs.invite(self.owner, self.org.id, 'nobody@example.test')
        self.assertEqual(set(registered), set(unregistered))
        self.assertEqual(registered['invited'], self.invitee.email)
        self.assertEqual(unregistered['invited'], 'nobody@example.test')
        self.assertIsInstance(registered['expires_at'], str)

    def test_accept_creates_the_membership_with_the_invited_role(self):
        invite = orgs.invite(self.owner, self.org.id, self.invitee.email, role='admin')
        row = OrgInvite.objects.get(org=self.org, email=self.invitee.email)
        self.assertEqual(orgs.respond(self.invitee, row.id, True),
                         {'org_id': self.org.id, 'role': 'admin'})
        self.assertEqual(orgs.role_of(self.invitee.id, self.org.id), 'admin')
        self.assertIsNotNone(OrgInvite.objects.get(id=row.id).accepted_at)
        self.assertIn('expires_at', invite)

    def test_a_second_accept_is_a_404(self):
        orgs.invite(self.owner, self.org.id, self.invitee.email)
        row = OrgInvite.objects.get(org=self.org)
        orgs.respond(self.invitee, row.id, True)
        with self.assertRaises(orgs.OrgError) as again:
            orgs.respond(self.invitee, row.id, True)
        self.assertEqual(again.exception.status, 404)
        self.assertEqual(Membership.objects.filter(org=self.org, user=self.invitee).count(), 1)

    def test_someone_else_cannot_answer_an_invitation(self):
        orgs.invite(self.owner, self.org.id, self.invitee.email)
        row = OrgInvite.objects.get(org=self.org)
        stranger = verified(user('stranger'))
        for accept in (True, False):
            with self.assertRaises(orgs.OrgError) as refused:
                orgs.respond(stranger, row.id, accept)
            self.assertEqual(refused.exception.status, 404)
        self.assertIsNone(orgs.role_of(stranger.id, self.org.id))
        self.assertIsNone(OrgInvite.objects.get(id=row.id).declined_at)

    def test_an_expired_invitation_cannot_be_accepted(self):
        orgs.invite(self.owner, self.org.id, self.invitee.email)
        OrgInvite.objects.filter(org=self.org).update(
            expires_at=timezone.now() - timedelta(days=1))
        row = OrgInvite.objects.get(org=self.org)
        with self.assertRaises(orgs.OrgError) as expired:
            orgs.respond(self.invitee, row.id, True)
        self.assertEqual(expired.exception.status, 404)
        self.assertIsNone(orgs.role_of(self.invitee.id, self.org.id))
        self.assertEqual(orgs.pending_invites_for(self.invitee)['invites'], [])

    def test_an_unverified_email_cannot_accept_but_can_decline(self):
        unverified = user('unverified')
        orgs.invite(self.owner, self.org.id, unverified.email)
        row = OrgInvite.objects.get(org=self.org)
        with self.assertRaises(orgs.OrgError) as refused:
            orgs.respond(unverified, row.id, True)
        self.assertEqual(refused.exception.status, 403)
        self.assertIsNone(orgs.role_of(unverified.id, self.org.id))
        self.assertFalse(orgs.pending_invites_for(unverified)['invites'][0]['can_accept'])
        self.assertIsNone(orgs.respond(unverified, row.id, False))
        self.assertIsNotNone(OrgInvite.objects.get(id=row.id).declined_at)

    def test_a_second_invite_to_the_same_person_is_idempotent(self):
        orgs.invite(self.owner, self.org.id, self.invitee.email)
        orgs.invite(self.owner, self.org.id, self.invitee.email.upper())
        self.assertEqual(OrgInvite.objects.filter(org=self.org).count(), 1)

    def test_re_inviting_with_a_new_role_updates_the_open_offer(self):
        orgs.invite(self.owner, self.org.id, self.invitee.email, role='member')
        orgs.invite(self.owner, self.org.id, self.invitee.email, role='admin')
        self.assertEqual(OrgInvite.objects.get(org=self.org).role, 'admin')

    def test_an_existing_member_cannot_be_invited(self):
        join(self.owner, self.org, self.invitee)
        with self.assertRaises(orgs.OrgError):
            orgs.invite(self.owner, self.org.id, self.invitee.email)

    def test_admin_curator_or_member_roles_can_be_offered(self):
        """Curator joined the invitable roles in K2.1; owner is still made only
        by an owner, through set_role, never offered by invitation."""
        for role in ('admin', 'curator', 'member'):
            orgs.invite(self.owner, self.org.id, self.invitee.email, role=role)
            self.assertEqual(OrgInvite.objects.get(org=self.org).role, role)
        with self.assertRaises(orgs.OrgError):
            orgs.invite(self.owner, self.org.id, self.invitee.email, role='owner')

    def test_a_registered_invitee_is_told_where_to_answer(self):
        orgs.invite(self.owner, self.org.id, self.invitee.email)
        note = Notification.objects.get(user=self.invitee)
        self.assertEqual(note.data['action_url'], '/team?tab=team')
        self.assertIn('Acme', note.title)

    def test_an_unregistered_address_gets_no_notification(self):
        orgs.invite(self.owner, self.org.id, 'nobody@example.test')
        self.assertFalse(Notification.objects.exists())

    def test_revoking_closes_the_invitation(self):
        orgs.invite(self.owner, self.org.id, self.invitee.email)
        row = OrgInvite.objects.get(org=self.org)
        orgs.revoke_invite(self.owner, self.org.id, row.id)
        with self.assertRaises(orgs.OrgError) as gone:
            orgs.respond(self.invitee, row.id, True)
        self.assertEqual(gone.exception.status, 404)

    def test_only_managers_can_revoke_or_list_invitations(self):
        orgs.invite(self.owner, self.org.id, self.invitee.email)
        row = OrgInvite.objects.get(org=self.org)
        member = verified(user('member'))
        join(self.owner, self.org, member)
        with self.assertRaises(orgs.OrgError) as cant_revoke:
            orgs.revoke_invite(member, self.org.id, row.id)
        self.assertEqual(cant_revoke.exception.status, 403)
        with self.assertRaises(orgs.OrgError) as cant_list:
            orgs.invites_for_org(member, self.org.id)
        self.assertEqual(cant_list.exception.status, 403)
        listed = orgs.invites_for_org(self.owner, self.org.id)
        self.assertEqual([i['email'] for i in listed['invites']], [self.invitee.email])

    def test_revoking_an_unknown_or_foreign_invitation_is_one_404(self):
        stranger = user('stranger')
        with self.assertRaises(orgs.OrgError) as missing:
            orgs.revoke_invite(self.owner, self.org.id, 999999)
        with self.assertRaises(orgs.OrgError) as foreign:
            orgs.revoke_invite(stranger, self.org.id, 999999)
        self.assertEqual((missing.exception.status, foreign.exception.status), (404, 404))

    def test_my_invitations_show_only_my_own_pending_offers(self):
        orgs.invite(self.owner, self.org.id, self.invitee.email, role='admin')
        mine = orgs.pending_invites_for(self.invitee)
        self.assertEqual(len(mine['invites']), 1)
        item = mine['invites'][0]
        self.assertEqual((item['org_name'], item['role'], item['invited_by_name']),
                         ('Acme', 'admin', 'owner'))
        self.assertTrue(item['can_accept'])
        self.assertEqual(orgs.pending_invites_for(self.owner)['invites'], [])

    def test_email_matching_ignores_case(self):
        orgs.invite(self.owner, self.org.id, 'Invitee@Example.Test')
        self.assertEqual(len(orgs.pending_invites_for(self.invitee)['invites']), 1)

    def test_an_empty_email_is_refused(self):
        with self.assertRaises(orgs.OrgError):
            orgs.invite(self.owner, self.org.id, '   ')

    def test_email_verification_is_read_from_the_profile(self):
        plain = user('plain')
        self.assertFalse(orgs.email_verified(plain))
        verified(plain)
        self.assertTrue(orgs.email_verified(plain))


class LastOwnerGuardTests(TestCase):
    def setUp(self):
        self.a = verified(user('owner_a'))
        self.b = verified(user('owner_b'))
        self.org = orgs.create(self.a, 'Acme')
        join(self.a, self.org, self.b, role='admin')
        # `invite` offers only admin or member, so the second owner is made here.
        Membership.objects.filter(org=self.org, user=self.b).update(role='owner')

    def test_two_owners_cannot_both_leave(self):
        """Pins the sequential case. The concurrent one is guarded by
        `orgs._lock_owners` (SELECT ... FOR UPDATE inside the transaction),
        which Postgres enforces. SQLite ignores FOR UPDATE, so a true race
        cannot be forced in this suite."""
        orgs.remove_member(self.a, self.org.id, self.a.id)
        with self.assertRaises(orgs.OrgError):
            orgs.remove_member(self.b, self.org.id, self.b.id)
        self.assertEqual(orgs.role_of(self.b.id, self.org.id), 'owner')

    def test_the_last_owner_cannot_be_demoted(self):
        orgs.remove_member(self.a, self.org.id, self.a.id)
        with self.assertRaises(orgs.OrgError):
            orgs.set_role(self.b, self.org.id, self.b.id, 'admin')
        self.assertEqual(orgs.role_of(self.b.id, self.org.id), 'owner')

    def test_an_owner_can_be_demoted_while_another_owner_remains(self):
        orgs.set_role(self.a, self.org.id, self.b.id, 'admin')
        self.assertEqual(orgs.role_of(self.b.id, self.org.id), 'admin')


class ChatOrgTests(APITestCase):
    def setUp(self):
        self.owner = verified(user('owner'))
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
        member = verified(user('member'))
        resp = self.client.post(f'/api/orgs/{self.org.id}/members/', {'email': member.email},
                                format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertIsNone(orgs.role_of(member.id, self.org.id))
        self.client.force_authenticate(member)
        self.assertEqual(self.client.delete(f'/api/orgs/{self.org.id}/').status_code, 404)
        invite_id = OrgInvite.objects.get(org=self.org).id
        self.assertEqual(self.client.post(f'/api/orgs/invites/{invite_id}/',
                                          {'accept': True}, format='json').status_code, 200)
        self.assertEqual(self.client.delete(f'/api/orgs/{self.org.id}/').status_code, 403)
        self.client.force_authenticate(user('stranger'))
        self.assertEqual(self.client.get(f'/api/orgs/{self.org.id}/members/').status_code, 404)


class InviteEndpointTests(APITestCase):
    def setUp(self):
        self.owner = verified(user('owner'))
        self.org = orgs.create(self.owner, 'Acme')
        self.invitee = verified(user('invitee'))
        self.client.force_authenticate(self.owner)

    def post_invite(self, email, role=None):
        body = {'email': email, **({'role': role} if role else {})}
        return self.client.post(f'/api/orgs/{self.org.id}/members/', body, format='json')

    def test_inviting_answers_201_with_the_same_shape_for_either_email(self):
        known = self.post_invite(self.invitee.email)
        unknown = self.post_invite('nobody@example.test')
        self.assertEqual(known.status_code, 201)
        self.assertEqual(unknown.status_code, 201)
        self.assertEqual(set(known.json()), set(unknown.json()))
        self.assertIsNone(orgs.role_of(self.invitee.id, self.org.id))

    def test_curator_can_be_offered_and_an_owner_cannot(self):
        self.assertEqual(self.post_invite(self.invitee.email, 'curator').status_code, 201)
        self.assertEqual(self.post_invite(self.invitee.email, 'owner').status_code, 400)

    def test_the_invitee_lists_and_accepts(self):
        self.post_invite(self.invitee.email, 'admin')
        self.client.force_authenticate(self.invitee)
        listed = self.client.get('/api/orgs/invites/').json()
        self.assertEqual(len(listed['invites']), 1)
        self.assertFalse(listed['truncated'])
        invite_id = listed['invites'][0]['id']
        self.assertEqual(self.client.post(f'/api/orgs/invites/{invite_id}/', {'accept': 'yes'},
                                          format='json').status_code, 400)
        resp = self.client.post(f'/api/orgs/invites/{invite_id}/', {'accept': True}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {'org_id': self.org.id, 'role': 'admin'})

    def test_declining_is_204_and_grants_nothing(self):
        self.post_invite(self.invitee.email)
        invite_id = OrgInvite.objects.get(org=self.org).id
        self.client.force_authenticate(self.invitee)
        resp = self.client.post(f'/api/orgs/invites/{invite_id}/', {'accept': False},
                                format='json')
        self.assertEqual(resp.status_code, 204)
        self.assertIsNone(orgs.role_of(self.invitee.id, self.org.id))

    def test_someone_elses_invitation_is_a_404(self):
        self.post_invite(self.invitee.email)
        invite_id = OrgInvite.objects.get(org=self.org).id
        self.client.force_authenticate(verified(user('stranger')))
        resp = self.client.post(f'/api/orgs/invites/{invite_id}/', {'accept': True},
                                format='json')
        self.assertEqual(resp.status_code, 404)

    def test_managers_list_and_revoke_through_the_org(self):
        self.post_invite(self.invitee.email)
        invite_id = OrgInvite.objects.get(org=self.org).id
        listed = self.client.get(f'/api/orgs/{self.org.id}/invites/').json()
        self.assertEqual([i['email'] for i in listed['invites']], [self.invitee.email])
        resp = self.client.delete(f'/api/orgs/{self.org.id}/invites/{invite_id}/')
        self.assertEqual(resp.status_code, 204)
        self.assertEqual(self.client.get(f'/api/orgs/{self.org.id}/invites/').json()['invites'], [])

    def test_a_plain_member_cannot_list_invitations(self):
        member = verified(user('member'))
        join(self.owner, self.org, member)
        self.client.force_authenticate(member)
        self.assertEqual(self.client.get(f'/api/orgs/{self.org.id}/invites/').status_code, 403)


class OrgSettingsTests(TestCase):
    """Capture and review settings (K2.1), and the curator role beside them."""

    def setUp(self):
        self.owner = verified(user('owner'))
        self.org = orgs.create(self.owner, 'Acme')
        self.admin = verified(user('admin'))
        join(self.owner, self.org, self.admin, role='admin')
        self.curator = verified(user('curator'))
        join(self.owner, self.org, self.curator, role='curator')
        self.member = verified(user('member'))
        join(self.owner, self.org, self.member)

    def test_a_new_org_suggests_captured_fixes_and_shares_at_once(self):
        self.assertEqual((self.org.capture_mode, self.org.review_policy), ('suggest', 'open'))

    def test_a_manager_sets_both_settings(self):
        orgs.update(self.admin, self.org.id, capture_mode='auto', review_policy='curated')
        self.org.refresh_from_db()
        self.assertEqual((self.org.capture_mode, self.org.review_policy), ('auto', 'curated'))

    def test_a_curator_or_member_cannot_change_the_settings(self):
        for actor in (self.curator, self.member):
            with self.assertRaises(orgs.OrgError) as caught:
                orgs.update(actor, self.org.id, capture_mode='auto')
            self.assertEqual(caught.exception.status, 403)

    def test_a_bad_value_refuses_the_whole_update(self):
        with self.assertRaises(orgs.OrgError) as caught:
            orgs.update(self.owner, self.org.id, name='Renamed', review_policy='sometimes')
        self.assertEqual(caught.exception.status, 400)
        self.org.refresh_from_db()
        self.assertEqual((self.org.name, self.org.review_policy), ('Acme', 'open'))

    def test_the_settings_are_listed_with_the_org(self):
        row = next(o for o in orgs.orgs_for(self.owner) if o['id'] == self.org.id)
        self.assertEqual((row['capture_mode'], row['review_policy']), ('suggest', 'open'))

    def test_curator_is_a_curating_role_and_not_a_managing_one(self):
        self.assertTrue(orgs.is_curator(self.owner.id, self.org.id))
        self.assertTrue(orgs.is_curator(self.admin.id, self.org.id))
        self.assertTrue(orgs.is_curator(self.curator.id, self.org.id))
        self.assertFalse(orgs.is_curator(self.member.id, self.org.id))
        self.assertFalse(orgs.is_manager(self.curator.id, self.org.id))

    def test_only_an_owner_or_admin_can_make_a_curator(self):
        orgs.set_role(self.owner, self.org.id, self.member.id, 'curator')
        self.assertEqual(orgs.role_of(self.member.id, self.org.id), 'curator')
        with self.assertRaises(orgs.OrgError) as caught:
            orgs.set_role(self.curator, self.org.id, self.member.id, 'admin')
        self.assertEqual(caught.exception.status, 403)
        with self.assertRaises(orgs.OrgError):
            orgs.set_role(self.owner, self.org.id, self.member.id, 'boss')


class CaptureModeMigrationTests(TransactionTestCase):
    """Migration 0016: orgs that exist keep today's behaviour (`auto`), and
    orgs made afterwards default to `suggest`. Runs the real migration, both
    directions, on the test database."""

    BEFORE = [('core', '0015_orginvite')]
    AFTER = [('core', '0016_org_capture_and_curators')]

    def test_existing_orgs_become_auto_and_new_ones_suggest(self):
        from core.models import Organization

        executor = MigrationExecutor(connection)
        executor.migrate(self.BEFORE)
        try:
            historical = executor.loader.project_state(self.BEFORE).apps.get_model(
                'core', 'Organization')
            existing_id = historical.objects.create(name='Existing team').id

            executor = MigrationExecutor(connection)
            executor.migrate(self.AFTER)
            existing = Organization.objects.get(id=existing_id)
            self.assertEqual((existing.capture_mode, existing.review_policy), ('auto', 'open'))

            fresh = Organization.objects.create(name='New team')
            self.assertEqual((fresh.capture_mode, fresh.review_policy), ('suggest', 'open'))
        finally:
            executor = MigrationExecutor(connection)
            executor.loader.build_graph()
            executor.migrate(executor.loader.graph.leaf_nodes())
