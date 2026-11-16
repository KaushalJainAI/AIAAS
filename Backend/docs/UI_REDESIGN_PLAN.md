# UI redesign — plan (Concept 5)

## Status

**Proposed 2026-11-11; not started.** Design: Concept 5 — Professional (17
desktop screens, 11 phone screens, light and dark). The rule for the whole
job: **the structure and the flows stay as they are; the look changes**,
plus the few new pieces of information the new screens show. Where a screen
shows something the server doesn't send, the plan adds it **additive**, so
the current UI keeps working against the new backend before the new UI
lands.

## What it covers

**Backend changes (all additive; each touches its row in `API.md`):**

- **B1 — Approval details** (`describe.py`): `effect` (read/reversible/
  irreversible; MCP = irreversible), `leaves_workspace` (never; for sends
  and publishes), an action-named verb (`Send email`), and whether the
  recipient was seen before (from `reviewer._recipients` + history, not
  exposed today).
- **B2 — Narrower approvals** — approve "this vendor, this run" via an
  argument match; the approve API takes only `scope` today. Must refuse a
  match that isn't a subset of the paused call's arguments.
- **B3 — Edit draft before approving — deferred.** The approval item shows
  Send / Decline and a steer instead.
- **B4 — Turn timing on the saved reply** — steps count + duration saved on
  the message (today only logged).
- **B5 — Run state in the chat list** — per-session state + last agent for
  the phone's Waiting / Running / Finished grouping. The only migration.
- **B6 — Month-to-date spend** — "Spend this month" endpoint; no budget
  (decided: spend only).
- **B7 — Credential health** — serialize `token_expires_at` next to
  `last_error` ("Expires in 6 days" / "Rejected last time").
- **B8 — Who wrote a file** — the agent tag on documents, recorded on
  writes (only on versions today as `source='agent'`).
- **B9 — Skill usage count** ("Used by 2 agents").
- **B10 — Accent palette with teal** — `accent_color` becomes a picked
  palette value, not free text.
- **B11 — Approval rule wording only** — API values stay
  `plan | ask | auto | full`.
- **B12 — Live turn cost — deferred.** A `turn_usage` frame with tokens
  and ₹ while running (today cost is known only after the turn ends).

**Frontend:** tokens + shared components first (F0), then screen batches
(F1–F7), each on its own files, never two agents editing the same file.
`StandaloneChat`, `ChatMessageItem`, `MarkdownMessage` and `index.css`
were being edited by other sessions — Phase 0 exists to land their work
on its own first.

## Decisions worth remembering

- **Structure stays; the look changes.** No re-flow, no new navigation —
  this is not a re-architecture.
- **Additive or it doesn't ship** — the current UI keeps working against
  the new backend at every step.
- **Backend first**, in one pass (B1, B2, B4–B11), with tests and
  `API.md` — Haiku agents do the bulk, one change per agent, B1/B2/B5 get
  a line-by-line review.
- **B2 refuses non-subset matches** — "applies to this vendor" must never
  approve something wider than the user saw.
- **B5 is the only migration** — deploys run it via `boot`; check the
  deploy log.
- **Phase 0 clears the ground** — others' sessions commit first; the
  redesign is a separate, revertible set of commits on `ui-redesign`.

## Open

- **B3** (edit a request before approving it) — deferred; not part of
  this redesign.
- **B12** (live turn cost) — deferred.
- **Not started** — nothing in the file is built.
