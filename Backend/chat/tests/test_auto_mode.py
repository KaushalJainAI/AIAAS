"""
Auto mode (P3): a mode picker in chat, a reviewer that may allow clear
matches, argument-shaped trust, and one button that pauses everything.

Pinned: the reviewer only ever downgrades ask → allow (never for spends,
publishes above link, unseen recipients, first-seen browser hosts or tainted
arguments); a dead or slow judge is an ask; plan withholds rather than gates;
trust matches exactly or not at all; a paused account refuses before any model
call.
"""
from __future__ import annotations

from datetime import timedelta

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from chat.models import ChatSession, ToolPermission
from chat.tools import READ_ONLY_TOOLS
from chat.tools.permissions import is_remembered
from chat.turn import reviewer
from chat.turn.reviewer import audit_for, auto_policy, read_only_source, review
from llm.testing import fail, provider_error, scripted_model, text

User = get_user_model()

# The judge is the real one (`reviewer._model_judge` -> `llm.access`); only the
# model's reply is scripted. A test whose rule must stop the call before the
# judge scripts an ALLOW and then asserts the model was never asked, which is a
# stronger check than "the fake judge said yes and the rule still refused".
ALLOW = text('ALLOW Clearly asked for.')
DENY = text('ASK Not convinced.')


class _Judged(TestCase):
    def setUp(self):
        cache.clear()
        reviewer._verdicts.clear()
        self.addCleanup(reviewer._verdicts.clear)
        self.user = User.objects.create_user(f'judged-{type(self).__name__}', password='pw')
        self.uid = self.user.id


@override_settings(AUTO_REVIEWER_PROVIDER='openrouter',
                   AUTO_REVIEWER_MODEL='meta-llama/llama-4-scout')
class ReviewerStaticTests(_Judged):
    def decide(self, *steps, **kwargs):
        params = dict(tool_name='write_file', args={'path': 'a.md'},
                      described='Write a.md', user_text='write a.md to say hi',
                      user_id=self.uid)
        params.update(kwargs)
        with scripted_model(*steps) as model:
            out = async_to_sync(review)(**params)
        return out, model

    def assertRuledWithoutTheJudge(self, out, model):
        self.assertFalse(out['allow'])
        self.assertEqual(out['reviewed_by'], 'rules')
        self.assertEqual(model.requests, [], 'a rule must decide before the judge is asked')

    def test_a_spendy_tool_always_asks(self):
        self.assertRuledWithoutTheJudge(*self.decide(
            ALLOW, tool_name='generate_image', args={'prompt': 'a cat'}))

    def test_publishing_above_link_always_asks(self):
        self.assertRuledWithoutTheJudge(*self.decide(
            ALLOW, tool_name='publish_page', args={'visibility': 'public'}))

    def test_a_link_page_may_reach_the_judge(self):
        out, model = self.decide(
            ALLOW, tool_name='publish_page', args={'visibility': 'link'},
            described='Publish a page', user_text='publish it')
        self.assertTrue(out['allow'])
        self.assertEqual(out['reviewed_by'], 'model')
        self.assertIn('Publish a page', model.requests[0].last_user_text())

    def test_a_recipient_outside_the_request_always_asks(self):
        out, model = self.decide(
            ALLOW, tool_name='message_send',
            args={'to': '#strangers', 'message': 'hi'}, user_text='tell #team-ops hi')
        self.assertRuledWithoutTheJudge(out, model)
        self.assertIn('#strangers', out['reason'])

    def test_a_recipient_in_the_request_may_reach_the_judge(self):
        out, _ = self.decide(
            ALLOW, tool_name='message_send',
            args={'to': '#team-ops', 'message': 'hi'},
            described='Send hi to #team-ops', user_text='tell #team-ops hi')
        self.assertTrue(out['allow'])

    def test_tainted_arguments_always_ask(self):
        self.assertRuledWithoutTheJudge(*self.decide(ALLOW, tainted=True))

    def test_a_first_seen_browser_host_always_asks(self):
        self.assertRuledWithoutTheJudge(*self.decide(
            ALLOW, tool_name='browser_act',
            args={'url': 'https://portal.example.com/',
                  'steps': [{'action': 'click', 'selector': 'button'}]},
            seen_hosts=()))

    def test_a_dead_judge_is_an_ask_not_an_allow(self):
        out, _ = self.decide(provider_error(503, 'no model here'),
                             described='Write a.md', user_text='write a.md')
        self.assertFalse(out['allow'])
        self.assertEqual(out['reason'], 'The reviewer was unavailable.')

    def test_review_never_raises(self):
        out, _ = self.decide(fail(ValueError('judge exploded')),
                             tool_name='x', args={}, described='x')
        self.assertFalse(out['allow'])


