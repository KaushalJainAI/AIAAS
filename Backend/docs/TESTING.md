# Testing the agent

Agent tests play the model with a script. Everything else runs for real.
The rule comes from the design guide: **script the model, run everything else
for real, control time in tests.**

## The three layers

1. **Scripted model (agent logic).** A test plays the model with
   `llm/testing.py`. The agent graph, the tools, `llm/access.py`, the provider
   handler and the database all run for real. Only the network is replaced.
2. **Real code everywhere else.** Use a real database (Django `TestCase`) and
   real tools, as long as they need no network. Do not patch our own functions.
3. **Benchmarks (model quality).** `eval/benchmarks/` calls real models and
   costs money. Ask the user before running one. See
   `eval/benchmarks/README.md`.

## Using the kit

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
| `text("...")` | Answers with text. |
| `reasoning("...")` | Shows reasoning. Combine with `+`: `reasoning("hm") + text("ok")`. |
| `tool_call(name, args, id=None)` | Calls a tool. Add more with `+` for several calls in one turn. |
| `usage(prompt_tokens, completion_tokens)` | Token counts for a reply: `text("x", usage=usage(40, 3))`. The default is 2 in, 1 out. |
| `fail(exc)` | The connection raises `exc`, as a broken socket would. |
| `provider_error(status, message)` | The provider answers with an HTTP error, such as 401 or 503. |
| `hang()` | Never answers. The test must cancel the call. |

### What a test can check

`model.requests` lists every call the model received, in order. Each entry has:

- `messages`, `tools`, `tool_choice`, `model`, `provider`, `effort`, `stream`,
  `api_key`, and `body` (the raw JSON).
- `system_text()`: the first system message.
- `last_user_text()`: the last user message.
- `tool_results()`: the tool messages sent back on that call.
- `tools_offered`: whether the model could call a tool on that call.

`model.assert_consumed()` fails if steps were left unused.

Pytest functions (no database) can use the fixture instead:

```python
from llm.testing import scripted

def test_something(scripted):
    scripted.push(text("hi"))
    ...
```

## Where the fake sits, and why

The kit replaces one thing: `llm.handlers.openai_compatible.shared_client`.
That is the single place where every OpenAI-compatible call leaves the process.
The kit puts an `httpx` client on a `MockTransport` there. The transport answers
each request with the next step, in the provider's wire format: JSON for
`complete()`, server-sent events for `stream()`.

Why this seam:

- **Not `llm.access.stream` or `complete`.** A patch there skips the funnel:
  credentials, context clamping, usage accounting, the tool-call parser and the
  error classifier never run. The `reviewer.py` bug hid behind this: the judge
  called a missing function and raised on every call, but every test patched
  `_model_judge` as a whole, so the suite passed.
- **Not the provider's handler.** Replacing the handler skips the payload
  builder and the SSE parser, which is where most of the wire-level bugs are.
- **Credentials: not patched.** The test user has no credential, so
  `llm/access.py` falls back to the platform key. The kit sets that key's
  environment variable (`OPENROUTER_API_KEY`) for the block. `model.requests[i].api_key`
  shows it was sent.

Not covered by the kit:

- **Ollama** (its own `/api/chat` format).
- **The ChatGPT plan** (`llm/handlers/responses_api.py`, its own HTTP call).
- **`llm/decisions.py`** (its own HTTP call).

Those need their own script or a recorded fixture, as described under next steps.

## Rules

- **Script the model. Do not replace the decision.** Never patch a function
  like `_model_judge`, `run_turn` or `llm.access.stream`. Script the model
  underneath it, so the code that decides still runs.
- **Never assert wall-clock speed.** A fast machine and a slow one both pass.
- **Never sleep in a test.** To wait for a request, use
  `await model.until_requested(n)`. It wakes on the request itself. To test a
  call that never returns, use `hang()`, wait for the request, then cancel.
- **Connection retries are off in the kit.** They sleep between attempts. A test
  that wants to see a retry must patch `openai_compatible.STREAM_CONNECT_RETRY_DELAYS`.
- **Assert on what was sent, as well as what came back.** The second request
  shows whether the tool result reached the model.
- **Do not rely on repeated replies.** When the script runs out, the kit raises
  `AssertionError` and names the call number. It raises again when the block
  exits, even if the code under test turned the error into an answer.

## Next steps

1. **Recorded provider fixtures.** Record one real provider response, replay it
   in tests, and fail CI when a fixture is missing. This would cover Ollama, the
   ChatGPT plan and `decisions.py`.
2. **A controllable clock.** Freeze or step time for the code that reads it
   (`get_current_time`, session expiry, schedules), so tests need no real waiting.
3. **Migrate the remaining ad-hoc fakes.** Each one patches `llm.access`, the
   model call, or `_model_judge`. Check each before moving it:
   - `chat/tests/test_turn_output_e2e.py`: its own `_ScriptedModel` patches `llm.access.stream`.
   - `chat/tests/test_questions.py`.
   - `chat/tests/test_pipeline.py` (the most patch sites of any file).
   - `chat/tests/test_auto_reviewer.py`, `chat/tests/test_auto_mode.py`,
     `chat/tests/test_injection_defences.py`: these patch `_model_judge`. This
     is the family the `reviewer.py` bug came from.
   - `chat/tests/test_curation.py`, `chat/tests/test_curation_e2e.py`,
     `chat/tests/test_context_overflow.py`, `chat/tests/test_iteration_limit.py`,
     `chat/tests/test_orchestrator_limits.py`, `chat/tests/test_pace.py`,
     `chat/tests/test_chat_transcript.py`, `chat/tests/test_approval_details_frame.py`,
     `chat/tests/test_account_errors.py`, `chat/tests/test_commands.py`,
     `chat/tests/test_attachment_prefix.py`.
   - `llm/tests/test_credits.py`.
   - `agents/tests/test_builder.py`, `agents/tests/test_run_cancellation.py`.
   - `eval/tests/` (`test_benchmarks.py`, `test_calibration.py`,
     `test_eval_mode.py`, `test_graders.py`, `test_phase1.py`, `test_phases.py`).
   - `inference/tests/test_extract_task.py`.
4. **Provider reasoning is captured** (fixed 2026-11-19). `llm/access.py` sets the
   handler's `thinking` flag on every hosted provider (not Ollama, whose handler
   changes the answer under it), so reasoning arrives as `Completion.thinking` on
   both paths and `<think>` tags are split out of the content.
   `llm/tests/test_scripted_model.py` (`ReasoningCaptureTests`) pins it.
