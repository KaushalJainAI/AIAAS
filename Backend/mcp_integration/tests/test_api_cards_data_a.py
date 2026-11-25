"""The twelve batch-A API cards (Phase 10 data, migration 0026) are in the database and valid.

Checks run against the rows the migrations wrote, so they also prove the
migration did what it says. The template validator is imported inside the test
because `card_template.py` is written by the engine work; until it exists this
test fails with ImportError, on purpose, rather than passing on an empty check.
"""
import json
import re
from pathlib import Path

from django.test import TestCase

from credentials.models import CredentialType
from mcp_integration.models import MCPServer
from mcp_integration.setup_guide import validate_setup_guide

CATALOGUE = Path(__file__).resolve().parents[2] / "datasources" / "catalogue"

# Card name (the MCPServer row name) -> icon_slug (also the spec file stem).
CARDS = {
    "Cloudflare": "cloudflare",
    "DigitalOcean": "digitalocean",
    "Netlify": "netlify",
    "Vercel": "vercel",
    "PagerDuty": "pagerduty",
    "Todoist": "todoist",
    "Trello": "trello",
    "ClickUp": "clickup",
    "Airtable": "airtable",
    "Calendly": "calendly",
    "Cal.com": "calcom",
    "Pipedrive": "pipedrive",
}

HTTP_METHODS = {"get", "head", "post", "put", "patch", "delete", "options", "trace"}
READ_METHODS = {"get", "head"}
PLACEHOLDER = re.compile(r"\{(\w+)\}")


class APICardsBatchATests(TestCase):

    def _row(self, name):
        return MCPServer.objects.get(name=name, user__isnull=True)

    def test_every_card_row_is_a_disabled_api_card_awaiting_its_check(self):
        for name in CARDS:
            with self.subTest(card=name):
                row = self._row(name)
                self.assertEqual(row.kind, "api")
                self.assertEqual(row.type, "http")
                self.assertEqual(row.url, "")
                self.assertFalse(row.enabled, "a card is switched on only after a live check")
                self.assertTrue(row.coming_soon)
                self.assertEqual(row.icon_slug, CARDS[name])
                self.assertTrue(row.help_url.startswith("https://"))
                self.assertIn(row.category, {
                    "google_workspace", "communication", "productivity",
                    "development", "utilities", "custom",
                })

    def test_setup_guide_passes_the_validator_and_has_steps(self):
        for name in CARDS:
            with self.subTest(card=name):
                row = self._row(name)
                checked = validate_setup_guide(row.setup_guide)
                self.assertGreaterEqual(len(checked["steps"]), 2)
                self.assertIn(
                    "Read-only: the assistant can look things up but cannot change anything.",
                    checked["limits"],
                )
                # Trello has two secrets, so its last step names both.
                expected = (
                    "Paste the key and the token here and click Save."
                    if name == "Trello" else "Paste the key here and click Save."
                )
                self.assertEqual(checked["steps"][-1]["text"], expected)

    def test_card_template_passes_the_template_validator(self):
        from mcp_integration.card_template import validate_card_template

        for name in CARDS:
            with self.subTest(card=name):
                row = self._row(name)
                validate_card_template(row.template)

    def test_spec_file_is_small_valid_json_with_get_only_and_one_check(self):
        for name, slug in CARDS.items():
            with self.subTest(card=name):
                path = CATALOGUE / f"{slug}.json"
                self.assertTrue(path.exists(), path)
                self.assertLess(path.stat().st_size, 30 * 1024)
                spec = json.loads(path.read_text(encoding="utf-8"))
                self.assertIn("openapi", spec)
                self.assertIn("title", spec["info"])
                self.assertIn("version", spec["info"])

                gets = 0
                checks = 0
                for route, item in spec["paths"].items():
                    methods = {key for key in item if key in HTTP_METHODS}
                    self.assertTrue(
                        methods <= READ_METHODS,
                        f"{route} has a write method: {sorted(methods - READ_METHODS)}",
                    )
                    for method, op in item.items():
                        if method not in HTTP_METHODS:
                            continue
                        gets += 1
                        if op.get("x-aiaas-check"):
                            checks += 1
                        for param in op.get("parameters", []):
                            if param.get("in") == "path":
                                self.assertTrue(param.get("required"), f"{route} path param not required")
                self.assertGreaterEqual(gets, 4)
                self.assertLessEqual(gets, 8)
                self.assertEqual(checks, 1, "exactly one operation proves the key works")

    def test_spec_file_is_the_one_the_template_names(self):
        for name, slug in CARDS.items():
            with self.subTest(card=name):
                template = self._row(name).template
                self.assertEqual(template["spec"], f"{slug}.json")
                self.assertTrue((CATALOGUE / template["spec"]).exists())
                self.assertEqual(template["allowed_methods"], ["GET", "HEAD"])

    def test_every_auth_placeholder_is_a_field_of_the_card_credential(self):
        for name in CARDS:
            with self.subTest(card=name):
                row = self._row(name)
                self.assertEqual(len(row.required_credential_types), 1)
                cred = CredentialType.objects.get(slug=row.required_credential_types[0])
                field_ids = {field["id"] for field in cred.fields_schema}
                used = set()
                for part in row.template["auth"]["parts"]:
                    used |= set(PLACEHOLDER.findall(part["value"]))
                self.assertTrue(used, "auth must send the key somewhere")
                self.assertLessEqual(used, field_ids)
                # None of these cards asks the user for a field in the base URL.
                base_placeholders = set(PLACEHOLDER.findall(row.template["base_url"]))
                self.assertLessEqual(base_placeholders, {f["name"] for f in row.template["fields"]})

    def test_credential_types_exist_and_are_api_keys_with_password_fields(self):
        for name, slug in CARDS.items():
            with self.subTest(card=name):
                cred_slug = f"card-{slug}"
                cred = CredentialType.objects.get(slug=cred_slug)
                self.assertEqual(cred.auth_method, "api_key")
                self.assertTrue(cred.is_active)
                self.assertTrue(cred.fields_schema)
                for field in cred.fields_schema:
                    self.assertEqual(field["type"], "string")
                    self.assertTrue(field["required"])
                    self.assertTrue(field["isPassword"])
                self.assertEqual(self._row(name).required_credential_types, [cred_slug])

    def test_trello_has_two_secret_fields_and_the_others_have_one(self):
        self.assertEqual(
            [f["id"] for f in CredentialType.objects.get(slug="card-trello").fields_schema],
            ["apiKey", "token"],
        )
        for name, slug in CARDS.items():
            if slug == "trello":
                continue
            with self.subTest(card=name):
                fields = CredentialType.objects.get(slug=f"card-{slug}").fields_schema
                self.assertEqual([f["id"] for f in fields], ["apiKey"])
