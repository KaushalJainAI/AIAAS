# Start Here

A beginner's tour of AIAAS. Read this first: what the product is, how a chat
message and an agent run travel through the code, which folder holds what, and
how to run it. For code-level detail, see [FEATURE_MAP.md](FEATURE_MAP.md).

---

## 1. What AIAAS is

AIAAS is a web app for building **AI agents that do real work**.

- **Chat** is the *manager*. The assistant searches the web, reads your files,
  runs Python and draws charts. It plans and reads. Anything that writes, sends,
  publishes or spends goes to an agent.
- **Agents** are the *workers*. An agent is a saved setup: instructions, a model,
  the tools it may use and its safety rules. It is configuration, not code. It
  runs on demand, on a schedule, or from a webhook.
- **Approvals** pause risky actions until you answer. An agent can also pause to
  ask you a question.

Files that agents make (decks, spreadsheets, documents) open in the built-in
Docs, Sheets and Slides apps.

## 2. The folders

| Folder | What it is | Language |
|---|---|---|
| `Backend/` | The server: data, model calls, tools, runs. | Python, Django |
| `better-n8n-frontend/` | The web app. | TypeScript, React |
| `mobile-native/` | The Android and iOS app, on the same backend. | TypeScript, Expo |

Also: `instance/` (seed data, simulations, Playwright tests), `LLD_Guide/` (design
study guide) and `learning/` (write-ups of problems hit while building).

The name `better-n8n-frontend` is historical. The drag-and-drop workflow editor it
was named for is gone. This is one git repository.

## 3. Run it on your machine

You need Python and Node.js. You do **not** need Redis, Postgres or Docker: local
settings use SQLite and an in-process channel layer (`settings/local.py`).

**Backend** (first terminal):

```bash
cd Backend
python -m venv venv
source venv/Scripts/activate        # Windows (Git Bash). Mac/Linux: source venv/bin/activate
pip install -r requirements.txt     # Mac/Linux: requirements-linux.txt
cp .env.example .env.local          # local settings read Backend/.env.local
```

Open `Backend/.env.local` and fill in:

- `CREDENTIAL_ENCRYPTION_KEY`. The file has the one-line command that makes it.
  The server will not start without it.
- `OPENROUTER_API_KEY`. The platform key for the default model. Chat needs it.

```bash
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

**Frontend** (second terminal):

```bash
cd better-n8n-frontend
npm install
npm run dev                         # open http://localhost:5173
```

The dev server sends `/api` and WebSocket traffic to `localhost:8000`
(`vite.config.ts`). Production is different: see [DEPLOYMENT.md](DEPLOYMENT.md).

## 4. The words you need

| Word | Meaning | Where it lives |
|---|---|---|
| **Chat session** | One conversation in the chat page. | `Backend/chat/models.py` |
| **Agent** | A saved setup: prompt, model, allowed tools, safety rules. | `Backend/agents/models.py` (`SubAgent`) |
| **Run** | One execution of an agent, with turns and steps. | `Backend/logs/models.py` (`ExecutionLog`) |
| **Tool** | One thing the AI can do, such as `web_search` or `read_file`. | `Backend/chat/tools/` |
| **Grant** | Permission for an agent to use a group of tools (`rag`, `fileOps`...). | `GRANT_TOOLS` in `Backend/agents/grants.py` |
| **HITL** | "Human in the loop": the run waits until a person answers. | `Backend/agents/agent/hitl.py` |

More words:

- **Turn**: one model call inside a run. **Step**: one tool call inside a turn.
- **Autonomy**: how much an agent may do unasked. Five levels: `plan` (read only),
  `review`, `ask`, `auto`, `full` (never asks).
- **Chat modes**: four, set in the message box: **Ask**, **Auto**, **Plan** and
  **Full auto**. Full auto is chosen by clicking it, never with Shift+Tab, which
  cycles Ask, Auto and Plan.
- **Steer**: a message typed while the assistant works. It joins a queue and is
  read at the next safe point.
- **Manager and workers**: chat hands jobs to agents, which hold only the
  permissions you gave them.
- **MCP** ("Model Context Protocol") plugs outside tool servers into an AI. Code
  lives in `Backend/mcp_integration/`.
- **Provider**: who serves the model: OpenRouter, OpenAI, NVIDIA, Ollama, or your
  own ChatGPT plan (on an install you run yourself).

## 5. How a chat message travels

```
Browser                                       Backend
───────                                       ───────
features/chat/components/StandaloneChat.tsx
  └─ chatService.sendMessageStream   (src/api/chat.ts)
       POST /api/chat/sessions/<id>/message/stream/
                                              chat/views.py  send_message_stream
                                                └─ chat/turn/runs.py   keeps the turn going after the request ends
                                                    └─ chat/turn/pipeline.py  run_chat_turn: checks, history, prompt
                                                        └─ chat/turn/agent.py  run_turn: the AI loop (LangGraph)
                                                            ├─ llm/access.py       calls the AI model
                                                            └─ chat/tools/...      runs the tools the model asked for
  ◄── "data:" events, streamed ─────────────  chat/transport/sse.py
