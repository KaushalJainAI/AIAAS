# Solution memory — "someone here already solved this"

Status: **S0–S4 built 2026-09-28** (undeployed): organisations, the
`solutions` app, automatic capture, freshness labels, the "doubtful" flag,
the per-chat share switch, the `/solutions` page. S5 (the benchmark suite and
the offline retrieval set) is not built. All decisions in §9 are settled.
What was built differs from the text below in the places listed in §11.

## 1. The problem, in plain words

A senior fixes a problem. Months later a junior hits the same problem and
starts from zero, because the fix lives in one person's chat history.

What we want:

1. **Reuse.** When someone asks about a problem, the assistant checks whether
   anyone in their organisation already solved it, and builds the answer from
   that — saying who solved it and when.
2. **Capture without effort.** When a problem gets solved, the solution is
   saved automatically. Nobody has to write a wiki page.
3. **Know what goes stale.** "Restart the worker" stays true for years. "The
   staging DB password rotates on Fridays" or "use library v4.2" may not. The
   system must know which kind a solution is, say so when it uses it, and
   re-check the changeable parts before stating them as fact.

## 2. What exists today, and what is missing

| Need | Today | Gap |
|---|---|---|
| "Same organisation" | Nothing. Every row is per-user. `useOrgContext` was deleted; company-wide context was ruled out of scope on 2026-08-14 | An `Organization` + membership model |
| A place to store solutions | `core.UserMemory` — short personal facts, rides in every system prompt, 25 per category | Solutions are long, many, and searched — not injected. Needs its own store |
| Search | `inference/backends/hybrid.py` (FAISS + full text), per-KB | Reuse it; one hidden KB per org |
| "It worked" signal | `logs.Feedback` (thumbs on chat messages and runs) | Nothing reads it for capture |
| Cheap model for background jobs | Context fold (`CONTEXT_SUMMARY_MODEL`), Auto reviewer | Reuse the same pattern |
| Poisoning defences | `core/safety/provenance.py::instruction_shaped`, memory guard refuses in tainted turns | Apply both at capture |
| Secret scrubbing | `credentials/refs.redact`, key-name redaction in `chat/tools/describe.py` | Apply before anything is shared |

## 3. The shape

```
 solve ──► capture (background) ──► Solution row ──► hybrid index (org KB)
                                          ▲                   │
            confirm / supersede ──────────┘                   ▼
 ask   ──► search_solutions tool ──► records + freshness ──► answer that
                                                              cites and warns
```

Three rules carry it:

- **A solution is a record, not a chat log.** Storing the transcript would
  leak everything said in it and would be useless to read. Capture extracts a
  small structured record (§4) and drops the rest.
- **Retrieved solutions are evidence, never instructions.** They arrive as a
  tool result, attributed and dated, exactly like a web page. A step in a
  solution that runs a tool still goes through the *reader's* own gates.
- **Freshness is decided when it is read, not when it is written.** The record
  stores *what kind* of claim it is and *when* it was last known true; the
  "is this still safe to say?" answer is computed at read time, so a
  solution becomes stale on its own without a job rewriting rows.

## 3a. The organisation boundary (settled 2026-09-28)

The user's rule: **a solution is shared only inside the organisation it
belongs to, and organisational data must never leak out of it.** Everything
below is built to make a leak structurally hard, not just forbidden.

1. **Every solution belongs to exactly one org, fixed at capture.** The org is
   the one the conversation or run happened in (`ChatSession.org`,
   `SubAgent.org`), never "whichever org the user is in". A person in two
   orgs (a contractor) therefore cannot carry Org A's fix into Org B's store.
   `org` is never editable after creation — moving a solution between orgs is
   not a feature.
2. **One door for every read.** `solutions/access.py::visible_solutions(user,
   org)` is the only queryset any view, tool or job may use; it checks live
   membership *on every call* (no cached org list), so someone removed from
   an org loses access on their next query, not at token expiry. A choke-point
   test fails if `Solution.objects` appears anywhere else — the
   `filesystem.resolve_folder` pattern.
3. **Foreign and unknown look the same.** Asking for another org's solution id
   answers 404 exactly like a missing id, so ids cannot be probed.
