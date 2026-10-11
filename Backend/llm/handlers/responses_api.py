"""
A handler for OpenAI's Responses API, and the ChatGPT plan provider on top of it.

Every other OpenAI-shaped provider here speaks chat-completions
(`openai_compatible.py`). ChatGPT plan usage is served only by
`POST /v1/responses`, whose request and stream are a different shape:

  * the system prompt is a top-level `instructions` string, not a message;
  * a tool call and its result are their own items (`function_call`,
    `function_call_output`) rather than fields on an assistant message;
  * tools are declared flat (`{type, name, parameters}`);
  * the stream is typed events (`response.output_text.delta`, …,
    `response.completed`) instead of `choices[].delta`.

So this class **translates at both edges and changes nothing in between**. It
is handed the same `config` every handler gets — chat-shaped `history`, chat-
shaped `tools` — and it yields the same chunks `llm/access.py` already folds
(`content`, `thinking`, `tool_calls`, `metadata`, `error`). The turn loop,
curation, steering and the tool library cannot tell which protocol answered.

It subclasses `OpenAICompatibleLLMNode` only to reuse what is not about the
wire: the system prompt with skills, the structured-output suffix, the
missing-credential sentence. Both `execute` and `stream_execute` are replaced.

Plan usage adds rules of its own, enforced in `build_body`: `store` is always
false, `stream` is always true (there is no non-streaming mode, so `execute`
collects the stream), and sampling and output-cap fields are never sent — the
route refuses them. Callers still pass `temperature` and `max_tokens`; they
are dropped here, on purpose, in one place.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, AsyncIterator, TYPE_CHECKING

import httpx
from asgiref.sync import sync_to_async

from llm import chatgpt_plan
from workflow_backend.httpclient import shared_client

from .base import NodeExecutionResult
from .llm_base import iter_sse_chunks
from .openai_compatible import (
    STREAM_CONNECT_RETRY_DELAYS,
    OpenAICompatibleLLMNode,
    _describe,
    encode_image_attachments,
)

if TYPE_CHECKING:
    from llm.context import ExecutionContext

logger = logging.getLogger(__name__)

#: The only top-level keys a plan request may carry. `build_body` is checked
#: against this in the tests: a field added later that the route refuses would
#: otherwise fail every turn with a 400.
ALLOWED_BODY_KEYS = frozenset({
    'model', 'instructions', 'input', 'store', 'stream', 'tools', 'reasoning',
    'text',
})


# ── Chat-shaped config → Responses items ─────────────────────────────────────

def _text_of(content: Any) -> str:
    """The plain text of a chat `content` value (string or parts)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return ''.join(
            part.get('text', '') for part in content
            if isinstance(part, dict) and part.get('type') in ('text', 'input_text', 'output_text')
        )
    return '' if content is None else str(content)


def _input_parts(content: Any) -> list[dict[str, Any]]:
    """A user or developer `content` as Responses input parts.

    Text and images translate. A raw file block (`type: file`, an OpenRouter
    shape) does not exist on this route and is dropped with a note in its
    place, so the model is told a file was there rather than left guessing.
    """
    if isinstance(content, str):
        return [{'type': 'input_text', 'text': content}]
    parts: list[dict[str, Any]] = []
    for part in content or []:
        if not isinstance(part, dict):
            continue
        kind = part.get('type')
        if kind in ('text', 'input_text'):
            parts.append({'type': 'input_text', 'text': part.get('text', '')})
        elif kind == 'image_url':
            image = part.get('image_url')
            url = image.get('url') if isinstance(image, dict) else image
            if url:
                parts.append({'type': 'input_image', 'image_url': url})
        elif kind == 'input_image':
            parts.append(part)
        elif kind == 'file':
            name = (part.get('file') or {}).get('filename') or 'a file'
            parts.append({
                'type': 'input_text',
                'text': f'[Attached file "{name}" could not be sent to this model.]',
            })
    return parts or [{'type': 'input_text', 'text': ''}]


def _arguments(raw: Any) -> str:
    if isinstance(raw, str):
        return raw or '{}'
    try:
        return json.dumps(raw if raw is not None else {})
    except (TypeError, ValueError):
        return '{}'


