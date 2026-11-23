"""
A scripted model for tests: script the provider's answers, run everything else.

Tests used to invent their own fake model, each one patching a different
function (`llm.access.stream`, a judge, a `complete`). A patch at that height
skips the funnel: credentials, context clamping, usage accounting, the tool-call
parser and the error classifier never run, so a bug in them passes every test.

This kit replaces the network, and nothing above it:

    run_turn / agent graph            real
    llm.access  (complete / stream)   real: credentials, clamping, usage, errors
    handler  (OpenRouterNode, ...)    real: payload, SSE parsing, error shape
    httpx client                      SCRIPTED here, the only fake

Seam: `llm.handlers.openai_compatible.shared_client`, the one place every
OpenAI-compatible call leaves the process. It is replaced by an `httpx.AsyncClient`
on a `MockTransport`. The transport answers each request with the next scripted
step, as the provider's wire format (JSON for `complete`, server-sent events for
`stream`). Each request is recorded as it went over the wire.

Credentials: no patch. `_build_request` finds no credential for the test user
and falls back to the platform key, so the kit sets that key's environment
variable (`OPENROUTER_API_KEY` for openrouter) for the length of the block.

Usage::

    from llm.testing import scripted_model, text, tool_call

    with scripted_model([tool_call("get_current_time", {}), text("It is noon.")]) as model:
        result = async_to_sync(run_turn)(turn, prompt="time?", thread_id="t1")
    assert len(model.requests) == 2
    assert model.requests[1].tool_results()

Not covered: Ollama (its own `/api/chat` wire format) and the ChatGPT plan
(the Responses API, `responses_api.py`), which open their own HTTP clients.
"""
from __future__ import annotations

import asyncio
import json
import os
from contextlib import ExitStack, contextmanager
from dataclasses import dataclass, field
from typing import Any, Iterator, Union
from unittest import mock

import httpx

from llm.handlers import openai_compatible

DEFAULT_PROVIDER = "openrouter"
#: A model id from CLAUDE.md's model table. The kit never checks the catalogue,
#: so any string works; a real id keeps the test honest about what it stands for.
DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash"
#: Fake key placed in the platform-key variable. Never sent anywhere: the
#: transport answers every request itself.
TEST_API_KEY = "scripted-test-key"

#: Providers the kit can answer for, with the environment variable each one's
#: platform key is read from (`credentials.resolution.PLATFORM_ENV_KEYS`).
_PLATFORM_KEY_ENV = {
    "openrouter": "OPENROUTER_API_KEY",
    "openai": "OPENAI_API_KEY",
    "nvidia": "NVIDIA_API_KEY",
}
#: Host each provider's chat endpoint lives on, used to name the provider a
#: request was sent to. The transport itself does not care which one it is.
_HOST_PROVIDER = {
    "openrouter.ai": "openrouter",
    "api.openai.com": "openai",
    "integrate.api.nvidia.com": "nvidia",
}


# ── Steps ────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Usage:
    """Token counts for one reply. Defaults to 2 in and 1 out: 3 in total."""

    prompt_tokens: int = 2
    completion_tokens: int = 1

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens

    def as_wire(self) -> dict[str, int]:
        return {
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
        }


def usage(prompt_tokens: int = 2, completion_tokens: int = 1) -> Usage:
    """Token counts to attach to a reply: `text("hi", usage=usage(40, 3))`."""
    return Usage(prompt_tokens, completion_tokens)


@dataclass(frozen=True)
class ToolCallSpec:
    name: str
    arguments: dict[str, Any]
    #: None means "generate one", deterministically, when the reply is sent.
    id: str | None = None


@dataclass(frozen=True)
class Reply:
    """One successful model reply. Combine replies with `+`.

    `reasoning("x") + tool_call("a", {}) + tool_call("b", {})` is one reply
    with reasoning and two calls in the same turn.
    """

    content: str = ""
    reasoning: str = ""
    calls: tuple[ToolCallSpec, ...] = ()
    usage: Usage | None = None

    def __add__(self, other: object) -> "Reply":
        if not isinstance(other, Reply):
            return NotImplemented
        return Reply(
            content=self.content + other.content,
            reasoning=self.reasoning + other.reasoning,
            calls=self.calls + other.calls,
            usage=other.usage or self.usage,
        )


