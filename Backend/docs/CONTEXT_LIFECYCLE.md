# Context lifecycle

How a long agent run stays inside its model's context window: what it keeps,
what it drops, how it gets any of it back — and what it is allowed to pull in
to begin with.

The three toggles in the agent builder — **Auto-compact history**
(`compaction`), **Smart summarization** (`recursiveContext`) and **Save and
recall** (`indexing`) — feed the curation policy below.

## Shape

```
tools ──▶ curate ──▶ steering ──▶ agent ──▶ (tools | END)
            │
            ├── compaction   results → records          (free)
            ├── fold         oldest steps → one note    (one cheap model call)
            └── archive      everything removed → ToolOutput
                                                  ▲
                          recall_context / read_tool_output
```

`chat/turn/curation.py` decides; `chat/turn/agent.py::curate_node` applies;
`llm/budget.py` does the arithmetic and owns the notion of a segment;
`chat/tools/tool_output.py` stores and searches.

**It edits state, not the wire.** `curate_node` returns replacement messages
carrying the ids they replace, so `add_messages` substitutes them in the
checkpoint, and `RemoveMessage` for what is folded away.

**Segments, never messages.** An assistant turn carrying `tool_calls` and its
`tool` messages are one indivisible unit. Everything moves in segments:
`llm.budget.Segment` for wire dicts (used by `clamp_input`),
`curation._Segment` for LangChain messages. Ids cannot survive a
messages → wire → messages round trip, and the id *is* the mechanism.

**A watermark, not a trickle.** Nothing happens until the projected request
crosses `CONTEXT_HIGH_WATER_RATIO` (0.70) of the budget; then enough is cut
to reach `CONTEXT_LOW_WATER_RATIO` (0.45) in one pass. Shaving a little
every turn would rewrite the prefix on every call and forfeit provider prefix
caching. Between watermarks the prefix is byte-identical.

**The last three segments are never touched** (`CONTEXT_KEEP_RECENT_SEGMENTS`).
Counted in segments so one oversized recent result cannot push whole turns out
of view. A model that cannot see what it just did, does it again.

## The three mechanisms

### compaction — mechanical, free

An old tool-calling turn keeps its reasoning and the *names and arguments*.
Each result over `CONTEXT_TOOL_RECORD_CHARS` (400) is replaced by a record:

```
[COMPACTED RESULT] web_search({"query": "q3 revenue"})
The quarterly revenue figure was 4.8 million…
[... 29,600 characters removed to stay inside the context window. archived as
tool_output id 'a1b2c3d4' — call recall_context or read_tool_output to read it.]
```

What each step *did* stays legible; what it *returned* becomes a pointer. No
model call, so this runs first and usually suffices.

### recursiveContext — one cheap model call per fold

When compaction alone cannot reach the low mark, the oldest segments fold
into a single running note (`[EARLIER WORK IN THIS RUN — SUMMARY]`), appended
as a `SystemMessage`. The previous note is always absorbed into the new one,
including when it sits in the protected tail. **There is exactly one note.**

**Which model folds.** Three levels, each narrower than the last:

1. the agent's own `summaryModel` / `summaryProvider`, chosen in the builder
2. the platform default — `nvidia/nemotron-3.5-lightning-30b-a3b` on NVIDIA
   (the provider the platform ships a key for, so the fold works on a fresh
   install)
3. the run's own model, as a last resort

Level 3 is also a *runtime* fallback: if the chosen model raises
`LLMUserActionable` (no credential, no credit, retired), the fold is retried
once on the run's own model. A fold that silently stops working is worse than
one that costs a little.

It is not the agent's own model by default because the fold is an extractive
job a larger model is not better at. Its tokens are added to `total_tokens`,
so the fold counts against the run's spend cap.

### indexing — what makes the other two safe

Everything the other two remove is written to `ToolOutput` first — the same
table, retention and ownership rules as an oversized tool result. The record
left behind names the id.

With indexing **off**, the notices say so explicitly (`not archived, so the
removed text is gone`) rather than point at an id nobody wrote.

