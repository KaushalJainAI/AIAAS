# `workspaces/`: a private machine per user (not built yet)

The user does not see this yet. It is the plan for coding agents (the `code`
pack): each user gets a persistent Linux machine to read, edit and run a real
repository. This app holds the records for it.

> **Status:** `engine.py` has no engine. Every call raises, and
> `WORKSPACE_ENGINE` defaults to `none`. Until one exists, the coding tools are
> not offered. Plan: [`docs/COMPUTE_ISOLATION_PLAN.md`](../docs/COMPUTE_ISOLATION_PLAN.md);
> team design: [`docs/CODING_AGENTS_PLAN.md`](../docs/CODING_AGENTS_PLAN.md).

## Data (`models.py`)

| Model | What it is |
|---|---|
| `Workspace` | One user's machine |
| `WorkspaceJob` | A long command running on it |
| `CodeProject` | A repository in the workspace |
| `CodeChange` | One file a worker changed |
| `CodeLease` | A lock on files, so two workers do not edit the same file |

## Files

| File | What it does |
|---|---|
| `engine.py` | The one door to a workspace (`ensure`, `exec`, `read`, `write`, `hibernate`, `destroy`). A stub today |
| `leases.py` | File locks for coding workers |
| `reads.py` | Remembers the version of each file a run read, so an edit to a file that changed since is refused |
| `awareness.py` | Tells running workers when a file they depend on changed |
| `sweep.py` | Hibernates idle workspaces |
| `views.py`, `urls.py` | A webhook for a finished job |

## Rules

- When there is no engine, the tools are withheld. They are never offered and then refused.
- There is no automatic fallback between engines.

## Tests

`workspaces/tests/`: `test_leases.py`, `test_stale_write.py`, `test_awareness.py`, `test_job_hook.py`.
