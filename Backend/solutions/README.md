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
- `views.py`, `urls.py`: `/api/solutions/`.

The chat tools (`search_solutions`, `get_solution`, `save_solution`,
`review_solution`) live in `chat/tools/solutions.py` and call `api.py` and
`search.py`.

## Tests

`tests/test_isolation.py` (the org boundary; read this first),
`test_search.py`, `test_api.py`, `test_capture.py`, `test_tools.py`.
