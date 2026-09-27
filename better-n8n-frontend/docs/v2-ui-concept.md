# v2 — Product & UI Direction

**The reframe:** v1 was a workflow automation tool where the user authored a DAG
and the system executed it. v2 is an **agent console** where the user states an
intent, an agent decides the plan at runtime, and the user watches, steers, and
approves.

**The key finding:** the backend already made this pivot. `chat/graph.py` and
`imagine/agent/graph.py` are LangGraph `StateGraph`s. `orchestrator.HITLRequest`
is a durable model. `executor/king.py` has `pause()`/`resume()`.
`streaming/consumers.py` has an `HITLNotificationConsumer`. `mcp_integration/`
is the tool substrate.

The frontend is what's still in the DAG era. v2 is largely **building the client
the backend already deserves**, not building a new platform.

## The one idea that drives everything

Because the agent decides the plan at runtime, **the canvas stops being an editor
and becomes a viewer.**

Nobody drags nodes. They state an intent, watch it unfold, and intervene when
asked. Every layout decision below follows from this.

## Information architecture

Fifteen flat destinations become four groups, ordered by frequency of use.

```
  WORK              BUILD          IMPROVE        DATA
  ─────             ─────          ───────        ────
  Ask   ← home      Agents         Evals          Documents
  Runs              Extract        Datasets       Data sources
  Inbox ⑶           Skills         Tuning         Connectors
                    Studio                        MCP Servers
                                                  Credentials
```

**Three of the four practical apps are not new destinations** — they're existing
surfaces doing more work:

| Practical app | Where it lives | New build |
|---|---|---|
| Corpus-wide document Q&A | **Ask**, scoped to Documents | Scope picker + citations |
| Ask-your-data analysis | **Ask**, with a data source attached | Sandbox result rendering |
| Scheduled / watching agents | **Agents**, as trigger config | Schedule editor + next-run list |
| Document → structured extraction | **Extract** — genuinely its own surface | Pipeline + review queue |

This matters for scope: adding four use cases costs roughly one and a half new
screens, because Ask was always meant to be the universal entry point.

| v1 | v2 | Change |
|---|---|---|
| Workflows, WorkflowEditor, Templates | **Agents** | DAG authoring → agent definitions + presets |
| AI Chat | **Ask** | Becomes the home surface |
| Logs, Executions, Insights | **Runs** | Unified into the trace view |
| *(nothing)* | **Inbox** | New. The HITL surface. |
| Imagine | **Studio** | Media, agent-driven |
| Connectors, MCP, Credentials, Documents | unchanged | Worth *more* under agents, not less |

`WorkflowEditor.tsx`, `src/nodes/`, and ReactFlow-as-editor are what actually get
retired. The tool/credential/MCP layer is the moat and it already exists.

## Visual direction — simple & organic

Built and running: **`docs/prototype/index.html`** — open it in a browser, no build
step. Six screens, clickable nav.

The feeling to hit: made by a person who likes simple, modern design — not
assembled from a component library. Warm rather than clinical, quiet rather than
loud. Colour is *earned*: it marks one primary action and real status, nothing
else. That's not just taste — users read long agent traces, and a loud UI is
exhausting after two minutes.

**No pure black, no pure white, no default blue.** Those three choices are most
of what makes software look machine-made.

| Token | v1 | v2 | Why |
|---|---|---|---|
| background | `0 0% 100%` white | `40 30% 97.5%` warm paper | Cards can be near-white and *lift*. White-on-white is why v1 cards need heavy borders. |
| primary | `217 91% 60%` vibrant blue | `152 26% 30%` moss | Every SaaS tool is blue. Deep muted green reads calm and organic, and survives being used sparingly. |
| text | `222 84% 4.9%` near-black | `28 12% 16%` warm ink | Pure black on white is a screen-only artefact; warm dark ink is what ink actually looks like. |
| border | `214 32% 91%` | `38 18% 89%` warm | Soft warm-tinted shadows carry separation; lines are the fallback. |
| radius | `1rem` flat | `14px` card / `10px` control / `7px` chip | A three-step scale reads considered; one uniform radius reads soft-toy. |
| type | Inter only | **Fraunces** display + **Inter** UI | A serif with soft/wonk axes for headings is the single strongest "human made this" signal. |

Status colours are drawn from the same warm family — amber `32 68% 42%`, clay
`8 52% 45%` — never stock red/green/yellow.

