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

from core.orgs import is_curator, is_member

from . import api, importer, insights
from .access import can_manage, get_visible, visible
from .attention import attention_for, attention_reasons
from .index import reindex
from .models import SolutionReview
from .search import present, search

LIST_LIMIT = 100
#: Rows a tag filter reads (see `SolutionListView.get`). A library bigger than
#: this is flagged `tag_scan_capped` in the response.
TAG_SCAN_LIMIT = 2000


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
    out['share_requested'] = solution.share_requested
    out['captured_by'] = solution.captured_by
    return out


#: Statuses kept out of the default library: a draft is its author's, and a
#: row waiting for review is in the queue. Each has its own `?status=`.
WORKFLOW_STATES = ('draft', 'pending_review')


def _offset(value) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def _tag_matches(solution, tag: str) -> bool:
    return any(str(t).lower() == tag for t in (solution.tags or []))


class SolutionListView(APIView):
    """GET the library. Query params (all optional):

    * `org` — the scope (`personal` or absent = no org).
    * `q` — a search; returns `solutions`, `abstained`, `semantic` (no paging).
    * `status` — one status; otherwise everything except drafts and the queue.
    * `doubtful=1` — only rows someone doubted.
    * `tag=<tag>` — rows carrying that tag (case-insensitive).
    * `author=me` — only rows you wrote.
    * `offset=<n>` — paging, 100 rows a page. `next_offset` is the next value,
      or null on the last page; `truncated` is true when more rows follow.
    * `attention=1` — "Needs attention" (K4.1): rows that are `needs_check`,
      doubted, or carry a claim past its freshness window. Most urgent first,
      at most 500 rows judged; `truncated` says when that cut the list. Each
      row carries `attention` (the reasons). Honours `tag` and `author=me`.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        user_id = request.user.id
        org_id = _org_param(request.query_params.get('org'))
        params = request.query_params
        tag = (params.get('tag') or '').strip().lower()[:40]
        mine = params.get('author') == 'me'
        query = (params.get('q') or '').strip()
        if params.get('attention') in ('1', 'true'):
            return self._attention(user_id, org_id, tag, mine)
        if query:
            # Browsing the library is not using a fix: only a chat answer that
            # took it counts as a use (search.py, record_use).
            found = async_to_sync(search)(user_id, org_id, query, limit=20, record_use=False,
                                          log_source='page')
            return Response({'solutions': found['results'], 'searched': found.get('searched', 0),
                             'abstained': found['abstained'], 'semantic': found['semantic']})
        rows = visible(user_id, org_id, include_inactive=True).exclude(status='retracted')
        state = params.get('status')
        if state in ('active', 'needs_check', 'superseded') + WORKFLOW_STATES:
            # `visible` already limits drafts to their author and a row waiting
            # for review to its author and the org's curators.
            rows = rows.filter(status=state)
        else:
            rows = rows.exclude(status__in=WORKFLOW_STATES)
        if params.get('doubtful') in ('1', 'true'):
            rows = rows.filter(doubtful=True)
        if mine:
            rows = rows.filter(author_id=user_id)
        # `id` breaks ties: paging by offset is only stable with a total order.
        rows = rows.order_by('-updated_at', '-id')
        offset = _offset(params.get('offset'))
        out: dict = {}
        if tag:
            # Tags are a JSON list, and SQLite cannot filter one in SQL. So the
            # match runs in Python over the newest TAG_SCAN_LIMIT rows; a larger
            # library says so rather than quietly missing older matches.
            scan = list(rows[:TAG_SCAN_LIMIT + 1])
            if len(scan) > TAG_SCAN_LIMIT:
                out['tag_scan_capped'] = True
            matched = [s for s in scan[:TAG_SCAN_LIMIT] if _tag_matches(s, tag)]
            total = len(matched)
            page = matched[offset:offset + LIST_LIMIT]
        else:
            total = rows.count()
            page = list(rows[offset:offset + LIST_LIMIT])
        more = offset + LIST_LIMIT < total
        out.update({
            'solutions': [_item(s, user_id) for s in page],
            'total': total,
            'truncated': more,
            'next_offset': offset + LIST_LIMIT if more else None,
        })
        return Response(out)

    def _attention(self, user_id, org_id, tag, mine):
        found, truncated = attention_for(user_id, org_id)
        if mine:
            found = [s for s in found if s.author_id == user_id]
        if tag:
            found = [s for s in found if _tag_matches(s, tag)]
        items = []
        for solution in found:
            item = _item(solution, user_id)
            item['attention'] = attention_reasons(solution)
            items.append(item)
        return Response({'solutions': items, 'total': len(items), 'truncated': truncated,
                         'next_offset': None})

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
                solution = api.edit(request.user, solution_id, org_id, _draft(request.data),
                                    verified=bool(request.data.get('verified')))
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


class SolutionPublishView(APIView):
    """POST {org, share}: the author turns a draft into a real entry.

    `share: true` shares it — or, in a curated org, sends it to the curators'
    queue. `share: false` (the default) keeps it private. 200 with the solution.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, solution_id):
        org_id = _org_param(request.data.get('org'))
        try:
            solution = api.publish(request.user, solution_id, org_id,
                                   share=bool(request.data.get('share', False)))
        except api.SolutionError as exc:
            return _refused(exc)
        return Response(_item(solution, request.user.id))


