"""
Knowledge bases over HTTP: the list a person sees, and the team-sharing switch.

Read sharing only (K6). The owner of a knowledge base is the only one who may
change where it is shared. A curator of the organisation it is shared with may
turn that sharing off and nothing else. Who may *read* a shared knowledge base
is decided by `inference/kb_access.py` on every request, never by anything
stored on the row.

Unknown ids, hidden eval corpora, and ids the caller cannot see all answer the
same 404, so the API cannot be used to find out which ids are real.
"""
from __future__ import annotations

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core import orgs
from core.orgs import OrgError

from . import kb_access
from .models import KnowledgeBase
from .serializers import KnowledgeBaseSerializer, KnowledgeBaseShareSerializer

#: Cap for the list (function views have no automatic pagination).
KB_LIST_CAP = 200

NOT_FOUND = 'Knowledge base not found.'


def _row(kb: KnowledgeBase, me_id: int) -> dict:
    """One knowledge base as the sharing screens need it.

    The owner's display name is shown to people who can already read the
    knowledge base; the owner's email is never sent.
    """
    data = dict(KnowledgeBaseSerializer(kb).data)
    data.update({
        'org': kb.org_id,
        'shared_with_org': kb.shared_with_org,
        'is_mine': kb.user_id == me_id,
        'owner_name': kb.user.get_full_name() or kb.user.username,
    })
    return data


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def knowledge_base_list(request):
    """GET the caller's knowledge bases.

    `?org=<id>` adds that organisation's shared knowledge bases, so one list
    answers "what do I know, and what does my team know". An org the caller is
    not in is the same 404 as an org that does not exist.
    """
    org_id = None
    raw = request.query_params.get('org')
    if raw not in (None, ''):
        try:
            org_id = int(raw)
            orgs.get_for_member(request.user, org_id)
        except (ValueError, OrgError):
            return Response({'error': 'No such organisation.'}, status=404)

    rows = (kb_access.readable_kbs(request.user.id, org_id)
            .select_related('user')
            .order_by('name'))
    kbs = list(rows[:KB_LIST_CAP + 1])
    truncated = len(kbs) > KB_LIST_CAP
    kbs = kbs[:KB_LIST_CAP]
    return Response({
        'knowledge_bases': [_row(kb, request.user.id) for kb in kbs],
        'count': len(kbs),
        **({'truncated': True} if truncated else {}),
    })


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def knowledge_base_detail(request, kb_id: int):
    """PATCH `{org, shared_with_org}` on a knowledge base.

    The owner may choose the organisation (one they belong to) and switch the
    sharing on or off. Choosing a different organisation turns sharing off
    until the owner turns it on again: a share was granted to the old one.

    A curator of the knowledge base's organisation may send exactly
    `{shared_with_org: false}`. Anyone else who can see it gets a 403, because
    they can already read it and the refusal reveals nothing new.
    """
    me = request.user
    kb = KnowledgeBase.objects.select_related('user').filter(id=kb_id).first()
    # The same read rule as every other reader. A hidden eval corpus, an
    # unknown id, and a team KB the caller cannot read all fall out here.
    if kb is None or kb_access.get_readable_kb(me.id, kb.org_id, kb.id) is None:
        return Response({'error': NOT_FOUND}, status=404)

    body = KnowledgeBaseShareSerializer(data=request.data)
    body.is_valid(raise_exception=True)
    data = body.validated_data

    if kb.user_id != me.id:
        # Curators (owner, admin or curator) may switch a team's sharing off.
        if not orgs.is_curator(me.id, kb.org_id):
            return Response(
                {'error': 'Only the owner can change how this knowledge base is shared.'},
                status=403,
            )
        if set(data) != {'shared_with_org'} or data['shared_with_org'] is not False:
            return Response(
                {'error': 'A curator can only stop sharing this knowledge base.'},
                status=403,
            )
        kb.shared_with_org = False
        kb.save(update_fields=['shared_with_org', 'updated_at'])
        return Response(_row(kb, me.id))

    org_id, shared = kb.org_id, kb.shared_with_org
    switching_org = False
    if 'org' in data:
        if data['org'] is None:
            org_id, shared = None, False
        elif data['org'] != kb.org_id:
            try:
                orgs.get_for_member(me, data['org'])
            except OrgError as exc:
                return Response({'error': str(exc)}, status=exc.status)
            org_id, shared, switching_org = data['org'], False, True
    if 'shared_with_org' in data:
        shared = bool(data['shared_with_org'])
    if shared and org_id is None:
        return Response(
            {'error': 'Choose an organisation to share this knowledge base with first.'},
            status=400,
        )

    turning_on = shared and (switching_org or not kb.shared_with_org)
    if turning_on and not orgs.is_member(me.id, org_id):
        # The owner has left this organisation; they may still stop sharing.
        return Response({'error': 'No such organisation.'}, status=404)

    kb.org_id = org_id
    kb.shared_with_org = shared
    kb.save(update_fields=['org', 'shared_with_org', 'updated_at'])
    return Response(_row(kb, me.id))
