# Chat Agent

How the chat assistant in `Backend/chat/` works: one message end to end, the
AI loop at its centre, and the choices a newcomer would otherwise undo by
accident.

Saved agents (`agents/`) run the same loop with different configuration:
which tools, which safety level, who is watching.

## Where things are

| Path | What it does |
|---|---|
| `chat/views.py` | HTTP only: check who you are, read the request, hand it on |
| `chat/turn/runs.py` | Keeps a turn running after the HTTP request that started it |
| `chat/turn/pipeline.py` | **One turn, end to end** (`run_chat_turn`). Read this first |
| `chat/turn/agent.py` | **The AI loop** (a LangGraph graph) and `TurnContext` |
| `chat/turn/prompts.py` | The system prompt and the small prompts used inside the loop |
| `chat/turn/history.py` | What the model gets to see from earlier in the conversation |
| `chat/turn/curation.py` | Shrinking a long run so it fits the model's memory |
| `chat/turn/steering.py` | Messages you send while a run is working |
| `chat/turn/todos.py` | The run's own plan (its todo list) |
| `chat/turn/pace.py` | How much time a turn is worth, and the budget the model is told |
| `chat/turn/reviewer.py` | In `auto` mode, a second model decides whether a risky call needs you |
| `chat/turn/events.py` | The events streamed to the browser |
| `chat/turn/extraction.py` | Backup parser for weak models that write tool calls as text |
| `chat/transport/` | Turning events into a server-sent events response |
| `chat/sources/` | Web search and file attachments |
| `chat/tools/` | Every tool, one file per topic, `@tool(...)` |
| `chat/commands/` | Slash commands like `/agent` and `/memory` |
| `chat/vision/` | Lets a text-only model ask questions about an image |
| `chat/guest/` | Chat without an account |
| `llm/access.py` | Every model call goes through it |

## One message, step by step

```
POST /api/chat/sessions/<id>/message/stream/
  chat/views.py  send_message_stream
    └─ chat/turn/runs.py  start           (the turn now lives outside the request)
        └─ chat/turn/pipeline.py  run_chat_turn
             1. preflight: is there a working model key? Fail now if not.
             2. slash command? resolve it (chat/commands/)
             3. save your message
             4. load history, your saved memories, attachments
             5. build the system prompt + a "context update" message
             6. pick the turn's starting pace (chat/turn/pace.py)
             7. chat/turn/agent.py  run_turn   ← the AI loop, below
             8. suggest follow-up questions (a small separate model call)
             9. save the answer, with sources, cost and trace
  events stream back as "data:" lines the whole time
```

`send_message` (the non-streaming endpoint) runs the exact same function and
throws the events away.

## The AI loop

`chat/turn/agent.py::_build_graph` builds a loop of four steps:

```
agent ──► tools ──► curate ──► steering ──► agent ... (until a final answer)
```

1. **agent**: send the conversation to the model. It answers, or asks for
   one or more tools.
2. **tools**: run those tools. Safe ones (`parallel=True`) run at the same
   time. Risky ones may pause for approval first.
3. **curate**: shrink the oldest part if the conversation is getting too
   long (see `CONTEXT_LIFECYCLE.md`).
4. **steering**: add anything you typed while it worked.

The loop stops when the model answers without asking for a tool, or at its
iteration limit. At the limit it is told to answer with what it has, so a
long run ends with a partial answer instead of an error.

## Pace: quick questions stay quick

Every chat turn runs at one of three paces (`chat/turn/pace.py`):

| Pace | Model calls | Starts here when |
|---|---|---|
| `quick` | 3 | you picked Search, Image or Video, or the message is a short lookup |
| `standard` | 12 | everything else, and any message with an attachment |
| `deep` | 36 | you picked Research, or typed a command that starts a run (`/agent`) |

Three rules:

1. **The model is told its budget on every pass**, as a trailing message with
   the pace and the tool rounds left. One round before the end it is told the
   next reply must be the answer.
2. **The model promotes itself.** Calling `update_todos`, delegating to an
   agent or starting `deep_research` moves the turn to `deep`
   (`PROMOTING_TOOLS`). Nothing classifies the message up front. Promotion is
   one-way.
