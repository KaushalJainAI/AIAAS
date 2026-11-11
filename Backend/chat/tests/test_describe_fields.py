"""The approval description's new fields: effect, leaves_workspace,
first_contact and action_label (UI redesign B1).

The contract is what the approval card reads, so these tests assert on the
dict `describe_call` / `describe_call_async` return, and on the registry
declarations that feed it.
"""
from __future__ import annotations

from asgiref.sync import async_to_sync
from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase
from unittest.mock import patch

from chat.tools.describe import describe_call, describe_call_async
from logs.models import AgentStep, ExecutionLog


class DeclaredFieldsTests(SimpleTestCase):
    def test_a_send_leaves_the_workspace_and_says_what_its_button_does(self):
        d = describe_call('gmail_send_message', {'to': 'a@example.com', 'body': 'hi'})
        self.assertEqual(d['effect'], 'irreversible')
        self.assertTrue(d['leaves_workspace'])
        self.assertEqual(d['action_label'], 'Send email')
        # The synchronous renderer never reads history, so it says False and
        # `describe_call_async` is the one that can say True.
        self.assertFalse(d['first_contact'])

    def test_a_chat_message_and_a_published_page_leave_the_workspace(self):
        for name, label in (
            ('message_send', 'Send message'),
            ('publish_page', 'Publish page'),
            ('browser_act', 'Run browser steps'),
        ):
            with self.subTest(tool=name):
                d = describe_call(name, {})
                self.assertTrue(d['leaves_workspace'])
                self.assertEqual(d['action_label'], label)

    def test_a_read_stays_inside_and_keeps_the_default_verb(self):
        d = describe_call('gmail_search_threads', {'query': 'invoices'})
        self.assertEqual(d['effect'], 'read')
        self.assertFalse(d['leaves_workspace'])
        self.assertEqual(d['action_label'], 'Approve')

    def test_an_mcp_tool_is_treated_as_the_worst_case(self):
        d = describe_call('mcp__7__send_email_ab12cd34', {'to': 'a@example.com'})
        self.assertEqual(d['effect'], 'irreversible')
        self.assertTrue(d['leaves_workspace'])
        self.assertEqual(d['action_label'], 'Approve')

    def test_an_undeclared_builtin_is_treated_as_the_worst_case(self):
        d = describe_call('no_such_tool_declared_anywhere', {})
        self.assertEqual(d['effect'], 'irreversible')
        self.assertTrue(d['leaves_workspace'])
        self.assertEqual(d['action_label'], 'Approve')

    def test_the_existing_keys_are_kept(self):
        d = describe_call('gmail_send_message', {'to': 'a@example.com'})
        for key in ('title', 'sentence', 'server', 'tool', 'fields'):
            self.assertIn(key, d)

    def test_the_new_fields_do_not_change_the_sentence(self):
        # Rendering rules stay: the sentence is plain text, no markup.
        d = describe_call('gmail_send_message', {'to': '<b>x</b>@example.com'})
        self.assertNotIn('<b>', d['sentence'])
        self.assertEqual(d['action_label'], 'Send email')


class FirstContactTests(TestCase):
    """A recipient is a first contact unless this user has sent to them before."""

    def setUp(self):
        self.user = User.objects.create_user('fc', 'fc@example.com', 'pw')
        self.other = User.objects.create_user('other', 'other@example.com', 'pw')
        log = ExecutionLog.objects.create(user=self.user, status='completed')
        AgentStep.objects.create(
            execution=log, call_id='old-1', tool='gmail_send_message',
            status='completed', order=1, args={'to': 'Old@Example.com'},
        )
        other_log = ExecutionLog.objects.create(user=self.other, status='completed')
        AgentStep.objects.create(
            execution=other_log, call_id='theirs-1', tool='gmail_send_message',
            status='completed', order=1, args={'to': 'stranger@example.com'},
        )

    def _describe(self, name, args, user_id=None):
        return async_to_sync(describe_call_async)(
            name, args, user_id=self.user.id if user_id is None else user_id,
        )

    def test_someone_already_written_to_is_not_a_first_contact(self):
        # Case is ignored, the way the reviewer's recipient rule ignores it.
        d = self._describe('gmail_send_message', {'to': 'old@example.com'})
        self.assertFalse(d['first_contact'])

    def test_someone_new_is_a_first_contact(self):
        d = self._describe('gmail_send_message', {'to': 'new@example.com'})
        self.assertTrue(d['first_contact'])

    def test_one_new_recipient_among_known_ones_is_a_first_contact(self):
        d = self._describe('gmail_send_message', {
            'to': ['old@example.com', 'new@example.com'],
        })
        self.assertTrue(d['first_contact'])

    def test_another_users_sends_do_not_count(self):
        d = self._describe('gmail_send_message', {'to': 'stranger@example.com'})
        self.assertTrue(d['first_contact'])

    def test_a_call_that_stays_inside_is_never_a_first_contact(self):
        d = self._describe('gmail_search_threads', {'to': 'new@example.com'})
        self.assertFalse(d['first_contact'])

    def test_no_recipient_is_not_a_first_contact(self):
        d = self._describe('gmail_send_message', {'body': 'hi there'})
        self.assertFalse(d['first_contact'])

    def test_an_unreadable_history_reads_as_new(self):
        # Unknown is treated as new, never as familiar.
        with patch('chat.tools.registry.external_names',
                   side_effect=RuntimeError('db down')):
            d = self._describe('gmail_send_message', {'to': 'old@example.com'})
        self.assertTrue(d['first_contact'])
