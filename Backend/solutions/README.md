# `solutions/`: what the team already solved

The user sees this as the Team knowledge page (`/team`). When someone fixes a
problem and says so, it is saved as a solution. The next person who hits the
same problem gets it from the assistant, marked with how fresh it is.

Design: [`docs/SOLUTION_MEMORY_PLAN.md`](../docs/SOLUTION_MEMORY_PLAN.md) (the
records and search) and [`docs/ORG_KNOWLEDGE_PLAN.md`](../docs/ORG_KNOWLEDGE_PLAN.md)
(drafts, curators, sharing, imports).

## Data (`models.py`)

| Model | What it is |
|---|---|
| `Solution` | The record: problem, symptoms, cause, fix, claims, org, status |
| `SolutionReview` | Worked, didn't work, doubtful, or edited, with which model said so |
| `SolutionSignature`, `SolutionTerm`, `SolutionVector` | The three search indexes |
| `SolutionSearchLog` | Team searches, scrubbed, kept 90 days (for the curators' Insights tab) |

## Files

| File | What it does |
|---|---|
| `access.py` | **The one door.** `visible(user_id, org_id)` decides what a person may see. Membership is checked live |
| `api.py` | Every write: save, review, share, edit, retract. The one place a new solution's starting status is decided |
| `search.py` | Signature, keyword and meaning search, merged and re-scored. It abstains when nothing is close |
| `capture.py`, `signals.py` | Saving automatically when a fix is confirmed |
| `importer.py` | Turns one of your own documents into draft solutions |
| `attention.py`, `freshness.py` | Which solutions need a check, and how fast each kind of claim goes stale |
| `stale.py`, `tasks.py`, `management/commands/solutions_stale_sweep.py` | The weekly "may be out of date" digest |
| `insights.py` | The curators' 30-day view. Counts only, never who searched |
| `signatures.py`, `index.py` | Error fingerprints, and writing a solution into the indexes |
| `views.py`, `urls.py` | `/api/solutions/`: list, detail, import, insights, review, publish, discard, approve, send back |
| `models.py`, `admin.py`, `apps.py` | The models above; Django admin; app config |

The chat tools (`search_solutions`, `get_solution`, `save_solution`, `review_solution`) are in `chat/tools/solutions.py`.

## Rules

- A solution belongs to the organisation it was solved in. Every read goes through `access.visible`. A test fails if other code queries `Solution.objects`.
- Unattended runs (schedules, missions, delegated workers) can read team solutions but never save or review one.
- Freshness is reset only by a check, never by an edit alone.
- Drafts are never searched and never shared.

## Tests

`solutions/tests/`: `test_isolation.py` (the org boundary; read first),
`test_search.py`, `test_capture.py`, `test_workflow.py`, `test_import.py`,
`test_stale.py`, `test_insights.py`, `test_api.py`, `test_tools.py`.
