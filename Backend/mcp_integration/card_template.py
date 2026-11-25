"""
API-card templates: how a curated `kind='api'` connector builds the user's
`ApiConnection` (Phase 9b/10 of CONNECTOR_CATALOGUE_PLAN.md).

A card row carries `MCPServer.template`:

    {"base_url": "https://{subdomain}.freshdesk.com/api/v2",
     "spec": "freshdesk.json",
     "auth": {"parts": [{"in": "header", "name": "Authorization", "value": "Bearer {apiKey}"}]},
     "fields": [{"name": "subdomain", "label": "Freshdesk subdomain", "pattern": "^[a-z0-9-]{1,63}$"}],
     "allowed_methods": ["GET", "HEAD"]}

`{x}` in `base_url` names a field the user types (not a secret). `{x}` in
`auth.parts` names a field of the card's first credential type; that secret is
never in the template and never passes through the card routes. The spec file
lives in `datasources/catalogue/` and lists only GET/HEAD operations.

Pure: no ORM, no HTTP. The routes and the `connector_check` command use it.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import urlsplit

from datasources.auth_template import check_parts, placeholders

#: Where specs are read from. A module attribute, read at call time, so a test
#: can point it at a temporary directory.
CATALOGUE_DIR = Path(__file__).resolve().parent.parent / 'datasources' / 'catalogue'

TEMPLATE_KEYS = frozenset({'base_url', 'spec', 'auth', 'fields', 'allowed_methods'})
AUTH_KEYS = frozenset({'parts'})
FIELD_KEYS = frozenset({'name', 'label', 'help', 'pattern', 'options'})
FIELD_NAME_RE = re.compile(r'^[A-Za-z_][A-Za-z0-9_]{0,63}$')
SPEC_NAME_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$')
ALLOWED_METHODS = ('GET', 'HEAD')
#: The spec's marker for the one cheap operation the live check calls.
CHECK_FLAG = 'x-aiaas-check'
#: Characters a user-typed field value may never carry: they would move the
#: host, the path or the userinfo of the URL they are pasted into.
_REFUSED_IN_VALUE = frozenset('/?#@:\\')
PLACEHOLDER_SUB_RE = re.compile(r'\{([A-Za-z_][A-Za-z0-9_]{0,63})\}')


class CardSpecMissing(RuntimeError):
    """A card's spec file cannot be read or is not an OpenAPI object."""


def _text(value, what: str, limit: int) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f'{what} must be non-empty text.')
    if len(value) > limit:
        raise ValueError(f'{what} is longer than {limit} characters.')
    return value


def _check_fields(raw) -> list[dict]:
    if not isinstance(raw, list):
        raise ValueError('"fields" must be a list.')
    out: list[dict] = []
    seen: set[str] = set()
    for index, field in enumerate(raw, 1):
        if not isinstance(field, dict):
            raise ValueError(f'Field {index} must be an object.')
        unknown = sorted(set(field) - FIELD_KEYS)
        if unknown:
            raise ValueError(f'Field {index}: unknown key "{unknown[0]}".')
        name = field.get('name')
        if not isinstance(name, str) or not FIELD_NAME_RE.fullmatch(name):
            raise ValueError(f'Field {index}: "name" must be an identifier.')
        if name in seen:
            raise ValueError(f'Field "{name}" is listed twice.')
        seen.add(name)
        cleaned: dict = {
            'name': name,
            'label': _text(field.get('label'), f'Field "{name}" label', 120),
        }
        if 'help' in field:
            cleaned['help'] = _text(field['help'], f'Field "{name}" help', 300)
        if 'pattern' in field:
            pattern = _text(field['pattern'], f'Field "{name}" pattern', 300)
            try:
                re.compile(pattern)
            except re.error as exc:
                raise ValueError(f'Field "{name}" pattern is not a valid regex: {exc}.')
            cleaned['pattern'] = pattern
        if 'options' in field:
            options = field['options']
            if not isinstance(options, list) or not options:
                raise ValueError(f'Field "{name}" options must be a non-empty list.')
            if not all(isinstance(o, str) and o for o in options) or len(set(options)) != len(options):
                raise ValueError(f'Field "{name}" options must be unique, non-empty text.')
            cleaned['options'] = list(options)
        out.append(cleaned)
    return out


def validate_card_template(value) -> dict:
    """The template, cleaned and with defaults filled, or ValueError.

    `{}` is valid: a card with no API template yet. Anything else needs a
    `https://` base URL, a spec file name, every `base_url` placeholder declared
    as a field, and auth parts within the shared rules (`check_parts`).
    """
    if not isinstance(value, dict):
        raise ValueError('The template must be a JSON object.')
    unknown = sorted(set(value) - TEMPLATE_KEYS)
    if unknown:
        raise ValueError(f'Unknown template key "{unknown[0]}".')
    if not value:
        return {}
    if 'base_url' not in value or 'spec' not in value:
        raise ValueError('A template needs "base_url" and "spec".')

    base_url = _text(value['base_url'], '"base_url"', 1000)
    if not base_url.startswith('https://') or any(c.isspace() for c in base_url):
        raise ValueError('"base_url" must be an https:// URL with no spaces.')
    spec = value['spec']
    if not isinstance(spec, str) or not SPEC_NAME_RE.fullmatch(spec):
        raise ValueError('"spec" must be a plain .json file name.')

    fields = _check_fields(value.get('fields', []))
    names = {field['name'] for field in fields}
    for name in placeholders(base_url):
        if name not in names:
            raise ValueError(f'"base_url" uses {{{name}}} but there is no field named "{name}".')

    auth = value.get('auth', {'parts': []})
    if not isinstance(auth, dict):
        raise ValueError('"auth" must be an object.')
    unknown_auth = sorted(set(auth) - AUTH_KEYS)
    if unknown_auth:
        raise ValueError(f'Unknown auth key "{unknown_auth[0]}".')
    parts = check_parts(auth.get('parts', []))

    methods = value.get('allowed_methods', list(ALLOWED_METHODS))
    if not isinstance(methods, list) or not methods:
        raise ValueError('"allowed_methods" must be a non-empty list.')
    bad = [m for m in methods if m not in ALLOWED_METHODS]
    if bad:
        raise ValueError(f'Only GET and HEAD are allowed on cards for now, not {bad[0]!r}.')
    if len(set(methods)) != len(methods):
        raise ValueError('"allowed_methods" lists a method twice.')

    return {
        'base_url': base_url,
        'spec': spec,
        'auth': {'parts': parts},
        'fields': fields,
        'allowed_methods': list(methods),
    }


