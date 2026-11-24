# Testing the agent

Agent tests play the model with a script. Everything else runs for real.
The rule comes from the design guide: **script the model, run everything else
for real, control time in tests.**

## The layers

1. **Scripted model (agent logic).** A test writes the model's replies with
   `llm/testing.py`. The agent graph, the tools, `llm/access.py`, the provider
   handler and the database all run for real. Only the network is replaced.
2. **Recorded provider HTTP (wire formats).** `llm/recorded.py` replays one
   saved exchange with a real provider, so the real handler parses real bytes.
   It covers what the scripted model cannot speak: Ollama, the ChatGPT plan
   (Responses API) and OpenRouter's Decisions API.
3. **A controllable clock (time).** `workflow_backend/testclock.py` freezes the
   clock and moves it when the test says. No test waits for time to pass.
4. **Real code everywhere else.** Use a real database (Django `TestCase`) and
   real tools, as long as they need no network. Do not patch our own functions.
5. **Benchmarks (model quality).** `eval/benchmarks/` calls real models and
   costs money. Ask the user before running one. See
   `eval/benchmarks/README.md`.

`llm/tests/test_no_model_fakes.py` fails if a test patches the model above the
wire (`llm.access.stream`, `llm.access.complete`, `_build_request`, or the
auto-mode judge). CI runs the whole suite on every push to `main` or `develop`
and on every pull request (`.github/workflows/backend.yml`).

## The scripted model

```python
from asgiref.sync import async_to_sync
from llm.testing import scripted_model, text, tool_call

with scripted_model([
    tool_call("get_current_time", {}),   # the model asks for the clock
    text("It is Tuesday."),              # then it answers
]) as model:
    result = async_to_sync(run_turn)(turn, prompt="what day is it?", thread_id="t1")

assert result.answer == "It is Tuesday."
assert len(model.requests) == 2                     # two model calls
assert model.requests[1].tool_results()             # the tool result was sent back
```

The model's steps are used in order. One step is used per model call.

### The steps

| Helper | What the model does |
|---|---|
| `text("...")` | Answers with text. `citations=[{"url": ..., "title": ...}]` adds sources. |
| `reasoning("...")` | Shows reasoning. Combine with `+`: `reasoning("hm") + text("ok")`. |
| `tool_call(name, args, id=None)` | Calls a tool. Add more with `+` for several calls in one turn. |
| `usage(prompt_tokens, completion_tokens)` | Token counts for a reply: `text("x", usage=usage(40, 3))`. The default is 2 in, 1 out. |
| `fail(exc)` | The connection raises `exc`, as a broken socket would. |
| `provider_error(status, message)` | The provider answers with an HTTP error, such as 401 or 503. |
| `hang()` | Never answers. The test must cancel the call. |
| `always(fn)` | Answers every remaining call with `fn(request)`. For a model whose answer depends on what it was sent, such as "call a tool while tools are offered, then answer". It goes last. |

### What a test can check

`model.requests` lists every call the model received, in order. Each entry has:

- `messages`, `tools`, `tool_choice`, `model`, `provider`, `effort`, `stream`,
  `api_key`, and `body` (the raw JSON).
- `system_text()`: the first system message. `system_messages()`: all of them.
- `last_user_text()`: the last user message.
- `tool_results()`: the tool messages sent back on that call.
- `tools_offered`: whether the model could call a tool on that call.

`model.assert_consumed()` fails if steps were left unused.

A script with no steps (`scripted_model()`) is how a test says "the model must
not be called": a call fails the test. It also supplies the platform key, so
the real preflight runs.

One `ScriptedModel` can be installed more than once with `model.installed()`.
That is how a turn that pauses and resumes keeps one script and one list of
requests.

Pytest functions (no database) can use the fixture instead:

```python
from llm.testing import scripted

def test_something(scripted):
    scripted.push(text("hi"))
    ...
```

### Where the fake sits, and why

The kit replaces one thing: `workflow_backend.httpclient.shared_client`, the
pooled client every outbound call uses, in every module that imported it
(`llm.testing.shared_client_seams`). The kit puts an `httpx` client on a
`MockTransport` there. The transport answers each chat-completions request with
the next step, in the provider's wire format: JSON for `complete()`,
server-sent events for `stream()`. Any other route is refused and named.

Why this seam:

- **Not `llm.access.stream` or `complete`.** A patch there skips the funnel:
  credentials, context clamping, usage accounting, the tool-call parser and the
  error classifier never run. The `reviewer.py` bug hid behind this: the judge
  called a missing function and raised on every call, but every test patched
  `_model_judge` as a whole, so the suite passed.
