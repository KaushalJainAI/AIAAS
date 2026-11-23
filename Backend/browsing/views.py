"""HTTP routes for the browser: a frame picture, and whether a browser is set up.

Owner only. Every route checks the signed-in user, and a frame is found only
under that user's own key (`browsing/frames.py`), so an unknown, expired or
someone else's frame all get the same 404.
"""
from __future__ import annotations

from adrf.decorators import api_view as async_api_view
from asgiref.sync import sync_to_async
from django.http import Http404, HttpResponse
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle

#: The preview's own inputs and outputs, capped.
PREVIEW_URL_CHARS = 2000
PREVIEW_TEXT_CHARS = 2000


class BrowserPreviewThrottle(UserRateThrottle):
    """One preview is one paid browser call, so it has its own cap (20 an hour)."""
    scope = 'browser_preview'


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def browser_frame(request, frame_id: str):
    """The last picture of a browser call: `image/jpeg`, private, short-lived."""
    from browsing.frames import get, ttl_seconds

    data = get(request.user.id, frame_id)
    if data is None:
        raise Http404
    response = HttpResponse(data, content_type='image/jpeg')
    response['Cache-Control'] = f'private, max-age={ttl_seconds()}'
    return response


@async_api_view(['POST'])
@permission_classes([IsAuthenticated])
@throttle_classes([BrowserPreviewThrottle])
async def browser_preview(request):
    """Read one link for the side pane: its title, a picture and a short excerpt.

    Read only: the page is opened and read, nothing is clicked or typed. The
    address is checked by `core.safety.net` before anything is sent, and the
    call is counted as one browser minute on the ledger, like an agent's call.
    The picture is kept under the same owner-only rule as every other frame.
    """
    from browsing.costs import record_browser_minute
    from browsing.engine import BrowserError, browser_available, run
    from browsing.frames import put
    from core.safety.net import validate_url_async

    if not browser_available():
        return Response({'detail': 'Not found.'}, status=404)
    url = str(request.data.get('url') or '').strip()
    if not url:
        return Response({'error': 'No URL was sent.'}, status=400)
    if len(url) > PREVIEW_URL_CHARS:
        return Response({'error': 'That address is too long.'}, status=400)
    ok, reason = await validate_url_async(url)
    if not ok:
        return Response({'error': reason}, status=400)
    try:
        page = await run(url, screenshot=True)
    except BrowserError as exc:
        return Response({'error': str(exc)}, status=502)

    try:
        frame_id = await sync_to_async(put)(request.user.id, page.get('screenshot')) or ''
    except Exception:  # noqa: BLE001 — a cache hiccup costs the picture, not the preview
        frame_id = ''
    await record_browser_minute(request.user.id, source='browser_preview')
    return Response({
        'url': str(page.get('url') or url),
        'title': str(page.get('title') or ''),
        'frame_id': frame_id,
        'text_excerpt': str(page.get('text') or '')[:PREVIEW_TEXT_CHARS],
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def browser_status(request):
    """`{available}`: whether this server has a browser the agent can use.

    The frontend reads it to decide whether to offer the Browser tab and the
    link preview. It says nothing about the user's own settings.
    """
    from browsing.engine import browser_available

    return Response({'available': browser_available()})
