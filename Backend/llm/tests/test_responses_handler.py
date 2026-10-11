"""
The Responses-protocol handler and the ChatGPT plan provider.

The handler translates at both edges: chat-shaped config in, the funnel's
chunk shapes out. These tests assert on the two things that actually cross
those edges — the request body that would be sent, and what
`StreamAccumulator` (the real consumer) makes of the stream — because a
translation layer passes any test written against its own intermediate.

The event streams are written from the public Responses API reference. The
plan's Phase 0 script records real ones; replace these with those when it has
been run against an account.
"""
from __future__ import annotations

import json
from unittest.mock import patch

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from llm import access, chatgpt_plan
from llm.handlers import responses_api
from llm.handlers.responses_api import (
    ALLOWED_BODY_KEYS,
    ChatGPTPlanNode,
    to_input_items,
    to_responses_tools,
)
from llm.models import AIModel, AIProvider

User = get_user_model()


class _Response:
    def __init__(self, events=None, *, status=200, body=b''):
        self.status_code = status
        self._events = events or []
        self._body = body

    async def aread(self):
        return self._body

    async def aiter_lines(self):
        for event in self._events:
            yield f"event: {event['type']}"
            yield f'data: {json.dumps(event)}'
            yield ''

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class _Client:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def stream(self, method, url, **kwargs):
        self.calls.append({'method': method, 'url': url, **kwargs})
        return self.response


def _run(events=None, *, config=None, response=None):
    """Drive the real handler; return (accumulator, client)."""
    client = _Client(response or _Response(events))

    async def token(self, config, context):
        return 'access-token'

    async def system(self, config):
        return config.get('system_message') or 'You are a helpful assistant.'

    async def collect():
        folded = access.StreamAccumulator()
        cfg = {'prompt': 'hi', 'model': 'chatgpt/gpt-6-luna', **(config or {})}
        async for chunk in ChatGPTPlanNode().stream_execute({}, cfg, None):
            folded.add(chunk)
        return folded

    with patch.object(responses_api, 'shared_client', lambda: client), \
            patch.object(ChatGPTPlanNode, 'resolve_token', token), \
            patch.object(ChatGPTPlanNode, '_system_message', system):
        return async_to_sync(collect)(), client


TEXT = [
    {'type': 'response.created', 'response': {'id': 'r1'}},
    {'type': 'response.output_text.delta', 'delta': 'Hel'},
    {'type': 'response.output_text.delta', 'delta': 'lo'},
    {'type': 'response.completed', 'response': {'usage': {
        'input_tokens': 120, 'output_tokens': 8, 'total_tokens': 128,
        'input_tokens_details': {'cached_tokens': 100},
        'output_tokens_details': {'reasoning_tokens': 3},
    }}},
]


def _call(name, arguments, call_id):
    return {'type': 'response.output_item.done', 'item': {
        'type': 'function_call', 'name': name, 'arguments': arguments, 'call_id': call_id}}