@dataclass(frozen=True)
class Failure:
    """The transport raises `exc`, as a dropped connection or a bug would."""

    exc: BaseException


@dataclass(frozen=True)
class ProviderError:
    """The provider answers with an HTTP error status and a body."""

    status: int
    message: str


@dataclass(frozen=True)
class Hang:
    """The provider never answers. Ends only when the caller cancels."""


Step = Union[Reply, Failure, ProviderError, Hang]


def text(content: str, *, usage: Usage | None = None) -> Reply:
    """A plain answer."""
    return Reply(content=content, usage=usage)


def reasoning(content: str) -> Reply:
    """Reasoning the model shows before its answer. Streamed calls surface it."""
    return Reply(reasoning=content)


def tool_call(name: str, args: dict[str, Any] | None = None, id: str | None = None) -> Reply:
    """One tool call. Add more with `+` to make several calls in one turn."""
    return Reply(calls=(ToolCallSpec(name=name, arguments=dict(args or {}), id=id),))


def fail(exc: BaseException) -> Failure:
    """Raise `exc` at the transport, the way a broken connection would."""
    return Failure(exc)


def provider_error(status: int, message: str = "") -> ProviderError:
    """Answer with an HTTP error status, the way a rejecting provider would."""
    return ProviderError(status, message or f"provider returned {status}")


def hang() -> Hang:
    """Never answer. A test using it must cancel the call itself."""
    return Hang()


def _flatten(steps: tuple[Any, ...]) -> list[Step]:
    if len(steps) == 1 and isinstance(steps[0], (list, tuple)):
        steps = tuple(steps[0])
    for step in steps:
        if not isinstance(step, (Reply, Failure, ProviderError, Hang)):
            raise TypeError(
                f"not a scripted step: {step!r}. Use text(), reasoning(), "
                "tool_call(), fail(), provider_error() or hang()."
            )
    return list(steps)


# ── Recorded requests ────────────────────────────────────────────────────────

