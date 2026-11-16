# Evaluation — `eval/`

*Is this agent any good, and who says so?*

`logs/` records what an agent did. `eval/` records whether it should have
done that — and, because a grader is a program with opinions, whether the
grader was right.

**Looking for the practical benchmark?** The ready-made suites (instructions,
research, data analysis, files, and five guardrail suites) live in
`eval/benchmarks/` and run with `python manage.py benchmark run --user <email>`.
Start at `eval/benchmarks/README.md`.

## The shape

```
EvalSuite ── EvalCase              a named set of cases + a supervision policy
    │
    └── EvalRun ── EvalResult ── EvalReview
      (one sweep)  (one case)    (a person's verdict)
```

| Table | Row is | Key columns |
|---|---|---|
| `eval_evalsuite` | a set of cases and the policy for reviewing them | `supervision`, `pass_threshold`, `reviewer`, `concurrency`, `max_cost_rupees` |
| `eval_evalcase` | one goal handed to the agent | `goal`, `input_data`, `reference`, `graders` |
| `eval_evalrun` | one sweep of a suite against one agent | `status`, `score`, `passed`, `grader_agreement`, `revision`, `is_baseline`, `mode` |
| `eval_evalresult` | one case's outcome | `auto_passed`, `auto_score`, `grades`, `review_state`, `execution`, `judge_tokens`, `judge_cost_usd` |
| `eval_evalreview` | a person's verdict on a result | `verdict`, `agreed_with_graders`, `corrected_answer` |
| `eval_judgecalibration` | judge agreement vs known labels | `judge_model`, `agreement`, `false_pass_rate`, `source` |

**Eval runs are `caller='eval'`**: excluded from the agent spend cap, agent
list stats, `/runs`, and insights — but included in
`cost_breakdown.by_caller['eval']` as real money. A suite may cap its sweep
with `max_cost_rupees`; the sweep fails with "ceiling reached" and skips the
rest. Stale `running` sweeps are closed by `eval/recovery.py` (3 h). Judge
cost is recorded per grade and summed onto the result/run/scorecard.
Baselines are accepted per suite+model (`benchmark accept`); the scorecard
shows a vs-baseline column. `disagreement` queues only judge-vs-deterministic
splits and uncertain judges. `mode='bare'` is the platform-tax control
(external suites only): one bare `llm.complete` per case, no tools, no
`ExecutionLog`.

## Six decisions, and what each one prevents

### 1. A sweep runs the agent through the same door everything else does

Every case is executed by `agents.agent.runtime.run_agent` with
`caller='eval'` — the same entry point a user pressing "run" goes through,
under the same guardrails, writing the same `ExecutionLog`.
`EvalResult.execution` keeps the full turn-by-turn trace one hop from the
score. Measuring a code path nobody uses scores something that does not ship.

### 2. A human verdict overrides, it does not overwrite

`EvalResult.auto_passed` keeps the graders' answer for ever;
`EvalReview.verdict` is what the run's score is computed from. Two records,
not one field. `EvalRun.grader_agreement` is not computable from an
overwritten column — a suite whose graders agree with people 55% of the time
is measuring noise.

### 3. A run whose score can still move is never `completed`

A sweep with anything queued for review sits in `awaiting_review`, with
`passed = NULL`. `supervision.recompute()` moves it to `completed` when the
last verdict lands; it is the one function that computes a score. A
provisional score is never a release decision; `queries.agent_scorecard`
reports `awaiting_review` separately and leaves `latest` null until a run
settles.

### 4. A case nothing could grade does not pass

`graders.grade_all([])` returns `auto_passed = None`, not `True`, and
`supervision.needs_review` queues a `None` under every policy but `none`.
An empty suite reporting 100% is the most misleading number an eval system
can produce.

### 5. Failures are per-case; refusals stop the sweep

A case whose agent run raises becomes one `error` result and the sweep
carries on. A guardrail refusal or a missing credential aborts it, because
every remaining case would fail identically. Errored cases still score
zero, so an outage drags the score down rather than disappearing from the
denominator.

### 6. A run is pinned to the configuration it scored

`EvalRun.revision` is set at open time from `logs.revisions.current(agent)`,
the same way `ExecutionLog.revision` is. The scorecard reports the revision
number beside each score, which makes "did this prompt change help?"
answerable.

## Graders

One `@grader(...)` declaration per assertion in `eval/graders.py`.
**Registration is the schema**: `REGISTRY` is what the API validator, the
runner, and `GET /api/eval/graders/` all read.

| Grader | Asserts | Params |
|---|---|---|
| `contains` / `not_contains` | substring presence | `value`, `ignore_case` |
| `equals` | exact answer | `value`, `ignore_case`, `strip` |
| `regex` | pattern match | `pattern`, `ignore_case`, `negate` |
| `min_length` / `max_length` | answer size | `value` |
| `json_key` | key (and optionally value) in structured output | `key`, `equals` |
| `contract` | the run met its `output_schema` contract | — |
| `tool_used` / `tool_not_used` | what the agent reached for | `tool` |
| `no_error` | the run finished and was not left paused | — |
| `paused_for_approval` | the run stopped at an approval gate (a guardrail *pass*) | — |
| `max_tokens` / `max_duration_ms` / `max_tool_calls` | budget | `value` |
| `llm_judge` | a model scores the answer against a rubric | `rubric`, `threshold`, `provider`, `model` |

**A case passes when every grader passes.** Score is still a weighted mean,
because ranking failures is useful and the supervision policy reads the
mid-band.

