# `eval/`: is this agent any good?

The user sees this as the Evals page. A **suite** holds **cases** (an input and
what a good answer looks like). A **sweep** runs the agent on every case, and
**graders** score each answer. A person reviews what the graders decided, and
the app measures how often the graders agreed with them.

Design: [`docs/EVALUATION.md`](../docs/EVALUATION.md). Environments:
[`docs/EVAL_ENVIRONMENTS_PLAN.md`](../docs/EVAL_ENVIRONMENTS_PLAN.md). The
built-in benchmark: [`benchmarks/README.md`](benchmarks/README.md).

The app label is `eval` (singular). Some dev databases still hold unused
`evals_*` tables from a deleted app. Ignore them.

## Read in this order

1. `models.py`: suites, cases, worlds, runs, results, reviews.
2. `api.py`: the surface other apps import.
3. `runner.py`: how a sweep runs.
4. `graders.py`: how an answer is scored.
5. `supervision.py`: which results a person must review, and the final score.

## Data (`models.py`)

| Model | What it is |
|---|---|
| `EvalSuite`, `EvalCase` | A suite and its cases |
| `EvalWorld` | A made-up situation for a suite (files, mail, calendar, web) with the facts answers depend on. Versioned: regenerating makes a new version |
| `EvalRun` | One sweep of a suite against an agent |
| `EvalResult` | One case's outcome. `auto_passed` is what the graders said |
| `EvalReview` | A person's verdict on a result. The score uses this |
| `JudgeCalibration` | How often the AI judge agrees with known-correct labels |

## Files

**Public surface and the core**

| File | What it does |
|---|---|
| `api.py` | **What other apps import.** Grading, sweeps, supervision and reads. Use this, not the internals |
| `graders.py` | Registry of small named checks (`contains`, `json_value`, `llm_judge`, and the file graders). Registering one is the schema |
| `runner.py` | Runs a suite: one agent run per case, grade, queue doubtful results for review |
| `supervision.py` | Which results need a person, and how the final score is computed |
| `bare.py` | Runs the plain model with no platform, for comparison |
| `calibration.py` | Checks the AI judge against labelled examples |
| `recovery.py` | Closes sweeps that a restart interrupted |
| `queries.py` | Read-side queries for the Evals page |

**Worlds and fixtures** (what a case starts from)

| File | What it does |
|---|---|
| `environment.py` | Puts one attempt inside its world. Connector tools without a simulator are withheld |
| `sim/` | Simulators (`mail`, `calendar`, `drive`, `web`, `notify`). They return the real tools' shapes and record each call |
| `kb_world.py` | An eval world's hidden knowledge base |
| `workspace.py` | Per-case folders of starting files, reset before each attempt |
| `office_files.py` | Reads `.xlsx`, `.docx` and `.pptx` back for grading |
| `generator.py`, `starter_kits.py` | Drafts cases and worlds that the judge writes. Drafts stay inactive until accepted on the Evals page |

**HTTP**

| File | What it does |
|---|---|
| `urls.py`, `views.py`, `serializers.py` | The `/api/eval/` routes: suites, cases, worlds, runs, reviews, scorecards |

**Benchmark**

| File | What it does |
|---|---|
| `benchmarks/` | The built-in benchmark: `suites/` (capability and guardrail suites as code), `external/` (public datasets such as IFEval and GAIA), `calibration/` (the judge's labelled set), `agents.py` (the agents under test), `install.py`, `report.py` |
| `management/commands/benchmark.py` | `manage.py benchmark run --user <email>` |
| `management/commands/seed_starter_evals.py` | Installs the starter suites |

## Rules

- Eval runs use `caller='eval'`. They are left out of the user's run and cost views (`logs/queries.py`).
- An eval never stops to ask. `ask_user` records the question and the run carries on (`chat/tools/ask.py`).
- Inside a world, no real mail, calendar, drive or web call happens. Tools without a simulator are withheld.
- The judge model and the model under test are different models. The table of model ids is in the root `CLAUDE.md`, and `eval/tests/test_benchmarks.py` pins them.
- Paid runs (benchmarks, calibration, proof runs) need the user's go-ahead.

## Tests

`eval/tests/`. Start with `test_api.py`, `test_runner.py`, `test_supervision.py`,
`test_world_isolation.py` and `test_benchmarks.py`.