Retrieval is `recall_context(query)` — keyword search over everything this
run stored, returning windows with ids — and `read_tool_output(id, offset)` to
page any of them in full. Both are in `RETRIEVAL_TOOLS`: **dispatchable
always, offered only once the run has stored something**. The condition is a
database read; a model that names a tool offered a moment ago must not be
turned away because a row expired in between.

## What is recorded

A curation pass is not an `AgentTurn` (`(execution, index)` is unique, and a
curation has no place in the model's turn numbering). Instead:

- `AgentRunStream.on_curation` broadcasts `context_curated` on the execution
  channel (before/after tokens, what was compacted, what was folded)
- the run's totals land in `ExecutionLog.output_data['context_curation']`,
  only when a pass actually happened

Curation that leaves no trace is indistinguishable from a model that quietly
forgot.

## Acquisition: what a run may pull *in*

Retention is half of context management; the other half is what reaches the
window in the first place.

### Knowledge bases

`knowledge_base_search` resolved to a scope, built like `FileScope` and
carried the same way: `kb_scope_for(gathered)` → `TurnContext.kb_scope` → the
tool context → every KB tool. Three rules:

- **`None` is unrestricted, and an empty selection is `None`.** Chat has no
  selection to make, and an agent built before enforcement never had one
  applied.
- **No `kb_id` resolves within the scope**: the single KB if there is one,
  otherwise a request to name one. Never the user's default.
- **All five tools, including `read_document`** — it addresses a *document*
  id, not a KB.

The prompt carries id, backend and doc count per KB: the id is what the tools
take, and the backend decides which tool can read the KB at all (a semantic
search against a keyword-only index returns *nothing*, not an error).
`GRANT_TOOLS['rag']` unlocks all five.

### Delegation

Results have always been bounded; instructions were not — and instructions
multiply by worker count. Three additions (`agents/agent/orchestrator.py`):

- `check_delegation_payload` caps task length (`DELEGATION_TASK_CHAR_LIMIT`),
  briefing length and worker count (`MAX_WORKERS_PER_FANOUT`). **Refused, not
  truncated** — a trimmed instruction is a worker doing the wrong job, and the
  author is a model that can shorten and retry. Refused before any worker
  starts.
- **`briefing`** — one shared block sent to every worker once, instead of the
  same background pasted into all N tasks. It lands in the worker's system
  prompt as *context, not instruction*.
- **Read-through to the parent's archive.** `TurnContext.archive_scopes`
  carries the parent's session key, one hop, read-only;
  `recall_context` / `read_tool_output` search it alongside the worker's own.
  Without it, the parent curates a detail away, delegates a task needing it,
  and the worker — a fresh thread — cannot reach the text.

## Chat

**Earlier turns come from the database, and only from there.** Chat history is
bounded by `HISTORY_WINDOW` (20 *messages*, about 10 exchanges); long answers
by `context_summary`. `run_turn(fresh_transcript=True)` clears the
checkpoint's messages at the start of each new chat turn (never on a resume,
so approvals still resume). When the budget forces `to_wire_history` to drop
the oldest window messages, the per-turn context update says how many.

**Across turns, the conversation keeps notes.** After each reply, a
background job (`chat/turn/session_notes.py`) files the exchange into a task
and rewrites the conversation's notes file
(`/Chat/Conversations/<title> (<first 8 chars of id>).md`): summary, decisions, open
questions, a task index with message ids, free notes, and the tools that
fetch more. The next turn reads that file first, then the current task's
messages in full plus a short tail; older tasks are rows the model opens with
`open_conversation_task`. Within a run the transcript is curated (above);
across turns the conversation is indexed. Neither replaces the other.

**Chat curates too, but only for free.** As the orchestrator one chat turn
can run many iterations, so it passes `curation.CHAT_POLICY`: `compaction`
and `indexing` on, `recursive` off (the fold is a paid model call on a path
the user is watching, and chat has no builder toggle through which anyone
chose to pay it). `recall_context` and `read_tool_output` appear once the
session has archived something. The agent runtime builds its policy from
`SubAgent.runtime_settings`. Callers differ in configuration, never in code
path.