@override_settings(AUTO_REVIEWER_PROVIDER='openrouter',
                   AUTO_REVIEWER_MODEL='meta-llama/llama-4-scout')
class AutoPolicyTests(_Judged):
    def test_a_read_runs_without_a_reviewer(self):
        policy = auto_policy(user_text='what time is it')
        with scripted_model() as model:
            self.assertFalse(async_to_sync(policy)('get_current_time', {}, {'user_id': self.uid}))
        self.assertEqual(model.requests, [])
        self.assertIsNone(audit_for(policy, 'get_current_time', {}))

    PAGE = {'visibility': 'link', 'title': 'Notes'}

    def test_an_allowed_irreversible_call_runs_and_leaves_an_audit(self):
        policy = auto_policy(user_text='publish the notes as a page')
        with scripted_model(ALLOW):
            paused = async_to_sync(policy)('publish_page', self.PAGE, {'user_id': self.uid})
        self.assertFalse(paused)
        audit = audit_for(policy, 'publish_page', self.PAGE)
        self.assertEqual(
            (audit['mode'], audit['verdict'], audit['reviewed_by']),
            ('auto', 'allow', 'model'),
        )
        self.assertEqual(audit['reason'], 'Clearly asked for.')

    def test_a_refused_irreversible_call_pauses(self):
        policy = auto_policy(user_text='save the notes')
        with scripted_model(DENY):
            paused = async_to_sync(policy)('publish_page', self.PAGE, {'user_id': self.uid})
        self.assertTrue(paused)
        self.assertEqual(audit_for(policy, 'publish_page', self.PAGE)['verdict'], 'ask')

    def test_what_can_be_undone_runs_without_the_judge(self):
        # One meaning of `auto` for chat and agents: the agent ladder has
        # always freed reversible tools; chat used to send each to the judge.
        policy = auto_policy(user_text='save the notes')
        with scripted_model() as model:  # no steps: a model call would fail the test
            paused = async_to_sync(policy)(
                'write_file', {'path': 'n.md'}, {'user_id': self.uid})
        self.assertFalse(paused)
        self.assertEqual(model.requests, [])
        audit = audit_for(policy, 'write_file', {'path': 'n.md'})
        self.assertEqual((audit['verdict'], audit['reviewed_by']), ('allow', 'rules'))

    def test_delegation_is_the_managers_own_call(self):
        # The judge never read "run the Analyst agent" as the user's request
        # carried out, so every delegation asked and auto behaved as ask.
        policy = auto_policy(user_text='make me a deck about Q3')
        args = {'agent_id': 4, 'goal': 'Build a Q3 deck'}
        with scripted_model() as model:
            for name in ('run_agent', 'invoke_subagent', 'start_tasks'):
                self.assertFalse(
                    async_to_sync(policy)(name, args, {'user_id': self.uid}), name)
        self.assertEqual(model.requests, [])
        self.assertEqual(audit_for(policy, 'run_agent', args)['reviewed_by'], 'rules')

    def test_a_tainted_turn_frees_nothing(self):
        policy = auto_policy(user_text='make me a deck about Q3')
        ctx = {'user_id': self.uid, 'tainted_by': 'read_url'}
        with scripted_model(ALLOW, ALLOW) as model:
            self.assertTrue(async_to_sync(policy)(
                'run_agent', {'agent_id': 4, 'goal': 'x'}, ctx))
            self.assertTrue(async_to_sync(policy)(
                'write_file', {'path': 'n.md'}, ctx))
        self.assertEqual(model.requests, [])

    def test_a_mission_and_a_spend_are_never_freed_by_rule(self):
        self.assertEqual(reviewer.rule_allow('start_mission'), '')
        self.assertEqual(reviewer.rule_allow('generate_image'), '')
        self.assertEqual(reviewer.rule_allow('run_eval_suite'), '')
        self.assertEqual(reviewer.rule_allow('mcp__7__send_email_ab12cd34'), '')
        policy = auto_policy(user_text='run the suite')
        with scripted_model(ALLOW) as model:
            self.assertTrue(async_to_sync(policy)(
                'run_eval_suite', {'suite_id': 1}, {'user_id': self.uid}))
        self.assertEqual(model.requests, [])