class SolutionDiscardView(APIView):
    """POST {org}: the author drops a draft. The row is kept as retracted. 200 with it."""

    permission_classes = [IsAuthenticated]

    def post(self, request, solution_id):
        org_id = _org_param(request.data.get('org'))
        try:
            solution = api.discard(request.user, solution_id, org_id)
        except api.SolutionError as exc:
            return _refused(exc)
        return Response(_item(solution, request.user.id))


class SolutionApproveView(APIView):
    """POST {org}: a curator approves a solution waiting for review. 200 with it."""

    permission_classes = [IsAuthenticated]

    def post(self, request, solution_id):
        org_id = _org_param(request.data.get('org'))
        try:
            solution = api.approve(request.user, solution_id, org_id)
        except api.SolutionError as exc:
            return _refused(exc)
        return Response(_item(solution, request.user.id))


class SolutionSendBackView(APIView):
    """POST {org, reason}: a curator returns a solution waiting for review to
    its author as their private fix. `reason` is required. 200 with it."""

    permission_classes = [IsAuthenticated]

    def post(self, request, solution_id):
        org_id = _org_param(request.data.get('org'))
        try:
            solution = api.send_back(request.user, solution_id, org_id,
                                     str(request.data.get('reason') or ''))
        except api.SolutionError as exc:
            return _refused(exc)
        return Response(_item(solution, request.user.id))


class SolutionReviewView(APIView):
    """POST {org, kind, reason}: worked / didn't work / doubtful / cleared."""

    permission_classes = [IsAuthenticated]

    def post(self, request, solution_id):
        org_id = _org_param(request.data.get('org'))
        kind = str(request.data.get('kind') or '')
        if kind == 'edited':
            # Written by `api.edit` alongside a real change; a client posting it
            # would leave an audit row claiming an edit that never happened.
            return Response({'detail': 'Edit the solution to record an edit.'}, status=400)
        try:
            solution = api.review(request.user, org_id, solution_id,
                                  kind,
                                  reason=str(request.data.get('reason') or ''))
        except api.SolutionError as exc:
            return _refused(exc)
        return Response(_item(solution, request.user.id))


class SolutionImportView(APIView):
    """POST {org, document_id}: extract solved problems from one of your
    documents, saved as drafts (K3.2). 202 {started: true} — the job runs in the
    background and the notification says when the drafts are ready.

    Unknown and foreign documents are the same 404. A daily cap answers 429.
    The checks run before the cap is spent, so a mistyped request costs nothing.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        org_id = _org_param(request.data.get('org'))
        if org_id == -1 or (org_id and not is_member(request.user.id, org_id)):
            return Response({'detail': 'No such organisation.'}, status=404)
        try:
            document_id = int(request.data.get('document_id'))
        except (TypeError, ValueError):
            return Response({'detail': 'Choose a document to import.'}, status=400)
        if not importer.document_exists(request.user.id, document_id):
            return Response({'detail': 'No such document.'}, status=404)
        if not importer.take_import_slot(request.user.id):
            return Response(
                {'detail': f'You can import {importer.import_cap()} documents a day. '
                           'Try again tomorrow.'},
                status=429)
        importer.start_import(request.user.id, org_id, document_id)
        return Response({'started': True}, status=202)


class SolutionInsightsView(APIView):
    """GET `?org=<id>`: the team's last 30 days (K5.2). Curators only.

    404 for an unknown org and for a non-member (the same answer, so the
    response does not say which orgs exist). 403 for a member who is not a
    curator. The shape is `insights.summary`; nothing in it names who searched.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        user_id = request.user.id
        org_id = _org_param(request.query_params.get('org'))
        if not org_id or org_id == -1 or not is_member(user_id, org_id):
            return Response({'detail': 'No such organisation.'}, status=404)
        if not is_curator(user_id, org_id):
            return Response({'detail': 'Only curators can see the team insights.'},
                            status=403)
        return Response(insights.summary(user_id, org_id))