4. **Separate index per org.** Each org has its own hidden KB and its own
   FAISS index; a search physically cannot return a vector from another org,
   and deduplication (§6 step 4) searches only the same org's index.
5. **Nothing crosses by side door.** Solutions and the org KB are refused by:
   agent publishing (`to_shareable` — a shared agent carries no org data),
   public pages (`publish_page`), template install, export to a personal
   folder, and eval worlds. Delegated workers inherit the parent's org scope
   and can never widen it. Notifications and digests name a solution, never
   quote it, outside the org.
6. **Leaving an org.** Org solutions stay with the org (they are the org's
   knowledge); the departed member's *private* solutions go with them.
   Deleting an org deletes its solutions, KB and index.
7. **What leaves our servers.** Capture and search send solution text to the
   org's model provider, like any chat. An org setting pins which provider /
   key capture uses (default: the org's own key, never a free router that may
   train on inputs). Stated on the settings page.
8. **Logs.** Server logs and Sentry get solution ids, never text.
9. **Proved, not promised.** A 100%-bar guardrail suite (§8 S5) and unit tests
   cover: cross-org search returns nothing, a removed member gets nothing,
   foreign id = 404, a published agent/page carries no solution text, a
   two-org user's capture lands only in the conversation's org.

## 4. The record

New app `solutions/` (providers-and-data layer, beside `inference`; may read
`inference` models, imports nothing from `chat.turn`/`chat.tools`).

`Solution`:

| Field | Meaning |
|---|---|
| `org` (nullable), `author` | Null org = private to the author |
| `problem` | The problem as a person would ask it ("Celery worker won't pick up tasks after deploy") |
| `symptoms` | Error text, observed behaviour — what a junior will paste |
| `environment` | Versions / systems it applied to (`{"django": "5.1", "service": "billing"}`) |
| `root_cause` | Why it happened |
| `resolution` | The steps that fixed it |
| `claims` | List of `{text, kind, depends_on}` — the individual statements inside the resolution that could go stale (§5) |
| `volatility` | Overall class, the most volatile of its claims |
| `valid_as_of` | When it was last known true (capture time, then each confirmation) |
| `status` | `active` · `needs_check` · `superseded` · `retracted` |
| `superseded_by` | FK to the newer solution |
| `confirmations`, `failures` | Counts of "this worked for me" / "this did not" |
| `reuse_count`, `last_used_at` | Read stats |
| `source_kind`, `source_id` | Chat message or `ExecutionLog` it came from (link, not copy) |
| `document` | The hidden `inference.Document` holding the searchable text |

Search text is `problem + symptoms + root_cause + resolution`, written into
one hidden KB per org (`backend='hybrid'`, excluded from pickers the same way
eval world KBs are, via `visible_knowledge_bases`). No new index code.

## 5. Knowing what can change

Each claim gets a **kind** at capture time, from the cheap model, from a
closed list:

| Kind | Example | Default "check after" |
|---|---|---|
| `principle` | "Don't hold a DB connection across a model call" | never |
| `procedure` | "Clear the npx cache, then restart" | 1 year |
| `versioned` | "Fixed in `langgraph` 1.0.3" | when the named dependency changes, else 6 months |
| `config` | "Staging uses port 5433" | 90 days |
| `time_sensitive` | "The vendor's API limit is 60/min", prices, people, schedules | 30 days |
| `ephemeral` | "The outage is ongoing" | **not saved** |

At read time each claim is labelled:

- **fresh** — inside its window, or confirmed recently → stated normally,
  with the date.
- **check** — past its window, or a `versioned` claim whose dependency now
  reads differently (`environment` in the record vs the asker's stated
  environment) → the assistant must either **re-verify** (web search, read
  the repo file, run the read-only command — whatever tool it has) or **say
  plainly** "this was true on 12 March; it may have changed — I haven't
  confirmed it".
- **contradicted** — re-verification found a different answer → the claim is
  not used, the solution drops to `needs_check`, and the new finding becomes
  a new solution that `supersedes` it.

This is enforced in two places, not left to the model's mood:

1. The tool result carries the label per claim, so the model cannot miss it.
2. A prompt rule (added to `CORE_RULES` rule 3's neighbourhood *and* to
   `build_system_prompt`, the lesson of 2026-09-13): *a `check` claim is
   never stated as current fact without either a verification in this turn
   or an explicit "may have changed" line.*

