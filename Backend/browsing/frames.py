"""The last picture of a browser call, kept briefly for the person who ran it.

The Browser tab shows what the agent's browser is looking at. A picture of a
user's own pages is sensitive, so it is not saved to their files (that stays
opt-in, `screenshot: true`) and not written to disk at all: it lives in the
cache for `BROWSER_FRAME_TTL_SECONDS`, under a key that names the owner.

Two rules hold for every reader:

* A frame is found only by the user who made it. The key is
  `browser:frame:<user_id>:<frame_id>`, so another user's id finds nothing,
  and an unknown or expired id finds nothing either. The view answers the
  same 404 for all three.
* A frame is bounded. A picture over `MAX_FRAME_BYTES` is not kept, and the
  caller gets no id for it.
"""
from __future__ import annotations

import re
import secrets

from django.conf import settings
from django.core.cache import cache

MAX_FRAME_BYTES = 600_000
DEFAULT_TTL_SECONDS = 3600

#: What `secrets.token_urlsafe` can produce, with a length cap so a request
#: path cannot make an oversized cache key.
_FRAME_ID = re.compile(r'^[A-Za-z0-9_-]{8,64}$')


def ttl_seconds() -> int:
    try:
        return int(getattr(settings, 'BROWSER_FRAME_TTL_SECONDS', DEFAULT_TTL_SECONDS))
    except (TypeError, ValueError):
        return DEFAULT_TTL_SECONDS


def _key(user_id: int, frame_id: str) -> str:
    return f'browser:frame:{int(user_id)}:{frame_id}'


def put(user_id: int, data: bytes | None) -> str | None:
    """Store one JPEG; return its random frame id, or None if it is absent or too big."""
    if not data or not user_id or len(data) > MAX_FRAME_BYTES:
        return None
    frame_id = secrets.token_urlsafe(12)
    cache.set(_key(user_id, frame_id), bytes(data), ttl_seconds())
    return frame_id


def get(user_id: int, frame_id: str) -> bytes | None:
    """The frame, or None if unknown, expired, malformed, or someone else's."""
    if not isinstance(frame_id, str) or not _FRAME_ID.match(frame_id):
        return None
    if not user_id:
        return None
    return cache.get(_key(user_id, frame_id))
