"""Narrowed approvals: "applies to this vendor" (UI redesign B2).

`approve_tool_call` is driven against a fake graph whose snapshot holds one
paused call, so the checks run against the arguments the call really has. The
rules under test: `match` is only allowed with scope `session`, must be a
subset of the paused call's own arguments by value and type, and a refusal
writes nothing, so the call stays paused.
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from asgiref.sync import async_to_sync
from django.contrib.auth.models import User
from django.test import TestCase
from langchain_core.messages import AIMessage

from chat.models import ToolPermission
from chat.tools.permissions import is_remembered

ARGS = {'to': 'vendor@example.com', 'subject': 'Invoice', 'body': 'Paid', 'count': 2}


class _Snapshot:
    def __init__(self, values):
        self.values = values


def _paused(args=None, name='gmail_send_message', call_id='call-1'):
    if args is None:
        return _Snapshot({})
    message = AIMessage(content='', tool_calls=[{'id': call_id, 'name': name, 'args': args}])
    return _Snapshot({'messages': [message], 'metadata': {}})


class NarrowedApprovalTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('nar', 'nar@example.com', 'pw')
        self.graph = MagicMock()
        self.graph.aget_state = AsyncMock(return_value=_paused(ARGS))
        self.graph.aupdate_state = AsyncMock()
        patcher = patch('chat.turn.agent.get_graph', return_value=self.graph)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _approve(self, **kw):
        from chat.turn.agent import approve_tool_call

        return async_to_sync(approve_tool_call)(
            'thread-n', 'call-1', user_id=self.user.id, **kw)

    def _refused(self, **kw):
        from chat.turn.agent import ApprovalRefused

        with self.assertRaises(ApprovalRefused) as ctx:
            self._approve(**kw)
        # Nothing was approved and nothing was filed.
        self.graph.aupdate_state.assert_not_awaited()
        self.assertFalse(ToolPermission.objects.filter(user=self.user).exists())
        return str(ctx.exception)

    # ── what gets stored ────────────────────────────────────────────────────

    def test_a_narrowed_session_approval_is_stored_with_its_match(self):
        self._approve(scope='session', session_key='sess-1',
                      match={'to': 'vendor@example.com'})

        self.graph.aupdate_state.assert_awaited()
        row = ToolPermission.objects.get(user=self.user)
        self.assertEqual(row.tool_name, 'gmail_send_message')
        self.assertEqual(row.session_key, 'sess-1')
        self.assertEqual(row.match, {'to': 'vendor@example.com'})

    def test_is_remembered_honours_the_narrowing(self):
        self._approve(scope='session', session_key='sess-1',
                      match={'to': 'vendor@example.com'})
        ctx = {'user_id': self.user.id, 'session_id': 'sess-1'}

        same_vendor = {'to': 'vendor@example.com', 'body': 'a different body'}
        other_vendor = {'to': 'someone@else.com', 'body': 'Paid'}
        self.assertTrue(async_to_sync(is_remembered)('gmail_send_message', ctx, same_vendor))
        self.assertFalse(async_to_sync(is_remembered)('gmail_send_message', ctx, other_vendor))

    def test_a_plain_session_approval_still_allows_the_whole_tool(self):
        self._approve(scope='session', session_key='sess-1')

        row = ToolPermission.objects.get(user=self.user)
        self.assertEqual(row.match, {})
        ctx = {'user_id': self.user.id, 'session_id': 'sess-1'}
        self.assertTrue(async_to_sync(is_remembered)(
            'gmail_send_message', ctx, {'to': 'anyone@example.com'}))

    def test_an_empty_match_is_no_narrowing(self):
        self._approve(scope='session', session_key='sess-1', match={})

        self.assertEqual(ToolPermission.objects.get(user=self.user).match, {})

    def test_a_second_narrowing_replaces_the_first_for_the_same_tool(self):
        self._approve(scope='session', session_key='sess-1',
                      match={'to': 'vendor@example.com'})
        self._approve(scope='session', session_key='sess-1',
                      match={'subject': 'Invoice'})

        rows = ToolPermission.objects.filter(user=self.user)
        self.assertEqual(rows.count(), 1)
        self.assertEqual(rows.get().match, {'subject': 'Invoice'})

    def test_a_narrowing_does_not_narrow_an_existing_broad_rule(self):
        ToolPermission.objects.create(
            user=self.user, tool_name='gmail_send_message', session_key='sess-1', match={},
        )
        self._approve(scope='session', session_key='sess-1',
                      match={'to': 'vendor@example.com'})

        # The broader rule the user already gave still stands, unnarrowed.
        self.assertEqual(ToolPermission.objects.get(user=self.user).match, {})

    # ── what is refused ─────────────────────────────────────────────────────

    def test_a_value_the_call_does_not_use_is_refused(self):
        message = self._refused(scope='session', session_key='sess-1',
                                match={'to': 'someone@else.com'})
        self.assertIn('to', message)

    def test_a_key_the_call_does_not_have_is_refused(self):
        self._refused(scope='session', session_key='sess-1', match={'cc': 'x@example.com'})

    def test_only_the_session_scope_may_narrow(self):
        for scope in ('once', 'always', ''):
            with self.subTest(scope=scope):
                self._refused(scope=scope, session_key='sess-1',
                              match={'to': 'vendor@example.com'})

    def test_a_narrowing_needs_a_user_to_remember_it_for(self):
        from chat.turn.agent import ApprovalRefused, approve_tool_call

        with self.assertRaises(ApprovalRefused):
            async_to_sync(approve_tool_call)(
                'thread-n', 'call-1', scope='session', session_key='sess-1',
                user_id=None, match={'to': 'vendor@example.com'})
        self.graph.aupdate_state.assert_not_awaited()

    def test_no_paused_call_is_refused(self):
        self.graph.aget_state.return_value = _paused(None)
        self._refused(scope='session', session_key='sess-1',
                      match={'to': 'vendor@example.com'})

    def test_a_call_with_another_id_is_refused(self):
        # The paused call is `call-1`; approving `call-9` has nothing to narrow.
        from chat.turn.agent import ApprovalRefused, approve_tool_call

        with self.assertRaises(ApprovalRefused):
            async_to_sync(approve_tool_call)(
                'thread-n', 'call-9', scope='session', session_key='sess-1',
                user_id=self.user.id, match={'to': 'vendor@example.com'})
        self.graph.aupdate_state.assert_not_awaited()

    def test_a_bool_does_not_stand_in_for_a_number(self):
        # `True == 1` in Python. The count is an int, so a yes/no is a mismatch.
        self._refused(scope='session', session_key='sess-1', match={'count': True})

    def test_a_list_or_object_value_is_refused(self):
        self._refused(scope='session', session_key='sess-1', match={'to': ['vendor@example.com']})
        self._refused(scope='session', session_key='sess-1', match={'to': {'a': 'b'}})

    def test_too_many_keys_is_refused(self):
        from chat.turn import agent

        many = {f'k{i}': i for i in range(agent.MAX_MATCH_KEYS + 1)}
        self.graph.aget_state.return_value = _paused(many)
        self._refused(scope='session', session_key='sess-1', match=dict(list(many.items())))

    def test_a_match_that_is_not_an_object_is_refused(self):
        self._refused(scope='session', session_key='sess-1', match='vendor@example.com')

    def test_a_refused_narrowing_leaves_the_call_paused(self):
        # The refusal happens before `aupdate_state`, so `approved_tool_calls`
        # is never written and the run stays paused on its interrupt.
        self._refused(scope='session', session_key='sess-1', match={'to': 'nobody@x.com'})
        self.assertFalse(ToolPermission.objects.exists())


class NarrowedRememberedTypeTests(TestCase):
    """`is_remembered` must not let a stored count match a yes/no."""

    def setUp(self):
        self.user = User.objects.create_user('typed', 'typed@example.com', 'pw')
        ToolPermission.objects.create(
            user=self.user, tool_name='gmail_send_message', session_key='sess-1',
            match={'count': 1},
        )

    def test_a_matching_int_is_remembered(self):
        ctx = {'user_id': self.user.id, 'session_id': 'sess-1'}
        self.assertTrue(async_to_sync(is_remembered)(
            'gmail_send_message', ctx, {'count': 1}))

    def test_a_yes_no_that_compares_equal_is_not(self):
        ctx = {'user_id': self.user.id, 'session_id': 'sess-1'}
        self.assertFalse(async_to_sync(is_remembered)(
            'gmail_send_message', ctx, {'count': True}))


class ChatDoorTests(TestCase):
    """The chat message endpoint writes a narrowed approval before its turn."""

    def setUp(self):
        self.user = User.objects.create_user('chatdoor', 'chatdoor@example.com', 'pw')
        self.graph = MagicMock()
        self.graph.aget_state = AsyncMock(return_value=_paused(ARGS))
        self.graph.aupdate_state = AsyncMock()
        patcher = patch('chat.turn.agent.get_graph', return_value=self.graph)
        patcher.start()
        self.addCleanup(patcher.stop)
        # A session with memory on has a stable checkpoint id: its own id.
        self.session = SimpleNamespace(id='sess-door', memory_enabled=True)

    def _apply(self, payload):
        from chat.views import _apply_narrowed_approval

        return async_to_sync(_apply_narrowed_approval)(self.session, self.user, payload)

    def test_a_refused_narrowing_returns_the_reason(self):
        reason = self._apply({
            'approve_tool_call': 'call-1', 'approval_scope': 'session',
            'match': {'to': 'nobody@example.com'},
        })
        self.assertIsNotNone(reason)
        self.assertFalse(ToolPermission.objects.exists())

    def test_a_valid_narrowing_is_written_and_reports_nothing(self):
        reason = self._apply({
            'approve_tool_call': 'call-1', 'approval_scope': 'session',
            'match': {'to': 'vendor@example.com'},
        })
        self.assertIsNone(reason)
        row = ToolPermission.objects.get(user=self.user)
        self.assertEqual(row.session_key, 'sess-door')
        self.assertEqual(row.match, {'to': 'vendor@example.com'})

    def test_a_request_without_a_match_is_left_to_the_turn(self):
        self.assertIsNone(self._apply({'approve_tool_call': 'call-1',
                                       'approval_scope': 'session'}))
        self.graph.aupdate_state.assert_not_awaited()
        self.assertFalse(ToolPermission.objects.exists())
