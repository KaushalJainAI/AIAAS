# Engineering decisions

The problems in this project that took more than one attempt, what was
decided, and why. Each section links to the code and tests that hold the
decision in place. The last section is an honest account of where the
system stops scaling today. Why the detailed design history exists: see
CLAUDE.md, "Design history - search it, don't load it".

## 1. A production out-of-memory kill, and budgeting in megabytes

**Problem.** In 2026-09 the web server was killed by the kernel inside a
384 MB container. One chat turn asked all eight connectors which tools they
offered; each answer meant a cold `npx` start, two Node processes each. A
*count* cap on the session pool couldn't help — the processes that
exhausted memory didn't exist yet when the cap was checked.

**Decision.** Three fixes: **listing never starts a connector** (which tools
exist is a catalogue question, `MCPToolCatalogue`, served from the database;
a connector starts when a tool is *called*); **admission is by megabytes**
(`mcp_integration/supervisor.py` reserves an estimated footprint before
spawning, evicts idle sessions to make room, refuses cleanly when nothing
can be freed, then measures `/proc` so the next estimate is real); and
**half the processes** (`launch.py` rewrites `npx -y <pkg>` into a direct
`node` launch when the package is preinstalled).
**Degrades to permissive.** No `/proc` means falling back to counting; a
budget of 0 disables the ceiling. Losing the ability to measure must not
take away the ability to run.

Tests: `mcp_integration/tests/test_supervisor.py`, `test_listing_never_spawns.py`, `test_launch.py`.

## 2. Human approval that doesn't run anything twice

**Problem.** LangGraph's `interrupt()` pauses a run by discarding the node's
writes and *re-running the node from the top* on resume. If the tool node
checked permissions inline, a batch of calls would run the safe ones, pause,
and run them *again* on resume. Graph state rolls back; an email that was
sent doesn't.

**Decision.** The tool node runs in passes: settle every approval gate
first, then dispatch. Nothing leaves the process until every gate in the
batch is answered. The approval record (`HITLRequest`) is idempotent on
`(execution, call_id)`.

Approval is a **policy over the call, not a list of names**: connector tool
names are minted at runtime, so a name list can never contain them. A
credentialed connector call is gated unless its name starts with a read-only
verb — guessing "write" costs a click, guessing "read" sends the email.
Five autonomy levels exist because a system offering only "ask every time"
and "never ask" trains people to pick the second once; the middle level
gates on each tool's declared *effect* (`read | reversible | irreversible`),
not on its name.

Tests: `agents/tests/test_autonomy.py`, `chat/tests/test_permissions.py`.

## 3. Long agent runs inside a context window

**Problem.** An agent run resends its whole transcript every iteration. The
original trimmer dropped one *message* at a time and could remove an
assistant turn while keeping the `tool` results that answered it (a 400 from
the provider). It also counted only `content`, so the largest entries —
tool-call arguments — scored as zero.

**Decision.** The unit of trimming is the **segment** (an assistant
tool-call turn plus its results, indivisible). Curation fires at a
**watermark** (70% of the budget, cutting to 45%) rather than a little every
turn — rewriting the request prefix would forfeit provider prompt caching.
What is cut **stays reachable**: it is archived and the model gets a notice
naming an id it can fetch. The agent's **plan lives outside the
transcript**, in graph metadata (`chat/turn/todos.py`), which curation never
touches.

Tests: `chat/tests/test_curation_e2e.py` — twenty real turns through the
real graph against a stub provider.

## 4. Parallel tool calls, safely

**Problem.** Calls within one turn are independent — the model issues them
before seeing any result — yet they ran one at a time, so three web
searches took three round trips.

**Decision.** Safe calls run with `asyncio.gather`. Parallelism is an
**allow-list** declared per tool, because the unsafe cases can't be seen
from a name: the Python sandbox's in-process fallback swaps the
process-global `sys.stdout`, and connector tools are unknown so they run
serially. Results are **recorded in call order**, not completion order, so
the transcript and the run log are identical across reruns. Prompts tell
the model to batch, because the engine is useless if the model waits
between calls.

Tests: `chat/tests/test_parallel_tools.py`.

## 5. Fail before looking busy

**Problem.** A turn with no valid credential or no credit would show
"thinking", persist the message, load history, then render an apology *in
the assistant's voice* for a problem only the user could fix.

**Decision.** `llm.preflight()` runs before the first status event and
before anything is written. Provider errors are classified into typed
exceptions (access denied, quota exhausted, model retired) that callers
*raise* rather than render. Agent runs preflight too, so the API answers
**402** naming the provider instead of 202 followed by a dead run.

