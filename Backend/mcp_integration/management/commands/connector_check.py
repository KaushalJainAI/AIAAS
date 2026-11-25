"""Live check of a connector card against the real service.

    python manage.py connector_check <icon_slug> --user <email> [--field name=value ...] [--enable]
    python manage.py connector_check <icon_slug> --probe [--field name=value ...]
    python manage.py connector_check --probe --all

For an API card: builds the URL from the template and the given fields, finds
the spec's one operation marked `"x-aiaas-check": true`, resolves the user's
stored credential, makes that single GET (15 s timeout) after the egress guard,
and prints PASS or FAIL with the status code. Nothing secret is printed: the
URL shown is the template's base address and the operation path, never the
query string (which can carry a token in a query-style auth).

With `--enable`, a PASS switches the card on (`enabled=True, coming_soon=False`).
Other kinds print that they are not supported yet.

With `--probe` there is no account and no stored credential. Every credential
placeholder is filled with `PROBE_SECRET`, an obviously fake key, and the same
one GET is sent. The answer is a verdict about wiring, not about the key (see
`_verdict_for`). A probe never enables a card. `--all` (only with `--probe`)
runs it over every curated API card and exits non-zero if any card FAILs.
"""
from __future__ import annotations

import time
from dataclasses import dataclass

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
USER_AGENT = "AIAAS/1.0"
#: What every credential placeholder becomes in probe mode. Obviously fake;
#: never printed and never stored.
PROBE_SECRET = "aiaas-probe-not-a-real-key"

REACHABLE = "REACHABLE"
WARN = "WARN"
FAIL = "FAIL"
SKIPPED = "SKIPPED"
VERDICTS = (REACHABLE, WARN, FAIL, SKIPPED)


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


def _curated_server(slug: str) -> MCPServer:
    server = MCPServer.objects.filter(icon_slug=slug, user__isnull=True).first()
    if server is None:
        raise CommandError(f"No curated connector has icon_slug {slug!r}.")
    return server


def _field_names(template: dict) -> list[str]:
    return [field["name"] for field in (template or {}).get("fields", [])]


def _request_headers(parts: list[dict], values: dict) -> tuple[dict, dict]:
    """The headers and query params a check sends. Shared by the live check and the probe."""
    headers: dict = {"User-Agent": USER_AGENT}
    params: dict = {}
    if parts:
        headers, params = apply_parts(parts, values)
    return headers, params


def _verdict_for(status: int) -> tuple[str, str]:
    """The verdict and a short reading for the status a probe got back.

    401/403 mean the host, the path and the auth placement all reached the
    vendor, which refused the fake key. Other codes are a warning, and the
    status is printed so a person can judge (some vendors answer 400 or 422 to
    a bad key).
    """
    if status in (401, 403):
        return REACHABLE, "host, path and auth placement wired; the vendor refused the fake key"
    if 200 <= status < 300:
        return WARN, "endpoint did not require auth, or auth was not sent where the vendor reads it"
    if status in (400, 404, 405) or 300 <= status < 400:
        return WARN, "path or host suspect"
    return WARN, "unexpected status; check by hand"


@dataclass
class ProbeResult:
    slug: str
    method: str
    path: str
    verdict: str
    status: int | None = None
    ms: int | None = None
    note: str = ""

    def line(self) -> str:
        op = f"{self.method} {self.path}"
        status = str(self.status) if self.status is not None else "-"
        ms = f"{self.ms} ms" if self.ms is not None else "-"
        return f"{self.verdict:<10} {self.slug:<18} {op:<40} {status:<4} {ms:<9} {self.note}".rstrip()


def _probe_card(server: MCPServer, fields: dict) -> ProbeResult:
    """Probe one card. `fields` holds only this card's own field names."""
    template = server.template or {}
    slug = server.icon_slug
    try:
        spec = load_spec(template.get("spec", ""))
        method, path = check_operation(spec)
    except (ValueError, CardSpecMissing) as exc:
        return ProbeResult(slug, "-", "-", FAIL, note=str(exc))

    missing = [name for name in _field_names(template) if not str(fields.get(name) or "").strip()]
    if missing:
        return ProbeResult(slug, method, path, SKIPPED, note=f"needs field {missing[0]}")
    try:
        base_url = render_base_url(template, {name: fields[name] for name in _field_names(template)})
    except ValueError as exc:
        return ProbeResult(slug, method, path, SKIPPED, note=f"field refused: {exc}")

    try:
        parts = check_parts((template.get("auth") or {}).get("parts") or [])
        values = {name: PROBE_SECRET for name in part_placeholders(parts)}
        headers, params = _request_headers(parts, values)
    except ValueError:
        return ProbeResult(slug, method, path, FAIL, note="the auth parts could not be built")

    target = base_url.rstrip("/") + path
    allowed, reason = check_egress(target, None)
    if not allowed:
        return ProbeResult(slug, method, path, FAIL, note=reason)

    started = time.perf_counter()
    try:
        status_code = async_to_sync(_get)(method, target, headers, params)
    except Exception as exc:  # noqa: BLE001 — name the class only: its text may hold the URL
        ms = int((time.perf_counter() - started) * 1000)
        return ProbeResult(slug, method, path, FAIL, ms=ms,
                           note=f"the request failed ({type(exc).__name__})")
    ms = int((time.perf_counter() - started) * 1000)
    verdict, note = _verdict_for(status_code)
    return ProbeResult(slug, method, path, verdict, status=status_code, ms=ms, note=note)


