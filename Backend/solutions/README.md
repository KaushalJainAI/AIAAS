# solutions/

Problems people have already solved, saved so the next person does not start
from zero. The assistant searches here first for troubleshooting questions.

Plan and design: `docs/SOLUTION_MEMORY_PLAN.md`.

## The one rule

A solution belongs to the **organisation it was solved in**, and is never
shown anywhere else. Every read goes through `access.py::visible`. A test
fails if code outside this app queries `Solution.objects`.

## Files, in reading order

- `models.py`: `Solution` (the record: problem, symptoms, cause, fix, claims),
  `SolutionReview` (worked / didn't work / doubtful / cleared, with which model
  said so), and three index tables (`SolutionSignature`, `SolutionTerm`,
  `SolutionVector`).
- `access.py`: **the one door.** Who may see what, from which org. Membership
  is checked live on every call.
- `freshness.py`: how fast each kind of claim goes stale (`principle` never,
  `time_sensitive` after 30 days, …) and the `fresh` / `check` label.
- `signatures.py`: turns error lines into fingerprints (paths, numbers and ids
  stripped) for exact matching.
- `index.py`: writes one solution into the three indexes. Vectors are stored
  as float16 in the database, not held in memory.
- `search.py`: the search: signature + keywords + meaning, merged, re-scored
  by track record, environment and freshness, and **abstains** when nothing
  is close.
- `api.py`: every write (save, review, share, edit, retract). Removes secrets
  and contact details, refuses text addressed to an AI, and drops "only true
  right now" claims.
- `capture.py`: automatic saving. Starts when the person says a fix worked or
  gives a thumbs-up; one cheap model call extracts the record.
- `signals.py`: thumbs-up → capture; account deleted → private solutions go.
- `attention.py`: "needs attention": a solution is `needs_check`, doubted, or
  holds a claim past its freshness window. The library's attention filter and
  the weekly nudge both call this one function, so they cannot disagree.
- `importer.py`: reads one of your own documents (a runbook, a postmortem) and
  turns each solved problem into a **draft**. Duplicates are skipped, and a
  document that reads as instructions to an AI is refused.
- `stale.py`: the weekly "may be out of date" digest per person and per team,
  and the deletion of team search logs after 90 days.
- `insights.py`: the curators' 30-day view of team searches, answers, gaps and
  contributors. Counts only; it never says who searched.
- `tasks.py`, `management/commands/solutions_stale_sweep.py`: the weekly sweep
  as a Celery beat task and a management command. Both call `stale.py`.
- `views.py`, `urls.py`: `/api/solutions/`.

## Statuses

| Status | What it means | Who sees it | Used for answers |
|---|---|---|---|
| `draft` | Saved for its author to look at (from a chat, or an import). Never shared | The author only | No |
| `pending_review` | The author asked to share it in a curated org. Waiting for a curator | The author and the org's curators | No |
| `active` | Live. Private if not shared, shared with the org if shared | The author; the org if shared | Yes |
| `needs_check` | Failures outnumber confirmations, or a re-check contradicted it | The org, marked | Yes, with a warning |
| `superseded` | A newer, corrected fix replaced it | The org | Replaced by the newer one |
| `retracted` | Withdrawn. The row is kept, so the same answer is not captured again | Nobody | No |

A correction saved as a draft has a `replaces` link to the old fix. The old
fix is retired only when the correction goes live, never while it is a draft.

## Where a new solution starts

`solutions/api.py::starting_state` decides this. It is the only place.

| Saved by | Org setting | Share? | Starts as |
|---|---|---|---|
| An import (any org) | — | — | `draft`, not shared |
| A personal chat (no org) | — | — | `active`, private |
| A chat or tool, org in `suggest` mode | `capture_mode = suggest` | any | `draft`, not shared |
| A chat or tool, org in `auto` mode | `capture_mode = auto` | no | `active`, private |
| A chat or tool, `auto` | yes, `review_policy = open` | yes | `active`, shared |
| A chat or tool, `auto` | yes, `review_policy = curated` | yes | `pending_review` |
| A person clicks Save | any | no | `active`, private |
| A person clicks Save | any | yes, `open` | `active`, shared |
| A person clicks Save | any | yes, `curated` | `pending_review` |

A draft is never shared. The switch the person chose is remembered on the row
as `share_requested`, so publishing it later keeps their choice.

A new organisation starts in `suggest` mode with `open` review. Organisations
that existed before the change were set to `auto` and `open`, so nothing
changed for them.

## Who may do what

- **The author** can edit, publish or discard a draft, and edit, share or
  retract their own solutions.
- **A curator** (owner, admin or curator) can approve a `pending_review` row,
  send a shared one back to its author with a reason, edit or retract any team
  solution, and open the queue and insights pages. A curator does not manage
  people; that stays with owners and admins (`core/orgs.py`).
- **A member** can read the team's solutions, add their own, and mark a
  solution doubtful.

Marking a solution "worked" or "didn't work" counts once per person.

## Limits

- **Automatic saves**: `SOLUTION_CAPTURE_DAILY_CAP` (default 30) per person
  per day. `0` turns the limit off. If the counter cannot be read, the save is
  refused rather than allowed. A thumbs-up that only credits the team solutions
  an answer used is not a save, and does not count.
- **Imports**: `SOLUTION_IMPORT_DAILY_CAP` (default 5) per person per day.
  Each import is paid model calls. Refused imports return 429.
- **The weekly sweep**: `SOLUTION_STALE_SWEEP_SECONDS` (default 604800, one
  week). Nobody gets two digests within six days.

## Team search log

A search made from chat or from the library page, inside an organisation, by
someone who is a member at that moment, is written to `SolutionSearchLog`.
Personal searches, captures and imports are not logged. The query is scrubbed
of secrets and contact details and cut to 300 characters. The insights page
reads it with counts only, to curators only. The weekly sweep deletes rows
older than 90 days.

## Chat tools

The chat tools (`search_solutions`, `get_solution`, `save_solution`,
`review_solution`) live in `chat/tools/solutions.py` and call `api.py` and
`search.py`. Unattended runs (schedules, triggers, missions and delegated
workers) are read-only on team solutions: they can search and read them, but
cannot save or review one, because nobody is there to check what would be
written to the team.

## Tests

`tests/test_isolation.py` (the org boundary; read this first),
`test_search.py`, `test_api.py`, `test_capture.py`, `test_tools.py`,
`test_workflow.py` (statuses, publish, discard, approve, send-back),
`test_import.py`, `test_stale.py`, `test_list.py` (filters, paging, attention),
`test_insights.py`.
