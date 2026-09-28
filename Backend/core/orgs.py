"""
Organisations: who belongs, in what role, and which org a user is "in".

The one rule: **membership is read live, on every check.** Nothing caches the
set of orgs a user belongs to — not a token claim, not a process cache —
because the thing an org boundary protects is org data, and a removed member
who can still read it for five minutes has already leaked it. One indexed
query per check is the price, and it is small.

Every function that takes an `actor` enforces the actor's role itself, so a
view cannot forget to. Errors are `OrgError` with a message fit to show.
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db import transaction

from .models import Membership, Organization, UserProfile

MANAGERS = ('owner', 'admin')


class OrgError(Exception):
    """A refused org operation. `status` is the HTTP code a view should use."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


# ── Reads ────────────────────────────────────────────────────────────────────

def role_of(user_id, org_id) -> str | None:
    """The user's role in the org, or None when they are not a member."""
    if not user_id or not org_id:
        return None
    return (Membership.objects
            .filter(user_id=user_id, org_id=org_id)
            .values_list('role', flat=True)
            .first())


def is_member(user_id, org_id) -> bool:
    return role_of(user_id, org_id) is not None


def is_manager(user_id, org_id) -> bool:
    return role_of(user_id, org_id) in MANAGERS


def orgs_for(user) -> list[dict]:
    """The orgs this user belongs to, with their role, name order."""
    rows = (Membership.objects
            .filter(user=user)
            .select_related('org')
            .order_by('org__name'))
    return [{'id': m.org_id, 'name': m.org.name, 'role': m.role,
             'share_by_default': m.org.share_by_default} for m in rows]


def get_for_member(user, org_id) -> Organization:
    """The org, if the user belongs to it. Unknown and foreign ids are the same
    404, so an org id cannot be probed for existence."""
    org = Organization.objects.filter(id=org_id, memberships__user=user).first()
    if org is None:
        raise OrgError('No such organisation.', status=404)
    return org


def active_org_id(user) -> int | None:
    """The org new chats start in — only while the user is still a member.

    A stale `active_org` (removed since it was set) reads as None rather than
    as the org, because this value is copied onto new chats and a chat
    stamped with an org its owner has left would be a way back in.
    """
    org_id = (UserProfile.objects
              .filter(user=user)
              .values_list('active_org_id', flat=True)
              .first())
    if org_id and is_member(user.id, org_id):
        return org_id
    return None


def members(user, org_id) -> list[dict]:
    get_for_member(user, org_id)
    rows = (Membership.objects
            .filter(org_id=org_id)
            .select_related('user')
            .order_by('created_at'))
    return [{'user_id': m.user_id, 'email': m.user.email,
             'name': m.user.get_full_name() or m.user.username,
             'role': m.role} for m in rows]


# ── Writes ───────────────────────────────────────────────────────────────────

def create(user, name: str) -> Organization:
    name = (name or '').strip()[:120]
    if not name:
        raise OrgError('Give the organisation a name.')
    with transaction.atomic():
        org = Organization.objects.create(name=name, created_by=user)
        Membership.objects.create(org=org, user=user, role='owner')
        _set_profile_org(user, org.id)
    return org


def update(actor, org_id, *, name: str | None = None,
           share_by_default: bool | None = None) -> Organization:
    org = get_for_member(actor, org_id)
    if not is_manager(actor.id, org_id):
        raise OrgError('Only an owner or admin can change the organisation.', 403)
    fields = []
    if name is not None:
        name = name.strip()[:120]
        if not name:
            raise OrgError('Give the organisation a name.')
        org.name = name
        fields.append('name')
    if share_by_default is not None:
        org.share_by_default = bool(share_by_default)
        fields.append('share_by_default')
    if fields:
        org.save(update_fields=fields)
    return org