3. **The pace is stored in `metadata['pace']`**, so it survives an approval
   pause. `[Latency] turn ... pace=quick>deep` in the log shows where each
   turn started and ended.

Agent runs and evals set no pace and are unchanged. The numbers live in
`workflow_backend/thresholds.py::PACE_ITERATIONS`. Tests:
`chat/tests/test_pace.py`.

## Design choices to keep

**Chat is the manager; agents do the work.** Chat cannot be set up the way an
agent can (no grants, no scopes), so it holds only basic tools: read, find,
run, build, answer agents, memory and missions. Anything that writes a file,
sends mail, publishes, makes a deck or spends money is handed to an agent.
The check runs twice: `get_available_tools` does not offer the tool, and
`execute_chat_tool` refuses it if the model names it anyway. Keep that second
check out of `execute_tool`: agents use `execute_tool` too.

**The model gets a real transcript.** Tool requests go back to the model as
an assistant message with `tool_calls`; results go back as `tool` messages
with the matching id. Models then make native tool calls instead of writing
them as text.

**The answer streams as plain markdown.** Text shows as it arrives
(`content_chunk`). If the model says "let me look that up" and *then* calls a
tool, the server sends `content_reset` and the browser clears that preamble.
Follow-up questions come from a small separate call after the answer
(`suggest_follow_ups`).

**The system prompt only holds things that never change during a session.**
The clock, and anything else that changes every turn, goes into a separate
"context update" message near the end, so the provider can reuse its cache
of the prompt. Your saved memories are the one exception: they change rarely.

**Memory off means no earlier messages, not "don't save".** Messages are
always saved. With memory off the model just does not see earlier turns;
the turn gets a throwaway `thread_id`.

**Recall doesn't wait for the model.** When you plainly refer to something
said earlier, the pipeline searches the conversation itself and adds the
result.

**Attachments are never silently ignored.** Vision models get the file. Text
models get its extracted text, or ask the vision helper (`ask_vision`). Files
nobody can read are reported to you *and* to the model.

**Approval.** A risky tool pauses the graph with LangGraph's `interrupt()`
and sends `ask_permission`. The browser answers with `approve_tool_call` or
`reject_tool_call`. All approvals are decided *before* any tool in the batch
runs, because `interrupt()` re-runs the whole step on resume. Which calls
need approval is decided in `chat/tools/permissions.py`.

**Every tool must check ownership itself.** `/api/chat/execute-tool/` lets a
logged-in user call a tool directly with any arguments. Each tool must check
that the thing it touches belongs to the caller.

**Delegating to a saved agent.** `run_agent` starts the agent run in the
background and waits for it, instead of running it inside the chat loop.
Agents cannot call `run_agent` themselves: it is in no `GRANT_TOOLS` group.

**Weak models.** `extraction.py` recognises tool calls written as text in two
known shapes only. Guessing more formats risks running the *wrong* tool.

## Events sent to the browser

The full list is `chat/turn/events.py::Event`. The main ones: `status`,
`thinking_chunk`, `content_chunk`, `content_reset`, `agent_trace`,
`sources_update`, `images_update`, `videos_update`, `chart`, `html_artifact`,
`todos_update`, `files_update`, `ask_permission`, `done`, `steers_returned`,
`error`.

On the frontend, `src/features/chat/hooks/useChatStream.ts` turns these
events into screen state.

## Testing

- `chat/tests/test_pipeline.py`: whole turns with the model faked (patch
  `llm.access.stream`; stub `chat.tools.get_available_tools`, because the
  real tool list reaches the user's MCP servers).
- `chat/tests/test_turn_output_e2e.py`: drives the real graph and checks
  what a browser gets.
- `chat/tests/test_curation_e2e.py`: twenty real turns against a fake model.
- `chat/tests/test_agent_tools.py`: the sandbox and each tool's ownership
  checks.
- `test_parallel_tools.py`, `test_steering.py`, `test_todos.py`,
  `test_permissions.py`: one feature each.