def render_base_url(template: dict, values: dict) -> str:
    """The user's base URL: the template with each field filled in.

    Every field is required, must match its `pattern` (fully) and its
    `options`, and may not carry `/ ? # @ : \\` or whitespace. A `.` is refused
    too unless the field's pattern is written to allow one (hostname fields).
    Raises ValueError with a sentence the user can act on.
    """
    if not isinstance(values, dict):
        raise ValueError('"fields" must be an object of field values.')
    fields = {field['name']: field for field in template.get('fields', [])}
    unknown = sorted(set(values) - set(fields))
    if unknown:
        raise ValueError(f'Unknown field "{unknown[0]}".')

    filled: dict[str, str] = {}
    for name, field in fields.items():
        label = field.get('label') or name
        raw = values.get(name)
        if raw is None or not str(raw).strip():
            raise ValueError(f'{label} is required.')
        text = str(raw)
        if any(c in _REFUSED_IN_VALUE or c.isspace() for c in text):
            raise ValueError(f'{label} may not contain slashes, colons, @, ?, # or spaces.')
        pattern = field.get('pattern')
        if '.' in text and (pattern is None or '.' not in pattern):
            raise ValueError(f'{label} may not contain a dot.')
        if pattern is not None and not re.fullmatch(pattern, text):
            raise ValueError(f'{label} is not in the expected form. {field.get("help", "")}'.rstrip())
        options = field.get('options')
        if options is not None and text not in options:
            raise ValueError(f'{label} must be one of: {", ".join(options)}.')
        filled[name] = text

    base = template['base_url']
    missing = [name for name in placeholders(base) if name not in filled]
    if missing:
        raise ValueError(f'The connector is missing its "{missing[0]}" field.')
    url = _substitute(base, filled)
    parts = urlsplit(url)
    if parts.scheme != 'https' or not parts.hostname:
        raise ValueError('The address built from these fields is not a valid https address.')
    return url


def _substitute(text: str, values: dict) -> str:
    """Replace each `{field}` with its value, once; inserted text is not rescanned."""
    return PLACEHOLDER_SUB_RE.sub(lambda m: values[m.group(1)], text)


def load_spec(name: str) -> dict:
    """The OpenAPI document `name` in the catalogue directory.

    Raises CardSpecMissing for a bad name, a missing file or a file that is not
    a JSON object. A name is only ever a file name, never a path.
    """
    if not isinstance(name, str) or not SPEC_NAME_RE.fullmatch(name):
        raise CardSpecMissing('The connector names no valid API description.')
    try:
        data = json.loads((Path(CATALOGUE_DIR) / name).read_text(encoding='utf-8'))
    except (OSError, ValueError) as exc:
        raise CardSpecMissing(f'API description {name} could not be read.') from exc
    if not isinstance(data, dict):
        raise CardSpecMissing(f'API description {name} is not an OpenAPI object.')
    return data


def _operations(spec: dict):
    paths = (spec or {}).get('paths') or {}
    if not isinstance(paths, dict):
        return
    for path, item in paths.items():
        if not isinstance(item, dict):
            continue
        for method, op in item.items():
            if str(method).upper() not in ('GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'):
                continue
            yield str(method).upper(), path, (op if isinstance(op, dict) else {})


def read_operations(spec: dict) -> list[dict]:
    """The GET and HEAD operations of a spec: `{method, path, summary}`, in order."""
    out = []
    for method, path, op in _operations(spec):
        if method not in ALLOWED_METHODS:
            continue
        summary = str(op.get('summary') or op.get('description') or '')[:200]
        out.append({'method': method, 'path': path, 'summary': summary})
    return out


def check_operation(spec: dict) -> tuple[str, str]:
    """The `(method, path)` the live check calls.

    Exactly one GET or HEAD operation must carry `"x-aiaas-check": true`.
    """
    flagged = [(method, path) for method, path, op in _operations(spec)
               if op.get(CHECK_FLAG) is True]
    if len(flagged) != 1:
        raise ValueError(
            f'The API description must mark exactly one operation with '
            f'"{CHECK_FLAG}": true (found {len(flagged)}).')
    method, path = flagged[0]
    if method not in ALLOWED_METHODS:
        raise ValueError(f'The check operation must be GET or HEAD, not {method}.')
    return method, path