def to_input_items(history: list[dict], *, context_role: str) -> list[dict[str, Any]]:
    """Chat-shaped messages as Responses input items, order preserved.

    A mid-conversation `system` message (the clock, the pace budget, a trim
    notice) keeps its place under `context_role`: this route refuses the
    `system` role, and folding those into `instructions` would rewrite the
    request prefix on every turn.
    """
    items: list[dict[str, Any]] = []
    for message in history or []:
        if not isinstance(message, dict):
            continue
        role = message.get('role')
        if role == 'tool':
            items.append({
                'type': 'function_call_output',
                'call_id': str(message.get('tool_call_id') or ''),
                'output': _text_of(message.get('content')),
            })
        elif role == 'assistant':
            if text := _text_of(message.get('content')):
                items.append({
                    'role': 'assistant',
                    'content': [{'type': 'output_text', 'text': text}],
                })
            for call in message.get('tool_calls') or []:
                function = call.get('function') or {}
                items.append({
                    'type': 'function_call',
                    'call_id': str(call.get('id') or ''),
                    'name': function.get('name') or '',
                    'arguments': _arguments(function.get('arguments')),
                })
        elif role == 'system':
            items.append({
                'role': context_role,
                'content': _input_parts(message.get('content')),
            })
        elif role == 'user':
            items.append({'role': 'user', 'content': _input_parts(message.get('content'))})
    return items


def to_responses_tools(tools: list | None) -> list[dict[str, Any]]:
    """Chat-shaped tool declarations, flattened to the Responses shape."""
    flat: list[dict[str, Any]] = []
    for tool in tools or []:
        if not isinstance(tool, dict):
            continue
        function = tool.get('function') if tool.get('type') == 'function' else None
        if not isinstance(function, dict) or not function.get('name'):
            continue
        flat.append({
            'type': 'function',
            'name': function['name'],
            'description': function.get('description') or '',
            'parameters': function.get('parameters') or {'type': 'object', 'properties': {}},
        })
    return flat


def to_chat_usage(usage: dict | None) -> dict[str, Any]:
    """A Responses usage object in the chat-completions spelling.

    `llm/usage.py` reads `prompt_tokens_details.cached_tokens`; the Responses
    API calls the same number `input_tokens_details.cached_tokens`. Input
    includes the cached tokens here as it does there, so the default
    (inclusive) convention is right.
    """
    usage = usage or {}
    cached = (usage.get('input_tokens_details') or {}).get('cached_tokens') or 0
    reasoning = (usage.get('output_tokens_details') or {}).get('reasoning_tokens') or 0
    prompt = usage.get('input_tokens') or 0
    output = usage.get('output_tokens') or 0
    return {
        'prompt_tokens': prompt,
        'completion_tokens': output,
        'total_tokens': usage.get('total_tokens') or prompt + output,
        'prompt_tokens_details': {'cached_tokens': cached},
        'completion_tokens_details': {'reasoning_tokens': reasoning},
    }


class ResponsesStreamParser:
    """Folds Responses stream events into this codebase's chunk shapes.

    A tool call is emitted once, whole, when its item is done — the funnel's
    accumulator rebuilds calls by index and takes a complete one as readily as
    fragments, and there is then no partial-JSON state to get wrong here.
    """

    def __init__(self, *, emit_thinking: bool, usage_convention: str, label: str):
        self.emit_thinking = emit_thinking
        self.usage_convention = usage_convention
        self.label = label
        self.completed = False
        self.failed = False
        self._calls = 0

    def feed(self, event: dict[str, Any]):
        kind = event.get('type') or ''

        if kind == 'response.output_text.delta':
            if delta := event.get('delta'):
                yield {'type': 'content', 'content': delta}

        elif kind in ('response.reasoning_summary_text.delta',
                      'response.reasoning_text.delta'):
            if self.emit_thinking and (delta := event.get('delta')):
                yield {'type': 'thinking', 'content': delta}

        elif kind == 'response.output_item.done':
            item = event.get('item') or {}
            if item.get('type') == 'function_call' and item.get('name'):
                yield {'type': 'tool_calls', 'tool_calls': [{
                    'index': self._calls,
                    'id': item.get('call_id') or item.get('id') or '',
                    'function': {
                        'name': item['name'],
                        'arguments': _arguments(item.get('arguments')),
                    },
                }]}
                self._calls += 1

        elif kind == 'response.completed':
            self.completed = True
            usage = (event.get('response') or {}).get('usage')
            if usage:
                yield {
                    'type': 'metadata',
                    'usage': to_chat_usage(usage),
                    'usage_convention': self.usage_convention,
                }

        elif kind in ('response.failed', 'error'):
            self.failed = True
            error = (event.get('response') or {}).get('error') or event.get('error') or event
            yield self._error(error)

        elif kind == 'response.incomplete':
            self.failed = True
            details = (event.get('response') or {}).get('incomplete_details') or {}
            reason = details.get('reason') or 'no reason given'
            yield {
                'type': 'error',
                'message': f'{self.label} stopped before finishing the answer ({reason}).',
            }

    def _error(self, error: Any) -> dict[str, Any]:
        if not isinstance(error, dict):
            error = {'message': str(error)}
        code = str(error.get('code') or '')
        message = str(error.get('message') or 'The request failed.')
        status = chatgpt_plan.PLAN_ERRORS.get(code, (None, ''))[0]
        chunk: dict[str, Any] = {
            'type': 'error',
            'message': f'{self.label} API error: {code + ": " if code else ""}{message}',
        }
        if status:
            chunk['status'] = status
        return chunk


