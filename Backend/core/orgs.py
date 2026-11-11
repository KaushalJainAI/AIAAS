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

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .models import Membership, Organization, OrgInvite, UserProfile

MANAGERS = ('owner', 'admin')
#: Who approves and edits the team's solutions. A curator cannot manage people.
CURATORS = ('owner', 'admin', 'curator')
#: Roles an invitation may offer.
INVITABLE_ROLES = ('admin', 'curator', 'member')
#: Roles `set_role` accepts (an owner is made by an owner, see `set_role`).
ASSIGNABLE_ROLES = ('owner', 'admin', 'curator', 'member')
#: Org settings a manager may change, and what they may be set to.
CAPTURE_MODES = ('suggest', 'auto')
REVIEW_POLICIES = ('open', 'curated')
#: How long an invitation stays open before it has to be sent again.
INVITE_DAYS = 14
#: Cap for the invite lists (function views have no automatic pagination).
INVITE_LIST_CAP = 200
#: Where the invitation notification points: the Team tab of the Team
#: knowledge page, where the Accept / Decline card is.
INVITE_ACTION_URL = '/team?tab=team'


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


def is_curator(user_id, org_id) -> bool:
    """May approve, edit and retract the org's shared solutions."""
    return role_of(user_id, org_id) in CURATORS


def orgs_for(user) -> list[dict]:
    """The orgs this user belongs to, with their role, name order."""
    rows = (Membership.objects
            .filter(user=user)
            .select_related('org')
            .order_by('org__name'))
    return [{'id': m.org_id, 'name': m.org.name, 'role': m.role,
             'share_by_default': m.org.share_by_default,
             'capture_mode': m.org.capture_mode,
             'review_policy': m.org.review_policy} for m in rows]


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
           share_by_default: bool | None = None,
           capture_mode: str | None = None,
           review_policy: str | None = None) -> Organization:
    org = get_for_member(actor, org_id)
    if not is_manager(actor.id, org_id):
        raise OrgError('Only an owner or admin can change the organisation.', 403)
    # Validate every setting before writing any, so a refused request changes nothing.
    if capture_mode is not None and capture_mode not in CAPTURE_MODES:
        raise OrgError(f'capture_mode must be one of {", ".join(CAPTURE_MODES)}.')
    if review_policy is not None and review_policy not in REVIEW_POLICIES:
        raise OrgError(f'review_policy must be one of {", ".join(REVIEW_POLICIES)}.')
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
    if capture_mode is not None:
        org.capture_mode = capture_mode
        fields.append('capture_mode')
    if review_policy is not None:
        org.review_policy = review_policy
        fields.append('review_policy')
    if fields:
        org.save(update_fields=fields)
    return org


def delete(actor, org_id) -> None:
    """Delete the org and — by cascade — everything it owns, solutions included."""
    get_for_member(actor, org_id)
    if role_of(actor.id, org_id) != 'owner':
        raise OrgError('Only an owner can delete the organisation.', 403)
    Organization.objects.filter(id=org_id).delete()


def email_verified(user) -> bool:
    """Whether this account has proven it holds its email address.

    The project's one record of that is `UserProfile.email_verified_at`
    (`allauth` runs with `ACCOUNT_EMAIL_VERIFICATION = 'none'` and its
    `EmailAddress` table is never consulted). It is set by Google sign-in
    (Google vouches for the address), a password reset, an OTP-confirmed
    password change, and an email change. Signup does not set it, and an
    account with no profile row is unverified.
    """
    return UserProfile.objects.filter(
        user_id=user.id, email_verified_at__isnull=False,
    ).exists()


def _pending_q(now):
    return Q(accepted_at__isnull=True, declined_at__isnull=True, expires_at__gt=now)