Re-verification that agrees bumps `valid_as_of` — so solutions people keep
using stay fresh by being used, like `UserMemory`'s touch-on-repeat.

## 6. Automatic capture

**When.** A turn is a capture candidate when any of these happen:

- the user gives thumbs-up on the answer (`Feedback.rating = +1`);
- the user's *next* message says it worked ("that fixed it", "works now") —
  judged by the cheap model as part of the capture job, not by keywords;
- an agent run finishes `completed` with a `findings`/`patch` contract and
  the task was a fix.

**How.** A detached job (`background.spawn`) after the turn ends — never on
the path to the first token (pre-model latency is already the known hot
spot). Steps:

1. **Worth it?** Cheap model answers: was a real, reusable problem solved?
   "What's 2+2" and "write me a poem" are not solutions. Most turns stop here.
2. **Extract** the record (§4) and claim kinds (§5). Ephemeral → stop.
3. **Guard.** Refuse if the turn was `tainted_by` (same rule as the memory
   guard) or any field is instruction-shaped. Scrub secrets with the
   existing redactors; drop anything that looks like a credential or a
   personal detail about a third party.
4. **Dedupe.** Search the store; if a near match exists (similarity over a
   threshold *and* the model agrees it is the same problem), **confirm** it
   (bump `confirmations`, `valid_as_of`) instead of inserting — or, if the
   new fix differs, save the new one and mark the old `superseded`.
5. **Save** and tell the user once, quietly: "Saved as a team solution ·
   Edit · Undo". Undo retracts.

`effort="none"` on every capture call, charged to the user's `total_tokens`
like the context fold, so it counts against spend caps.

## 7. Retrieval and the answer