- **Not the provider's handler.** Replacing the handler skips the payload
  builder and the SSE parser, which is where most of the wire-level bugs are.
- **Every caller of the shared client.** Model calls that do not go through the
  funnel, such as the injection check in `core/safety/moderation.py`, use the
  same client and draw on the same script.
- **Credentials: not patched.** The test user has no credential, so
  `llm/access.py` falls back to the platform key. The kit sets that key's
  environment variable (`OPENROUTER_API_KEY`) for the block.
  `model.requests[i].api_key` shows it was sent.

## Recorded provider HTTP

```python
from llm.recorded import replay

with replay("ollama_chat_stream") as tape:
    result = collect(access.stream(provider="ollama", model="qwen3:8b", ...))
assert tape.requests[0].json["stream"] is True
```

A recording is `llm/tests/recordings/<name>.json`: the requests in order (method
and URL) and the responses as they came back. The replay refuses a request
whose method or URL differs, and fails when an exchange is left unused. The
tests are in `llm/tests/test_recorded_providers.py`.

Each file says where it came from in `source`:

- `recorded`: taken off the wire. Today that is `openrouter_decision_models`.
- `from-docs`: written from the provider's published API reference, because no
  local Ollama, ChatGPT sign-in or paid key was at hand. It checks our parser
  against the documented format, not against what the provider sends today.
  Its `note` says how to re-record it.

To record: run the test with `RECORD_PROVIDER_FIXTURES=1` (only missing files)
or `RECORD_PROVIDER_FIXTURES=overwrite`. Tests use throwaway keys, so set
`RECORD_BEARER_TOKEN` to a real key or token. Request headers are never saved,
and only `content-type` is kept from the response. A recording of a paid
provider costs one real call: ask the user first.

A missing recording skips the test locally and fails it in CI (`CI` set).

## The clock

```python
from workflow_backend.testclock import freeze_for, frozen_clock

with frozen_clock("2026-11-23 09:00") as clock:
    token = issue_token()
    clock.advance(minutes=61)
    assert is_expired(token)
```

Inside the block the wall clock does not move: `timezone.now()`,
`datetime.now()` and `time.time()` all return the frozen instant until the test
calls `clock.advance(...)` or `clock.set(...)`. `freeze_for(self)` freezes it
from `setUp` and releases it on cleanup. `time.monotonic()` keeps running, so
timeouts and `asyncio` waits still work. Examples: the clock tool, JWT expiry
and a daily schedule in `workflow_backend/tests/test_testclock.py`.

## Rules

- **Script the model. Do not replace the decision.** Never patch a function
  like `_model_judge` or `llm.access.stream`. Script the model underneath it,
  so the code that decides still runs. The guard test enforces it.
- **Never assert wall-clock speed.** A fast machine and a slow one both pass.
  To prove things ran at the same time, use a barrier (see
  `test_auto_reviewer.py::test_gates_are_decided_concurrently`).
- **Never sleep in a test.** To wait for a request, use
  `await model.until_requested(n)`. To make time pass, move the frozen clock.
- **Connection retries are off in the kit.** They sleep between attempts. A test
  that wants to see a retry must patch `openai_compatible.STREAM_CONNECT_RETRY_DELAYS`.
- **Assert on what was sent, as well as what came back.** The second request
  shows whether the tool result reached the model. A request also shows what
  the funnel's final guard did: tests that read the history handed to the
  funnel passed while the request that left had been trimmed
  (`test_chat_transcript.py`, `test_curation_e2e.py`).
- **Give a small budget a small tool list.** The chat catalogue's tool schemas
  are tens of thousands of tokens. A test with a tight context budget passes
  `tool_source=` with only the tools it calls, or the definitions alone fill
  the budget.
- **Do not rely on repeated replies.** When the script runs out, the kit raises
  `AssertionError` and names the call number. It raises again when the block
  exits, even if the code under test turned the error into an answer.

## What is still not real

- **Recordings from the live providers.** Only the decision-model listing is a
  real recording. Re-record the `from-docs` files when an Ollama server, a
  ChatGPT sign-in or a key (with the user's go-ahead) is available.
- **`core/safety/moderation.py::classify`** (image prompts and pages) still
  calls `httpx.post` directly. Its tests patch the classifier's result.
- **Tests that stop at `run_turn`** to read the `TurnContext` that `run_agent`
  built (`test_run_org.py`, `test_taint_inheritance.py`) read configuration;
  they do not fake the model. So does the internal-crash test in
  `test_run_cancellation.py`, which has no wire-level cause to script.