def invite(actor, org_id, email: str, role: str = 'member') -> dict:
    """Offer membership to an email address. Nobody is added by this.

    The answer is the same whether or not an account uses the address, so the
    endpoint does not reveal registered emails to the people it is not meant
    for. The one thing it does say — that the address is already a member — is
    shown only to a manager, who can already read the member list.
    """
    get_for_member(actor, org_id)
    if not is_manager(actor.id, org_id):
        raise OrgError('Only an owner or admin can invite people.', 403)
    if role not in INVITABLE_ROLES:
        raise OrgError('Role must be admin, curator or member.')
    email = (email or '').strip().lower()
    if not email:
        raise OrgError('Enter an email address.')
    now = timezone.now()
    with transaction.atomic():
        # Locking the org row serialises invites to one org, so two requests
        # for the same address cannot both see "no pending invite" and both
        # create one. (SQLite ignores FOR UPDATE; its IMMEDIATE transaction
        # gives the same serialisation.)
        org = Organization.objects.select_for_update().get(id=org_id)
        if Membership.objects.filter(org_id=org_id, user__email__iexact=email).exists():
            raise OrgError('That person is already a member.')
        existing = (OrgInvite.objects
                    .filter(org_id=org_id, email=email)
                    .filter(_pending_q(now))
                    .order_by('-created_at')
                    .first())
        if existing is not None:
            # Idempotent. A changed role is applied to the open offer.
            if existing.role != role:
                existing.role = role
                existing.save(update_fields=['role'])
            return {'invited': email, 'expires_at': existing.expires_at.isoformat()}
        row = OrgInvite.objects.create(
            org=org, email=email, role=role, invited_by=actor,
            expires_at=now + timedelta(days=INVITE_DAYS),
        )
    # After the commit, so the notification never points at an invite that
    # does not exist. Only a registered address gets one; the answer is the same.
    account = get_user_model().objects.filter(email__iexact=email).first()
    if account is not None:
        from notifications.utils import create_notification

        inviter = actor.get_full_name() or actor.username
        create_notification(
            account, 'system', f'Invitation to {org.name}',
            f'{inviter} invited you to join {org.name} as {role}. '
            'Accept or decline it on the Team knowledge page.',
            data={'action_url': INVITE_ACTION_URL},
            send_email=False,  # email belongs to the daily digest alone
        )
    return {'invited': email, 'expires_at': row.expires_at.isoformat()}


def pending_invites_for(user) -> dict:
    """The invitations this account can answer, as `{invites, truncated}`.

    Matched on the account's own email, so a user sees only offers made to
    them. `can_accept` says whether accepting would succeed now (it needs a
    verified email), so the screen can explain rather than fail on click.
    """
    if not user.email:
        return {'invites': [], 'truncated': False}
    now = timezone.now()
    rows = list(OrgInvite.objects
                .filter(email=user.email.strip().lower())
                .filter(_pending_q(now))
                .select_related('org', 'invited_by')
                .order_by('-created_at')[:INVITE_LIST_CAP + 1])
    verified = email_verified(user)
    return {
        'invites': [{
            'id': r.id, 'org_id': r.org_id, 'org_name': r.org.name, 'role': r.role,
            'invited_by_name': _name_of(r.invited_by),
            'expires_at': r.expires_at.isoformat(),
            'can_accept': verified,
        } for r in rows[:INVITE_LIST_CAP]],
        'truncated': len(rows) > INVITE_LIST_CAP,
    }


def invites_for_org(actor, org_id) -> dict:
    """Pending invitations of one org, for its managers: `{invites, truncated}`."""
    get_for_member(actor, org_id)
    if not is_manager(actor.id, org_id):
        raise OrgError('Only an owner or admin can see invitations.', 403)
    rows = list(OrgInvite.objects
                .filter(org_id=org_id)
                .filter(_pending_q(timezone.now()))
                .select_related('invited_by')
                .order_by('-created_at')[:INVITE_LIST_CAP + 1])
    return {
        'invites': [{
            'id': r.id, 'email': r.email, 'role': r.role,
            'invited_by_name': _name_of(r.invited_by),
            'created_at': r.created_at.isoformat(),
            'expires_at': r.expires_at.isoformat(),
        } for r in rows[:INVITE_LIST_CAP]],
        'truncated': len(rows) > INVITE_LIST_CAP,
    }


