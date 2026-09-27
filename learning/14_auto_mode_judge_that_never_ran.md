# 14 — The Auto-Mode Judge That Never Ran

> Source: `Backend/chat/turn/reviewer.py`, `chat/turn/agent.py::tools_node` (Pass 1),
> `chat/turn/pipeline.py::reviewer_text`, `workflow_backend/settings/base.py`
> Fixed: 2026-09-24 · Tests: `chat/tests/test_auto_reviewer.py`

---

## The Symptom

Chat has three modes: **Ask** (pause before every risky tool call), **Auto** (a small
"judge" model lets clearly-requested calls through), and **Plan** (read-only). Users said
Auto "doesn't work well": it was slow and still asked about everything.

---

## The Root Cause: One Import Line

```python
# reviewer.py — before
import llm
completion = await llm.complete(...)   # llm/__init__.py is EMPTY
```

The real function lives at `llm.access.complete`. So **every** judge call raised
`AttributeError`. The code around it did this:

```python
try:
    outcome = await call_judge(...)
except (asyncio.TimeoutError, Exception):
    logger.warning('[Reviewer] Judge failed for %s; asking.', tool_name)
    return {'allow': False, 'reason': 'The reviewer was unavailable.'}
```

"Fail safe" is right for a security gate: if the judge breaks, **ask**, never allow. But
it also meant the bug looked exactly like "the judge was cautious". Auto mode quietly
became Ask mode, and nothing ever crashed.

### Why every test was green

Every test replaced the judge with a fake:

```python
with _judge(reviewer, _allow):      # swaps out _model_judge
    paused = policy('write_file', ...)
```

The fake bypassed the one line that was broken. The tests proved the *policy logic* was
right and never exercised the *wiring*.

**Lesson:** when you mock a dependency, keep at least one test that runs the real
function and mocks only one level further down (here: patch `llm.access.complete`, not
`_model_judge`). That test would have failed on day one.

**Lesson 2:** a broad `except Exception` in a fail-safe path should **log the exception
type**. "Reviewer unavailable" hid an `AttributeError` for as long as the feature existed.
The log now says `[Latency] reviewer 12ms fail write_file (AttributeError: ...)`.

---

## The Other Four Problems (Found Once It Actually Ran)

### 1. The judge used the user's chat model

With no reviewer model configured, it fell back to the chat model, by default
`openrouter/free`. Measured with the real judge prompt:

| Model | Latency (3 calls) | Verdicts |
|---|---|---|
| `openrouter/free` | 6.1 s, 22.3 s, 1.7 s | ALLOW, ALLOW, ASK (inconsistent) |
| `meta-llama/llama-4-scout` | 1.3 s, 1.3 s, 1.5 s | ALLOW ×3 |
| `inception/mercury-2.5` | ~1 s | empty replies |

The budget is 3 s. `openrouter/free` is also a *reasoning* router with no `none` effort
setting, so the judge "thought" inside a 200-token cap. The fix is a dedicated setting,
`AUTO_REVIEWER_MODEL`: a fast, non-reasoning model.

**Lesson:** a judge / classifier / router model is a different job from the main model.
Pick it for latency and consistency, and **measure** instead of guessing.

### 2. Calls were judged one at a time

```python
for call in calls:                       # before: 4 writes = 4 sequential judge calls
    if await policy(call, ...): ...
```

```python
gates = await asyncio.gather(*(_gated(c) for c in calls))   # after: decide concurrently
for call, gated in zip(calls, gates):                        # ...then act in call order
    if gated: await _require_approval(call, ...)
```

Deciding runs concurrently; acting stays in order, so the approval cards and the
transcript don't depend on which judge answered first. That's safe because the policies
are pure reads.

### 3. Approving re-judged everything

LangGraph's `interrupt()` pauses a node, and on resume **re-runs the node from the top**.
So after you approved one call, the whole batch was judged *again*, including the call you
just approved. The judge can answer differently the second time, so a call it had allowed
could turn into a brand-new approval card.

Fixes:
- skip calls already in `approved_tool_calls` *before* asking the policy;
- cache each verdict by `(session, call_id)` so a re-run reuses it.

**Lesson:** in any "replay from the top" system (LangGraph interrupts, React StrictMode,
retried jobs), a side-effecting or nondeterministic step must be **idempotent** or
**memoized by a stable id**.

### 4. The judge saw too little

It only saw the current message. "yes, send it" names nothing, so the judge (told
"when in doubt, ASK") always asked. It now gets the last 4 user messages and the live todo
list. Recipient checks use the same text, so "reply to john@acme.com" two messages ago
still covers the address.

---

## Interview Questions

1. *Your fail-safe path catches every exception and returns a safe default. What can go
   wrong?*
   → A permanent bug looks like normal cautious behaviour. Log the exception type, and alert
   when the failure rate is high.

2. *All your tests pass but the feature never worked in production. How?*
   → The tests mocked the layer that was broken. Keep one test per integration seam that
   mocks one level lower.

3. *How do you run N independent checks concurrently but keep deterministic output?*
   → `asyncio.gather` to decide, then iterate the results in the original order to act.

4. *Why can re-running a node after an interrupt cause duplicate or contradictory
   prompts?*
   → The replay re-executes nondeterministic work. Memoize by a stable id or skip
   already-settled items.

5. *How would you choose a model for an inline "allow or ask" judge?*
   → Latency budget first (it blocks the user), then consistency (temperature 0, no
   reasoning), then cost. Measure p50/p95 on the real prompt.
