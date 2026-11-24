"""
Recorded provider HTTP for tests: replay a provider's real bytes, offline.

The scripted model (`llm/testing.py`) writes the provider's answer for a test,
in the OpenAI chat-completions format. It cannot tell us whether that format
is still what providers send, and it does not speak the other three wire
formats this app talks: Ollama's `/api/chat` (newline-delimited JSON), the
Responses API behind the ChatGPT plan (typed server-sent events), and
OpenRouter's Decisions API. A recording does both jobs. It is one exchange
with the real provider, saved once and replayed in every test after, so the
real handler parses the real bytes and nothing goes over the network.

    from llm.recorded import replay

    with replay("ollama_chat_stream") as tape:
        chunks = await collect(access.stream(provider="ollama", ...))
    assert tape.requests[0].json["stream"] is True

Seam: every place an outbound call leaves the process.
`workflow_backend.httpclient.shared_client` (and every module that imported
it by name) returns a client on a mock transport, and the module-level
`httpx.get` / `httpx.post` go to a sync client on the same transport. The
transport answers each request with the next recorded response, and refuses
a request whose method or URL differs from the recording.

Recordings live in `llm/tests/recordings/<name>.json`:

    {
      "source": "recorded" | "from-docs",
      "note": "where it came from and how to re-record it",
      "exchanges": [
        {"request":  {"method": "POST", "url": "http://localhost:11434/api/chat"},
         "response": {"status": 200, "headers": {...},
                      "json": {...}  or  "body": "..."  or  "body_lines": [...]}}
      ]
    }

`source` is honest about what a file is. `recorded` came off the wire.
`from-docs` was written from the provider's published API reference because
no account or local server was at hand. Such a file checks the parser against
the documented format, not against what the provider sends today. Re-record
it when you can (see below).

Missing recording: in CI (`CI` set) the test fails, naming the file, so a
recording cannot be quietly forgotten. Locally the test is skipped with the
same message.

Recording: run the test with `RECORD_PROVIDER_FIXTURES=1`. Requests then go to
the real provider, and the exchanges are written to the file. Recording only
happens when the file is missing; `RECORD_PROVIDER_FIXTURES=overwrite` replaces
an existing one. Tests use throwaway keys, so set `RECORD_BEARER_TOKEN` to a
real key or token and it is swapped in on the way out. Credentials are never
written: request headers are not saved at all, and only `content-type` is kept
from the response. A recording costs one real call, so a paid provider needs
the owner's go-ahead.
"""
from __future__ import annotations

import json
import os
import sys
import unittest
from contextlib import ExitStack, contextmanager
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any, Iterator
from unittest import mock

import httpx

from workflow_backend import httpclient

RECORDINGS_DIR = Path(__file__).resolve().parent / "tests" / "recordings"

#: Headers that carry credentials. Never written to a recording.
SECRET_HEADERS = frozenset({
    "authorization", "cookie", "set-cookie", "x-api-key", "api-key",
    "openai-organization", "openai-project", "chatgpt-account-id",
})
#: Response headers worth keeping. The rest (dates, request ids, CDN noise)
#: change on every call and would make each re-recording a noisy diff.
_KEPT_RESPONSE_HEADERS = frozenset({"content-type"})
#: Headers that describe the bytes on the wire, not the body httpx hands back.
#: `response.content` is already decoded, so passing `content-encoding: gzip`
#: on with it makes the reader try to unzip plain text.
_TRANSPORT_HEADERS = frozenset({"content-encoding", "content-length", "transfer-encoding"})


class RecordingMissing(AssertionError):
    """A test asked for a recording that is not on disk."""


@dataclass
class ReplayedRequest:
    """One request the code under test sent, as it went over the wire."""

    method: str
    url: str
    headers: dict[str, str]
    body: bytes = field(repr=False)

    @property
    def json(self) -> Any:
        return json.loads(self.body or b"null")


def _kept(request: httpx.Request) -> ReplayedRequest:
    return ReplayedRequest(method=request.method, url=str(request.url),
                           headers=dict(request.headers), body=request.content)


