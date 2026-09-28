# Start Here

A beginner's tour of the AIAAS codebase. Read this first. It tells you what the
product does, how the pieces fit, and which file to open for each job.

You do not need to read the whole codebase. Most changes touch one or two
folders. This page tells you which ones.

---

## 1. What AIAAS is, in one paragraph

AIAAS is a web app for building **AI agents that do real work for you**. You
can chat with an assistant that searches the web, reads your files, runs
Python, and makes charts. You can also save an **agent**: a named setup
(instructions + model + allowed tools) that runs on demand or on a schedule.
The chat assistant is the **manager**: it reads, plans and hands work to
agents. Anything that writes files, sends mail, publishes or makes a deck is
done by an agent, because an agent is where you decide what it may touch.
Anything risky, like sending an email, **pauses and asks you first**. An agent
that is unsure can also pause and ask you a question. Files an agent makes
(decks, spreadsheets, documents) open in built-in **Docs, Sheets and Slides**
apps.

## 2. The three folders

| Folder | What it is | Language |
|---|---|---|
| `Backend/` | The server. Stores data, talks to AI models, runs tools. | Python, Django |
| `better-n8n-frontend/` | The website you click on. | TypeScript, React |
| `BrowserOS/` | An older desktop-style UI. **Parked, do not work here.** | TypeScript, React |

The name `better-n8n-frontend` is historical. The app used to be a drag-and-drop
workflow editor like n8n. That editor is gone. Ignore the name.

Each of `Backend/` and `better-n8n-frontend/` is its own git repo. The top
folder is not a repo.

## 3. Run it on your machine

Backend (in one terminal):

```bash
cd Backend
python -m venv venv
source venv/Scripts/activate      # Windows. On Mac/Linux: source venv/bin/activate
pip install -r requirements.txt
cp .env.local .env                # then put your OPENROUTER_API_KEY in .env
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

Frontend (in a second terminal):

```bash
cd better-n8n-frontend
npm install
npm run dev                       # open http://localhost:5173
```

You do not need Redis, Postgres or Docker for local work. SQLite and in-memory
stand-ins are used by default.

## 4. Six words you need to know

| Word | Meaning | Where it lives |
|---|---|---|
| **Chat session** | One conversation in the chat page. | `Backend/chat/models.py` (`ChatSession`, `ChatMessage`) |
| **Agent** | A saved setup: prompt, model, allowed tools, safety rules. Not code. | `Backend/agents/models.py` (`SubAgent`) |
| **Run** | One time an agent was executed. Has turns and steps. | `Backend/logs/models.py` (`ExecutionLog`) |
| **Tool** | One thing the AI can do: `web_search`, `read_file`, `send_email`... | `Backend/chat/tools/` |
| **Grant** | Permission for an agent to use a group of tools (e.g. `rag`, `fileOps`). | `GRANT_TOOLS` in `Backend/agents/grants.py` |
| **HITL** | "Human in the loop": the run pauses until a person approves. | `Backend/agents/agent/hitl.py`, `Backend/chat/tools/permissions.py` |

A few more you will meet:

- **Turn**: one model call inside a run. The model thinks, calls some tools,
  gets results, and that is one turn.
- **Step**: one tool call inside a turn.
- **Autonomy**: how much an agent may do without asking. Five levels:
  `plan` (read only) → `review` → `ask` → `auto` → `full` (never asks).
  Chat has three of them, picked in the message box: Ask, Auto and Plan.
- **Manager and workers**: the chat assistant is the manager. It plans and
  hands jobs to agents (the workers), which hold the permissions you gave them.
- **Connector / connection**: an outside account the AI can use, like Gmail
  or a custom MCP server.
- **MCP**: "Model Context Protocol", a standard way to plug outside tool
  servers into an AI. Lives in `Backend/mcp_integration/`.
- **Knowledge base (KB)**: a set of your documents indexed for search.
- **Template / pack**: a ready-made agent (or group of agents) you install
  from the Explore page.
- **Provider**: who serves the AI model: OpenRouter, OpenAI, NVIDIA, Ollama,
  OpenCode Zen.

## 5. How a chat message travels

This is the most important flow. When you understand it, the rest is detail.

```
Browser                         Backend
───────                         ───────
StandaloneChat.tsx
  └─ chatService.sendMessageStream   (src/api/chat.ts)
       POST /api/chat/sessions/<id>/message/stream/
                                 chat/views.py  send_message_stream
                                   └─ chat/turn/runs.py      keeps the turn alive after the request
                                       └─ chat/turn/pipeline.py  run_chat_turn: checks, history, prompt
                                           └─ chat/turn/agent.py  run_turn: the AI loop (LangGraph)
                                               ├─ llm/access.py        calls the AI model
                                               └─ chat/tools/...       runs the tools the model asked for
  ◄── streamed "data:" events ──  chat/transport/sse.py
