"""connector_check --probe and --all: the verdict for each status, the field and
SKIPPED rules, the refusals, and the summary. No network: `_get` and the egress
guard are stubbed, and the spec files live in a temporary directory."""
from __future__ import annotations

import json
import shutil
import tempfile
from io import StringIO
from pathlib import Path
from unittest import mock

import httpx
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from mcp_integration import card_template
from mcp_integration.management.commands.connector_check import PROBE_SECRET
from mcp_integration.models import MCPServer

MODULE = "mcp_integration.management.commands.connector_check"

SPEC = {
    "openapi": "3.0.0",
    "paths": {
        "/zones": {"get": {"summary": "List zones", "x-aiaas-check": True}},
    },
}

TEMPLATE = {
    "base_url": "https://{subdomain}.example-card.test/api/v2",
    "spec": "probe-card.json",
    "auth": {"parts": [{"in": "header", "name": "Authorization", "value": "Bearer {apiKey}"}]},
    "fields": [{"name": "subdomain", "label": "Subdomain", "pattern": "^[a-z0-9-]{1,63}$"}],
    "allowed_methods": ["GET", "HEAD"],
}


class ConnectorProbeTests(TestCase):
    def setUp(self):
        # The migrated curated cards read their real specs, which this test does
        # not point at. Drop them for this test (the transaction rolls it back).
        MCPServer.objects.filter(kind="api").delete()
        self.spec_dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.spec_dir, ignore_errors=True)
        (self.spec_dir / "probe-card.json").write_text(json.dumps(SPEC), encoding="utf-8")
        patcher = mock.patch.object(card_template, "CATALOGUE_DIR", self.spec_dir)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.card = self.make_card()

    def make_card(self, icon_slug="probe-card", **overrides):
        values = {
            "name": icon_slug, "display_name": icon_slug, "kind": "api",
            "icon_slug": icon_slug, "enabled": False, "coming_soon": True, "user": None,
            "required_credential_types": ["card-probe"], "template": TEMPLATE,
            "category": "utilities",
        }
        values.update(overrides)
        return MCPServer.objects.create(**values)

    def probe(self, *extra, status=200, side_effect=None, slug="probe-card", fields=("subdomain=acme",)):
        """Run the command. Returns (stdout, the _get mock, the CommandError text or None)."""
        out = StringIO()
        get_kwargs = {"new_callable": mock.AsyncMock}
        if side_effect is None:
            get_kwargs["return_value"] = status
        else:
            get_kwargs["side_effect"] = side_effect
        args = [slug] if slug else []
        for pair in fields:
            args += ["--field", pair]
        error = None
        with mock.patch(f"{MODULE}._get", **get_kwargs) as get, \
                mock.patch(f"{MODULE}.check_egress", return_value=(True, "")):
            try:
                call_command("connector_check", *args, "--probe", *extra, stdout=out)
            except CommandError as exc:
                error = str(exc)
        return out.getvalue(), get, error

    def test_status_codes_map_to_verdicts(self):
        cases = [
            (401, "REACHABLE"), (403, "REACHABLE"),
            (400, "WARN"), (404, "WARN"), (405, "WARN"), (302, "WARN"),
            (200, "WARN"), (422, "WARN"), (500, "WARN"),
        ]
        for status, verdict in cases:
            with self.subTest(status=status):
                text, get, error = self.probe(status=status)
                self.assertIsNone(error)
                self.assertIn(verdict, text)
                self.assertIn(f"{status}", text)
                get.assert_awaited_once()

    def test_timeout_is_fail_and_names_only_the_class(self):
        text, _, error = self.probe(side_effect=httpx.ReadTimeout("slow, see https://x.example-card.test"))
        self.assertIn("FAIL", text)
        self.assertIn("ReadTimeout", text)
        self.assertNotIn("slow, see", text)
        self.assertEqual(error, "1 card(s) failed the probe.")

    def test_connect_error_is_fail(self):
        text, _, error = self.probe(side_effect=httpx.ConnectError("no route"))
        self.assertIn("FAIL", text)
        self.assertIsNotNone(error)

    def test_egress_refusal_is_fail_and_sends_nothing(self):
        out = StringIO()
        with mock.patch(f"{MODULE}._get", new_callable=mock.AsyncMock) as get, \
                mock.patch(f"{MODULE}.check_egress", return_value=(False, "Refused: private address.")):
            with self.assertRaises(CommandError):
                call_command("connector_check", "probe-card", "--probe",
                             "--field", "subdomain=acme", stdout=out)
        get.assert_not_awaited()
        self.assertIn("FAIL", out.getvalue())
        self.assertIn("Refused: private address.", out.getvalue())

    def test_missing_field_is_skipped_without_a_request(self):
        text, get, error = self.probe(fields=())
        self.assertIn("SKIPPED", text)
        self.assertIn("needs field subdomain", text)
        self.assertIsNone(error)
        get.assert_not_awaited()

    def test_probe_needs_no_user_and_sends_the_fake_key_in_the_header(self):
        text, get, error = self.probe()
        self.assertIsNone(error)
        get.assert_awaited_once()
        method, url, headers, params = get.await_args.args
        self.assertEqual(method, "GET")
        self.assertEqual(url, "https://acme.example-card.test/api/v2/zones")
        self.assertEqual(headers["Authorization"], f"Bearer {PROBE_SECRET}")
        self.assertEqual(params, {})
        self.assertNotIn(PROBE_SECRET, text)

    def test_query_style_auth_goes_in_params_and_is_never_printed(self):
        self.make_card(
            icon_slug="query-card",
            template={**TEMPLATE, "auth": {"parts": [{"in": "query", "name": "token", "value": "{apiKey}"}]}},
        )
        text, get, error = self.probe(slug="query-card")
        self.assertIsNone(error)
        _, url, headers, params = get.await_args.args
        self.assertEqual(params, {"token": PROBE_SECRET})
        self.assertNotIn("token", headers)
        self.assertNotIn(PROBE_SECRET, text)
        self.assertNotIn("token=", text)
        self.assertNotIn("?", url)

    def test_probe_never_enables_a_card(self):
        text, get, error = self.probe("--enable")
        self.assertIsNotNone(error)
        self.assertIn("never enables", error)
        get.assert_not_awaited()
        self.card.refresh_from_db()
        self.assertFalse(self.card.enabled)
        self.assertTrue(self.card.coming_soon)

    def test_all_needs_probe(self):
        with self.assertRaisesMessage(CommandError, "--all runs only with --probe."):
            call_command("connector_check", "--all", stdout=StringIO())

    def test_plain_check_still_needs_a_user(self):
        with self.assertRaisesMessage(CommandError, "--user is needed unless --probe is given."):
            call_command("connector_check", "probe-card", stdout=StringIO())

    def test_unknown_field_is_refused_for_one_card(self):
        _, get, error = self.probe(fields=("nope=1",))
        self.assertEqual(error, "probe-card has no field 'nope'.")
        get.assert_not_awaited()

    def test_a_non_api_card_is_not_probed(self):
        self.make_card(icon_slug="plain", kind="mcp", type="stdio", command="npx", template={})
        text, get, error = self.probe(slug="plain")
        self.assertIn("not supported yet", text)
        self.assertIsNone(error)
        get.assert_not_awaited()

    def test_all_prints_one_line_per_card_and_a_summary(self):
        self.make_card(icon_slug="other-card", template={
            **TEMPLATE, "base_url": "https://{subdomain}.other-card.test/api/v1"})
        self.make_card(icon_slug="no-spec", template={"base_url": "https://x.example.test"})

        def by_host(method, url, headers, params):
            return 401 if "example-card.test" in url else 200

        text, get, error = self.probe("--all", slug=None, side_effect=by_host)
        self.assertIsNone(error)
        self.assertIn("REACHABLE  probe-card", text)
        self.assertIn("WARN       other-card", text)
        self.assertNotIn("no-spec", text)
        self.assertIn("Probed 2 cards: 1 REACHABLE, 1 WARN, 0 FAIL, 0 SKIPPED.", text)
        self.assertNotIn(PROBE_SECRET, text)
        self.assertEqual(get.await_count, 2)

    def test_all_counts_skipped_and_exits_non_zero_on_fail(self):
        self.make_card(icon_slug="broken-card", template={**TEMPLATE, "spec": "missing.json"})
        self.make_card(icon_slug="gated", template={
            **TEMPLATE, "base_url": "https://{subdomain}.gated.test/api",
            "fields": [{"name": "subdomain", "label": "Subdomain"}, {"name": "region", "label": "Region"}]})
        text, get, error = self.probe("--all", slug=None, status=401)
        self.assertEqual(error, "1 card(s) failed the probe.")
        self.assertIn("FAIL       broken-card", text)
        self.assertIn("SKIPPED    gated", text)
        self.assertIn("Probed 3 cards: 1 REACHABLE, 0 WARN, 1 FAIL, 1 SKIPPED.", text)
        self.assertEqual(get.await_count, 1)

    def test_all_with_a_card_name_is_refused(self):
        with self.assertRaisesMessage(CommandError, "name one connector or pass --all, not both."):
            call_command("connector_check", "probe-card", "--probe", "--all", stdout=StringIO())
