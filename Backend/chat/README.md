# `chat/`: the assistant, the AI loop, and every tool

The user sees this as the chat page: sessions, messages, attachments, the plan
panel, approval cards and the slash-command palette. Chat is the orchestrator:
it reads, plans, and hands writing and sending work to saved agents.

The app holds three things:

1. **The chat feature**: sessions, messages, attachments.
2. **The AI loop** (`turn/`). Saved agents run on the same loop.
3. **The tool library** (`tools/`): everything the AI can do.

Design: [`docs/CHAT_AGENT.md`](../docs/CHAT_AGENT.md). Context lifecycle:
[`docs/CONTEXT_LIFECYCLE.md`](../docs/CONTEXT_LIFECYCLE.md).

## Read in this order

1. `tools/clock.py`: the smallest tool.
2. `tools/registry.py`: what `@tool(...)` records (schema, `effect`, `parallel`, `sensitive`, `requires`).
3. `turn/pipeline.py` → `run_chat_turn`: one message, end to end.
4. `turn/agent.py` → `_build_graph`, `run_turn`, `TurnContext`: the loop.
5. `tools/permissions.py`: which calls need approval.

## Data (`models.py`)

| Model | What it is |
|---|---|
| `ChatSession` | One conversation: model, effort, autonomy mode, memory on or off, org |
| `ChatMessage` | One message, with sources, trace and cost in `metadata` |
| `ChatAttachment` | An uploaded file on a session |
| `VisionExchange` | Questions asked about an image, and the answers |
| `ToolOutput` | A tool result too big for the model, kept so `read_tool_output` can fetch it |
| `ToolPermission` | "Always allow" answers to approval prompts |

## Files

| File | What it does |
|---|---|
| `turn/pipeline.py` | The steps before and after the model: preflight, history, memory, attachments, the run's plan |
| `turn/agent.py` | The loop (LangGraph): model, tools, curation, steering. `tools_node` runs a batch in four passes. `enclose_result` wraps each tool result in `<untrusted_data>` unless the tool is `trusted_output` |
| `turn/prompts.py` | System prompt and the context update message. Nothing that changes may go in the system prompt |
| `turn/history.py` | Loads the transcript the model sees: a window that moves in steps of 10 so the prefix stays cacheable; upload markers replay as a fixed pointer |
| `turn/session_notes.py` | The conversation's notes file: summary, task index, how to fetch more. Read every turn, but sent after the replayed history, not before it |
| `turn/context_view.py` | Backs `GET /api/chat/sessions/<id>/context/`, the "What the assistant sees" panel |
| `turn/curation.py` | Shrinks a long run's transcript and archives what it cuts |
| `turn/reasoning_note.py` | The short note of why a tool-calling turn made its calls, rendered into the transcript; strips a copied note from the answer |
| `turn/prune.py` | Deletes old chat checkpoint rows |
| `turn/extraction.py` | Fallback parser for models that write tool calls as text instead of native tool calls |
| `turn/side_calls.py` | Model calls a turn makes outside its own loop (for example, follow-up questions). Priced into the turn's cost |
| `turn/steering.py` | Messages sent to a running turn |
| `turn/todos.py` | The run's plan: `update_todos`, with history |
| `turn/pace.py` | quick, standard or deep, and the budget the model is told about |
| `turn/reviewer.py` | The auto-mode judge |
| `turn/checkpoints.py`, `turn/runs.py`, `turn/events.py` | Where run state is saved, runs that outlive the request, and what is streamed |
| `tools/` | One file per topic (below) |
| `commands/` | Slash commands. `registry.py` declares them, `resolve.py` parses them |
| `sources/` | Web search (`search.py`) and attachments (`attachments.py`) |
| `transport/` | Streaming events over HTTP |
| `vision/` | A cheap vision model that a text-only model can question about an image |
| `guest/` | Chat for visitors without an account |

### The tool files (`tools/`)

| File | Tools |
|---|---|
| `web.py`, `fetch.py`, `browser.py` | Web search, reading pages, downloading files, the browser |
| `knowledge.py`, `solutions.py` | Searching knowledge bases; team solutions |
| `files.py` | Your files: read, write, edit, move, versions, export |
| `sandbox.py` | `execute_python`, `run_python_on_files` |
| `office.py`, `charts.py` | Decks, workbooks, documents, PDFs, diagrams, charts |
| `artifacts.py`, `dashboards.py`, `publish.py` | HTML snippets, dashboards, shared pages |
| `google/`, `notion.py` | Gmail, Drive, Sheets, Calendar, Docs, Notion |
| `docs.py` | Reads a scanned document as text, rows or fields |
| `messaging/`, `talk.py` | Slack, WhatsApp, Teams, SMS, Telegram |
| `data.py`, `apicaller.py` | Your databases and your own APIs |
| `agents.py`, `authoring.py`, `tasks.py` | Running agents, creating agents, the coding team's tasks, `answer_subagent` |
| `ask.py` | `ask_user`: the run pauses until you answer |
| `decisions.py` | `decide`: a typed answer from a decision model |
| `memory.py`, `conversation.py`, `planning.py` | What the assistant remembers, searching this chat, the plan |
| `media.py`, `voice.py`, `vision.py` | Images, speech, questions about an image |
| `code.py`, `compute.py`, `workspace.py` | Coding (grant `shell`) and compute (grant `compute`). Need a workspace engine, so not offered until one exists |
| `runs.py`, `missions.py`, `esign.py`, `eval_manager.py`, `internal.py`, `clock.py` | Smaller tools: runs, missions, e-sign, eval management (chat only), internal, clock |
| `permissions.py`, `describe.py`, `tool_output.py` | Approval policy, the sentence on an approval card, and capping big results |
| `registry.py` | The `@tool` declaration. `trusted_output=True` marks a tool whose result is only ours, so it is not enclosed as third-party text |
| `__init__.py` | Imports every tool file (this registers them) and picks what a turn is offered. Chat gets reads, delegation, agent-building, memory and missions (`chat_orchestrator_allowed`) |

## Rules

- **Tools check ownership themselves.** `/api/chat/execute-tool/` can call any tool with any arguments.
- **Declare `effect` honestly.** It defaults to `"irreversible"`. Auto mode uses it to decide what needs approval.
- **Chat gets reads only, plus delegation.** Anything that writes, sends or spends is a saved agent's job. Adding a critical tool to `CHAT_ORCHESTRATOR_EXTRA` undoes that; give it a grant instead.
- **Adding a tool:** `@tool({...})` on an `async def`, import the file in `tools/__init__.py`, and add it to `GRANT_TOOLS` if agents should have it. Step by step: [`START_HERE.md`](../../START_HERE.md#9-common-jobs).

## Tests

`chat/tests/`. Start with `test_turn_output_e2e.py` (what a client receives),
`test_curation_e2e.py`, `test_orchestrator_scope.py`, `test_auto_mode.py`.