class ResponsesAPINode(OpenAICompatibleLLMNode):
    """Base for a provider served by `POST {base_url}/responses`."""

    #: The role a mid-conversation `system` message is sent under.
    context_role: str = 'developer'
    image_endpoint = None
    #: Prefix on catalogue values that is not part of the wire id.
    MODEL_PREFIX: str = ''

    def _responses_url(self) -> str:
        return f"{self.base_url.rstrip('/')}/responses"

    def reasoning_payload(self, effort: Any) -> dict[str, Any]:
        """The Responses spelling: `reasoning: {effort}`."""
        from llm import effort as effort_levels

        level = effort_levels.normalize(effort)
        if level is None:
            return {}
        # No `none` rung on this API; its cheapest is `minimal`.
        return {'reasoning': {'effort': 'minimal' if level == 'none' else level}}

    async def resolve_token(self, config: dict[str, Any], context: 'ExecutionContext') -> str:
        """The bearer token for this call. Raises to refuse."""
        raise NotImplementedError

    async def build_body(
        self, *, model: str, prompt: str, config: dict[str, Any],
    ) -> dict[str, Any]:
        """The request body. Never carries a field outside `ALLOWED_BODY_KEYS`."""
        items = to_input_items(config.get('history') or [], context_role=self.context_role)
        items.append({'role': 'user', 'content': _input_parts(encode_image_attachments(
            config.get('attachments', []),
            provider=self.api_label,
            prompt=self.effective_prompt(prompt, config),
        ))})

        body: dict[str, Any] = {
            'model': model.removeprefix(self.MODEL_PREFIX) if self.MODEL_PREFIX else model,
            'instructions': await self._system_message(config),
            'input': items,
            'store': False,
            'stream': True,
        }
        reasoning = dict(self.reasoning_payload(config.get('effort')).get('reasoning') or {})
        if config.get('thinking') and reasoning:
            # A readable summary of the reasoning, for the thinking panel.
            reasoning['summary'] = 'auto'
        if reasoning:
            body['reasoning'] = reasoning
        if tools := to_responses_tools(self._tools_for(config)):
            body['tools'] = tools
        if config.get('response_format') in ('json_object', 'json_code'):
            body['text'] = {'format': {'type': 'json_object'}}
        return body

    def _headers(self, token: str) -> dict[str, str]:
        return {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
            **self.extra_headers,
        }

    async def stream_execute(
        self,
        input_data: dict[str, Any],
        config: dict[str, Any],
        context: 'ExecutionContext',
    ) -> AsyncIterator[dict[str, Any]]:
        model = config.get('model') or self.default_model
        prompt = config.get('prompt', '')
        if not prompt:
            yield {'type': 'error', 'message': 'Prompt is required'}
            return

        try:
            token = await self.resolve_token(config, context)
        except _TokenRefused as refused:
            yield refused.chunk
            return
        if not token:
            yield {'type': 'error', 'message': self._missing_key_error(), 'status': 401}
            return

        body = await self.build_body(model=model, prompt=prompt, config=config)
        parser = ResponsesStreamParser(
            emit_thinking=bool(config.get('thinking', False)),
            usage_convention=self.usage_convention,
            label=self.api_label,
        )

        # Same retry rule as the chat-completions handler, for the same reason:
        # a call that never produced anything is safe to make again, one that
        # has emitted tokens is not, and a status the provider answered with is
        # never retried.
        for attempt, delay in enumerate((*STREAM_CONNECT_RETRY_DELAYS, None)):
            emitted = False
            try:
                async with shared_client().stream(
                    'POST', self._responses_url(),
                    headers=self._headers(token), json=body, timeout=self.timeout,
                ) as response:
                    if response.status_code != 200:
                        text = (await response.aread()).decode('utf-8', 'replace')
                        yield {
                            'type': 'error',
                            'message': f'{self.api_label} API error: {text}',
                            'status': response.status_code,
                        }
                        return
                    async for event in iter_sse_chunks(response):
                        for chunk in parser.feed(event):
                            emitted = True
                            yield chunk
                        if parser.failed:
                            return
                if not parser.completed:
                    # The connection closed without the event that says the
                    # answer is whole. Half an answer is not an answer.
                    yield {
                        'type': 'error',
                        'message': f'{self.api_label} closed the stream before the answer finished.',
                    }
                return
            except (httpx.ConnectError, httpx.ConnectTimeout, httpx.RemoteProtocolError) as exc:
                if emitted or delay is None:
                    logger.exception('%s stream failed', self.api_label)
                    yield {'type': 'error', 'message': f'{self.api_label} error: {_describe(exc)}'}
                    return
                logger.warning('%s connection failed (%s); retry %d in %ss',
                               self.api_label, _describe(exc), attempt + 1, delay)
                await asyncio.sleep(delay)
            except httpx.TimeoutException as exc:
                if emitted or delay is None:
                    yield {'type': 'error', 'message': f'{self.api_label} API request timed out'}
                    return
                logger.warning('%s timed out (%s); retry %d in %ss',
                               self.api_label, _describe(exc), attempt + 1, delay)
                await asyncio.sleep(delay)
            except Exception as exc:  # noqa: BLE001
                logger.exception('%s stream failed', self.api_label)
                yield {'type': 'error', 'message': f'{self.api_label} error: {_describe(exc)}'}
                return

    async def execute(
        self,
        input_data: dict[str, Any],
        config: dict[str, Any],
        context: 'ExecutionContext',
    ) -> NodeExecutionResult:
        """The non-streaming call, made by collecting the stream.

        The route has no other mode. The result is shaped exactly as the
        chat-completions handler's, including chat-shaped `tool_calls`.
        """
        content, thinking = '', ''
        calls: list[dict[str, Any]] = []
        usage: dict[str, Any] = {}
        async for chunk in self.stream_execute(input_data, {**config, 'thinking': True}, context):
            kind = chunk.get('type')
            if kind == 'content':
                content += chunk.get('content') or ''
            elif kind == 'thinking':
                thinking += chunk.get('content') or ''
            elif kind == 'tool_calls':
                for call in chunk.get('tool_calls') or []:
                    calls.append({
                        'id': call.get('id'), 'type': 'function',
                        'function': call.get('function') or {},
                    })
            elif kind == 'metadata':
                usage = chunk.get('usage') or usage
            elif kind == 'error':
                return NodeExecutionResult(
                    success=False, error=chunk.get('message') or 'Unknown provider error',
                    status_code=chunk.get('status'),
                )
        result: dict[str, Any] = {
            'content': content,
            'model': config.get('model') or self.default_model,
            'media_url': None,
            'usage': usage,
            'usage_convention': self.usage_convention,
        }
        if calls:
            result['tool_calls'] = calls
        if thinking and config.get('thinking'):
            result['thinking'] = thinking
        return NodeExecutionResult(success=True, data=result)


