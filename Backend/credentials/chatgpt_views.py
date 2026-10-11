"""
Routes for Continue with ChatGPT. The work is in `credentials/chatgpt.py`.

Three signed-in routes under `/api/credentials/chatgpt/` and one that is not:
`/auth/callback`, where OpenAI sends the browser back. That one carries no
session of ours — it is a redirect from another site to a loopback address —
so the only thing tying it to a user is the `state` this server issued, which
`chatgpt.complete` checks and spends. It answers with a small page of its own
and the same generic sentence for every failure: the window is a popup, and
the page that opened it finds out by asking `status/`.
"""
from __future__ import annotations

import logging

from django.http import Http404, HttpResponse
from django.utils.html import escape
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET
from rest_framework import status as http
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from . import chatgpt

logger = logging.getLogger(__name__)


def _require_enabled() -> None:
    # 404, not 403: switched off, the feature does not exist on this install.
    if not chatgpt.enabled():
        raise Http404


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def start(request):
    """Begin a sign-in. Returns the URL to open in a popup."""
    _require_enabled()
    host = request.get_host()
    if not chatgpt.is_loopback(host):
        return Response({
            'code': 'not_local',
            'error': (
                'Continue with ChatGPT only works when you open this app on the '
                'machine it runs on (http://localhost or http://127.0.0.1).'
            ),
        }, status=http.HTTP_400_BAD_REQUEST)
    return Response({'authorize_url': chatgpt.begin(request.user.id, request_host=host)})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def status(request):
    """Whether this user is signed in with ChatGPT. Never 404s: the UI asks
    this to decide whether to draw anything at all."""
    return Response(chatgpt.status(request.user.id))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def disconnect(request):
    _require_enabled()
    revoked = chatgpt.disconnect(request.user.id)
    chatgpt.forget_models(request.user.id)
    return Response({'disconnected': True, 'revoked_at_openai': revoked})


_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>
  body {{ font: 15px/1.5 system-ui, sans-serif; margin: 0; min-height: 100vh;
         display: grid; place-items: center; background: #0f1115; color: #e8eaed; }}
  main {{ max-width: 26rem; padding: 2rem; text-align: center; }}
  h1 {{ font-size: 1.15rem; margin: 0 0 .5rem; }}
  p {{ margin: 0; opacity: .75; }}
</style></head>
<body><main><h1>{title}</h1><p>{body}</p></main>
<script>setTimeout(function () {{ window.close(); }}, {close_ms});</script>
</body></html>"""

_FAILED = (
    'ChatGPT sign-in did not finish',
    'Close this window and press Continue with ChatGPT again.',
)


def _page(title: str, body: str, *, code: int = 200, close_ms: int = 1500) -> HttpResponse:
    response = HttpResponse(
        _PAGE.format(title=escape(title), body=escape(body), close_ms=close_ms),
        status=code,
    )
    # Nothing on this page loads anything; say so.
    response['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"
    response['Referrer-Policy'] = 'no-referrer'
    return response


@never_cache
@require_GET
def callback(request):
    """Where OpenAI sends the browser after the consent screen."""
    _require_enabled()
    if not chatgpt.is_loopback(request.get_host()):
        raise Http404
    code = request.GET.get('code', '')
    state = request.GET.get('state', '')
    if request.GET.get('error') or not code or not state:
        return _page(*_FAILED, code=400, close_ms=6000)
    try:
        credential = chatgpt.complete(
            state=state, code=code, client_id=request.GET.get('client_id', ''))
    except chatgpt.ChatGPTAuthError as exc:
        # The reason goes to the log, never to the page: it is another site's
        # redirect, and what failed is not something to describe to it.
        logger.warning('ChatGPT sign-in failed: %s', exc.code)
        return _page(*_FAILED, code=400, close_ms=6000)
    chatgpt.forget_models(credential.user_id)
    return _page(
        "You're using your ChatGPT plan",
        'Eligible usage in this app uses your ChatGPT plan. You can close this window.',
    )