useChatStream.ts turns the events into what you see on screen
```

The AI loop in `chat/turn/agent.py` repeats four steps until the model gives a
final answer:

1. **agent**: ask the model what to do next.
2. **tools**: run the tools it asked for (safe ones in parallel).
3. **curate**: if the conversation got too long, shrink the oldest part.
4. **steering**: pick up anything you typed while it was working.

## 6. How an agent run travels

```
Automations page → Run button
  POST /api/orchestrator/agents/<id>/execute/
    agents/views/runs.py  agent_execute
      └─ agents/agent/runtime.py  start_agent_run   (checks limits, creates the run record)
          └─ runs in the background:  run_agent
              └─ chat/turn/agent.py  run_turn      ← the SAME loop chat uses
    agents/agent/stream.py  saves each turn and step, and sends live updates
      ──► WebSocket  ws/execution/<id>/  ──►  Activity page (src/pages/Runs.tsx)
```

Key idea: **every run starts in one place** (`start_agent_run` / `run_agent`),
whether it came from a button, a schedule, a webhook, or another agent. That
is how safety checks can't be skipped.

**When a worker needs something.** If an agent started from chat pauses (it
wants approval, or it asks a question), the chat assistant sees that and can
answer it with the `answer_subagent` tool. Answering a question or saying no
is always the assistant's call. Saying *yes* to a risky action still follows
your chat's mode: in `ask` mode you get the approval card yourself.

## 7. Backend map

Each folder below is a Django "app". Most have their own `README.md` with a
file-by-file guide.

**The core (read these first)**

| App | What it does in plain words |
|---|---|
| [`chat/`](Backend/chat/README.md) | The chat assistant, the AI loop, and **every tool** the AI can use. The biggest app. |
| [`agents/`](Backend/agents/README.md) | Saved agents: create, edit, run, schedule, approve, templates. (Its internal Django name is `orchestrator`.) |
| [`llm/`](Backend/llm/README.md) | Talking to AI model providers. Every model call goes through `llm/access.py`. |
| [`logs/`](Backend/logs/README.md) | The record of what each run did: run → turns → steps. |

**Data the user owns**

| App | What it does |
|---|---|
| [`inference/`](Backend/inference/README.md) | Files, folders, the recycle bin, knowledge bases (search), data extraction, hosted pages, dashboards, and the server side of the Docs / Sheets / Slides apps (versions, autosave, export). |
| [`credentials/`](Backend/credentials/README.md) | Saved API keys and OAuth logins, encrypted. |
| [`core/`](Backend/core/README.md) | Users, login, profile, what the assistant remembers about you, rate limits, and the checks that refuse prompt-injection attacks. |

**Connecting to the outside**

| App | What it does |
|---|---|
| [`mcp_integration/`](Backend/mcp_integration/README.md) | Connections page: MCP servers and the native Google connectors. |
| [`datasources/`](Backend/datasources/README.md) | Your own APIs and databases, used as tools. |
| [`messaging/`](Backend/messaging/README.md) | Slack, WhatsApp, Teams, SMS, Telegram. |
| [`browsing/`](Backend/browsing/README.md) | A real web browser the AI can drive (off unless configured). |
| [`esign/`](Backend/esign/README.md), [`voice/`](Backend/voice/README.md) | E-signatures and speech (off unless configured). |

**Running code**

| App | What it does |
|---|---|
| [`sandbox/`](Backend/sandbox/README.md) + `sandbox_service/` | Runs the AI's Python code safely, in a locked-down container. |
| [`office/`](Backend/office/README.md) | Not a Django app: a plain library that builds and reads `.pptx`, `.xlsx`, `.docx`, PDF, diagrams and charts. Used by the AI's tools, the Docs/Sheets/Slides apps and the benchmark. |
| [`workspaces/`](Backend/workspaces/README.md) | Per-user Linux machines for the coding agents. **Engine not built yet.** |

**Everything else**

| App | What it does |
|---|---|
| [`solutions/`](Backend/solutions/README.md) | Problems your organisation already solved. The assistant searches here first, saves new fixes when you say they worked, and marks what may be out of date. |
| [`notifications/`](Backend/notifications/README.md) | The notification bell, approval reminders, the daily digest, reminders you schedule. |
| [`eval/`](Backend/eval/README.md) | Testing how good an agent is: test cases, graders, benchmarks, and fake "worlds" (simulated mail, calendar, files) so a test never touches real data. |
| [`imagine/`](Backend/imagine/README.md) | Image, video and audio generation (the Studio page). |
| [`streaming/`](Backend/streaming/README.md) | WebSocket plumbing for live updates. |
| [`tools_config/`](Backend/tools_config/README.md) | The Tools page: switch tools on/off per user. |
| [`skills/`](Backend/skills/README.md) | Reusable instruction snippets you can give an agent. |
| [`missions/`](Backend/missions/README.md) | Long goals that span many runs. |
| `templates/` | Empty. Kept only for old database migrations. |
| `workflow_backend/` | Project settings, URL root, and shared helpers. See [its README](Backend/workflow_backend/README.md). |

**The layers rule.** Lower apps (files, logs, model providers...) may read
another app's *models*, but never import the agent runtime, the chat engine,
the tool library, or another app's views. `Backend/.importlinter` checks this
and a test fails if you break it. If you need shared code, put it in a module
both sides can import, not in a view or a tool file.

## 8. Frontend map

Everything is in `better-n8n-frontend/src/`. See
[`BEGINNER_GUIDE.md`](better-n8n-frontend/BEGINNER_GUIDE.md) for the full tour.

| Folder | What goes there |
|---|---|
| `pages/` | One file per screen (`Runs.tsx` = the Activity page). |
| `components/` | Pieces of screens, grouped by feature (`chat/`, `agents/`, `ui/`...). `apps/` holds the full-screen Docs, Sheets and Slides editors. |
| `api/` | One file per backend area. **The only place that calls the backend.** |
| `hooks/` | Reusable React state logic (`useChatStream`, `useLiveRun`...). |
| `lib/` | Plain functions with no React (formatting, parsing, cron text...). |
| `contexts/` | App-wide state: who is logged in, theme, assistant. |
| `types/` | Shared TypeScript types. |

## 9. Common jobs, step by step

**Add a new tool the AI can use**

1. Pick the file in `Backend/chat/tools/` for its topic (or make a new one).
   `clock.py` is the smallest example to copy.
2. Write an `async def my_tool(args, context) -> str` and put `@tool({...schema...})`
   on it. The decorator *is* the registration. Set `effect="read"`,
   `"reversible"` or `"irreversible"` honestly.
3. If you made a new file, import it in `Backend/chat/tools/__init__.py`.
4. For agents to use it, add its name to the right group in `GRANT_TOOLS`
   (`Backend/agents/grants.py`).
5. Chat gets it only if it is `effect="read"`. A tool that writes, sends or
   spends belongs to agents. Do **not** add it to `CHAT_ORCHESTRATOR_EXTRA`
   in `Backend/chat/tools/__init__.py` to make chat use it.
6. Add a test in `Backend/chat/tests/`.

**Add a backend API route**

1. Write the view in the app's `views.py` (or `views/` folder).
2. Add it to that app's `urls.py`.
3. Add a row to `Backend/docs/API.md` (this is a project rule).
4. Call it from the matching file in `better-n8n-frontend/src/api/`.

**Add a page**

1. Create `src/pages/MyPage.tsx`.
2. Add a lazy route in `src/App.tsx` (copy an existing `lazyPage(...)` line).
3. Add it to the menu in `src/lib/navigation.ts`, the one list the sidebar,
   top bar and mobile tab bar all read.

**Add an installable agent template**

Add an entry to the right pack file in `Backend/agents/gallery/` (e.g. `office.py`), or to `standalone.py`. A test checks it is valid.

## 10. Tests and checks

```bash
# Backend (about 12 minutes for everything)
cd Backend
python -m pytest                            # all
python -m pytest chat/tests/test_todos.py   # one file

