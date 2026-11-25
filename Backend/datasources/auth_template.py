"""
Auth "parts": how a stored credential becomes request headers, query
parameters or Basic auth.

A template auth is `{"type": "template", "credential_type": "<slug>",
"parts": [...]}`. Each part names one place the credential goes, and `{field}`
placeholders name fields of that credential type:

    {"in": "header", "name": "Authorization", "value": "Bearer {apiKey}"}
    {"in": "query",  "name": "token", "value": "{token}"}
    {"in": "basic",  "user": "{apiKey}", "password": "X"}

Text outside braces is literal, so a static header (`revision: 2025-07-15`) is
just a part with no placeholder.

Pure: no ORM and no HTTP. Used by the datasources serializer (validation at
write), by `chat/tools/apicaller.py` (dispatch) and by the API-card routes in
`mcp_integration` (which build a connection from a card's template). Keeping it
here, in a lower layer, is what lets `mcp_integration` import it.
"""
from __future__ import annotations

import base64
import re
from collections.abc import Mapping

#: Where a part can put the credential.
PART_KINDS = ('header', 'query', 'basic')

#: A template may carry at most this many parts.
MAX_PARTS = 4

HEADER_NAME_RE = re.compile(r'^[A-Za-z0-9-]{1,64}$')
QUERY_NAME_RE = re.compile(r'^[A-Za-z0-9_.-]{1,64}$')
#: `{field}` — a field name, the same identifier shape a credential field has.
PLACEHOLDER_RE = re.compile(r'\{([A-Za-z_][A-Za-z0-9_]{0,63})\}')

#: Longest literal or placeholder text in one part.
MAX_PART_TEXT = 512

_KEYS = {
    'header': frozenset({'in', 'name', 'value'}),
    'query': frozenset({'in', 'name', 'value'}),
    'basic': frozenset({'in', 'user', 'password'}),
}


def placeholders(text: str) -> list[str]:
    """Every `{field}` name in `text`, in order (repeats included)."""
    return PLACEHOLDER_RE.findall(text or '')


def _text(part: dict, key: str, index: int) -> str:
    value = part.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError(f'Auth part {index}: "{key}" must be a non-empty text.')
    if len(value) > MAX_PART_TEXT:
        raise ValueError(f'Auth part {index}: "{key}" is longer than {MAX_PART_TEXT} characters.')
    return value


def check_parts(parts) -> list[dict]:
    """The parts, cleaned, or ValueError naming the first thing wrong."""
    if not isinstance(parts, list):
        raise ValueError('"parts" must be a list.')
    if len(parts) > MAX_PARTS:
        raise ValueError(f'At most {MAX_PARTS} auth parts are allowed.')
    out: list[dict] = []
    basics = 0
    for index, part in enumerate(parts, 1):
        if not isinstance(part, dict):
            raise ValueError(f'Auth part {index} must be an object.')
        kind = part.get('in')
        if kind not in PART_KINDS:
            raise ValueError(f'Auth part {index}: "in" must be one of {", ".join(PART_KINDS)}.')
        unknown = sorted(set(part) - _KEYS[kind])
        if unknown:
            raise ValueError(f'Auth part {index}: unknown key "{unknown[0]}".')
        if kind == 'basic':
            basics += 1
            out.append({
                'in': 'basic',
                'user': _text(part, 'user', index),
                'password': _text(part, 'password', index),
            })
            continue
        name = _text(part, 'name', index)
        pattern = HEADER_NAME_RE if kind == 'header' else QUERY_NAME_RE
        if not pattern.fullmatch(name):
            raise ValueError(f'Auth part {index}: "{name}" is not a valid {kind} name.')
        out.append({'in': kind, 'name': name, 'value': _text(part, 'value', index)})
    if basics > 1:
        raise ValueError('At most one basic auth part is allowed.')
    return out


def part_placeholders(parts: list[dict]) -> list[str]:
    """The distinct field names the parts use, in first-seen order."""
    seen: dict[str, None] = {}
    for part in parts or []:
        texts = [part.get('user', ''), part.get('password', '')] if part.get('in') == 'basic' \
            else [part.get('value', '')]
        for text in texts:
            for name in placeholders(text):
                seen.setdefault(name, None)
    return list(seen)


def _fill(text: str, values: Mapping[str, str]) -> str:
    def sub(match: re.Match) -> str:
        key = match.group(1)
        value = values.get(key)
        if value in (None, ''):
            raise ValueError(f'No value for "{key}".')
        return str(value)

    out = PLACEHOLDER_RE.sub(sub, text)
    if '\r' in out or '\n' in out:
        raise ValueError('A credential value may not contain a line break.')
    return out


def apply_parts(parts: list[dict], values: Mapping[str, str]) -> tuple[dict, dict]:
    """`(headers, query params)` the parts produce from resolved `values`.

    Raises ValueError when a placeholder has no value, so a caller that cannot
    fill every part sends no auth at all rather than a half-built one.
    """
    headers: dict[str, str] = {}
    params: dict[str, str] = {}
    for part in parts:
        if part['in'] == 'basic':
            user = _fill(part['user'], values)
            password = _fill(part['password'], values)
            token = base64.b64encode(f'{user}:{password}'.encode()).decode()
            headers['Authorization'] = f'Basic {token}'
        elif part['in'] == 'header':
            headers[part['name']] = _fill(part['value'], values)
        else:
            params[part['name']] = _fill(part['value'], values)
    return headers, params