features/chat/hooks/useChatStream.ts turns each event into what you see
```

The AI loop repeats four steps until the model answers:

1. **agent**: ask the model what to do next.
2. **tools**: run what it asked for. Safe tools run in parallel.
3. **curate**: if the conversation got long, shrink its oldest part.
4. **steering**: take in anything you typed meanwhile.

Steering is a queue, not the WebSocket: `POST /api/chat/sessions/<id>/message/steer/`.
When chat hands work to an agent, that run follows section 6.

## 6. How an agent run travels

```
Automations page → Run button   (or a schedule, a webhook, or another agent)
  POST /api/orchestrator/agents/<id>/execute/
    agents/views/runs.py         agent_execute
      └─ agents/agent/runtime.py   start_agent_run: checks limits, opens the run record
          └─ run_agent              runs in the background
              └─ chat/turn/agent.py  run_turn   ← the same loop chat uses
    agents/agent/stream.py       saves each turn and step, sends live updates
      ──► WebSocket ws/execution/<id>/  ──►  Activity page (src/pages/Runs.tsx)
```

**Key idea:** every run starts in one place, `start_agent_run` / `run_agent`,
whatever the caller (chat, API, schedule, webhook at `agents/views/triggers.py`,
or another agent). A safety check cannot be skipped by starting a run another way.

**When a worker needs something.** If an agent started from chat pauses, the
assistant sees it and answers with `answer_subagent`. Answering a question or
saying no is the assistant's call. Saying *yes* to a risky action follows your
chat's mode: in Ask mode you get the approval card yourself.

## 7. Backend map

Each folder is a Django app. Most have their own `README.md`, file by file.

| App | What it does |
|---|---|
| [`chat/`](Backend/chat/README.md) | The chat assistant, the AI loop, and **every tool**. The biggest app. |
| [`agents/`](Backend/agents/README.md) | Saved agents: create, edit, run, schedule, approve, templates. Django label `orchestrator`. |
| [`llm/`](Backend/llm/README.md) | Talking to model providers. Every model call goes through `llm/access.py`. |
| [`logs/`](Backend/logs/README.md) | The record of each run: run, turns, steps. |
| [`inference/`](Backend/inference/README.md) | Files, folders, recycle bin, knowledge bases, extraction, pages, dashboards, and the server side of Docs / Sheets / Slides. |
| [`credentials/`](Backend/credentials/README.md) | Saved API keys and OAuth logins, encrypted. |
| [`core/`](Backend/core/README.md) | Users, login, profile, assistant memory, rate limits, prompt-injection checks. |
| [`mcp_integration/`](Backend/mcp_integration/README.md) | The Connections page: MCP servers and native Google connectors. |
| [`datasources/`](Backend/datasources/README.md), [`messaging/`](Backend/messaging/README.md), [`browsing/`](Backend/browsing/README.md), [`esign/`](Backend/esign/README.md), [`voice/`](Backend/voice/README.md) | Your APIs and databases, Slack and other messaging, a browser the AI can drive, e-signature, speech. Browsing and esign are off unless configured. Voice is on by default. |
| [`sandbox/`](Backend/sandbox/README.md) + `sandbox_service/` | Runs the AI's Python in a locked-down container. |
| [`office/`](Backend/office/README.md) | Not a Django app. Builds and reads `.pptx`, `.xlsx`, `.docx`, PDF, diagrams and charts. |
| [`workspaces/`](Backend/workspaces/README.md) | Per-user Linux machines for coding agents. **No engine yet.** |
| [`solutions/`](Backend/solutions/README.md), [`notifications/`](Backend/notifications/README.md), [`eval/`](Backend/eval/README.md), [`imagine/`](Backend/imagine/README.md) | Team knowledge; the bell, reminders and digest; agent tests and fake worlds; image, video and audio. |
| [`streaming/`](Backend/streaming/README.md), [`tools_config/`](Backend/tools_config/README.md), [`skills/`](Backend/skills/README.md), [`missions/`](Backend/missions/README.md) | WebSocket plumbing; the Tools page; reusable instructions; long goals across many runs. |
| `templates/`, `workflow_backend/` | `templates/` holds old migrations only. `workflow_backend/` holds project settings, URLs and shared helpers ([README](Backend/workflow_backend/README.md)). |

**The layers rule.** Lower apps (files, logs, model providers) may read another
app's *models*. They may not import the agent runtime, the chat engine, the tool
library, `eval`, `missions`, or another app's *views*. `Backend/.importlinter`
lists the rules, and `workflow_backend/tests/test_import_contracts.py` fails when
one breaks. Shared code goes in a module both sides can import, not in a view or
a tool file.

## 8. Frontend map

Everything is in `better-n8n-frontend/src/`. The full tour is
[BEGINNER_GUIDE.md](better-n8n-frontend/BEGINNER_GUIDE.md).

| Folder | What goes there |
|---|---|
| `pages/` | One file per screen. `Runs.tsx` is the Activity page. |
| `features/` | Feature folders with a front door (`index.ts`). Chat is `features/chat/`. |
| `components/` | Pieces of screens, by feature. `components/apps/` holds the Docs, Sheets and Slides editors. |
| `api/` | One file per backend area. **The only place that calls the backend.** |
| `hooks/`, `lib/` | React state logic; plain functions with no React (cron text, paths...). |
| `contexts/`, `types/` | App-wide state (login, theme, assistant); shared TypeScript types. |

## 9. Common jobs

**Add a tool the AI can use**

1. Pick a file in `Backend/chat/tools/` for its topic, or make one. `clock.py` is the smallest example.
2. Write `async def my_tool(args, context) -> str` with `@tool({...schema...})` on it. The decorator *is* the registration. Set `effect="read"`, `"reversible"` or `"irreversible"` honestly.
3. A new file goes in the `from . import (...)` list in `Backend/chat/tools/__init__.py`.
4. For agents, add the name to the right group in `GRANT_TOOLS` (`Backend/agents/grants.py`).
5. Chat gets read tools and a few orchestration tools (`CHAT_ORCHESTRATOR_EXTRA`). A tool that writes, sends or spends belongs to agents. Do **not** add it to `CHAT_ORCHESTRATOR_EXTRA` to give chat the tool.
6. Add a test in `Backend/chat/tests/`.

**Add a backend API route**

1. Write the view in the app's `views.py` (or `views/`), and add it to that app's `urls.py`.
2. Add a row to `Backend/docs/API.md`. This is a project rule.
3. Call it from the matching file in `better-n8n-frontend/src/api/`.

**Add a page**

1. Create `src/pages/MyPage.tsx`.
2. Add a lazy route in `src/App.tsx`. Copy an existing `lazyPage(...)` line.
3. Add it to `src/lib/navigation.ts`. That list feeds the sidebar, top bar and mobile tab bar.

**Add an installable agent template**

Add an entry to a pack file in `Backend/agents/gallery/` (e.g. `office.py`), or to
`standalone.py`. A test checks it is valid.

## 10. Tests and checks

```bash
# Backend
cd Backend
python -m pytest                            # all (python manage.py test also works)
python -m pytest chat/tests/test_todos.py   # one file