**Everything but `llm_judge` runs with no provider, no credential and no
network.** A grading pass whose cost is unpredictable is one nobody runs.

**The judge fails closed.** An outage, a missing rubric, or an unparseable
reply is a *failed* grade whose detail says the judge was the thing that
broke. It defaults to `EVAL_JUDGE_PROVIDER` / `EVAL_JUDGE_MODEL` rather than
the agent's own model: same-model self-grading is where a rubric failure and
an agent failure cannot be told apart.

## Supervision

`eval/supervision.py`. The policy lives on the suite and is **copied onto the
run**, so editing a suite does not rewrite what was supervised.

| Policy | Queues |
|---|---|
| `none` | nothing |
| `failures` | every case the graders failed |
| `disagreement` *(default)* | where the graders were least sure |
| `sampled` | `sample_percent` of results, at random |
| `all` | everything |

`disagreement` queues a result when the graders split, when an `llm_judge`
score lands in `UNCERTAIN_BAND` (0.35–0.65), or when the overall score does.
It is the only policy whose review cost does not grow with the size of the
suite.

An `unsure` verdict on a graded result is recorded, not refused: it leaves
the grader's verdict standing with `agreed_with_graders = NULL`, so an honest
"I cannot tell" does not drag the agreement figure down. Errored or skipped
cases are never queued.

**One notification per run, never one per result** — the same reasoning as
the HITL digest in `notifications/reminders.py`.

## Bounds

In `workflow_backend/thresholds.py`. A sweep runs the agent once per case, so
every number here bounds what one button press can cost.

| Constant | Value | Why |
|---|---|---|
| `EVAL_MAX_CONCURRENCY` | 4 | ceiling `suite.concurrency` is clamped to |
| `EVAL_MAX_CASES_PER_SUITE` | 200 | the size of a suite is the size of a bill |
| `EVAL_RESULT_ANSWER_CHAR_LIMIT` | 16k | per-result copy; `answer_truncated` marks a cut |
| `EVAL_RUN_LIST_LIMIT` / `EVAL_RESULT_LIST_LIMIT` / `EVAL_REVIEW_QUEUE_LIMIT` | 100 / 200 / 100 | these are `@api_view` functions, which DRF pagination never reaches |

Cancellation is cooperative: `POST /runs/{id}/cancel/` flips the row and each
case checks it on the way *out* of the concurrency semaphore. A case already
inside a model call runs to completion rather than being abandoned
half-paid-for.

## Using it from another app

`eval/api.py` is the public surface. Everything else is HTTP plumbing or
internal to a sweep.

```python
from eval import api as evals

# Pure — no rows, no provider (unless a spec asks for llm_judge)
evals.list_graders()
await evals.grade_answer('It is Paris.', [{'type': 'contains', 'value': 'paris'}])
evals.needs_review('failures', auto_passed=False, score=0.0)
evals.validate_graders(specs)                      # raises GraderError

# Score a run that already happened — chat, a trigger, a delegation.
# Persists nothing; the caller decides if the verdict is worth keeping.
await evals.grade_execution(execution_log, specs, reference='...')

# Sweeps
run    = await evals.run_suite_now(suite, agent, user)    # awaited, already settled
run_id = await evals.start_suite_run(suite, agent, user)  # detached, 202-shaped

# Supervision and reads
evals.record_review(result, reviewer=user, verdict='fail')
evals.review_queue(user), evals.agent_scorecard(user, agent_id)
```

Three properties make this safe to depend on, each with a test in
`eval/tests/test_public_api.py`:

- **No module-level import of a sibling app.** Every reference to `agents`,
  `logs`, `llm` or `notifications` inside `eval/` is function-local.
- **`eval/__init__.py` is empty on purpose** — `INSTALLED_APPS` imports the
  package during setup, so anything there touching `eval.models` would raise
  `AppRegistryNotReady` on boot. The façade is `eval/api.py`.
- **The pure layer needs no ORM.** `graders.py` and the policy half of
  `supervision.py` import no models.

`grade_answer` returns plain JSON (`{'score', 'passed', 'grades'}`) rather
than `Grade` dataclasses, and `passed` is `None`, never `True`, when nothing
could decide. The `Eval*` models take objects rather than ids throughout, so
**ownership stays the caller's business** — nothing in the public layer
re-checks a user except the `queries.*` reads.

## Endpoints

See [API.md](API.md) §20 for the full route list with access and gotchas.
Scoring is 0–100 everywhere (`score_100`, `final_score_100`,
`auto_score_100`): done = positive, give-up = 0, guardrail / hallucination /
out-of-scope = minus inside the case with a `flags` entry (`gave_up`,
`guardrail`, `hallucination`, `out_of_scope`). Guardrail and unexpected
give-up results auto-queue for review. See
[EVAL_EXPANSION_PLAN.md](EVAL_EXPANSION_PLAN.md).

## Tests

`eval/tests/`:

- `test_graders.py` — registry/schema agreement, every deterministic grader,
  fail-closed judge behaviour, and the no-graders → `None` rule.
- `test_supervision.py` — every policy, override-without-overwrite, agreement
  arithmetic, and `awaiting_review` gating.
- `test_runner.py` — sweeps with `run_agent` stubbed: scoring, refusal
  abort, cancellation, revision pinning, answer capping.
- `test_api.py` — every route, cross-tenant 404s, and the 402/400 split.
- `test_public_api.py` — the importability contract of the section above.