class _TokenRefused(Exception):
    """`resolve_token` refused; carries the error chunk to yield."""

    def __init__(self, chunk: dict[str, Any]):
        super().__init__(chunk.get('message', ''))
        self.chunk = chunk


class ChatGPTPlanNode(ResponsesAPINode):
    """ChatGPT plan usage — a user's own ChatGPT subscription.

    Sign-in only: there is no API key to paste and never a platform key, since
    one person's plan must not answer for another user. The token is the
    user's OAuth access token, refreshed when it is about to expire
    (`credentials/chatgpt.py::access_token_for`) — per call, because an agent
    run can outlast the hour a token lives.
    """

    node_type = 'chatgpt'
    name = 'ChatGPT plan'
    description = 'Use the usage included in your own ChatGPT plan'

    provider_slug = 'chatgpt'
    api_label = 'ChatGPT plan'
    base_url = 'https://api.openai.com/v1'
    default_model = ''
    MODEL_PREFIX = chatgpt_plan.MODEL_PREFIX

    async def resolve_token(self, config: dict[str, Any], context: 'ExecutionContext') -> str:
        from credentials import chatgpt as signin

        credential_id = config.get('credential')
        if not credential_id:
            return ''
        try:
            return await sync_to_async(signin.access_token_for)(credential_id, context.user_id)
        except signin.ChatGPTAuthError as exc:
            if exc.needs_sign_in:
                raise _TokenRefused({
                    'type': 'error', 'status': 401,
                    'message': f'{self.api_label}: sign in again ({exc.code}).',
                }) from exc
            raise _TokenRefused({
                'type': 'error', 'status': 503,
                'message': f'{self.api_label} sign-in is temporarily unavailable ({exc.code}).',
            }) from exc

    def _missing_key_error(self) -> str:
        return (
            'You are not signed in with ChatGPT. Press Continue with ChatGPT in '
            'the model picker, then send your message again.'
        )