Tests: `chat/tests/test_chat_transcript.py` (what reached the provider on
turn 3; the iteration budget; a long turn compacting).

All three toggles off is a request to be left alone and is honoured: the run
falls back to `clamp_input` alone — now segment-aware, so "off" means the
old behaviour minus the 400, not an unbounded window.

## Settings

| Name | Default | What it does |
|---|---|---|
| `CONTEXT_SUMMARY_PROVIDER` | `nvidia` | Provider for the fold when the agent names none |
| `CONTEXT_SUMMARY_MODEL` | `nvidia/nemotron-3.5-lightning-30b-a3b` | Model for the fold; the agent's `summaryModel` overrides it |
| `CONTEXT_HIGH_WATER_RATIO` | 0.70 | Of the input budget: start curating |
| `CONTEXT_LOW_WATER_RATIO` | 0.45 | Of the input budget: cut back to here |
| `CONTEXT_KEEP_RECENT_SEGMENTS` | 3 | Never curated |
| `CONTEXT_TOOL_RECORD_CHARS` | 400 | Survives in a compacted record |
| `CONTEXT_SUMMARY_TARGET_WORDS` | 250 | Target length of the note |
| `RECALL_MAX_MATCHES` / `RECALL_SNIPPET_CHARS` | 3 / 1500 | `recall_context` output bounds |

The ratios and char limits live in `workflow_backend/thresholds.py`; the two
model settings in `workflow_backend/settings/base.py`.

## Across turns: what is cached

A chat turn's request is cached by the provider only as far as its bytes stay
the same from one turn to the next, so the order is fixed:

1. **Stable first**: the system prompt, the replayed history (its start moves
   only in steps of `HISTORY_WINDOW_STEP`, 10), and the upload pointers.
2. **Volatile last**: the conversation notes, the current state, the plan and
   the budget. These change every turn, so they go after everything cached.

Raw attachments ride on the user's question inside history after the first
pass (`agent.py::_seat_attachments`, for openrouter, openai and nvidia), so
their bytes sit in the cached prefix. Nothing volatile may be inserted before
the history.

## Tests

`chat/tests/test_curation.py`, grouped by the mistake each pins:

- **`OrphanedToolResultTests`** — trimming never leaves a result without its
  call, something is actually dropped, and tool-call arguments are counted
- **`SegmentTests`** — a turn and its results group as one; two results for
  one turn stay together; an orphan attaches rather than standing alone
- **`CurateTests`** — compaction keeps the call and shrinks the result; the
  recent tail is untouched; indexing on archives and names the id, off
  admits the loss; a fold removes by id and leaves exactly one note; a
  previous note is absorbed; a failed fold changes nothing; a second pass
  does not re-archive
- **`RecallTests`** — another user's and another run's archives are
  unreachable
- **`NoteReachesTheWireTests`** — `to_wire` renders the note
- **`CurateNodeTests`** — chat is untouched, the fold is charged to the run,
  and a broken curator does not fail the run

`chat/tests/test_curation_e2e.py` drives the **real graph** for twenty
tool-calling turns against a stub provider. No request exceeds the budget,
no request orphans a `tool_call_id`, a fact planted in turn 2 is still
reachable through `recall_context` at turn 20, and a short run is untouched.
One test runs with curation off and asserts the transcript *would* have
overflowed, so the others cannot pass vacuously.

`chat/tests/test_context_acquisition.py` covers the other half: the KB scope
(including that `read_document` cannot be used around it), the prompt
carrying ids and backends, the full `rag` grant, the delegation payload
bounds, the briefing, and the worker's read-through to its parent's archive.

Plus `agents/tests/test_agent_runtime.py::RetrievalToolAdvertisementTests`
for withheld-until-stored, and `GrantMappingTests` for why the retrieval pair
is not grant-gated.