@override_settings(AUTO_REVIEWER_PROVIDER='openrouter',
                   AUTO_REVIEWER_MODEL='meta-llama/llama-4-scout')
class FullAutoTests(_Judged):
    """Full auto: nothing asks — except in a turn that read orders from a page."""

    def policy(self):
        return reviewer.full_policy(auto_policy(user_text='tidy my inbox'))

    def test_nothing_pauses_and_no_judge_is_called(self):
        policy = self.policy()
        with scripted_model() as model:
            for name, args in (
                ('run_agent', {'agent_id': 4, 'goal': 'x'}),
                ('publish_page', {'visibility': 'public'}),
                ('generate_image', {'prompt': 'a cat'}),
                ('start_mission', {'goal': 'x'}),
                ('message_send', {'to': '#strangers', 'message': 'hi'}),
                ('mcp__7__send_email_ab12cd34', {'to': 'a@b.c'}),
            ):
                self.assertFalse(
                    async_to_sync(policy)(name, args, {'user_id': self.uid}), name)
        self.assertEqual(model.requests, [])

    def test_a_tainted_turn_falls_back_to_auto(self):
        policy = self.policy()
        ctx = {'user_id': self.uid, 'tainted_by': 'read_url'}
        with scripted_model(ALLOW) as model:
            self.assertTrue(async_to_sync(policy)(
                'run_agent', {'agent_id': 4, 'goal': 'x'}, ctx))
            # A plain read is never gated, tainted or not.
            self.assertFalse(async_to_sync(policy)('get_current_time', {}, ctx))
        self.assertEqual(model.requests, [])

    def test_the_model_is_told_the_mode(self):
        from chat.turn.prompts import AUTONOMY_NOTES

        self.assertIn('FULL AUTO', AUTONOMY_NOTES['full'])