class RequestBodyTests(SimpleTestCase):
    HISTORY = [
        {'role': 'user', 'content': 'find the report'},
        {'role': 'assistant', 'content': 'Looking.', 'tool_calls': [
            {'id': 'call_1', 'type': 'function',
             'function': {'name': 'find_files', 'arguments': '{"query": "report"}'}},
            {'id': 'call_2', 'type': 'function',
             'function': {'name': 'web_search', 'arguments': {'q': 'report'}}},
        ]},
        {'role': 'tool', 'tool_call_id': 'call_1', 'content': 'q3.md'},
        {'role': 'tool', 'tool_call_id': 'call_2', 'content': 'nothing'},
        {'role': 'system', 'content': 'CURRENT TIME: 09:00'},
    ]
    TOOLS = [{'type': 'function', 'function': {
        'name': 'find_files', 'description': 'Find files',
        'parameters': {'type': 'object', 'properties': {'query': {'type': 'string'}}}}}]

    def body(self, **config):
        _, client = _run(TEXT, config={
            'system_message': 'SYSTEM PROMPT', 'history': self.HISTORY,
            'tools': self.TOOLS, 'temperature': 0.2, 'max_tokens': 4096, **config})
        return client.calls[0]

    def test_only_fields_the_plan_route_accepts_are_sent(self):
        body = self.body(effort='high', response_format='json_object')['json']
        self.assertLessEqual(set(body), ALLOWED_BODY_KEYS)
        self.assertIs(body['store'], False)
        self.assertIs(body['stream'], True)
        for refused in ('temperature', 'top_p', 'max_tokens', 'max_output_tokens',
                        'truncation', 'user', 'metadata'):
            self.assertNotIn(refused, body)

    def test_the_request_goes_to_the_responses_route_with_the_users_token(self):
        call = self.body()
        self.assertEqual(call['url'], 'https://api.openai.com/v1/responses')
        self.assertEqual(call['headers']['Authorization'], 'Bearer access-token')
        # The catalogue prefix is ours, not OpenAI's.
        self.assertEqual(call['json']['model'], 'gpt-6-luna')

    def test_the_system_prompt_is_instructions_and_no_message_has_the_system_role(self):
        body = self.body()['json']
        self.assertEqual(body['instructions'], 'SYSTEM PROMPT')
        roles = [item.get('role') for item in body['input']]
        self.assertNotIn('system', roles)
        # A later system note keeps its place in the conversation rather than
        # being folded into the cached prefix.
        self.assertNotIn('CURRENT TIME', body['instructions'])
        note = body['input'][-2]
        self.assertEqual(note['role'], 'developer')
        self.assertEqual(note['content'][0]['text'], 'CURRENT TIME: 09:00')

    def test_tool_calls_and_results_become_items_with_matching_ids(self):
        items = to_input_items(self.HISTORY, context_role='developer')
        calls = [i for i in items if i.get('type') == 'function_call']
        outputs = [i for i in items if i.get('type') == 'function_call_output']
        self.assertEqual([c['call_id'] for c in calls], ['call_1', 'call_2'])
        self.assertEqual([o['call_id'] for o in outputs], ['call_1', 'call_2'])
        # Arguments are a JSON string on the wire, whichever form history held.
        self.assertEqual(json.loads(calls[1]['arguments']), {'q': 'report'})
        # Order is preserved: both calls come before either result.
        self.assertLess(items.index(calls[1]), items.index(outputs[0]))

    def test_tools_are_declared_flat(self):
        flat = to_responses_tools(self.TOOLS)
        self.assertEqual(flat[0]['name'], 'find_files')
        self.assertNotIn('function', flat[0])
        self.assertEqual(self.body()['json']['tools'], flat)

    def test_effort_is_spelled_as_a_reasoning_object(self):
        self.assertEqual(self.body(effort='high')['json']['reasoning'], {'effort': 'high'})
        self.assertNotIn('reasoning', self.body(effort=None)['json'])
        # No `none` rung on this API.
        self.assertEqual(self.body(effort='none')['json']['reasoning']['effort'], 'minimal')

    def test_an_image_part_is_translated_and_a_raw_file_is_named_not_sent(self):
        items = to_input_items([{'role': 'user', 'content': [
            {'type': 'text', 'text': 'look'},
            {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,AAAA'}},
            {'type': 'file', 'file': {'filename': 'a.pdf', 'file_data': 'data:...'}},
        ]}], context_role='developer')
        parts = items[0]['content']
        self.assertEqual(parts[1], {'type': 'input_image', 'image_url': 'data:image/png;base64,AAAA'})
        self.assertIn('a.pdf', parts[2]['text'])
        self.assertNotIn('file_data', json.dumps(parts))


class StreamTests(SimpleTestCase):
    def test_text_and_usage_reach_the_funnel(self):
        folded, _ = _run(TEXT)
        self.assertEqual(folded.content, 'Hello')
        self.assertIsNone(folded.error)
        self.assertEqual(folded.usage.total, 128)
        completion = folded.finish()
        self.assertEqual(completion.tool_calls, ())

    def test_two_tool_calls_in_one_turn_come_out_as_two_calls(self):
        folded, _ = _run([
            _call('find_files', '{"query": "report"}', 'call_a'),
            _call('web_search', '{"q": "x"}', 'call_b'),
            {'type': 'response.completed', 'response': {'usage': {'input_tokens': 5, 'output_tokens': 5}}},
        ])
        calls = folded.finish().tool_calls
        self.assertEqual([c.name for c in calls], ['find_files', 'web_search'])
        self.assertEqual([c.id for c in calls], ['call_a', 'call_b'])
        self.assertEqual(calls[0].arguments, {'query': 'report'})

    def test_reasoning_is_only_emitted_when_thinking_was_asked_for(self):
        events = [{'type': 'response.reasoning_summary_text.delta', 'delta': 'hmm'}, *TEXT]
        self.assertEqual(_run(events)[0].thinking, '')
        self.assertEqual(_run(events, config={'thinking': True})[0].thinking, 'hmm')

    def test_a_stream_cut_before_completed_is_an_error_not_an_answer(self):
        folded, _ = _run(TEXT[:-1])
        self.assertEqual(folded.content, 'Hello')
        self.assertIn('before the answer finished', folded.error)

    def test_a_plan_limit_inside_the_stream_is_raised_as_the_users_to_fix(self):
        folded, _ = _run([{'type': 'response.failed', 'response': {'error': {
            'code': 'subscription_sharing_usage_limit_exceeded', 'message': 'limit'}}}])
        self.assertEqual(folded.error_status, 429)
        problem = folded.actionable_error('chatgpt', 'chatgpt/gpt-6-luna')
        self.assertIsInstance(problem, access.LLMQuotaExhausted)
        self.assertIn('Usage', str(problem))

    def test_an_http_refusal_keeps_its_status(self):
        body = json.dumps({'error': {'code': 'subscription_sharing_user_not_eligible'}}).encode()
        folded, _ = _run(response=_Response(status=403, body=body))
        self.assertEqual(folded.error_status, 403)
        problem = folded.actionable_error('chatgpt')
        self.assertIsInstance(problem, access.LLMAccessDenied)
        self.assertIn('Signing in again will not change that', str(problem))

    def test_execute_collects_the_stream_into_the_chat_shaped_result(self):
        client = _Client(_Response([_call('find_files', '{}', 'call_a'), *TEXT]))

        async def token(self, config, context):
            return 't'

        async def system(self, config):
            return 's'

        with patch.object(responses_api, 'shared_client', lambda: client), \
                patch.object(ChatGPTPlanNode, 'resolve_token', token), \
                patch.object(ChatGPTPlanNode, '_system_message', system):
            result = async_to_sync(ChatGPTPlanNode().execute)(
                {}, {'prompt': 'hi', 'model': 'chatgpt/gpt-6-luna'}, None)
        self.assertTrue(result.success)
        self.assertEqual(result.data['content'], 'Hello')
        self.assertEqual(result.data['tool_calls'][0]['function']['name'], 'find_files')
        self.assertEqual(access.to_tool_calls(result.data['tool_calls'])[0].id, 'call_a')

    def test_no_sign_in_fails_with_a_sentence_and_sends_nothing(self):
        client = _Client(_Response(TEXT))

        async def collect():
            return [c async for c in ChatGPTPlanNode().stream_execute(
                {}, {'prompt': 'hi', 'model': 'chatgpt/x'}, None)]

        with patch.object(responses_api, 'shared_client', lambda: client):
            chunks = async_to_sync(collect)()
        self.assertEqual(client.calls, [])
        self.assertEqual(chunks[0]['type'], 'error')
        self.assertIn('Continue with ChatGPT', chunks[0]['message'])


class PlanErrorTests(SimpleTestCase):
    def test_each_refusal_gets_its_own_sentence(self):
        limit = access.classify_provider_error(
            429, 'subscription_sharing_usage_limit_exceeded', 'chatgpt')
        self.assertIsInstance(limit, access.LLMQuotaExhausted)
        signed_out = access.classify_provider_error(
            401, 'subscription_sharing_invalid_user', 'chatgpt')
        self.assertIsInstance(signed_out, access.LLMAccessDenied)
        self.assertIn('sign in again', str(signed_out))
        # Shown, not raised: nothing about the account is wrong.
        self.assertIsNone(access.classify_provider_error(
            400, 'subscription_sharing_unsupported_capability', 'chatgpt'))
        self.assertIn('does not support', access.explain_provider_failure(
            400, 'subscription_sharing_unsupported_capability', provider='chatgpt'))
        self.assertIn('temporarily unavailable', access.explain_provider_failure(
            503, 'subscription_sharing_usage_unavailable', provider='chatgpt'))

    def test_other_providers_errors_read_exactly_as_before(self):
        problem = access.classify_provider_error(401, 'invalid api key', 'openrouter')
        self.assertIn('rejected the API key', str(problem))
        self.assertIsNone(access.classify_provider_error(429, 'slow down', 'openai'))


class OffSwitchTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username='u', password='pw')
        self.provider, _ = AIProvider.objects.get_or_create(
            slug='chatgpt', defaults={'name': 'ChatGPT plan'})
        AIModel.objects.update_or_create(value='chatgpt/gpt-6-luna', defaults={
            'provider': self.provider, 'name': 'GPT-6 Luna', 'supports_image_input': True,
            'source': 'hand'})
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _providers(self):
        payload = self.client.get('/api/llm/models/').json()
        return {p['slug']: p for p in payload['providers']}

    @override_settings(CHATGPT_PLAN_ENABLED=False)
    def test_switched_off_the_provider_is_not_offered_and_cannot_run(self):
        self.assertNotIn('chatgpt', self._providers())
        with self.assertRaises(access.LLMUnavailable) as caught:
            async_to_sync(access.preflight)(
                provider='chatgpt', model='chatgpt/gpt-6-luna', user_id=self.user.id)
        self.assertNotIsInstance(caught.exception, access.LLMUserActionable)

    @override_settings(CHATGPT_PLAN_ENABLED=True)
    def test_before_sign_in_the_provider_is_offered_with_nothing_to_pick(self):
        provider = self._providers()['chatgpt']
        self.assertFalse(provider['has_credentials'])
        self.assertEqual(provider['models'], [])
        with self.assertRaises(access.LLMNoCredential):
            async_to_sync(access.preflight)(
                provider='chatgpt', model='chatgpt/gpt-6-luna', user_id=self.user.id)

    @override_settings(CHATGPT_PLAN_ENABLED=True)
    def test_a_user_sees_only_the_models_their_own_account_lists(self):
        from credentials import chatgpt as signin

        signin._save(
            user_id=self.user.id, client_id='app_x',
            tokens={'access_token': 'a', 'refresh_token': 'r', 'expires_in': 3600},
            identity={'sub': 's', 'email': 'me@example.com'})
        other = User.objects.create_user(username='other', password='pw')
        signin._save(
            user_id=other.id, client_id='app_y',
            tokens={'access_token': 'b', 'refresh_token': 'r2', 'expires_in': 3600},
            identity={'sub': 't', 'email': 'you@example.com'})

        listings = {
            self.user.id: [{'slug': 'gpt-6-luna', 'display_name': 'GPT-6 Luna',
                            'visibility': 'list', 'context_window': 400000},
                           {'slug': 'internal-only', 'visibility': 'hide'}],
            other.id: [{'slug': 'gpt-6-sol', 'display_name': 'GPT-6 Sol', 'visibility': 'list'}],
        }
        def listing(user_id):
            return [e for e in listings[user_id] if chatgpt_plan._listed(e)]

        with patch.object(chatgpt_plan, '_fetch_listing', listing):
            mine = [m['value'] for m in self._providers()['chatgpt']['models']]
            self.client.force_authenticate(other)
            theirs = [m['value'] for m in self._providers()['chatgpt']['models']]
        self.assertEqual(mine, ['chatgpt/gpt-6-luna'])
        self.assertEqual(theirs, ['chatgpt/gpt-6-sol'])
        self.assertEqual(
            AIModel.objects.get(value='chatgpt/gpt-6-luna').context_window, 400000)

    def test_the_catalogue_prefix_never_reaches_the_wire(self):
        self.assertEqual(chatgpt_plan.wire_model('chatgpt/gpt-6-luna'), 'gpt-6-luna')
