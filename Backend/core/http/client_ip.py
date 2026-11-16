"""The caller's IP address, as seen through our reverse proxies.

Production runs behind two proxies (Caddy, then the frontend's nginx), so
`REMOTE_ADDR` is always nginx's container address and `X-Forwarded-For` is
`<client>, <caddy>`. `REST_FRAMEWORK['NUM_PROXIES']` (env `TRUSTED_PROXY_COUNT`)
says how many entries from the right were written by proxies we run; the one
before them is the address our outermost proxy saw, which a client cannot forge
by sending its own `X-Forwarded-For` (anything it sends lands further left).

DRF's throttles read the same setting through `BaseThrottle.get_ident`, so a
rate limit and an audit row agree on who the caller was.
"""
from __future__ import annotations

from django.conf import settings


def proxy_count() -> int | None:
    value = (getattr(settings, 'REST_FRAMEWORK', {}) or {}).get('NUM_PROXIES')
    return value if isinstance(value, int) and value >= 0 else None


def client_ip(request) -> str | None:
    """The client address, or None when it cannot be told."""
    meta = getattr(request, 'META', {}) or {}
    remote = meta.get('REMOTE_ADDR') or None
    proxies = proxy_count()
    xff = meta.get('HTTP_X_FORWARDED_FOR')
    if not proxies or not xff:
        return remote
    addrs = [a.strip() for a in xff.split(',') if a.strip()]
    if not addrs:
        return remote
    return addrs[-min(proxies, len(addrs))]
