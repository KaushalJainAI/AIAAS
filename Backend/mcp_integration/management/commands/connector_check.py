"""Live check of a connector card against the real service.

    python manage.py connector_check <icon_slug> --user <email> [--field name=value ...] [--enable]

For an API card: builds the URL from the template and the given fields, finds
the spec's one operation marked `"x-aiaas-check": true`, resolves the user's
stored credential, makes that single GET (15 s timeout) after the egress guard,
and prints PASS or FAIL with the status code. Nothing secret is printed: the
URL shown is the template's base address and the operation path, never the
query string (which can carry a token in a query-style auth).

With `--enable`, a PASS switches the card on (`enabled=True, coming_soon=False`).
Other kinds print that they are not supported yet.
"""
from __future__ import annotations

import httpx
from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from core.safety.net import check_egress
from credentials.manager import CredentialManager
from datasources.auth_template import apply_parts, check_parts, part_placeholders
from mcp_integration.card_template import (
    CardSpecMissing,
    check_operation,
    load_spec,
    render_base_url,
)
from mcp_integration.models import MCPServer

TIMEOUT_S = 15.0


async def _get(method: str, url: str, headers: dict, params: dict) -> int:
    """The one request the check makes. A module function so tests can stub it."""
    async with httpx.AsyncClient(timeout=TIMEOUT_S, follow_redirects=False) as client:
        resp = await client.request(method, url, headers=headers, params=params)
    return resp.status_code


def _parse_fields(pairs: list[str]) -> dict:
    fields: dict[str, str] = {}
    for pair in pairs:
        name, sep, value = pair.partition("=")
        if not sep or not name.strip():
            raise CommandError(f"--field needs name=value, not {pair!r}.")
        fields[name.strip()] = value
    return fields


class Command(BaseCommand):
    help = "Check a connector card against its real service (PASS/FAIL)."

    def add_arguments(self, parser):
        parser.add_argument("icon_slug", help="The card's icon_slug, e.g. freshdesk.")
        parser.add_argument("--user", required=True, help="Email of the account whose credential is used.")
        parser.add_argument("--field", action="append", default=[], metavar="NAME=VALUE",
                            help="A form field of the card. Repeat for each field.")
        parser.add_argument("--enable", action="store_true",
                            help="On PASS, switch the card on.")

    def handle(self, *args, **options):
        User = get_user_model()
        user = User.objects.filter(email__iexact=options["user"]).first()
        if user is None:
            raise CommandError("No account has that email.")
        server = MCPServer.objects.filter(icon_slug=options["icon_slug"], user__isnull=True).first()
        if server is None:
            raise CommandError(f"No curated connector has icon_slug {options['icon_slug']!r}.")
        if server.kind != "api":
            self.stdout.write(f"{server.icon_slug}: kind '{server.kind}' is not supported yet.")
            return

        template = server.template or {}
        try:
            base_url = render_base_url(template, _parse_fields(options["field"]))
            spec = load_spec(template.get("spec", ""))
            method, path = check_operation(spec)
        except (ValueError, CardSpecMissing) as exc:
            raise CommandError(str(exc))

        parts = check_parts((template.get("auth") or {}).get("parts") or [])
        headers: dict = {"User-Agent": "AIAAS/1.0"}
        params: dict = {}
        if parts:
            slug = (server.required_credential_types or [""])[0]
            data = async_to_sync(CredentialManager().get_credential_by_slug)(slug, user.id)
            if data is None:
                return self._fail(server, path, "no credential is connected for this account")
            values = {name: str(data.get(name) or "") for name in part_placeholders(parts)}
            try:
                headers, params = apply_parts(parts, values)
            except ValueError:
                return self._fail(server, path, "the stored credential is missing a field")

        target = base_url.rstrip("/") + path
        allowed, reason = check_egress(target, None)
        if not allowed:
            return self._fail(server, path, reason)

        try:
            status_code = async_to_sync(_get)(method, target, headers, params)
        except Exception as exc:  # noqa: BLE001 — name the class only: its text may hold the URL
            return self._fail(server, path, f"the request failed ({type(exc).__name__})")
        if not 200 <= status_code < 300:
            return self._fail(server, path, f"answered HTTP {status_code}")

        self.stdout.write(f"PASS {server.icon_slug}: {method} {path} answered HTTP {status_code}")
        if options["enable"]:
            server.enabled = True
            server.coming_soon = False
            server.save(update_fields=["enabled", "coming_soon", "updated_at"])
            self.stdout.write(f"{server.icon_slug} is switched on.")

    def _fail(self, server, path: str, why: str) -> None:
        self.stdout.write(f"FAIL {server.icon_slug}: {path} {why}")