def delete(actor, org_id) -> None:
    """Delete the org and — by cascade — everything it owns, solutions included."""
    get_for_member(actor, org_id)
    if role_of(actor.id, org_id) != 'owner':
        raise OrgError('Only an owner can delete the organisation.', 403)
    Organization.objects.filter(id=org_id).delete()


def add_member(actor, org_id, email: str, role: str = 'member') -> dict:
    """Add an existing account by email.

    Says plainly when no account has that email. That does tell an org admin
    whether an address is registered — accepted, because only a signed-in
    manager of an org can ask, and an invite flow that hid it would have to
    send mail this install may not be configured to send.
    """
    get_for_member(actor, org_id)
    if not is_manager(actor.id, org_id):
        raise OrgError('Only an owner or admin can add people.', 403)
    if role not in ('admin', 'member'):
        raise OrgError('Role must be admin or member.')
    email = (email or '').strip()
    user = get_user_model().objects.filter(email__iexact=email).first() if email else None
    if user is None:
        raise OrgError('No account uses that email. Ask them to sign up first.')
    membership, created = Membership.objects.get_or_create(
        org_id=org_id, user=user, defaults={'role': role},
    )
    if not created:
        raise OrgError('That person is already a member.')
    return {'user_id': user.id, 'email': user.email, 'role': membership.role}


def set_role(actor, org_id, user_id, role: str) -> None:
    get_for_member(actor, org_id)
    actor_role = role_of(actor.id, org_id)
    if actor_role not in MANAGERS:
        raise OrgError('Only an owner or admin can change roles.', 403)
    if role not in ('owner', 'admin', 'member'):
        raise OrgError('Unknown role.')
    target = Membership.objects.filter(org_id=org_id, user_id=user_id).first()
    if target is None:
        raise OrgError('No such member.', 404)
    # Admins manage members; only an owner makes or unmakes owners.
    if 'owner' in (role, target.role) and actor_role != 'owner':
        raise OrgError('Only an owner can change who owns the organisation.', 403)
    if target.role == 'owner' and role != 'owner' and _owner_count(org_id) == 1:
        raise OrgError('An organisation needs at least one owner.')
    target.role = role
    target.save(update_fields=['role'])


def remove_member(actor, org_id, user_id) -> None:
    """Remove someone (a manager), or leave (anyone, removing themself).

    Their access to org data ends with this row: every read checks membership
    live. Their `active_org` is cleared so new chats stop starting in it.
    """
    get_for_member(actor, org_id)
    leaving = int(user_id) == actor.id
    actor_role = role_of(actor.id, org_id)
    if not leaving and actor_role not in MANAGERS:
        raise OrgError('Only an owner or admin can remove people.', 403)
    target = Membership.objects.filter(org_id=org_id, user_id=user_id).first()
    if target is None:
        raise OrgError('No such member.', 404)
    if target.role == 'owner' and not leaving and actor_role != 'owner':
        raise OrgError('Only an owner can remove an owner.', 403)
    if target.role == 'owner' and _owner_count(org_id) == 1:
        raise OrgError('Make someone else an owner before the last owner leaves.')
    with transaction.atomic():
        target.delete()
        UserProfile.objects.filter(user_id=user_id, active_org_id=org_id).update(
            active_org=None,
        )


def set_active(user, org_id) -> int | None:
    """Pick the org new chats start in; None means personal (no org)."""
    if org_id in (None, '', 0):
        _set_profile_org(user, None)
        return None
    get_for_member(user, org_id)
    _set_profile_org(user, int(org_id))
    return int(org_id)


def _set_profile_org(user, org_id) -> None:
    # get_or_create: not every account has a profile row yet, and an update
    # that matches nothing would silently leave the choice unsaved.
    profile, _ = UserProfile.objects.get_or_create(user=user)
    profile.active_org_id = org_id
    profile.save(update_fields=['active_org'])


def _owner_count(org_id) -> int:
    return Membership.objects.filter(org_id=org_id, role='owner').count()
