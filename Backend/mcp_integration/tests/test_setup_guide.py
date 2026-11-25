"""The connector kind and the Get started panel (Phase 9a).

Three things are pinned here: the validator's rules (a table, so each refusal
has a name), what the migration left in the curated rows after every migration
has run, and the API contract the web and mobile apps build against: both new
fields come back on `GET /api/mcp/servers/` and neither can be written there.
"""
from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from mcp_integration.models import MCPServer
from mcp_integration.setup_guide import validate_setup_guide

User = get_user_model()

KINDS = {'mcp', 'native', 'api', 'sql'}


def _guide(**overrides):
    guide = {
        'steps': [{'text': 'Click Connect.'}],
    }
    guide.update(overrides)
    return guide


class ValidateSetupGuideTests(SimpleTestCase):

    def test_empty_guide_is_valid_and_means_no_guide(self):
        self.assertEqual(validate_setup_guide({}), {})

    def test_full_guide_is_normalised_with_every_key_present(self):
        out = validate_setup_guide({
            'you_need': ['  A Google account  '],
            'admin_needed': '  Ask your admin.  ',
            'cost': ' Free ',
            'time': ' 1 minute ',
            'steps': [
                {'text': '  Click Connect.  '},
                {'text': 'Open the page.', 'url': 'https://example.com/a'},
            ],
            'limits': ['  Reconnect after a week.  '],
        })
        self.assertEqual(out, {
            'you_need': ['A Google account'],
            'admin_needed': 'Ask your admin.',
            'cost': 'Free',
            'time': '1 minute',
            'steps': [
                {'text': 'Click Connect.'},
                {'text': 'Open the page.', 'url': 'https://example.com/a'},
            ],
            'limits': ['Reconnect after a week.'],
        })

    def test_missing_optional_keys_take_their_defaults(self):
        out = validate_setup_guide(_guide())
        self.assertEqual(out, {
            'you_need': [],
            'admin_needed': None,
            'cost': '',
            'time': '',
            'steps': [{'text': 'Click Connect.'}],
            'limits': [],
        })

    def test_blank_admin_needed_is_stored_as_null(self):
        out = validate_setup_guide(_guide(admin_needed='   '))
        self.assertIsNone(out['admin_needed'])

    def test_refusals(self):
        cases = {
            'unknown top-level key': _guide(step='typo'),
            'unknown step key': {'steps': [{'text': 'Go', 'note': 'x'}]},
            'http url': {'steps': [{'text': 'Go', 'url': 'http://example.com'}]},
            'url with no host': {'steps': [{'text': 'Go', 'url': 'https://'}]},
            'url over 500 chars': {
                'steps': [{'text': 'Go', 'url': 'https://example.com/' + 'a' * 500}],
            },
            '13 steps': {'steps': [{'text': f'Step {n}'} for n in range(13)]},
            '0 steps in a non-empty guide': {'steps': []},
            'guide without steps': {'cost': 'Free'},
            '201-char you_need item': {'steps': [{'text': 'Go'}], 'you_need': ['x' * 201]},
            'blank you_need item': {'steps': [{'text': 'Go'}], 'you_need': ['   ']},
            'nine you_need items': {
                'steps': [{'text': 'Go'}], 'you_need': [f'item {n}' for n in range(9)],
            },
            'step without text': {'steps': [{'url': 'https://example.com'}]},
            'admin_needed over 300 chars': _guide(admin_needed='x' * 301),
            'cost over 120 chars': _guide(cost='x' * 121),
            'time over 60 chars': _guide(time='x' * 61),
            'step text over 400 chars': {'steps': [{'text': 'x' * 401}]},
            'not an object': ['steps'],
            'steps not a list': {'steps': 'Click Connect.'},
        }
        for label, value in cases.items():
            with self.subTest(label), self.assertRaises(ValueError):
                validate_setup_guide(value)

    def test_limits_over_eight_items_is_refused(self):
        with self.assertRaises(ValueError):
            validate_setup_guide(_guide(limits=[f'limit {n}' for n in range(9)]))


class CuratedRowsAfterMigrationTests(TestCase):
    """The rows as every migration left them, which is what a fresh install serves."""

    def test_every_curated_row_has_a_known_kind(self):
        for server in MCPServer.objects.filter(user__isnull=True):
            with self.subTest(server.name):
                self.assertIn(server.kind, KINDS)

    def test_native_rows_are_kind_native(self):
        natives = MCPServer.objects.filter(user__isnull=True, type='native')
        self.assertTrue(natives.exists())
        for server in natives:
            with self.subTest(server.name):
                self.assertEqual(server.kind, 'native')

    def test_enabled_curated_guides_pass_the_validator(self):
        enabled = MCPServer.objects.filter(user__isnull=True, enabled=True)
        self.assertTrue(enabled.exists())
        for server in enabled:
            with self.subTest(server.name):
                if server.setup_guide:
                    # Idempotent: a stored guide is already in normalised form.
                    self.assertEqual(validate_setup_guide(server.setup_guide), server.setup_guide)

    def test_gmail_guide_has_steps(self):
        gmail = MCPServer.objects.get(name='Gmail', user__isnull=True)
        self.assertTrue(gmail.setup_guide['steps'])
        self.assertEqual(gmail.setup_guide['you_need'], ['A Google account'])
        self.assertEqual(gmail.setup_guide['cost'], 'Free')

    def test_notion_guide_points_at_the_integrations_page(self):
        notion = MCPServer.objects.get(name='Notion', user__isnull=True)
        self.assertEqual(notion.kind, 'native')
        self.assertEqual(
            notion.setup_guide['steps'][0]['url'],
            'https://www.notion.so/my-integrations',
        )

    def test_disabled_curated_rows_have_no_guide(self):
        for server in MCPServer.objects.filter(user__isnull=True, enabled=False, kind='mcp'):
            # API cards ship disabled (Coming soon) *with* their guide: the
            # guide is how a user learns what the card will need.
            with self.subTest(server.name):
                self.assertEqual(server.setup_guide, {})


class SetupGuideApiTests(TestCase):

    def setUp(self):
        self.user = User.objects.create_user(username='alice', password='x')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_list_returns_kind_and_setup_guide_on_each_server(self):
        res = self.client.get('/api/mcp/servers/')
        self.assertEqual(res.status_code, 200)
        servers = res.data['servers']
        self.assertTrue(servers)
        for server in servers:
            with self.subTest(server['name']):
                self.assertIn('kind', server)
                self.assertIn('setup_guide', server)
                self.assertIn(server['kind'], KINDS)

        gmail = next(s for s in servers if s['name'] == 'Gmail')
        self.assertEqual(gmail['kind'], 'native')
        self.assertTrue(gmail['setup_guide']['steps'])

    def test_patch_cannot_write_setup_guide_or_kind_on_an_owned_row(self):
        owned = MCPServer.objects.create(
            name='My own row', type='stdio', command='npx', user=self.user,
            setup_guide={},
        )
        payload = {
            'setup_guide': _guide(cost='Free'),
            'kind': 'native',
        }
        res = self.client.patch(f'/api/mcp/servers/{owned.id}/', payload, format='json')
        self.assertEqual(res.status_code, 200)

        owned.refresh_from_db()
        self.assertEqual(owned.setup_guide, {})
        self.assertEqual(owned.kind, 'mcp')