class WorkerModeTests(TestCase):
    """A chat in `auto` does not start a worker that asks about undoable work."""

    def test_only_ask_is_lifted_and_only_by_an_auto_chat(self):
        from agents.agent.runtime import lifted_autonomy

        self.assertEqual(lifted_autonomy('ask', 'auto'), 'auto')
        for own in ('plan', 'review', 'auto', 'full'):
            self.assertEqual(lifted_autonomy(own, 'auto'), own)
        for parent in ('', 'ask', 'plan', 'review'):
            self.assertEqual(lifted_autonomy('ask', parent), 'ask')

    def test_a_full_auto_chat_switches_its_workers_approvals_off_too(self):
        from agents.agent.runtime import lifted_autonomy

        self.assertEqual(lifted_autonomy('ask', 'full'), 'full')
        self.assertEqual(lifted_autonomy('auto', 'full'), 'full')
        # Stricter than the default is a choice, and it stands.
        self.assertEqual(lifted_autonomy('plan', 'full'), 'plan')
        self.assertEqual(lifted_autonomy('review', 'full'), 'review')
        self.assertEqual(lifted_autonomy('ask', 'full', 'eval'), 'ask')

    def test_an_eval_measures_the_agent_as_saved(self):
        from agents.agent.runtime import lifted_autonomy

        self.assertEqual(lifted_autonomy('ask', 'auto', 'eval'), 'ask')

    def test_the_mode_survives_a_pause(self):
        # `resume_agent_run` knows only the log, so the mode is kept on it.
        from agents.agent.runtime import _open_log, _remember_parent_autonomy
        from agents.models import SubAgent

        user = User.objects.create_user('lifter', 'l@example.com', 'pw')
        agent = SubAgent.objects.create(user=user, name='Worker')
        log = async_to_sync(_open_log)(agent, user, 'goal', 'api', 't-1', caller='chat')
        self.assertEqual(async_to_sync(_remember_parent_autonomy)(log, 'auto'), 'auto')
        log.refresh_from_db()
        self.assertEqual(async_to_sync(_remember_parent_autonomy)(log, ''), 'auto')

    def test_the_tool_context_carries_the_chat_mode(self):
        from chat.turn.agent import TurnContext, _live_autonomy

        base = dict(provider='p', model='m', system_message='', user_id=1,
                    session_id='mode-thread', intent='chat', user_text='q')
        self.assertEqual(_live_autonomy(TurnContext(**base, autonomy='auto')), 'auto')
        # An agent run sets none, so nothing is passed down from it.
        self.assertEqual(_live_autonomy(TurnContext(**base)), '')


class PlanWithholdsTests(TestCase):
    def test_plan_offers_only_reads(self):
        from inference import vfs

        user = User.objects.create_user('planner', 'p@example.com', 'pw')
        scope = vfs.chat_scope(user)
        source = read_only_source(user_id=user.id, session_key='s', file_scope=scope)
        offered = async_to_sync(source)()
        names = {t['function']['name'] for t in offered}
        self.assertTrue(names)
        self.assertLessEqual(names, set(READ_ONLY_TOOLS))
        self.assertIn('execute_python', names)
        self.assertNotIn('write_file', names)
        self.assertNotIn('generate_image', names)


class TrustMatchTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('truster', 't@example.com', 'pw')
        self.ctx = {'user_id': self.user.id, 'session_id': 's1'}

    def _remember(self, tool, match, session_key=''):
        return ToolPermission.objects.create(
            user=self.user, tool_name=tool, session_key=session_key, match=match)

    def test_an_empty_match_allows_regardless_of_arguments(self):
        self._remember('write_file', {})
        self.assertTrue(async_to_sync(is_remembered)(
            'write_file', self.ctx, {'path': 'anything.md'}))

    def test_an_exact_match_allows(self):
        self._remember('message_send', {'to': '#team-ops', 'channel': 'slack'})
        self.assertTrue(async_to_sync(is_remembered)(
            'message_send', self.ctx, {'to': '#team-ops', 'channel': 'slack'}))

    def test_a_partial_match_does_not(self):
        self._remember('message_send', {'to': '#team-ops'})
        self.assertFalse(async_to_sync(is_remembered)(
            'message_send', self.ctx, {'to': '#strangers'}))

    def test_a_session_rule_does_not_leak_into_another_session(self):
        self._remember('write_file', {}, session_key='other-session')
        self.assertFalse(async_to_sync(is_remembered)(
            'write_file', self.ctx, {'path': 'a.md'}))