# Frontend
cd better-n8n-frontend
npx tsc -b --force     # type check. Plain `tsc --noEmit` checks nothing here
npm run lint
npm test               # vitest
```

Backend tests live in `<app>/tests/test_<topic>.py`. Frontend tests live in
`src/<folder>/__tests__/`.

## 11. A reading order for your first week

1. This page.
2. `Backend/chat/tools/clock.py` and `registry.py`: what a tool is.
3. `Backend/chat/turn/pipeline.py`, `run_chat_turn`: one chat message, end to end.
4. `Backend/chat/turn/agent.py`, `run_turn`: the AI loop.
5. `Backend/llm/access.py`: how a model is called.
6. `Backend/agents/models.py` (`SubAgent`), then `agents/agent/runtime.py` (`run_agent`).
7. `better-n8n-frontend/src/api/chat.ts` and `src/features/chat/hooks/useChatStream.ts`: the same flow in the browser.

## 12. Other docs

- [FEATURE_MAP.md](FEATURE_MAP.md): code-level map of each feature.
- [DEPLOYMENT.md](DEPLOYMENT.md): production.
- [Backend/docs/README.md](Backend/docs/README.md): index of the design docs.
- [Backend/docs/API.md](Backend/docs/API.md): every HTTP route.
- [Backend/docs/OPEN_WORK.md](Backend/docs/OPEN_WORK.md): every open item across the plans.
- [CLAUDE.md](CLAUDE.md): detailed rules and design history for AI coding assistants. Dense. A reference, not a tutorial.
