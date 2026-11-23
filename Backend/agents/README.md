# `agents/`: saved agents, and everything that runs them

The user sees this as the Agents page and the agent builder, plus Explore
(templates) and the run history. An **agent** is a saved setup, not code: a
prompt, a model, the tools it may use (its *grants*), and its safety settings.
This app stores agents, runs them, schedules them, pauses them for approval,
and lets people share them.

> **Name trap.** The Python package is `agents`, but Django knows the app as
> **`orchestrator`** (`apps.py`). Tables are `orchestrator_*` and URLs are
> `/api/orchestrator/...`. Renaming the label would need a database migration.

Design: see the `docs/` files named in `CLAUDE.md` (`CODING_AGENTS_PLAN.md`,
`SPECIALIST_AGENTS_PLAN.md`, `AGENT_OBSERVABILITY.md`).

## Read in this order

1. `models.py` → `SubAgent`: what an agent is.
2. `grants.py` → `GRANT_TOOLS`: which tools each grant unlocks.
3. `agent/runtime.py` → `start_agent_run`, `run_agent`: how a run starts and runs.
4. `config.py` → `AgentSerializer`: how an agent is validated and saved.

## Data (`models.py`)

| Model | What it is |
|---|---|
| `SubAgent` | An agent. Its grants, guardrails, context (knowledge bases, connectors, file access) and `output_schema` |
| `Trigger` | A schedule, webhook or event that starts an agent. `next_due_at` says when |
| `HITLRequest` | A paused run waiting for a person |
| `SharedAgent` | A published copy others can install |
| `SchedulerLease` | Makes sure only one process fires schedules at a time |
| `ConversationMessage` | The builder chat's history. Normal chat uses `chat.ChatMessage` |

What a run *did* is stored in the `logs` app.

## Files

| File | What it does |
|---|---|
| `grants.py` | The permissions tables: `GRANT_TOOLS`, `ALWAYS_AVAILABLE`, `AUTONOMY_LADDER`, who may start a run. Plain data |
| `config.py` | `AgentSerializer`: the only way an agent is saved. The builder, templates, chat authoring and restore all use it |
| `agent/runtime.py` | The runtime: builds the toolbox, enforces guardrails, starts and runs every run. A worker inherits its parent's taint, and the taint is kept on the run's log so a resumed run keeps it |
| `agent/stream.py` | Saves each turn and tool call as it happens, and sends live updates |
| `agent/orchestrator.py` | Delegation: one agent handing work to others, bounded by depth, budget and result size |
| `agent/hitl.py` | Opens and closes `HITLRequest` rows when a run pauses |
| `agent/tasks.py` | Detached coding tasks, so a lead can steer workers while they run |
| `views/` | HTTP routes, one file per area: `agents`, `runs`, `triggers`, `hitl`, `gallery`, `builder`, `capabilities`, `wizard`, `responses` |
| `gallery/` | Installable templates, one file per pack. `playbooks/` (beside `gallery/`) holds the coding templates' instructions |
| `publishing.py` | Makes a shareable copy with every private id removed |
| `connector_scope.py` | Which connections, and which of their tools, an agent may use |
| `contracts.py` | The output shapes an agent can be required to return |
| `triggers.py` | Cron parsing and describing a schedule in words |
| `scheduler.py` | The in-process loop. Ticks every 30 s in the process holding the lease: fires due schedules, then runs `PERIODIC_JOBS` (reminders, run recovery, recycle-bin purge, checkpoint pruning) |
| `sweep.py`, `tasks.py` | Schedule firing, and the Celery entry points for deployments that use beat |
| `recovery.py` | Finds runs whose process died, and resumes or closes them |
| `admission.py`, `budget.py`, `spend.py` | Limits: runs at once, wall-clock time, money |
| `stock.py` | Built-in agent configurations, including `RESEARCH` |

## Rules

- **One door.** Every run starts at `start_agent_run` / `run_agent`, whatever the `caller` (`chat`, `orchestrator`, `trigger`, `api`, `eval`, `mission`). Do not add a second path.
- **Grants say whether, scopes say which.** An empty scope means no restriction, so older agents keep working.
- **Unattended runs** (schedules, webhooks) need `SubAgent.allow_unattended`.
- **`agents/tests/test_regressions.py`** is grouped by kind of mistake. Read it before changing the stats or spend code.

## Management commands

- `run_due_triggers`: fire due schedules once, by hand. The server loop normally does this.
- `recover_runs`: clean up runs orphaned by a restart. `--dry-run` only looks.
- `install_packs`: install template packs into an account.
- `prune_chat_checkpoints`: drop old checkpoint rows.

## Tests

`agents/tests/`: `test_agent_runtime.py`, `test_autonomy.py`, `test_schedules.py`,
`test_gallery.py`, `test_regressions.py`.