class PauseAllTests(TestCase):
    def setUp(self):
        from agents.models import SubAgent
        from core.models import UserProfile

        self.user = User.objects.create_user('pauser', 'p@example.com', 'pw')
        self.profile, _ = UserProfile.objects.get_or_create(user=self.user)
        self.agent = SubAgent.objects.create(user=self.user, name='Worker')

    def test_a_paused_account_refuses_before_any_model_call(self):
        from agents.agent.runtime import AgentRunRefused, check_guardrails

        self.profile.paused_until = timezone.now() + timedelta(hours=1)
        self.profile.save(update_fields=['paused_until'])
        with self.assertRaises(AgentRunRefused):
            async_to_sync(check_guardrails)(self.agent, self.user)

    def test_an_expired_pause_runs_again(self):
        from agents.agent.runtime import check_guardrails

        self.profile.paused_until = timezone.now() - timedelta(minutes=1)
        self.profile.save(update_fields=['paused_until'])
        async_to_sync(check_guardrails)(self.agent, self.user)  # does not raise

    def test_no_pause_runs(self):
        from agents.agent.runtime import check_guardrails

        self.profile.paused_until = None
        self.profile.save(update_fields=['paused_until'])
        async_to_sync(check_guardrails)(self.agent, self.user)  # does not raise


class SessionAutonomyTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('moder', 'm@example.com', 'pw')

    def test_the_chat_modes_are_ask_auto_full_and_plan(self):
        from chat.serializers import ChatSessionSerializer

        for level in ('ask', 'auto', 'full', 'plan'):
            serializer = ChatSessionSerializer(data={'title': 't', 'autonomy': level})
            self.assertTrue(serializer.is_valid(), serializer.errors)
        serializer = ChatSessionSerializer(data={'title': 't', 'autonomy': 'yolo'})
        self.assertFalse(serializer.is_valid())

    def test_no_chat_starts_in_full_auto_unasked(self):
        # Full auto is picked per conversation. Even a profile row that
        # somehow holds it does not make new chats start there.
        from core.models import UserProfile
        from rest_framework.test import APIRequestFactory, force_authenticate

        from chat.views import ChatSessionViewSet

        profile, _ = UserProfile.objects.get_or_create(user=self.user)
        profile.default_autonomy = 'full'
        profile.save(update_fields=['default_autonomy'])
        request = APIRequestFactory().post(
            '/api/chat/sessions/', {'title': 't'}, format='json')
        force_authenticate(request, user=self.user)
        response = ChatSessionViewSet.as_view({'post': 'create'})(request)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(
            ChatSession.objects.get(id=response.data['id']).autonomy, 'ask')

    def test_new_sessions_inherit_the_account_default(self):
        from core.models import UserProfile
        from rest_framework.test import APIRequestFactory, force_authenticate

        from chat.views import ChatSessionViewSet

        profile, _ = UserProfile.objects.get_or_create(user=self.user)
        profile.default_autonomy = 'auto'
        profile.save(update_fields=['default_autonomy'])

        factory = APIRequestFactory()
        request = factory.post('/api/chat/sessions/', {'title': 't'}, format='json')
        force_authenticate(request, user=self.user)
        view = ChatSessionViewSet.as_view({'post': 'create'})
        response = view(request)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(
            ChatSession.objects.get(id=response.data['id']).autonomy, 'auto')

    def test_an_explicit_mode_beats_the_default(self):
        from core.models import UserProfile
        from rest_framework.test import APIRequestFactory, force_authenticate

        from chat.views import ChatSessionViewSet

        profile, _ = UserProfile.objects.get_or_create(user=self.user)
        profile.default_autonomy = 'auto'
        profile.save(update_fields=['default_autonomy'])

        factory = APIRequestFactory()
        request = factory.post('/api/chat/sessions/', {'title': 't', 'autonomy': 'plan'},
                               format='json')
        force_authenticate(request, user=self.user)
        response = ChatSessionViewSet.as_view({'post': 'create'})(request)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(
            ChatSession.objects.get(id=response.data['id']).autonomy, 'plan')

    def test_profile_default_is_validated(self):
        from core.serializers import UserProfileSerializer

        serializer = UserProfileSerializer(data={'default_autonomy': 'full'})
        self.assertFalse(serializer.is_valid())


