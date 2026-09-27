# AIAAS: Agentic AI Automation System

A web app for building **AI agents that do real work for you**, and that stop
to ask before doing anything risky.

- **Chat** with an assistant that searches the web, reads your files, runs
  Python and makes charts. It acts as a manager: it plans the work and hands
  anything that writes, sends or spends to an agent.
- **Save agents**: a prompt, a model and a set of allowed tools, run on demand,
  on a schedule, or from a webhook. Agents can make real slide decks,
  spreadsheets and documents, which open in the built-in Docs, Sheets and
  Slides apps.
- **Stay in control**: five autonomy levels, from "read only" to "never ask".
  Risky actions (sending an email, spending money) pause for your approval,
  and an agent can pause to ask you a question.
- **See everything**: every run is recorded turn by turn, with the model's
  reasoning and every tool call.
- **Connect your accounts**: Gmail, Drive, Sheets, Calendar, Notion, Slack, and
  any MCP server, with keys encrypted at rest.

## New here?

Read **[START_HERE.md](START_HERE.md)**. It explains the whole codebase in plain
words, shows how a chat message travels through the system, and tells you
which file to open for common jobs.

## Folders

| Folder | What it is |
|---|---|
| [`Backend/`](Backend/README.md) | Django (ASGI) server, LangGraph agent loop, tools, storage |
| [`better-n8n-frontend/`](better-n8n-frontend/README.md) | React + TypeScript web app |
| [`instance/`](instance/README.md) | Seed data, user-journey simulations and Playwright tests |
| [`LLD_Guide/`](LLD_Guide/README.md) | Design walkthrough and interview kit |
| [`learning/`](learning/00_INDEX.md) | Write-ups of real problems hit while building this |

## Quick start

```bash
# Backend
cd Backend && python -m venv venv && source venv/Scripts/activate
pip install -r requirements.txt && cp .env.example .env.local   # add OPENROUTER_API_KEY
python manage.py migrate && python manage.py runserver 0.0.0.0:8000

# Frontend (second terminal)
cd better-n8n-frontend && npm install && npm run dev    # http://localhost:5173
```

Docker: `docker compose up --build` (local) or see [DEPLOYMENT.md](DEPLOYMENT.md)
for production.

## Docs

- [START_HERE.md](START_HERE.md): beginner tour
- [Backend/docs/README.md](Backend/docs/README.md): index of design docs
- [Backend/docs/API.md](Backend/docs/API.md): every HTTP route
- [better-n8n-frontend/BEGINNER_GUIDE.md](better-n8n-frontend/BEGINNER_GUIDE.md): frontend tour
- [CLAUDE.md](CLAUDE.md): detailed rules and design history (for AI assistants)