# Frontend
cd better-n8n-frontend
npx tsc -b --force        # type check (plain `tsc --noEmit` checks nothing here)
npm run lint
npx vitest run
```

Tests live in `<app>/tests/test_<topic>.py` (backend) and
`src/<folder>/__tests__/<name>.test.ts` (frontend).

## 11. A reading order for your first week

1. This page.
2. `Backend/chat/tools/clock.py` and `Backend/chat/tools/registry.py`: what a tool is.
3. `Backend/chat/turn/pipeline.py` → `run_chat_turn`: one chat message end to end.
4. `Backend/chat/turn/agent.py` → `_build_graph` and `run_turn`: the AI loop.
5. `Backend/llm/access.py`: how a model is called.
6. `Backend/agents/models.py` → `SubAgent`, then `agents/agent/runtime.py` →
   `run_agent`: how saved agents run.
7. `better-n8n-frontend/src/api/chat.ts` and `src/hooks/useChatStream.ts`: the
   same flow from the browser side.

## 12. Where the other docs are

- [`Backend/docs/README.md`](Backend/docs/README.md): index of every design
  doc, split into "how it works now" and "old plans".
- [`Backend/docs/API.md`](Backend/docs/API.md): every HTTP route.
- [`CLAUDE.md`](CLAUDE.md): the detailed rules and design history, written
  for AI coding assistants. It is dense. Use it as a reference, not a tutorial.