**Paper grain.** A fixed SVG `feTurbulence` layer at 4% opacity over everything.
Nearly invisible, and it's what stops large flat areas feeling like dead pixels.
One CSS rule, no asset.

**Deliberate exception:** the Studio canvas stays dark. Maximum contrast is
correct where you're judging an image. Focused modes get their own rules.

## Surfaces

### 1. Ask — the front door

Perplexity's *answer surface*, not its *object model*. Perplexity is bounded and
ephemeral (query → sources → answer). Agent runs are long, stateful,
side-effecting, and resumable — so the unit here is a durable **Run**, not a chat
message. You can close the tab and come back.

The pattern that transfers perfectly: **source chips become tool-call chips.**
Perplexity cites where a fact came from; we cite what the agent *did* to get it.

```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│              What should we automate today?                │
│                                                            │
│   ┌──────────────────────────────────────────────────┐     │
│   │ Summarize this quarter's invoices and email me…  │     │
│   │                                          ⊕   ↑   │     │
│   └──────────────────────────────────────────────────┘     │
│                                                            │
│   Try:  ▸ Audit my Drive   ▸ Draft outreach   ▸ Clip reel  │
│                                                            │
├────────────────────────────────────────────────────────────┤
│  ◐ Working · 4 steps · 00:12                    [ Trace ]  │
│                                                            │
│  I found 34 invoices this quarter totalling ₹12.4L.        │
│  Three are overdue by more than 30 days.                   │
│                                                            │
│  ⟨ ▦ Gmail · 34 results ⟩ ⟨ ⬡ Parse · 34 ⟩ ⟨ ▤ Sheet ⟩     │
│                                                            │
│  I need approval before emailing 3 vendors.  [ Review ]  │
└────────────────────────────────────────────────────────────┘
```

Answer streams first; tool chips sit beneath it and expand to raw I/O on click.
Transparency is available, never mandatory.

### 2. Runs — trace timeline primary

Agent runs are trees with retries and parallel subagents, not clean DAGs. A trace
shows *what happened, when, how long, where it failed*; a graph shows structure.
Every agent-observability tool converged on traces for good reason — they stay
legible at 200 steps, and they don't reflow the canvas every time a node appears.

```
┌──────────────────────────────────┬─────────────────────────┐
│  Invoice summary       ● Running │  Step detail            │
│  00:12 · 4 steps · 1 pending     │  ─────────────────────  │
│  ────────────────────────────────│  ⬡ Parse PDF            │
│  ▦ Fetch Gmail  0.8s ▏  │  │
│  ⬡ Parse PDF  3.2s ▏▏▏ │  Input  │
│    └ ↻ retry ×1         1.1s  ▏  │  { "file": "inv_08…" }  │
│  ▤ Append to Sheet  0.4s ▏  │  │
│  ◐  Draft emails  …  │  Output  │
│  └  awaiting approval  │  { "vendor": "Acme",  │
│                                  │    "amount": 48200 }    │
│  ────────────────────────────────│                         │
│  [  Graph ]  [ ⏸ Pause ]  │  Retried: timeout  │
└──────────────────────────────────┴─────────────────────────┘
```

Rows stream in and never reorder. Bars show duration. Retries nest under their
parent. `[  Graph ]` toggles the secondary view for run *shape* — same data,
laid out as a graph, for when structure is the question.

### 3. Inbox — HITL

The differentiator. Autonomy is only useful if it's safe, and it's only safe if
a human can be pulled in at the right moment. The backend model exists; this is
the product around it.

An approval card must carry enough context to decide in five seconds — what the
agent wants to do, why, what it's based on, and what happens if you ignore it.

```
┌────────────────────────────────────────────────────────────┐
│  Inbox                                       3 pending     │
├────────────────────────────────────────────────────────────┤
│  ╭──────────────────────────────────────────────────────╮  │
│  │  Send 3 payment reminder emails  │  │
│  │    Invoice summary · 2 min ago · expires in 58 min   │  │
│  │                                                      │  │
│  │    To:  Acme ₹48,200 · Baxter ₹12,000 · Cole ₹9,400  │  │
│  │                                                      │  │
│  │    "Hi — our records show invoice #4471 is 34 days   │  │
│  │     overdue. Could you confirm payment status?"      │  │
│  │                                        [ view all ]  │  │
│  │                                                      │  │
│  │    [ Approve ]  [ Edit first ]  [ Reject ]           │  │
│  ╰──────────────────────────────────────────────────────╯  │
└────────────────────────────────────────────────────────────┘
```

