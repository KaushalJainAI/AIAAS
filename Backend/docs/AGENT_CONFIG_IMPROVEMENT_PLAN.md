# Agent configuration audit & improvement — record

## Status

**Built 2026-09-18** — all 23 audit items worked through; the theme was
**a control that is stored, shown and never read** (or a number shown
without saying what it is). Done except the items in Open below.

## What it delivered

- **Chat cost chip, honest at last.** Each turn is priced once from summed
  token usage; a partly reported turn voids the reported total and the whole
  turn is estimated (`llm/usage.py`); follow-up-question calls are counted;
  the chip shows `charged` / `est.` with a tooltip naming the payer.
- **Agent status is enforced.** `paused` now refuses unattended callers
  (schedule, webhook, delegation) with `AgentPaused`, and the sweep **skips**
  the slot (outcome `paused`) instead of counting a failure that would have
  disabled the schedule.
- **Delete keeps runs.** `ExecutionLog.subagent` / `SubAgentRevision.subagent`
  are `SET_NULL`; an agent's runs survive its deletion ("<name> (deleted)");
  `archived` is settable and restorable.
- **Run controls everywhere.** `POST orchestrator/runs/<id>/cancel/`;
  `RunControls` on live runs (Stop, steer box, autonomy switch); approve/
  reject stay in the Inbox; cancelled/timed-out/failed runs no longer
  record 0 tokens against the spend cap.
- **Settings are stored *and used*.** Timezone (chat's clock, agent env,
  scheduler defaults, validated IANA zones), language (a code, told to the
  model), display name, bio, default temperature, instance name, webhook URL.
- **Customers can fix the model problem.** Unknown ids refused at save;
  retired models save but come back `model_status: retired`; summarising-
  model picker offers only runnable models.
- **Revision restore + duplicate** — `POST orchestrator/agents/<id>/
  revisions/<n>/restore/`, a save recorded as a `restore` revision;
  Duplicate starts as draft.
- **`/runs?run=<id>`** opens any run including hidden ones; needs-you
  filter, `?agent=<id>` filter, `useLiveRun` on the execution socket.

## Decisions worth remembering

- **`draft` is a label, not a switch** (item 8) — most dev agents are
  draft only because it is the default; enforcing it would silently stop
  them. Revisit together with a migration that promotes drafts with
  schedules.
- **Credits ≠ provider price.** Credits are charged only when the
  platform's own key pays, at 1 credit per 1,000 tokens, never on free
  models; the chip shows the provider's price, the tooltip names the payer.
- **A partly reported turn cannot be a confident `billed` figure** — void
  and estimate instead.
- **Approvals stay in one place** (the Inbox) — a paused run links there
  rather than growing a second answering screen.

## Open

- **The `draft` switch needs a data migration** (promote drafts that have
  schedules), then flip it.
- **Per-message cost breakdown** — `cost_usd` includes follow-ups and the
  witness; the tooltip should break them out.
- **Browser click-through of the builder changes** — verified by tests and
  lint only so far.