def _text_of(content: Any) -> str:
    """The text of a message's content, whether a string or a list of parts."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    return "".join(
        part.get("text", "")
        for part in content
        if isinstance(part, dict) and part.get("type") == "text"
    )


@dataclass
class ScriptedRequest:
    """One model call, as it went over the wire."""

    #: 1-based: the first model call is 1.
    index: int
    provider: str
    model: str
    stream: bool
    #: The `messages` array exactly as sent.
    messages: list[dict[str, Any]]
    #: The `tools` array exactly as sent; empty when none were offered.
    tools: list[dict[str, Any]]
    tool_choice: str | None
    #: The effort level sent, or None when the field was not sent.
    effort: str | None
    api_key: str
    body: dict[str, Any] = field(repr=False)

    @property
    def tools_offered(self) -> bool:
        """Whether the model was allowed to call a tool on this request."""
        return bool(self.tools) and self.tool_choice != "none"

    def system_messages(self) -> list[str]:
        return [_text_of(m.get("content")) for m in self.messages if m.get("role") == "system"]

    def system_text(self) -> str:
        """The first system message: the session-stable prompt."""
        found = self.system_messages()
        return found[0] if found else ""

    def last_user_text(self) -> str:
        for message in reversed(self.messages):
            if message.get("role") == "user":
                return _text_of(message.get("content"))
        return ""

    def tool_results(self) -> list[dict[str, Any]]:
        """The tool-result messages sent back to the model on this call."""
        return [m for m in self.messages if m.get("role") == "tool"]


def _effort_of(body: dict[str, Any]) -> str | None:
    reasoning_obj = body.get("reasoning")
    if isinstance(reasoning_obj, dict) and reasoning_obj.get("effort"):
        return reasoning_obj["effort"]
    return body.get("reasoning_effort")


# ── The model ────────────────────────────────────────────────────────────────

class ScriptedModel:
    """The steps the provider will answer with, and the requests it received.

    Each model call consumes the next step. Running out of steps is an error
    that names the call number. It is raised again when the block exits, even
    if the code above it swallowed the first one.
    """

    def __init__(
        self,
        steps: Any = (),
        *,
        provider: str = DEFAULT_PROVIDER,
        model: str = DEFAULT_MODEL,
    ) -> None:
        if provider not in _PLATFORM_KEY_ENV:
            raise ValueError(
                f"the scripted model answers for {sorted(_PLATFORM_KEY_ENV)}; "
                f"not {provider!r}. Ollama and the ChatGPT plan use other wire formats."
            )
        self.provider = provider
        self.model = model
        self._steps: list[Step] = _flatten(tuple(steps))
        self.requests: list[ScriptedRequest] = []
        #: Requests to any route other than chat completions. The script does not answer these.
        self.unexpected: list[str] = []
        self._problem: str | None = None
        self._waiters: list[asyncio.Future] = []

    # ── script ──

    @property
    def remaining(self) -> int:
        """Steps not yet used."""
        return len(self._steps)

    def push(self, *steps: Any) -> None:
        """Add steps to the end of the script, mid-test."""
        self._steps.extend(_flatten(steps))

    def assert_consumed(self) -> None:
        """Fail if the script has steps the model never asked for."""
        if self._steps:
            raise AssertionError(
                f"{len(self._steps)} scripted step(s) were never used; "
                f"the model was called {len(self.requests)} time(s)"
            )

    async def until_requested(self, count: int = 1) -> None:
        """Wait, without sleeping, until the model has been called `count` times."""
        loop = asyncio.get_running_loop()
        while len(self.requests) < count:
            waiter = loop.create_future()
            self._waiters.append(waiter)
            await waiter

    def check(self) -> None:
        """Raise if the script misbehaved: ran out of steps, or called a route it does not answer."""
        if self._problem:
            raise AssertionError(self._problem)
        if self.unexpected:
            raise AssertionError(
                "the model was called on a route the script does not answer: "
                + ", ".join(self.unexpected)
            )

    # ── the transport ──

    async def _handle(self, request: httpx.Request) -> httpx.Response:
        await request.aread()
        if not request.url.path.endswith("/chat/completions"):
            route = f"{request.method} {request.url.path}"
            self.unexpected.append(route)
            return httpx.Response(404, json={"error": {"message": f"not scripted: {route}"}})

        body = json.loads(request.content or b"{}")
        index = len(self.requests) + 1
        self.requests.append(ScriptedRequest(
            index=index,
            provider=_HOST_PROVIDER.get(request.url.host, request.url.host),
            model=body.get("model", self.model),
            stream=bool(body.get("stream")),
            messages=list(body.get("messages") or []),
            tools=list(body.get("tools") or []),
            tool_choice=body.get("tool_choice"),
            effort=_effort_of(body),
            api_key=(request.headers.get("authorization") or "").removeprefix("Bearer "),
            body=body,
        ))
        for waiter in self._waiters:
            if not waiter.done():
                waiter.set_result(None)
        self._waiters.clear()

        if not self._steps:
            message = (
                f"scripted model ran out of steps: model call {index} has no scripted "
                f"reply ({index - 1} step(s) were used)"
            )
            self._problem = self._problem or message
            # Handlers turn any Exception into an error reply, so this also
            # reaches check() through `_problem`.
            raise AssertionError(message)

        step = self._steps.pop(0)
        if isinstance(step, Hang):
            await asyncio.Event().wait()  # never set: ends only when cancelled
        if isinstance(step, Failure):
            raise step.exc
        if isinstance(step, ProviderError):
            return httpx.Response(step.status, json={"error": {
                "message": step.message, "code": step.status,
            }})
        if body.get("stream"):
            return httpx.Response(
                200, headers={"content-type": "text/event-stream"},
                content=self._sse(step, index, body).encode(),
            )
        return httpx.Response(200, json=self._completion(step, index, body))

    def _call_ids(self, reply: Reply, index: int) -> list[str]:
        return [
            call.id or f"call_{index}_{k}" for k, call in enumerate(reply.calls)
        ]

    def _sse(self, reply: Reply, index: int, body: dict[str, Any]) -> str:
        frames: list[str] = []
        base = {"id": f"scripted-{index}", "object": "chat.completion.chunk",
                "model": body.get("model", self.model)}

        def frame(choices: list[dict[str, Any]], **extra: Any) -> None:
            frames.append("data: " + json.dumps({**base, "choices": choices, **extra}) + "\n\n")

        if reply.reasoning:
            frame([{"index": 0, "delta": {"reasoning": reply.reasoning}}])
        if reply.content:
            frame([{"index": 0, "delta": {"content": reply.content}}])
        # Each call's name and arguments arrive in separate deltas, as providers
        # send them, so the accumulator's reassembly runs for real.
        for k, (call, call_id) in enumerate(zip(reply.calls, self._call_ids(reply, index))):
            frame([{"index": 0, "delta": {"tool_calls": [{
                "index": k, "id": call_id, "type": "function",
                "function": {"name": call.name, "arguments": ""},
            }]}}])
            frame([{"index": 0, "delta": {"tool_calls": [{
                "index": k, "function": {"arguments": json.dumps(call.arguments)},
            }]}}])
        frame([{"index": 0, "delta": {},
                "finish_reason": "tool_calls" if reply.calls else "stop"}])
        # Usage comes in a trailing frame with no choices, as
        # `stream_options.include_usage` asks providers to send it.
        frame([], usage=(reply.usage or Usage()).as_wire())
        frames.append("data: [DONE]\n\n")
        return "".join(frames)

    def _completion(self, reply: Reply, index: int, body: dict[str, Any]) -> dict[str, Any]:
        message: dict[str, Any] = {"role": "assistant", "content": reply.content}
        if reply.reasoning:
            message["reasoning"] = reply.reasoning
        if reply.calls:
            message["tool_calls"] = [
                {"id": call_id, "type": "function",
                 "function": {"name": call.name, "arguments": json.dumps(call.arguments)}}
                for call, call_id in zip(reply.calls, self._call_ids(reply, index))
            ]
        return {
            "id": f"scripted-{index}", "object": "chat.completion",
            "model": body.get("model", self.model),
            "choices": [{"index": 0, "message": message,
                         "finish_reason": "tool_calls" if reply.calls else "stop"}],
            "usage": (reply.usage or Usage()).as_wire(),
        }

    # ── installation ──

    @contextmanager
    def installed(self) -> Iterator["ScriptedModel"]:
        """Install the transport and the platform key, and restore both on exit."""
        client = httpx.AsyncClient(transport=httpx.MockTransport(self._handle))
        env_name = _PLATFORM_KEY_ENV[self.provider]
        try:
            with ExitStack() as stack:
                stack.enter_context(mock.patch.object(
                    openai_compatible, "shared_client", new=lambda: client,
                ))
                # Connection retries sleep between attempts. A test that wants
                # to see a retry can patch the delays itself.
                stack.enter_context(mock.patch.object(
                    openai_compatible, "STREAM_CONNECT_RETRY_DELAYS", (),
                ))
                stack.enter_context(mock.patch.dict(os.environ, {env_name: TEST_API_KEY}))
                yield self
        except BaseException as exc:
            if self._problem:
                # The code under test may have turned the missing reply into an
                # error of its own. Name the real cause.
                raise AssertionError(self._problem) from exc
            raise
        self.check()


@contextmanager
def scripted_model(
    *steps: Any,
    provider: str = DEFAULT_PROVIDER,
    model: str = DEFAULT_MODEL,
) -> Iterator[ScriptedModel]:
    """Install a scripted model for the block. Accepts steps as varargs or one list."""
    scripted = ScriptedModel(_flatten(steps), provider=provider, model=model)
    with scripted.installed():
        yield scripted


# ── pytest fixture form ──────────────────────────────────────────────────────
# Only for plain pytest functions. Django `TestCase` methods are unittest style
# and use `scripted_model(...)` instead. Import the name into the test module
# for pytest to find it:  `from llm.testing import scripted`.

try:  # pytest is a dev dependency; the app never imports this module at runtime
    import pytest
except ImportError:  # pragma: no cover
    pytest = None

if pytest is not None:

    @pytest.fixture
    def scripted():
        """A scripted model with no steps yet. The test pushes its own: `scripted.push(text("hi"))`."""
        with scripted_model() as model:
            yield model