def _path(name: str) -> Path:
    return RECORDINGS_DIR / f"{name}.json"


def _same_url(a: str, b: str) -> bool:
    """Same scheme, host, port and path. The query is compared too, as a set."""
    ua, ub = httpx.URL(a), httpx.URL(b)
    return (
        (ua.scheme, ua.host, ua.port, ua.path) == (ub.scheme, ub.host, ub.port, ub.path)
        and sorted(ua.params.multi_items()) == sorted(ub.params.multi_items())
    )


def _response_from(recorded: dict[str, Any]) -> httpx.Response:
    status = int(recorded.get("status", 200))
    headers = dict(recorded.get("headers") or {})
    if "json" in recorded:
        return httpx.Response(status, headers=headers, json=recorded["json"])
    if "body_lines" in recorded:
        body = "".join(f"{line}\n" for line in recorded["body_lines"])
    else:
        body = recorded.get("body", "")
    return httpx.Response(status, headers=headers, content=body.encode())


class Tape:
    """A recording being replayed: what it answers, and what it was asked."""

    def __init__(self, name: str, exchanges: list[dict[str, Any]]) -> None:
        self.name = name
        self._exchanges = list(exchanges)
        self.requests: list[ReplayedRequest] = []
        self.problem: str | None = None

    @property
    def remaining(self) -> int:
        return len(self._exchanges)

    def _fail(self, message: str) -> AssertionError:
        self.problem = self.problem or message
        return AssertionError(message)

    def answer(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(_kept(request))
        number = len(self.requests)
        if not self._exchanges:
            raise self._fail(
                f"recording {self.name!r} has no exchange for request {number} "
                f"({request.method} {request.url})"
            )
        exchange = self._exchanges.pop(0)
        expected = exchange["request"]
        if request.method != expected["method"] or not _same_url(str(request.url), expected["url"]):
            raise self._fail(
                f"recording {self.name!r}, request {number}: the code sent "
                f"{request.method} {request.url} but the recording has "
                f"{expected['method']} {expected['url']}"
            )
        return _response_from(exchange["response"])

    def check(self) -> None:
        if self.problem:
            raise AssertionError(self.problem)
        if self._exchanges:
            raise AssertionError(
                f"recording {self.name!r}: {len(self._exchanges)} exchange(s) were never "
                f"requested; the code sent {len(self.requests)} request(s)"
            )


class Recorder:
    """Record mode: forward each request for real and keep the exchange."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.exchanges: list[dict[str, Any]] = []
        self.requests: list[ReplayedRequest] = []

    def _outgoing_headers(self, request: httpx.Request) -> dict[str, str]:
        headers = {k: v for k, v in request.headers.items()
                   if k.lower() not in {"content-length", "host"}}
        token = os.environ.get("RECORD_BEARER_TOKEN")
        if token and any(k.lower() == "authorization" for k in headers):
            headers = {k: v for k, v in headers.items() if k.lower() != "authorization"}
            headers["Authorization"] = f"Bearer {token}"
        return headers

    def keep(self, request: httpx.Request, response: httpx.Response, body: bytes) -> None:
        """Add one exchange, with nothing secret and nothing that changes per call."""
        self.requests.append(_kept(request))
        recorded_request: dict[str, Any] = {"method": request.method, "url": str(request.url)}
        recorded_response: dict[str, Any] = {
            "status": response.status_code,
            "headers": {
                k: v for k, v in response.headers.items()
                if k.lower() in _KEPT_RESPONSE_HEADERS and k.lower() not in SECRET_HEADERS
            },
        }
        text = body.decode("utf-8", "replace")
        if "json" in response.headers.get("content-type", "") and "\n" not in text.strip():
            try:
                recorded_response["json"] = json.loads(text)
            except ValueError:
                recorded_response["body"] = text
        elif "\n" in text:
            recorded_response["body_lines"] = text.rstrip("\n").split("\n")
        else:
            recorded_response["body"] = text
        self.exchanges.append({"request": recorded_request, "response": recorded_response})

    def _passed_on(self, response: httpx.Response, body: bytes) -> httpx.Response:
        headers = {k: v for k, v in response.headers.items()
                   if k.lower() not in _TRANSPORT_HEADERS}
        return httpx.Response(response.status_code, headers=headers, content=body)

    async def answer_async(self, request: httpx.Request) -> httpx.Response:
        async with httpx.AsyncClient(timeout=120) as real:
            response = await real.request(
                request.method, request.url,
                headers=self._outgoing_headers(request), content=request.content,
            )
        self.keep(request, response, response.content)
        return self._passed_on(response, response.content)

    def answer_sync(self, request: httpx.Request) -> httpx.Response:
        with httpx.Client(timeout=120) as real:
            response = real.request(
                request.method, request.url,
                headers=self._outgoing_headers(request), content=request.content,
            )
        self.keep(request, response, response.content)
        return self._passed_on(response, response.content)

    def save(self) -> None:
        if not self.exchanges:
            raise AssertionError(f"recording {self.name!r}: the code sent no request")
        RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
        payload = {
            "source": "recorded",
            "note": f"Recorded {date.today().isoformat()} with RECORD_PROVIDER_FIXTURES.",
            "exchanges": self.exchanges,
        }
        _path(self.name).write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def load(name: str) -> dict[str, Any]:
    """The recording on disk. Raises `RecordingMissing` when there is none."""
    path = _path(name)
    if not path.exists():
        raise RecordingMissing(
            f"no recording {path.name} in {RECORDINGS_DIR}. Record it with "
            f"RECORD_PROVIDER_FIXTURES=1 (see llm/recorded.py)."
        )
    return json.loads(path.read_text(encoding="utf-8"))


def _shared_client_seams() -> list[tuple[Any, str]]:
    """Every module attribute that is `workflow_backend.httpclient.shared_client`.

    Modules import it by name (`from workflow_backend.httpclient import
    shared_client`), so patching the one in `httpclient` alone would miss them.
    Scanning finds a new caller without anyone remembering to list it here.
    """
    original = httpclient.shared_client
    seams = [(httpclient, "shared_client")]
    for module in list(sys.modules.values()):
        if module is None or module is httpclient:
            continue
        try:
            if getattr(module, "shared_client", None) is original:
                seams.append((module, "shared_client"))
        except Exception:  # noqa: BLE001 - lazy modules may raise on getattr
            continue
    return seams


@contextmanager
def _installed(async_handler, sync_handler) -> Iterator[None]:
    async_client = httpx.AsyncClient(transport=httpx.MockTransport(async_handler))
    sync_client = httpx.Client(transport=httpx.MockTransport(sync_handler))
    with ExitStack() as stack:
        for module, attr in _shared_client_seams():
            stack.enter_context(mock.patch.object(module, attr, new=lambda: async_client))
        stack.enter_context(mock.patch.object(httpx, "get", new=sync_client.get))
        stack.enter_context(mock.patch.object(httpx, "post", new=sync_client.post))
        yield


@contextmanager
def replay(name: str) -> Iterator[Any]:
    """Answer every outbound HTTP request in the block from recording `name`."""
    mode = os.environ.get("RECORD_PROVIDER_FIXTURES", "").strip().lower()

    if mode and (mode == "overwrite" or not _path(name).exists()):
        recorder = Recorder(name)
        with _installed(recorder.answer_async, recorder.answer_sync):
            yield recorder
        recorder.save()
        return

    try:
        data = load(name)
    except RecordingMissing:
        if os.environ.get("CI"):
            raise
        raise unittest.SkipTest(
            f"no recording {name}.json; record it with RECORD_PROVIDER_FIXTURES=1") from None

    tape = Tape(name, data["exchanges"])

    async def answer_async(request: httpx.Request) -> httpx.Response:
        await request.aread()
        return tape.answer(request)

    def answer_sync(request: httpx.Request) -> httpx.Response:
        request.read()
        return tape.answer(request)

    try:
        with _installed(answer_async, answer_sync):
            yield tape
    except BaseException as exc:
        if tape.problem:
            # The code under test may have turned the refusal into an error of
            # its own. Name the real cause.
            raise AssertionError(tape.problem) from exc
        raise
    tape.check()