Non-negotiables: a visible **expiry/escalation** policy (silence is a decision —
say which one), **Edit first** (approve/reject alone forces restarts), and an
audit trail of who approved what.

### 4. Studio — agent-driven media with manual touch-up

Agent does the heavy lifting; you fix the last 10% by hand. Crop, trim, and text
overlay only — deliberately *not* a timeline/layers editor. Extends `imagine/`,
which already has `Generation`, an agent graph, and an `hitl_gate`.

```
┌────────────────────────────────────────────────────────────┐
│  Studio                                        ⟲  ⟳   ⤓    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                                                      │  │
│  │                  [ preview ]                         │  │
│  │                                                      │  │
│  └──────────────────────────────────────────────────────┘  │
│  ├──────●───────────────────────────────────────┤  00:14   │
│                                                            │
│  ⊹ Crop  Trim  T Text  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Make it 30 seconds and add captions…            ↑    │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

The prompt bar is primary; manual tools are a thin strip above it. Every agent
edit is a reversible step in the same history stack as manual ones.

### 5. Extract — documents to structured data

The one practical app that earns its own destination. Definition on top, review
queue below. The review pane is the whole point: **document left, fields right,
and clicking a field highlights the region it came from.** Without that link,
verifying an extraction is slower than doing it by hand.

```
┌────────────────────────────────────────────────────────────┐
│  Extract › Vendor invoices                   ▶ Run    ⋯    │
├────────────────────────────────────────────────────────────┤
│  Source   ▦ Drive / Invoices           34 new documents    │
│  Fields   vendor · invoice_no · date · amount · due_date   │
│  Output   ▤ Sheets › Q3 Payables                           │
├────────────────────────────────────────────────────────────┤
│  Review                          31 confident · 3 to check │
│  ┌──────────────────┬─────────────────────────────────────┐│
│  │  │  vendor  Acme Supplies  ││
│  │  [ page 1/2 ]  │  invoice_no  4471  ││
│  │  │  date  2026-05-12  ││
│  │  ░░░░░░░░░░░░  │  amount  48,200  61%  ││
│  │   ░░░▓▓▓▓░░░░░ ←─┼──            ↳ "4B,2OO" unclear     ││
│  │  ░░░░░░░░░░░░  │  due_date  2026-06-11  ││
│  └──────────────────┴─────────────────────────────────────┘│
│                     [ Confirm ]  [ Fix ]  [ Skip ]    1/3  │
└────────────────────────────────────────────────────────────┘
```

Only low-confidence rows enter the queue — 31 of 34 never bother the user. The
review queue and the Inbox share one card language; this is just a typed variant.

### 6. Ask, with data attached

Analysis is not a separate screen. Attach a CSV or data source in Ask and the
answer arrives with a chart. **Answer first, chart second, code collapsed but one
click away** — "Show code" is the trust mechanism, and it's what makes a number
citable rather than merely plausible.

```
┌────────────────────────────────────────────────────────────┐
│  ◐ Working · analysing sales.csv                 [ Trace ] │
│                                                            │
│  Revenue grew 18% QoQ, driven almost entirely by the       │
│  North region. South declined for a third straight quarter.│
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │   ▁▂▃▅▆█   North                                     │  │
│  │   ▃▃▂▂▁▁   South                                     │  │
│  │   Q1  Q2  Q3  Q4                                     │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ⟨ ▤ sales.csv · 12,480 rows ⟩   ⟨ ⌁ python · 0.9s ⟩       │
│                                                            │
│  ▾ Show code                                               │
│      df.groupby(['quarter','region'])['revenue'].sum()     │
└────────────────────────────────────────────────────────────┘
```

Corpus Q&A is the same surface with a different attachment: scope to Documents
and the tool chips become citations.

### 7. Improve — Evals, Datasets, Tuning

**Evals is the money screen.** It makes the honest argument visually: put every
variant side by side and let the numbers decide. Note what the mock shows — the
tuned model doesn't win on accuracy alone, it wins on **cost and latency**, which
is the real reason to tune.

```
┌────────────────────────────────────────────────────────────┐
│  Evals › Invoice extraction             ▶ Run comparison   │
├────────────────────────────────────────────────────────────┤
│  Dataset   120 examples · 89 captured from Inbox decisions │
│                                                            │
│  Variant                Accuracy   Cost/1k    p50          │
│  ────────────────────────────────────────────────────────  │
│  ● Base prompt             71%      $2.40    1.2s          │
│  ● + few-shot              84%      $3.10    1.4s          │
│  ● + RAG                   88%      $3.60    2.1s          │
│  ○ Fine-tuned 4o-mini      91%      $0.40    0.6s          │
│                                    ↑ best cost & latency   │
│                                                            │
│  ▸ 14 examples where RAG wins but tuned fails              │
└────────────────────────────────────────────────────────────┘
```

**Datasets** makes the flywheel legible — the user can see their own review work
turning into training data:

```
┌────────────────────────────────────────────────────────────┐
│  Datasets › Invoice extraction    120 examples   [+] [ ⤓ ] │
├────────────────────────────────────────────────────────────┤
│  Source                             Count   Label          │
│  ────────────────────────────────────────────────────────  │
│  Inbox · approved  67  positive  │
│  Inbox · edited before approving  22  correction  │
│  Inbox · rejected  9  negative  │
│  ⤒ Uploaded manually                  22    mixed          │
└────────────────────────────────────────────────────────────┘
```

**Tuning** is premade recipes, each showing whether it has enough data yet —
"Collect" rather than "Start" when it doesn't. The guardrail against the
knowledge-injection misconception lives in the UI itself, at the moment of
confusion:

```
┌────────────────────────────────────────────────────────────┐
│  Tuning                                                    │
│  ╭────────────────╮ ╭────────────────╮ ╭────────────────╮  │
│  │ ⬡ Extraction  │ │ ▤ Classify  │ │  House style  │  │
│  │ Docs → fields  │ │ Route & tag    │ │ Tone & format  │  │
│  │ 120 ex. ready  │ │ 40 ex. needed  │ │ 8 ex. needed   │  │
│  │ [ Start ]      │ │ [ Collect ]    │ │ [ Collect ]    │  │
│  ╰────────────────╯ ╰────────────────╯ ╰────────────────╯  │
│                                                            │
│  ⓘ Tuning teaches form, not facts. To make an agent know   │
│    your content, add it to Documents — Evals will compare  │
│    both so you can see which actually wins.                │
└────────────────────────────────────────────────────────────┘
```

### 8. Schedules — a tab on Agents, not a destination

"Watching" agents are a trigger configuration plus a next-run list. What makes
the interface trustworthy is showing **when it will next fire and what it did
last time** — an agent running unattended is only comfortable if its history is
one glance away.

```
   Agent › Weekly payables digest      ● Active   [ Pause ]
   ────────────────────────────────────────────────────────
   Trigger    ◷ Every Monday, 09:00 IST
   Next run   Mon 3 Aug, 09:00  ·  in 4 days
   ────────────────────────────────────────────────────────
  Mon 27 Jul  09:00  34 invoices · 3 approvals  [trace]
  Mon 20 Jul  09:00  28 invoices · 0 approvals  [trace]
  Mon 13 Jul  09:00  failed · Drive auth expired [trace]