Credits hook into the same door (`llm/credits.py`): checked at preflight,
charged once the provider reports usage, only on the platform's own key,
never on free models. Charging is a single `UPDATE ... SET credits =
GREATEST(credits - n, 0)`, so concurrent fan-out subtracts correctly.

Tests: `chat/tests/test_account_errors.py`, `llm/tests/test_credits.py`.

## 6. Security boundaries that hold by construction

- **Connectors get an allow-listed environment.** A stdio connector is
  third-party code; its environment used to be `{**os.environ, ...}` — in
  Docker the whole `.env`, including the vault master key. Now: `PATH`, a
  few prefixes and the one user's mapped credentials
  (`mcp_integration/tests/test_subprocess_env.py`).
- **Code runs in a sidecar**, not the web process: its own container, no
  network, all capabilities dropped, read-only root, memory and pid caps,
  process-group kill. A full interpreter escape lands in a container with
  no secrets (`docs/SANDBOX_EXECUTION.md`).
- **The agent file system is virtual.** Paths are walked segment by segment
  over database rows; `os` is never imported, so a traversal bug can reach
  another row but never a host file. Unknown and foreign ids get the *same*
  404.
- **Unauthenticated surfaces answer 404 for every refusal** (webhooks,
  public agents), so they can't reveal which secrets are live.
- **Shared agents carry requirements, never ids.** Publishing a config that
  named "knowledge base 2" would, when installed elsewhere, read *someone
  else's* row 2. Publishing strips ids through an allow-list projection, so
  a field added later is private until someone decides otherwise.

## 7. One embedder for the whole process

**Problem.** A `KnowledgeBase` is created per user, and the embedder used to
be instantiated per KB — a model reload per user, ~100 MB each.

**Decision.** A process-global singleton (`get_global_embedder`), loaded
lazily once and shared across users and threads. Embeddings are stateless
during inference, so this is safe. The per-request hazard is GIL
serialization, but embedding is milliseconds and the shared instance wins.
The embedder is now an **API-backed `RemoteEmbedder`** (NVIDIA NIM's
`nvidia/nemotron-3-embed-1b`, 2048-dim) — no local model, nothing to load; the error
path raises `KnowledgeBaseUnavailable` (503), distinguishable from an empty
corpus (`inference/engine.py`).

## 8. Testing what users actually receive

Twice, a feature passed every unit test and reached no user — a todo list
built, streamed and stored, but drawn by no component. Each unit test
covers one hop, which lets a chain pass everywhere while connecting
nowhere. `chat/tests/test_turn_output_e2e.py` drives the real graph and
asserts on the two things a client consumes: the events emitted and the
metadata left behind. It found a real bug on its first run.

## Where it stops scaling today

Current deployment: one **GCP e2-medium VM** (2 vCPU, 4 GB RAM, shared with
the NGU project; Caddy → nginx → daphne), running the app, Redis, the code
sandbox and **PostgreSQL**, each in its own container. That is the right
cost for early access, and it has clear limits:

| Limit | Why | Next step |
|---|---|---|
| **One web process holds live run state** | Active chat runs (`chat/turn/runs.py`) and the steering mailbox (`chat/turn/steering.py`) are in-process dicts. With two replicas, "stop" or "steer" can reach the replica that isn't running the turn. | **Short term:** sticky sessions at the load balancer (run *state* is already durable in the Postgres checkpointer). **Long term:** Redis-backed mailbox and pub/sub cancel signal; event stream to a Redis stream so any replica can re-attach. |
| **Database shares the box** | PostgreSQL runs beside the app on a shared 4 GB VM, so a memory spike in the web process competes with the database. | A managed database, so the app tier can be resized or replaced freely; PgBouncer once there is more than one app process. |
| **Single instance, manual backups** | The box is a single point of failure; `pg_dump` is taken by hand before each deploy. | A nightly `pg_dump` job to S3; point-in-time recovery comes with a managed database. |
| **Connectors are memory-bound** | Each connector session is a 70–150 MB process, so concurrent connector users scale with RAM, not CPU. | Native REST implementations for the most-used connectors (Gmail, Drive, Sheets, Calendar are already native); move remaining stdio connectors to a separate host. |
| **Pre-model latency** | Many sequential awaits before the first token, each a sync-to-async thread hop into the ORM. Now measured per turn (`[Latency] pre-model`). | Batch the pre-model reads; stop seeding a web search for questions that don't need one. |

What already works across processes: run state (the Postgres checkpointer),
orphaned-run recovery (`agents/recovery.py`), the cache (Redis), WebSocket
fan-out (Redis channel layer), and every periodic job, each reachable both
as a management command and inside the backend process under a database
lease (no Celery in production).
