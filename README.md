# AIAAS: Agentic AI Automation System

A web app for building **AI agents that do real work**, and that stop to ask
before doing anything risky.

- **Chat**: an assistant that searches the web, reads your files, runs Python and
  makes charts. It plans the work and hands anything that writes, sends or spends
  to an agent.
- **Agents**: a saved prompt, model and set of allowed tools. Run them on demand,
  on a schedule, or from a webhook. They make decks, spreadsheets and documents
  that open in the built-in Docs, Sheets and Slides apps.
- **Control**: five autonomy levels, from read-only to never-ask. Risky actions
  pause for your approval, and an agent can pause to ask you a question.
- **Record**: every run is kept turn by turn, with the model's reasoning and each
  tool call.
- **Undo**: a reply's or run's file, memory and agent changes can be put back. A
  message a person is watching waits 20 seconds, so they can cancel it.
- **Connections**: Gmail, Drive, Sheets, Calendar, Notion, Slack and curated MCP
  connectors. Adding your own MCP server is off. Keys are encrypted at rest.

**New here?** Read **[START_HERE.md](START_HERE.md)** first. It explains the
codebase, shows how a chat message travels, and gives the run recipe.

## Folders

| Folder | What it is |
|---|---|
| [`Backend/`](Backend/README.md) | Django (ASGI) server: agent runtime, tools, storage |
| [`better-n8n-frontend/`](better-n8n-frontend/README.md) | Web app: React + TypeScript |
| [`mobile-native/`](mobile-native/README.md) | Android and iOS app: Expo (React Native) |
| [`instance/`](instance/README.md) | Seed data, user-journey simulations, Playwright tests |
| [`LLD_Guide/`](LLD_Guide/README.md) | Low-level design study guide, with diagrams and interview questions |
| `learning/` | Write-ups of problems hit while building this |

## Quick start

```bash
cd Backend && python -m venv venv && source venv/Scripts/activate   # Mac/Linux: venv/bin/activate
pip install -r requirements.txt && cp .env.example .env.local      # then set CREDENTIAL_ENCRYPTION_KEY and OPENROUTER_API_KEY
python manage.py migrate && python manage.py runserver 0.0.0.0:8000
cd ../better-n8n-frontend && npm install                            # second terminal
npm run dev                                                         # http://localhost:5173
```

Windows and Linux details are in [START_HERE.md](START_HERE.md), section 3. The Docker setup is in [DEPLOYMENT.md](DEPLOYMENT.md), section 10.
Production: [DEPLOYMENT.md](DEPLOYMENT.md).

## Docs

- [START_HERE.md](START_HERE.md): the beginner tour and the run recipe
- [FEATURE_MAP.md](FEATURE_MAP.md): code-level map of each feature
- [DEPLOYMENT.md](DEPLOYMENT.md): deploying to production
- [CONTRIBUTING.md](CONTRIBUTING.md): how to send a change, and which checks to run (CI is `.github/workflows/`)
- [INFRASTRUCTURE_SIMPLE_GUIDE.md](INFRASTRUCTURE_SIMPLE_GUIDE.md): how it is hosted (containers, proxies, databases, networking), in plain words
- [REALTIME_AND_PROTOCOLS_SIMPLE_GUIDE.md](REALTIME_AND_PROTOCOLS_SIMPLE_GUIDE.md): HTTP, streaming, WebSockets and webhooks, in plain words
- [Backend/docs/README.md](Backend/docs/README.md): index of the design docs
- [Backend/docs/API.md](Backend/docs/API.md): every HTTP route
- [Backend/docs/OPEN_WORK.md](Backend/docs/OPEN_WORK.md): every open item across the plans
- [better-n8n-frontend/BEGINNER_GUIDE.md](better-n8n-frontend/BEGINNER_GUIDE.md): frontend tour
- [mobile-native/README.md](mobile-native/README.md): mobile app, with its design and parity notes
- [LLD_Guide/README.md](LLD_Guide/README.md): low-level design guide
