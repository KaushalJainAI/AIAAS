# `eval/`: is this agent any good?

The user sees this as the Evals page. A **suite** holds **cases** (an input and
what a good answer looks like). A **sweep** runs the agent on every case, and
**graders** score each answer. A person reviews what the graders decided, and
the app measures how often the graders agreed with them.

Design: [`docs/EVALUATION.md`](../docs/EVALUATION.md). Environments:
[`docs/EVAL_ENVIRONMENTS_PLAN.md`](../docs/EVAL_ENVIRONMENTS_PLAN.md). The
built-in benchmark: [`benchmarks/README.md`](benchmarks/README.md).

The app label is `eval` (singular). An older `evals` app left unused `evals_*`
tables in some dev databases. Ignore them.

## Data (`models.py`)

| Model | What it is |
|---|---|
| `EvalSuite`, `EvalCase` | A suite and its cases |
| `EvalWorld` | A made-up situation for a suite (files, mail, calendar, web) with the facts answers depend on. Versioned: regenerating makes a new version |
| `EvalRun` | One sweep of a suite against an agent |
| `EvalResult` | One case's outcome. `auto_passed` is what the graders said, kept for ever |
| `EvalReview` | A person's verdict on a result. The score uses this |
| `JudgeCalibration` | How often the AI judge agrees with known-correct labels |

## Files

| File | What it does |
|---|---|
| `api.py` | **What other apps import.** Use this, not the internals |
| `graders.py` | Registry of small named checks (`contains`, `json_value`, `llm_judge`...). Registering one is the schema |
| `runner.py` | Runs a suite: one agent run per case, grade, queue doubtful results for review |
| `supervision.py` | Which results need a person, and how the final score is computed |
| `environment.py` | Puts one attempt inside its world. Connector tools without a simulator are refused |
| `sim/` | Simulators (`mail`, `calendar`, `drive`, `web`, `notify`) that return the real tools' shapes and record each call |
| `generator.py`, `starter_kits.py` | Draft cases and worlds the judge writes. Drafts stay inactive until accepted on the Evals page |
| `workspace.py` | Per-case folders of starting files, reset before each attempt |
| `office_files.py` | Reads `.xlsx`, `.docx` and `.pptx` back for grading |
| `calibration.py` | Checks the AI judge against labelled examples |
| `bare.py` | Runs the plain model with no platform, for comparison |
| `kb_world.py` | An eval world's hidden knowledge base |
| `recovery.py` | Closes sweeps that a restart interrupted |
| `queries.py`, `views.py`, `urls.py`, `serializers.py` | `/api/eval/` |
| `benchmarks/` | The built-in benchmark suites, as code |

## Rules

- Eval runs use `caller='eval'`. They are kept out of spend caps and the Activity page.
- An eval never stops to ask. Where a real run would pause, an eval records the question and carries on. See CLAUDE.md, "An eval never stops to ask".
- Inside a world, no real mail, calendar, drive or web call happens. See CLAUDE.md, "An eval runs inside a world the judge built".
- The judge model and the model under test must be different. See CLAUDE.md, "Model IDs".

## Tests

`eval/tests/`: `test_api.py`, `test_graders.py`, `test_runner.py`,
`test_supervision.py`, `test_environments.py`, `test_world_isolation.py`,
`test_benchmarks.py`.