def respond(user, invite_id, accept: bool) -> dict | None:
    """Accept or decline an invitation addressed to this account.

    Someone else's invitation, an expired one and an unknown id are all the
    same 404. Accepting needs a verified email, because the invitation is only
    as good as the address it was sent to. Declining grants nothing, so it is
    open to an unverified account too, which lets it clear its list. Returns
    `{org_id, role}` on accept and None on decline.
    """
    now = timezone.now()
    if not user.email:
        raise OrgError('No such invitation.', status=404)
    own = (OrgInvite.objects
           .filter(id=invite_id, email=user.email.strip().lower())
           .filter(_pending_q(now)))
    if not accept:
        if not own.update(declined_at=now):
            raise OrgError('No such invitation.', status=404)
        return None
    if not own.exists():
        raise OrgError('No such invitation.', status=404)
    if not email_verified(user):
        raise OrgError('Verify your email address to accept invitations.', status=403)
    with transaction.atomic():
        # A conditional UPDATE claims the offer: of two simultaneous accepts,
        # only one matches the pending filter and gets to create the membership.
        claimed = own.filter(id=invite_id).update(accepted_at=now)
        if not claimed:
            raise OrgError('No such invitation.', status=404)
        row = OrgInvite.objects.only('org_id', 'role').get(id=invite_id)
        membership, _ = Membership.objects.get_or_create(
            org_id=row.org_id, user=user, defaults={'role': row.role},
        )
    return {'org_id': row.org_id, 'role': membership.role}


def revoke_invite(actor, org_id, invite_id) -> None:
    """A manager withdraws an open invitation. Unknown ids and invitations
    already answered are the same 404."""
    get_for_member(actor, org_id)
    if not is_manager(actor.id, org_id):
        raise OrgError('Only an owner or admin can revoke invitations.', 403)
    closed = (OrgInvite.objects
              .filter(id=invite_id, org_id=org_id)
              .filter(_pending_q(timezone.now()))
              .update(declined_at=timezone.now()))
    if not closed:
        raise OrgError('No such invitation.', status=404)


def _name_of(user) -> str | None:
    if user is None:
        return None
    return user.get_full_name() or user.username


def set_role(actor, org_id, user_id, role: str) -> None:
    get_for_member(actor, org_id)
    with transaction.atomic():
        # Owners are locked before anything is read or written, so two
        # concurrent demotions cannot each see "two owners" and both proceed.
        owners = _lock_owners(org_id)
        actor_role = role_of(actor.id, org_id)
        if actor_role not in MANAGERS:
            raise OrgError('Only an owner or admin can change roles.', 403)
        if role not in ASSIGNABLE_ROLES:
            raise OrgError('Unknown role.')
        target = Membership.objects.filter(org_id=org_id, user_id=user_id).first()
        if target is None:
            raise OrgError('No such member.', 404)
        # Admins manage members; only an owner makes or unmakes owners.
        if 'owner' in (role, target.role) and actor_role != 'owner':
            raise OrgError('Only an owner can change who owns the organisation.', 403)
        if target.role == 'owner' and role != 'owner' and len(owners) == 1:
            raise OrgError('An organisation needs at least one owner.')
        target.role = role
        target.save(update_fields=['role'])


def remove_member(actor, org_id, user_id) -> None:
    """Remove someone (a manager), or leave (anyone, removing themself).

    Their access to org data ends with this row: every read checks membership
    live. Their `active_org` is cleared so new chats stop starting in it.

    The last-owner check and the delete share one transaction with the owner
    rows locked (`_lock_owners`), so two owners leaving at once cannot both see
    a second owner and both go. Postgres enforces that lock; SQLite ignores
    FOR UPDATE, and its IMMEDIATE transactions serialise writers instead.
    """
    get_for_member(actor, org_id)
    leaving = int(user_id) == actor.id
    with transaction.atomic():
        owners = _lock_owners(org_id)
        actor_role = role_of(actor.id, org_id)
        if not leaving and actor_role not in MANAGERS:
            raise OrgError('Only an owner or admin can remove people.', 403)
        target = Membership.objects.filter(org_id=org_id, user_id=user_id).first()
        if target is None:
            raise OrgError('No such member.', 404)
        if target.role == 'owner' and not leaving and actor_role != 'owner':
            raise OrgError('Only an owner can remove an owner.', 403)
        if target.role == 'owner' and len(owners) == 1:
            raise OrgError('Make someone else an owner before the last owner leaves.')
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


def _lock_owners(org_id) -> list:
    """The org's owner rows, locked until the enclosing transaction ends.

    Callers must be inside `transaction.atomic()`: the lock is what makes the
    count they take from this list true for the rest of the write.
    """
    return list(Membership.objects.select_for_update()
                .filter(org_id=org_id, role='owner'))