```

### 9. Tools — Connectors and MCP, merged

**Decision: one destination, not two.** From the agent's side there is no
difference between a first-party connector and an MCP server — both are sources
of tools. The user's question is never "what MCP servers do I have?", it's *"can
my agent read my email?"*, and a split forces them to check two places.

The strongest argument is permissions: every tool needs an
`always / ask first / never` policy, and "ask first" is exactly what generates a
HITL request. Split across two pages, that policy has two homes and the Inbox has
two upstreams. Merged, **Tools becomes the one place you decide what your agents
may do unsupervised.**

Merging the *list* doesn't flatten the *detail*. MCP servers keep a drill-in for
transport, health, and tool inventory — because a remote MCP server **can change
what it exposes after you've trusted it**, and silently granting an agent two new
tools is a genuine security problem. Connectors never need that. Differences like
this belong in detail, not navigation.

Credentials stays separate: "what's expiring, who authorised it, rotate it" is a
real standalone task with an audit flavour.

## Patterns that repeat

Design these once; they carry most of the app.

| Pattern | Appears in | Rule |
|---|---|---|
| **Review card** | Inbox, Extract review | Enough context to decide in 5s; always a third option between approve and reject (`Edit first` / `Fix`). |
| **Tool chip** | Ask, Runs, analysis | `⟨ icon · source · result-count ⟩`. Click expands raw I/O. Transparency available, never mandatory. |
| **Trace row** | Runs, schedule history, evals | Streams in, never reorders. Duration bar. Retries nest under parent. |
| **Confidence** | Extract, Evals, Inbox | Never a bare number — always paired with *why* and the source region. |
| **Empty state** | Everywhere | Illustration, one sentence, one primary action. Most-neglected surface, sets the tone. |

The Inbox review card and the Extract review card are the **same component** with
different payloads. If they drift apart, the design has failed.

## Design order

Interface-only sequencing. Each step is mockups and component specs, not code.

| # | Design | Why here |
|---|---|---|
| 1 | Tokens + primitives — `Button`, `Card`, `Table`, `Badge`, `Dialog` | 20 pages share only 5 primitives today. Everything below assumes these exist. |
| 2 | Shell + IA — sidebar groups, nav, routes | Cheap, and the whole app reads as new. |
| 3 | **Runs** — trace rows, duration bars, graph toggle | The new centre of gravity; Ask, Inbox, schedules and evals all reuse trace rows. |
| 4 | **Ask** — composer, streaming answer, tool chips | The front door. Absorbs corpus Q&A and data analysis. |
| 5 | **Inbox** — review card | Defines the card that Extract then reuses. |
| 6 | **Extract** — pipeline + review queue | Highest practical ROI; mostly assembles patterns 3 and 5. |
| 7 | **Improve** — Evals, Datasets, Tuning | Evals is the money screen. Datasets is a table. Tuning is recipe cards. |
| 8 | **Studio** + schedule tab | Deferrable without weakening the story. |

Steps 1–4 produce most of the perceived change. Steps 5–7 are where the product
becomes defensible.

Retired at step 2: `WorkflowEditor.tsx`, `src/nodes/`, ReactFlow-as-editor.
ReactFlow survives only as the secondary graph view in step 3.

## Positioning — against Perplexity Computer

Computer is a cloud agentic "digital worker": multi-agent, runs for hours or
months, ~400 connectors, delivered on desktop/mobile/Slack/M365.

The useful material is [its critical
review](https://www.builder.io/blog/perplexity-computer), which lists four
failures — and **all four are what this design already centres:**

| Their published failure | Our answer |
|---|---|
| "Everything happens in a cloud black box" | The trace view |
| Unsafe actions — "files appeared and disappeared with no local development step" | Inbox + per-tool `always / ask first / never` |
| "$200 in two days", endlessly pushing broken builds | Per-run budget with live burn-down |
| "OAuth tokens expired each session" | Credentials as its own surface, with expiry |

So the clone is a **positioning inversion**. Computer optimises for autonomy —
*give it a task and hope*. We optimise for legibility — *watch it work and steer*.
For businesses processing invoices and financial data, where a wrong action costs
real money, that's the better trade and it's defensible rather than a feature race.

**Two asymmetries worth using.** MCP means we inherit connectors from an
ecosystem rather than hand-building 400 flaky ones — their count is a cost centre,
ours is a dependency. And Computer is cloud-only: *documents never leaving your
infrastructure* is something they structurally cannot offer, plus fixed cost
instead of burning credits.

**Don't chase:** cloud VM per session, months-long runs, 400 connectors,
Slack/M365/mobile clients, browser automation. Each is capital-intensive and none
is where we win. Their headline feature — subagent spawning — is a documented
LangGraph supervisor/worker pattern, so it's cheap to add later; the expensive
part is fleet infrastructure, which we skip. Add it *after* the trace view exists,
or we ship their bug.

## Engineering notes — parked, not now

Recorded so they aren't rediscovered later. None block interface design.

- `chat/graph.py:18` uses LangGraph's `MemorySaver` — in-memory. Agent state
  dies on restart, which breaks any HITL approval answered hours later. Needs a
  Postgres checkpointer before the Inbox is real.
- `inference/apps.py:14` preloads a sentence-transformers embedder at startup.
  Inside a 600 MB-capped service on a 912 MB box, that's an OOM risk — move to a
  Celery worker or a hosted embedding API.
- Fine-tuning cannot run on this box. It orchestrates OpenAI/Gemini tuning APIs;
  the datasets and evals that would feed it are gone from the product.
- Deploy currently builds the untracked `AIAAS/Frontend/` copy, not this repo.
