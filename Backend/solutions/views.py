"""
`/api/solutions/` — the library page: browse, search, edit, share, review, retract.

Every request names the org it is asking from (`?org=<id>` or `org` in the
body; absent or `personal` means no org). That is the same scope a chat in
that org would search, resolved by `access.visible`, so the page can never
show more than the assistant could.
"""
from __future__ import annotations

from asgiref.sync import async_to_sync
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import api
from .access import can_manage, get_visible, visible
from .index import reindex
from .models import SolutionReview
from .search import present, search

LIST_LIMIT = 100


def _org_param(value):
    if value in (None, '', 'personal', 'null'):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return -1  # matches nothing; never falls back to "personal"


def _draft(data) -> api.Draft:
    return api.Draft(
        problem=str(data.get('problem') or ''),
        symptoms=str(data.get('symptoms') or ''),
        root_cause=str(data.get('root_cause') or ''),
        resolution=str(data.get('resolution') or ''),
        environment=data.get('environment') if isinstance(data.get('environment'), dict) else {},
        claims=data.get('claims') if isinstance(data.get('claims'), list) else [],
        phrasings=data.get('phrasings') if isinstance(data.get('phrasings'), list) else [],
        tags=data.get('tags') if isinstance(data.get('tags'), list) else [],
    )


def _refused(exc: api.SolutionError) -> Response:
    return Response({'detail': str(exc)}, status=exc.status)


def _item(solution, user_id) -> dict:
    out = present(solution, viewer_id=user_id)
    out['can_manage'] = can_manage(user_id, solution)
    out['updated_at'] = solution.updated_at
    return out


class SolutionListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user_id = request.user.id
        org_id = _org_param(request.query_params.get('org'))
        query = (request.query_params.get('q') or '').strip()
        if query:
            found = async_to_sync(search)(user_id, org_id, query, limit=20)
            return Response({'solutions': found['results'], 'searched': found.get('searched', 0),
                             'abstained': found['abstained'], 'semantic': found['semantic']})
        rows = visible(user_id, org_id, include_inactive=True).exclude(status='retracted')
        state = request.query_params.get('status')
        if state in ('active', 'needs_check', 'superseded'):
            rows = rows.filter(status=state)
        if request.query_params.get('doubtful') in ('1', 'true'):
            rows = rows.filter(doubtful=True)
        total = rows.count()
        items = [_item(s, user_id) for s in rows.order_by('-updated_at')[:LIST_LIMIT]]
        return Response({'solutions': items, 'total': total,
                         'truncated': total > LIST_LIMIT})

    def post(self, request):
        org_id = _org_param(request.data.get('org'))
        if org_id == -1:
            return Response({'detail': 'No such organisation.'}, status=404)
        try:
            solution = api.save(request.user, org_id=org_id,
                                share=bool(request.data.get('share', True)),
                                draft=_draft(request.data), captured_by='user')
        except api.SolutionError as exc:
            return _refused(exc)
        async_to_sync(reindex)(solution.id)
        return Response(_item(solution, request.user.id), status=status.HTTP_201_CREATED)


class SolutionDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, solution_id):
        user_id = request.user.id
        org_id = _org_param(request.query_params.get('org'))
        solution = get_visible(user_id, org_id, solution_id, include_inactive=True)
        if solution is None or solution.status == 'retracted':
            return Response({'detail': 'No such solution.'}, status=404)
        out = present(solution, viewer_id=user_id, full=True)
        out['can_manage'] = can_manage(user_id, solution)
        out['reviews'] = [
            {'kind': r.kind, 'by': 'a model' if r.model and not r.user_id else
             ('you' if r.user_id == user_id else 'a colleague'),
             'model': r.model, 'reason': r.reason, 'at': r.created_at}
            for r in SolutionReview.objects.filter(solution=solution)[:50]
        ]
        if solution.superseded_by_id:
            out['superseded_by'] = solution.superseded_by_id
        return Response(out)

    def patch(self, request, solution_id):
        org_id = _org_param(request.data.get('org'))
        try:
            if 'shared' in request.data and len(set(request.data) - {'org', 'shared'}) == 0:
                solution = api.set_shared(request.user, solution_id, org_id,
                                          bool(request.data['shared']))
            else:
                solution = api.edit(request.user, solution_id, org_id, _draft(request.data))
                if 'shared' in request.data:
                    solution = api.set_shared(request.user, solution_id, org_id,
                                              bool(request.data['shared']))
                async_to_sync(reindex)(solution.id)
        except api.SolutionError as exc:
            return _refused(exc)
        return Response(_item(solution, request.user.id))

    def delete(self, request, solution_id):
        org_id = _org_param(request.query_params.get('org') or request.data.get('org'))
        try:
            api.retract(request.user, solution_id, org_id,
                        str(request.data.get('reason') or '') if hasattr(request, 'data') else '')
        except api.SolutionError as exc:
            return _refused(exc)
        return Response(status=status.HTTP_204_NO_CONTENT)


class SolutionReviewView(APIView):
    """POST {org, kind, reason}: worked / didn't work / doubtful / cleared."""

    permission_classes = [IsAuthenticated]

    def post(self, request, solution_id):
        org_id = _org_param(request.data.get('org'))
        try:
            solution = api.review(request.user, org_id, solution_id,
                                  str(request.data.get('kind') or ''),
                                  reason=str(request.data.get('reason') or ''))
        except api.SolutionError as exc:
            return _refused(exc)
        return Response(_item(solution, request.user.id))
