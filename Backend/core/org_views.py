"""
`/api/orgs/` — create an organisation, manage its members, pick the active one.

Thin: every rule (who may do what, live membership, 404 for foreign ids) lives
in `core/orgs.py`, so these views only translate HTTP to calls and `OrgError`
back to a status.
"""
from __future__ import annotations

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import orgs


def _refused(exc: orgs.OrgError) -> Response:
    return Response({'detail': str(exc)}, status=exc.status)


class OrgListView(APIView):
    """GET my orgs + which is active; POST {name} creates one (I become owner)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({
            'orgs': orgs.orgs_for(request.user),
            'active_org_id': orgs.active_org_id(request.user),
        })

    def post(self, request):
        try:
            org = orgs.create(request.user, request.data.get('name', ''))
        except orgs.OrgError as exc:
            return _refused(exc)
        return Response(_org_body(org, 'owner'), status=status.HTTP_201_CREATED)


def _org_body(org, role: str) -> dict:
    return {'id': org.id, 'name': org.name, 'role': role,
            'share_by_default': org.share_by_default,
            'capture_mode': org.capture_mode, 'review_policy': org.review_policy}


class OrgDetailView(APIView):
    """PATCH {name?, share_by_default?, capture_mode?, review_policy?} (manager);
    DELETE (owner). `capture_mode` is suggest|auto; `review_policy` is open|curated."""

    permission_classes = [IsAuthenticated]

    def patch(self, request, org_id):
        try:
            share = request.data.get('share_by_default')
            org = orgs.update(
                request.user, org_id,
                name=request.data.get('name'),
                share_by_default=None if share is None else bool(share),
                capture_mode=request.data.get('capture_mode'),
                review_policy=request.data.get('review_policy'),
            )
        except orgs.OrgError as exc:
            return _refused(exc)
        role = orgs.role_of(request.user.id, org.id)
        return Response(_org_body(org, role))

    def delete(self, request, org_id):
        try:
            orgs.delete(request.user, org_id)
        except orgs.OrgError as exc:
            return _refused(exc)
        return Response(status=status.HTTP_204_NO_CONTENT)


class OrgMembersView(APIView):
    """GET members (any member); POST {email, role?} invites someone (manager).

    The POST does not add anybody: it creates an invitation, which the invitee
    accepts from their own account (`MyInvitesView`). The answer is the same
    whether or not the address has an account.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, org_id):
        try:
            return Response({'members': orgs.members(request.user, org_id)})
        except orgs.OrgError as exc:
            return _refused(exc)

    def post(self, request, org_id):
        try:
            row = orgs.invite(request.user, org_id,
                              request.data.get('email', ''),
                              request.data.get('role') or 'member')
        except orgs.OrgError as exc:
            return _refused(exc)
        return Response(row, status=status.HTTP_201_CREATED)


class OrgInvitesView(APIView):
    """GET the pending invitations of one org (manager); capped, with `truncated`."""

    permission_classes = [IsAuthenticated]

    def get(self, request, org_id):
        try:
            return Response(orgs.invites_for_org(request.user, org_id))
        except orgs.OrgError as exc:
            return _refused(exc)


class OrgInviteDetailView(APIView):
    """DELETE an open invitation (manager): it is withdrawn, 204."""

    permission_classes = [IsAuthenticated]

    def delete(self, request, org_id, invite_id):
        try:
            orgs.revoke_invite(request.user, org_id, invite_id)
        except orgs.OrgError as exc:
            return _refused(exc)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MyInvitesView(APIView):
    """GET the invitations addressed to my account, capped, with `truncated`."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(orgs.pending_invites_for(request.user))


class MyInviteRespondView(APIView):
    """POST {accept: true|false} answers an invitation to my account.

    200 `{org_id, role}` on accept, 204 on decline. Anything that is not mine,
    expired or already answered is the same 404.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, invite_id):
        accept = request.data.get('accept')
        if not isinstance(accept, bool):
            return Response({'detail': 'accept must be true or false.'},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            result = orgs.respond(request.user, invite_id, accept)
        except orgs.OrgError as exc:
            return _refused(exc)
        if result is None:
            return Response(status=status.HTTP_204_NO_CONTENT)
        return Response(result)


class OrgMemberDetailView(APIView):
    """PATCH {role} (manager); DELETE removes them — or, on yourself, leaves."""

    permission_classes = [IsAuthenticated]

    def patch(self, request, org_id, user_id):
        try:
            orgs.set_role(request.user, org_id, user_id, request.data.get('role', ''))
        except orgs.OrgError as exc:
            return _refused(exc)
        return Response({'user_id': user_id, 'role': request.data.get('role')})

    def delete(self, request, org_id, user_id):
        try:
            orgs.remove_member(request.user, org_id, user_id)
        except orgs.OrgError as exc:
            return _refused(exc)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ActiveOrgView(APIView):
    """POST {org_id|null}: the org new chats start in. Existing chats keep theirs."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            org_id = orgs.set_active(request.user, request.data.get('org_id'))
        except orgs.OrgError as exc:
            return _refused(exc)
        return Response({'active_org_id': org_id})
