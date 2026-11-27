"""
Checks the eleven batch B API cards written by `0027_api_cards_b`.

The migration writes its data inline and calls no validator, so this file is
where the data is held to the rules: each row must pass the same validators
the app uses (`setup_guide.validate_setup_guide`, and `card_template`), each
spec must be a small read-only OpenAPI document with one live check, and every
placeholder must name a field that exists.
"""
import json
import re
from pathlib import Path

from django.test import TestCase

from credentials.models import CredentialType
from mcp_integration.models import MCPServer
from mcp_integration.setup_guide import validate_setup_guide

CATALOGUE_DIR = Path(__file__).resolve().parents[2] / 'datasources' / 'catalogue'

CARDS = {
    'Freshdesk': 'freshdesk',
    'Mailchimp': 'mailchimp',
    'Klaviyo': 'klaviyo',
    'SendGrid': 'sendgrid',
    'Brevo': 'brevo',
    'Postmark': 'postmark',
    'Typeform': 'typeform',
    'Jotform': 'jotform',
    'Contentful': 'contentful',
    'WooCommerce': 'woocommerce',
    'OpenWeather': 'openweather',
}

PLACEHOLDER = re.compile(r'\{([A-Za-z_][A-Za-z0-9_]*)\}')
ALLOWED_PATH_KEYS = {'get', 'head', 'parameters', 'summary', 'description'}


def _placeholders(text):
    return set(PLACEHOLDER.findall(text))


class APICardsBDataTests(TestCase):

    def _row(self, name):
        return MCPServer.objects.get(name=name, user__isnull=True)

    def test_every_card_is_an_api_card_switched_off(self):
        for name in CARDS:
            with self.subTest(card=name):
                row = self._row(name)
                self.assertEqual(row.kind, 'api')
                self.assertFalse(row.enabled)
                self.assertTrue(row.coming_soon)

    def test_setup_guide_passes_the_validator(self):
        for name in CARDS:
            with self.subTest(card=name):
                guide = self._row(name).setup_guide
                checked = validate_setup_guide(guide)
                self.assertGreaterEqual(len(checked['steps']), 2)

    def test_template_passes_the_validator(self):
        try:
            from mcp_integration.card_template import validate_card_template
        except ImportError as exc:  # pragma: no cover - written by the engine agent
            self.fail(f'mcp_integration.card_template is missing: {exc}')
        for name in CARDS:
            with self.subTest(card=name):
                validate_card_template(self._row(name).template)

    def test_spec_file_is_a_small_read_only_document_with_one_check(self):
        for name, icon in CARDS.items():
            with self.subTest(card=name):
                path = CATALOGUE_DIR / f'{icon}.json'
                self.assertTrue(path.is_file(), f'missing spec {path}')
                self.assertLess(path.stat().st_size, 30 * 1024)
                spec = json.loads(path.read_text(encoding='utf-8'))
                self.assertTrue(str(spec.get('openapi', '')).startswith('3.0'))
                self.assertIn('title', spec.get('info', {}))
                self.assertIn('version', spec.get('info', {}))

                checks = 0
                gets = 0
                for route, item in spec['paths'].items():
                    extra = set(item) - ALLOWED_PATH_KEYS
                    self.assertFalse(extra, f'{route} has non-GET operations: {sorted(extra)}')
                    for method in ('get', 'head'):
                        op = item.get(method)
                        if op is None:
                            continue
                        gets += 1
                        self.assertIn('summary', op, f'{route} {method} has no summary')
                        if op.get('x-aiaas-check') is True:
                            checks += 1
                        for param in op.get('parameters', []):
                            if param.get('in') == 'path':
                                self.assertTrue(param.get('required'), f'{route} path param {param} must be required')
                self.assertEqual(checks, 1, 'exactly one operation must carry x-aiaas-check')
                self.assertGreaterEqual(gets, 4)
                self.assertLessEqual(gets, 8)

    def test_auth_placeholders_are_credential_fields(self):
        for name, icon in CARDS.items():
            with self.subTest(card=name):
                row = self._row(name)
                cred = CredentialType.objects.get(slug=row.required_credential_types[0])
                field_names = {field['id'] for field in cred.fields_schema}
                for part in row.template['auth']['parts']:
                    text = ' '.join(str(v) for k, v in part.items() if k in ('value', 'user', 'password'))
                    self.assertTrue(_placeholders(text) <= field_names,
                                    f'auth placeholders {_placeholders(text)} not in {field_names}')

    def test_base_url_placeholders_are_user_fields(self):
        for name in CARDS:
            with self.subTest(card=name):
                template = self._row(name).template
                field_names = {field['name'] for field in template['fields']}
                self.assertTrue(_placeholders(template['base_url']) <= field_names)

    def test_credential_type_is_inline_and_active(self):
        for name, icon in CARDS.items():
            with self.subTest(card=name):
                cred = CredentialType.objects.get(slug=f'card-{icon}')
                self.assertTrue(cred.is_active)
                self.assertEqual(cred.auth_method, 'api_key')
                for field in cred.fields_schema:
                    self.assertTrue(field['isPassword'])
                    self.assertTrue(field['required'])
