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
        return Response({'id': org.id, 'name': org.name, 'role': 'owner',
                         'share_by_default': org.share_by_default},
                        status=status.HTTP_201_CREATED)


class OrgDetailView(APIView):
    """PATCH {name?, share_by_default?} (manager); DELETE (owner)."""

    permission_classes = [IsAuthenticated]

    def patch(self, request, org_id):
        try:
            share = request.data.get('share_by_default')
            org = orgs.update(
                request.user, org_id,
                name=request.data.get('name'),
                share_by_default=None if share is None else bool(share),
            )
        except orgs.OrgError as exc:
            return _refused(exc)
        return Response({'id': org.id, 'name': org.name,
                         'share_by_default': org.share_by_default})

    def delete(self, request, org_id):
        try:
            orgs.delete(request.user, org_id)
        except orgs.OrgError as exc:
            return _refused(exc)
        return Response(status=status.HTTP_204_NO_CONTENT)


class OrgMembersView(APIView):
    """GET members (any member); POST {email, role?} adds one (manager)."""

    permission_classes = [IsAuthenticated]

    def get(self, request, org_id):
        try:
            return Response({'members': orgs.members(request.user, org_id)})
        except orgs.OrgError as exc:
            return _refused(exc)

    def post(self, request, org_id):
        try:
            row = orgs.add_member(request.user, org_id,
                                  request.data.get('email', ''),
                                  request.data.get('role') or 'member')
        except orgs.OrgError as exc:
            return _refused(exc)
        return Response(row, status=status.HTTP_201_CREATED)


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