class Command(BaseCommand):
    help = "Check a connector card against its real service (PASS/FAIL), or probe it with a fake key (--probe)."

    def add_arguments(self, parser):
        parser.add_argument("icon_slug", nargs="?",
                            help="The card's icon_slug, e.g. freshdesk. Not needed with --all.")
        parser.add_argument("--user",
                            help="Email of the account whose credential is used. Not needed with --probe.")
        parser.add_argument("--field", action="append", default=[], metavar="NAME=VALUE",
                            help="A form field of the card. Repeat for each field.")
        parser.add_argument("--enable", action="store_true",
                            help="On PASS, switch the card on. Not allowed with --probe.")
        parser.add_argument("--probe", action="store_true",
                            help="Send the check with a fake key. No account needed; never enables a card.")
        parser.add_argument("--all", action="store_true",
                            help="With --probe: probe every curated API card, one line each.")

    def handle(self, *args, **options):
        if options["probe"]:
            return self._probe(options)
        if options["all"]:
            raise CommandError("--all runs only with --probe.")
        if not options["icon_slug"]:
            raise CommandError("Name a connector: connector_check <icon_slug> --user <email>.")
        if not options["user"]:
            raise CommandError("--user is needed unless --probe is given.")

        User = get_user_model()
        user = User.objects.filter(email__iexact=options["user"]).first()
        if user is None:
            raise CommandError("No account has that email.")
        server = _curated_server(options["icon_slug"])
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
        headers, params = {"User-Agent": USER_AGENT}, {}
        if parts:
            slug = (server.required_credential_types or [""])[0]
            data = async_to_sync(CredentialManager().get_credential_by_slug)(slug, user.id)
            if data is None:
                return self._fail(server, path, "no credential is connected for this account")
            values = {name: str(data.get(name) or "") for name in part_placeholders(parts)}
            try:
                headers, params = _request_headers(parts, values)
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

    def _probe(self, options):
        if options["enable"]:
            raise CommandError("--probe never enables a card. Drop --enable.")
        if options["all"] and options["icon_slug"]:
            raise CommandError("With --probe, name one connector or pass --all, not both.")
        if not options["all"] and not options["icon_slug"]:
            raise CommandError("With --probe, name a connector or pass --all.")
        fields = _parse_fields(options["field"])

        if options["all"]:
            servers = [
                server for server in MCPServer.objects.filter(kind="api", user__isnull=True).order_by("icon_slug")
                if (server.template or {}).get("spec")
            ]
            results = [
                _probe_card(server, {k: v for k, v in fields.items() if k in _field_names(server.template)})
                for server in servers
            ]
        else:
            server = _curated_server(options["icon_slug"])
            if server.kind != "api":
                self.stdout.write(f"{server.icon_slug}: kind '{server.kind}' is not supported yet.")
                return
            unknown = sorted(set(fields) - set(_field_names(server.template)))
            if unknown:
                raise CommandError(f"{server.icon_slug} has no field {unknown[0]!r}.")
            results = [_probe_card(server, fields)]

        for result in results:
            self.stdout.write(result.line())
        if options["all"]:
            counts = {v: sum(1 for r in results if r.verdict == v) for v in VERDICTS}
            summary = ", ".join(f"{counts[v]} {v}" for v in VERDICTS)
            self.stdout.write(f"Probed {len(results)} cards: {summary}.")
        failed = sum(1 for r in results if r.verdict == FAIL)
        if failed:
            raise CommandError(f"{failed} card(s) failed the probe.")

    def _fail(self, server, path: str, why: str) -> None:
        self.stdout.write(f"FAIL {server.icon_slug}: {path} {why}")
