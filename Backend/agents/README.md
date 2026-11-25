# `agents/`: saved agents, and everything that runs them

The user sees this as the Agents page, the agent builder, Explore (templates)
and the run history. An **agent** is a saved setup, not code: a prompt, a
model, the tools it may use (its *grants*), and its safety settings. This app
stores agents, runs them, schedules them, pauses them for approval, and lets
people share them.

> **Name trap.** The Python package is `agents`, but Django knows the app as
> **`orchestrator`** (`apps.py`). Tables are `orchestrator_*` and URLs are
> `/api/orchestrator/...`. Renaming the label needs a database migration.

Design docs: [`docs/CODING_AGENTS_PLAN.md`](../docs/CODING_AGENTS_PLAN.md),
[`docs/SPECIALIST_AGENTS_PLAN.md`](../docs/SPECIALIST_AGENTS_PLAN.md),
[`docs/AGENT_OBSERVABILITY.md`](../docs/AGENT_OBSERVABILITY.md).

## Read in this order

1. `models.py`: `SubAgent` is what an agent is.
2. `grants.py`: `GRANT_TOOLS` says which tools each grant unlocks.
3. `agent/runtime.py`: `start_agent_run` and `run_agent` start and run a run.
4. `config.py`: `AgentSerializer` says how an agent is validated and saved.

## Data (`models.py`)

| Model | What it is |
|---|---|
| `SubAgent` | An agent: grants, guardrails, context (knowledge bases, connectors, file access), `output_schema` |
| `Trigger` | A schedule, webhook or event that starts an agent. `next_due_at` says when |
| `HITLRequest` | A paused run waiting for a person |
| `SharedAgent` | A published copy others can install |
| `SchedulerLease` | Makes sure only one process fires schedules at a time |
| `ConversationMessage` | The builder chat's history. Normal chat uses `chat.ChatMessage` |

What a run *did* is stored in the `logs` app.

## Files

**Permissions and saving**

| File | What it does |
|---|---|
| `grants.py` | The permissions tables: `GRANT_TOOLS`, `ALWAYS_AVAILABLE`, `AUTONOMY_LADDER`, `CALLERS`. Plain data |
| `config.py` | `AgentSerializer`: the only way an agent is saved. The builder, templates, chat authoring and restore all use it |
| `serializers.py` | DRF serializer for HITL requests |
| `contracts.py` | The output shapes an agent can be required to return |
| `connector_scope.py` | Which connections, and which of their tools, an agent may use |
| `publishing.py` | Makes a shareable copy with every private id removed |
| `stock.py` | Built-in agent configurations, including `RESEARCH` |

**Running**

| File | What it does |
|---|---|
| `agent/runtime.py` | Builds the toolbox, enforces guardrails, starts and runs every run. A worker inherits its parent's taint |
| `agent/stream.py` | Saves each turn and tool call as it happens, and sends live updates |
| `agent/orchestrator.py` | Delegation: one agent handing work to others, bounded by depth, budget and result size |
| `agent/hitl.py` | Opens and closes `HITLRequest` rows when a run pauses |
| `agent/tasks.py` | Detached coding tasks, so a lead can steer workers while they run |
| `recovery.py` | Finds runs whose process died, and resumes or closes them |
| `admission.py`, `budget.py`, `spend.py` | Limits: runs at once, wall-clock time, money |
| `gallery/` | Installable templates, one file per pack. `playbooks/` holds the coding templates' instructions |

**Scheduling**

| File | What it does |
|---|---|
| `triggers.py` | Cron parsing and describing a schedule in words |
| `scheduler.py` | The in-process loop. Ticks every 30 s in the process holding the lease. Fires due schedules, then runs `PERIODIC_JOBS` |
| `sweep.py` | Fires the triggers that are due |
| `tasks.py` | Celery entry points for deployments that use beat |

**HTTP**

| File | What it does |
|---|---|
| `urls.py` | The route table. Each route names its view module |
| `views/agents.py` | Agent CRUD, revisions and restore |
| `views/builder.py` | The builder's chat: plain language turned into knob changes |
| `views/runs.py` | Starting a run, and the ways a person intervenes (approve, reject, steer, stop, autonomy) |
| `views/triggers.py` | Schedules, previews, health, and the public webhook receiver |
| `views/hitl.py` | The pending-approval queue and the response that resumes a run |
| `views/gallery.py` | Explore and publishing into it |
| `views/capabilities.py` | What an agent may be granted, as data the builder can render |
| `views/wizard.py` | The guided agent-creation wizard |
| `views/responses.py` | Response serializers shared by the view modules |
| `admin.py`, `apps.py` | Django admin; the app label `orchestrator` |

## Rules

- **One door.** Every run starts at `start_agent_run` / `run_agent`, whatever the `caller` (`chat`, `orchestrator`, `trigger`, `api`, `eval`, `mission`). Do not add a second path.
- **Grants say whether, scopes say which.** An empty scope means no restriction, so older agents keep working.
- **Unattended runs** (`trigger`, `orchestrator`, `mission`) need `SubAgent.allow_unattended`.
- **Periodic jobs** must also be listed in `PERIODIC_JOBS` or `NOT_IN_PROCESS`. A test fails otherwise.

## Management commands

- `run_due_triggers`: fire due schedules once, by hand. The server loop normally does this.
- `recover_runs`: clean up runs orphaned by a restart. `--dry-run` only looks.
- `install_packs`: install template packs into an account.
- `prune_chat_checkpoints`: drop old checkpoint rows.

## Tests

`agents/tests/`. Start with `test_agent_runtime.py`, `test_schedules.py`,
`test_gallery.py` and `test_regressions.py`. Read `test_regressions.py` before
changing the stats or spend code.
