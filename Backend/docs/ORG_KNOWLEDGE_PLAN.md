# Team knowledge — record

## Status

**Built 2026-11-11 (K0–K7). Not deployed; not yet checked in a browser.** It
builds on `SOLUTION_MEMORY_PLAN.md` (S0–S4 built 2026-09-28) — it turns a
hidden solution store into "what my team knows".

## What it delivered

- **K0** — fixes under the new features: editing no longer resets freshness
  and leaves a record; `reuse_count` means "used", not "shown"; one capture
  per answer across workers; capture has a daily cap per user; invitations
  instead of silent adding; an atomic last-owner guard.
- **K1** — chat shows it working: a team fix used by an answer is marked on
  the reply (chip/link); a thumbs-up on an answer that *used* a fix credits
  that fix.
- **K2** — drafts, sharing on purpose, curators: new captures land as
  drafts; `curator` role between member and admin; per-org review queue.
- **K3** — fill it on day one: document import (runbooks/docs/wiki into the
  library), "New solution" button, `/team` page, chat invitation to set up a
  team.
- **K4** — keep it true: stale nudges for owners/curators; freshness labels
  on reuse; "may be out of date" digest.
- **K5** — show the value, find the gaps: insights tiles (searches, saves,
  reuse, abstention), org rollups, curators only.
- **K6** — share knowledge bases read-only with the org: membership checked
  per read; agents are never served the org KB; eval corpora never pass.
- **K7** — choose the org (per chat and per agent for unattended runs);
  schedules may use it (read-only use).

## Decisions worth remembering

- **The org comes from the chat, never from an argument.** Tools take no
  `org_id`; a chat carries the owner's active org for ever (or none);
  switching is a new chat, not an argument.
- **One read door.** `solutions/access.py::visible` is the only place
  solutions are filtered for reading; a choke-point test enforces it (same
  pattern for K6's KB door, `inference/kb_access.py`).
- **Capture is explicit, not silent.** Auto-capture lands as drafts that a
  curator approves, with a daily cap and logged spend.
- **Sharing is revocable by the owner, stoppable by a curator.** A curator
  may switch sharing off, never on; only the owner (or admin) changes who
  can read.
- **Unattended runs read but never write/review** team solutions.
- **Freshness is data.** Claims carry a freshness kind; edits re-timestamp
  them; nothing that was never true gets preserved by silence.

## Open

- **K0–K7 not checked in a browser**; not deployed.
- **Later items (not started):** share agents with an org (roles "builder"/
  "runner"); topic owners (tags mapped to people who get the stale nudges);
  export an org's knowledge (JSON) before deleting an org.
- **S5 benchmark suite** (from SOLUTION_MEMORY_PLAN): retrieval set + a
  100%-bar isolation guardrail — worth doing right after K2, but not done.