- New tool `search_solutions(query, environment?)`, `effect="read"`,
  `parallel=True`, in `ALWAYS_AVAILABLE` (it writes nothing and reaches only
  the caller's own org — same terms as `update_todos`). Chat, as the
  orchestrator, may use it; so may every agent.
- Scope: author's private solutions + their org's. Other orgs never — the
  query is filtered by org id at the queryset, and a guardrail eval case
  proves it (§8).
- Result per hit: problem, resolution, author name, date, confirmations vs
  failures, and each claim with its freshness label. Capped (top 3, like
  the tool-output budget), with the id for `get_solution` to read the rest.
- Prompt rule: for a troubleshooting or how-do-I question, search first; if a
  hit is used, say so ("Priya fixed this in March, confirmed by 3 people
  since") and adapt it to the asker's situation rather than pasting it.
- **Cheap nudge, not injection.** Optionally, a full-text-only lookup (no
  embedding call) at turn start that adds one line to the *trailing context
  message* — "2 team solutions may match; use search_solutions" — never the
  system prompt (the clock trap). Off by default until measured.
- **Closing the loop.** When the asker later says it worked or didn't, the
  same capture job records a confirmation or a failure against the solution
  that was used. Two failures with no later confirmation → `needs_check`.

## 7a. The retrieval system (IR)

**What we already have** (`inference/backends/hybrid.py`): a vector index
(FAISS HNSW, `nvidia/nemotron-3-embed-1b`, 2048 dims, via the NVIDIA API) and a
BM25-style keyword index (`IndexedTerm` rows), searched in parallel and merged
by reciprocal rank fusion. It is built for *documents*: text cut into chunks,
every chunk treated the same. Solutions are different: short, structured,
and asked about in a different voice from the one they were written in. So we
reuse the two engines and change what goes into them and what happens after.

### What gets indexed (write side, in the background, once)

- **One solution is one unit, not chunks.** A record is a few hundred words;
  chunking it would split the symptom from its fix.
- **Two sides, weighted differently.** The *question side* (problem +
  symptoms) is what a junior's message resembles; the *answer side* (cause +
  fix) matters less for matching. The question side gets the vector and the
  heavier keyword weight.
- **Error signatures.** Error text is the strongest clue in troubleshooting,
  and it is noisy (paths, line numbers, ids, timestamps). At capture we pull
  out the error lines and normalise them (`File "/home/priya/..." line 88` →
  `File "<path>" line <n>`; hex ids and numbers → placeholders). The result is
  stored as an exact-match `signature` column with a DB index. A pasted stack
  trace that matches a stored signature is usually the answer, without any
  embedding.
- **"How would someone ask this?"** The cheap model writes 3–5 alternative
  phrasings at capture ("worker not picking jobs", "celery stuck after
  release", …), embedded in one batched call. This is paid once per solution
  and fixes the main failure of short records: the asker uses words the author
  never did.

### What happens on a search (read side, per `search_solutions` call)

1. **Filter first.** Org + status (`active`, `needs_check`) are applied
   *before* ranking. The per-org index makes this physical (§3a).
2. **Understand the query, without a model.** Regex pulls error signatures
   and version strings (`django 5.1`) out of the message. A long paste is cut
   to its signature plus the first few hundred characters for embedding.
3. **Three candidate lists in parallel:** exact signature match (DB, ~ms),
   keyword top 20, vector top 20 (question side + phrasings).
4. **Fuse** with the existing RRF. A signature hit gets a fixed boost on top,
   because an exact error match beats any similarity score.
5. **Re-score the top ~10** with what only solutions have:
   - *track record*: confirmations vs failures, as a Wilson lower bound so
     1-of-1 does not beat 9-of-10;
   - *environment match*: the asker's versions vs the solution's;
   - *freshness*: a small penalty only. Stale solutions are **labelled, not
     hidden**, because an old fix with a warning beats no fix (§5).
6. **Collapse supersede chains.** Return the newest in a chain and note that
   an older one exists.
7. **Abstain.** If the best score is under a threshold, answer "no team
   solution matches". A wrong solution cited with a name and date on it is
   worse than none. The threshold is set from the evaluation set below, not
   guessed.
8. **Return top 3**, compact, each with a freshness label per claim and an id
   for `get_solution`.

A model-based reranker (cross-encoder or LLM) is **not** in v1. It gets added
only if the evaluation shows the top results are often in the wrong order,
and then only when the top scores are close.

### Keeping it fast and small

- **No cost before the model starts.** Search runs only when the model calls
  the tool. The optional nudge (§7) uses signature + keyword only, with no
  embedding call.
- **Skip the vector search when a signature matches with high confidence**;
  otherwise it costs one embedding call (~100–300 ms). Query embeddings are
  cached by normalised text for an hour.
- **Memory is the real limit.** 2048-dim float32 is 8 KB per vector; 10,000
  solutions × 5 phrasings would be ~400 MB, more than the whole 384 MB backend
  container. Options, to measure in S1 before choosing: (a) fewer dimensions,
  if the embedding model supports shortened output (check this; don't assume
  it); (b) float16 / product quantisation in FAISS; (c) keep vectors in
  Postgres rather than a memory-resident pickle. Per-org indexes load lazily
  and are evicted least-recently-used.
- **Target:** under 300 ms at p95 for `search_solutions`, measured with the
  same `[Latency]` log line style the rest of the app uses.
- **When the embedding API is down**, signature + keyword search still work
  and the result says "semantic search unavailable". This matters because the
  embedder is a remote NVIDIA model whose predecessor was retired on
  2026-08-25.

### How we know it is useful

- **Offline set.** For each saved solution, the judge model writes junior-style
  questions (drafts, reviewed on `/evals`, as with eval cases), plus questions
  that have **no** answer in the store. Measured: recall@3, MRR, and abstain
  accuracy (no-answer questions must return nothing). Re-run on every change
  to ranking, the same way the benchmark suites are run.
- **Online signals.** Share of searches with a hit; share of hits the answer
  actually cites; confirmations vs failures after use.
- **Missed-retrieval detector.** When capture finds a near-duplicate that
  already existed before the conversation began, and the conversation never
  surfaced it, that was a miss. We log the query and the missed solution, and
  the entry goes into the offline set. This is how the system tells us where
  its search is weak, without anyone labelling data.

## 8. Build order

| Phase | What | Done when |
|---|---|---|
| **S0** | `Organization`, `Membership(role: owner/admin/member)`, invite by email, org switcher in settings, `org` on `ChatSession` and `SubAgent`. In `core/` (foundation). Solo users keep working with no org | A user can create an org and invite someone; removing them cuts access on the next request |
| **S1** | `solutions/` app, `Solution` model, hidden org KB, `search_solutions`/`get_solution`/`save_solution` tools, the prompt rule | A person can say "save this as a solution" and a teammate finds it by asking |
| **S2** | Automatic capture (§6) from thumbs-up, "that worked", and completed fix runs | A solved chat becomes a saved solution with no action |
| **S3** | Claim kinds, freshness labels, re-verify-or-warn rule, supersede, confirm/failure loop | A 60-day-old `time_sensitive` claim is verified or flagged, never stated flat |
| **S4** | `/solutions` page: org library, "needs check" queue, edit, retract, who solved what; solution cards in chat | An admin can see and fix what the org knows |
| **S5** | Benchmark suite `solutions`: capability (retrieve and adapt), guardrails at 100% (no cross-org leak, no capture from a tainted turn, no secret in a saved record, stale claim never stated flat) | Suite green |

S0–S1 are the demo-able slice; S2 is where it feels like magic; S3 is what
makes it trustworthy.

## 9. Decisions needed from the user

1. ~~Build the organisation model now?~~ **Settled 2026-09-28: yes.** Sharing
   happens only within one organisation, with no leaks out of it (§3a). This
   reverses the 2026-08-14 "company-wide context out of scope" decision.
2. ~~Share immediately or keep private?~~ **Settled 2026-09-28: the person
   chooses per chat.** Every chat in an org has a "share solutions" switch;
   it starts at the org's `share_by_default` (on unless an admin turns it
   off). Off, fixes from that chat are saved privately.
3. ~~Who may edit or retract?~~ Built as recommended: the author and org
   owners/admins edit, share and retract; every member can say worked / didn't
   work and flag a solution as doubtful.
4. **Added 2026-09-28: the orchestrator may doubt a past solution.** On
   analysis it can mark a fix "doubtful" with a reason (`review_solution`),
   shown to everyone who finds it and lowering its rank. Each review records
   which model made it, so as models improve a later one can raise or clear
   the doubt.

## 10. Risks, stated

- **Poisoned knowledge spreads.** One bad or malicious record reaches every
  teammate's agent. Mitigations: provenance guard at capture, results framed
  as evidence, reader's gates still apply, failures demote, admins retract.
  Add to `SAFETY_AND_GUARDRAILS.md` when S2 lands.
- **Privacy.** A chat may contain things the author would not share.
  Mitigations: a record, not a transcript; redaction; undo; decision 2.
- **Confidently stale answers.** The whole of §5 exists for this.
- **Cost.** One cheap-model call per candidate turn, most stopping at step 1.
  Measure in S2 before turning on for everyone.

## 11. As built (2026-09-28)

- **No hidden KB.** §4 said one hidden `inference` KB per org. Built instead:
  the `solutions` app keeps its own three small indexes
  (`SolutionSignature`, `SolutionTerm`, `SolutionVector`). A KB belongs to a
  user, shows in pickers, and its FAISS index lives in memory; an org's
  library needs none of that, and keeping it out of `inference` keeps the
  org boundary in one app.
- **Vectors are float16 rows in the database** (§7a option c), loaded per
  scope on demand, four scopes cached, and always filtered by the live
  visible-id set. So a stale cache can never show a removed member anything.
- **Agent runs search only their owner's personal solutions.** `org_id` is
  carried on `TurnContext`, and only chat sets it. Giving agents (and
  delegated workers) the org scope is the next step.
- **Capture triggers:** a thumbs-up, or the person's next message saying it
  worked (a regex, no model cost). The "completed fix run" trigger is not
  built.
- **The `/solutions` page** has browse, search, review, flag, share and
  remove. It has no editing form yet (the API supports `PATCH`).
- **Thresholds are first guesses** (`search.py` constants). S5's offline set
  is what should tune them.
- **The capture model is a platform setting** (`SOLUTION_CAPTURE_PROVIDER` /
  `_MODEL`, default: the context-summary pair on the platform key). The
  per-org provider choice in §3a item 7 is not built.
- **Side doors (§3a item 5)** hold by construction rather than by refusals:
  solutions are not files, KB rows or agent config, so publishing, pages,
  templates and eval worlds have no path to them. The tools are withheld in
  eval worlds (they are not in `EVAL_SAFE_ALWAYS`).
