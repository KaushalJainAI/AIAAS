# 13 — Why One User Could Make the Server Lag: Async Django Concurrency Bottlenecks

> Source: `Backend/workflow_backend/background.py`, `chat/turn/checkpoints.py`,
> `chat/transport/streaming_http.py`, `agents/scheduler.py`, `streaming/consumers.py`,
> `docker-compose.prod.yml`
> Found: 2026-09-24 · Fix plan: `Backend/docs/CONCURRENCY_LAG_FIX_PLAN.md`

---

## The Symptom

The server lagged badly whenever several things ran at once — even for **one** user:
two or three chats open, an agent run, a coding lead with its workers. Nothing was
"broken"; everything just got slow together.

That "everything slows down together" pattern is the clue. It means the work is
**sharing something scarce** and queueing for it. The investigation is about finding
what is shared.

---

## The Mental Model: What Does an Async Django Server Share?

The backend is one Daphne process running an asyncio **event loop**. Async code
(`await httpx...`) runs on the loop and costs almost nothing while waiting. But the
Django ORM is **synchronous**, so every DB call is handed to a **thread** with
`sync_to_async`. That gives four shared resources:

| Shared thing | How many | What happens when it runs out |
|---|---|---|
| The event loop | 1 per process | Any CPU work on it freezes *every* stream |
| Threads for sync code | depends on `thread_sensitive` | Calls queue behind each other |
| DB connections (pool) | `max_size` = 10 in prod | New queries wait up to the pool timeout (20 s) |
| RAM / CPU of the box | 913 MB, 2 vCPU | Swap to disk, or CPU throttling |

Every gap below is one of these four running out.

---

## Bottleneck 1: Holding a DB Connection While Waiting for Something Else

Django gives each **thread** its own DB connection and only returns it to the pool when
the connection is closed. Our detached tasks (`background.spawn`) each get one dedicated
thread and close the connection only **when the task ends**:

```python
async def _detached(coro):
    async with ThreadSensitiveContext():      # one thread for this whole task
        try:
            return await coro                  # ...minutes of model calls...
        finally:
            await sync_to_async(close_old_connections)()   # only returned HERE
```

So a chat turn holds a connection for its whole life, including the ~30 s it spends
waiting for the LLM, when it isn't using the database at all. Count the holders for one
user:

- the scheduler loop (never ends → holds one **forever**)
- each chat turn in flight
- each open chat SSE stream (a **second** one per turn: the view queries, then streams)
- each agent run, and each coding worker

3 chats × 2 + a lead + 3 workers + the scheduler ≈ **11 > 10**. The 11th query waits
up to 20 s. That is the lag.

**The fix is not a bigger pool.** It's to *give the connection back before a long wait*:

```python
async def release_db():
    await sync_to_async(close_old_connections)()   # with a pool: returns it, µs to re-take

# before every model call, before streaming, before the scheduler sleeps
await release_db()
completion = await llm.complete(...)
```

**Rule:** never hold a scarce resource across a wait you don't control.
That rule applies to locks, DB connections, file handles, and semaphores alike.

---

## Bottleneck 2: A Dev-Grade Store in Production (the SQLite Checkpointer)

LangGraph saves the agent's state after every graph step (a "checkpoint") so a run can
survive a restart. Prod used the **SQLite** saver. Look at what it does per step:

```python
type_, serialized_checkpoint = self.serde.dumps_typed(checkpoint)   # whole transcript, ON THE EVENT LOOP
async with self.lock, self.conn.execute("INSERT OR REPLACE ...", ...):  # ONE lock for the whole process
    await self.conn.commit()
```

Three problems stack:

1. **CPU on the event loop** — serialising the full transcript blocks every other
   user's stream for that moment. It grows with transcript length.
2. **One global lock** — every run in the process waits for every other run's write.
3. **Full copy every step** — 4 steps per iteration, each storing the entire state.

The library's own docstring says: *"not recommended for production workloads."*
The Postgres saver has no global lock, uses a connection pool, and stores each piece of
state **once per version**, so an unchanged transcript isn't rewritten.

**Rule:** read the docstring of anything on your hot path. "Works in dev" is not the bar.

---

## Bottleneck 3: `thread_sensitive` — One Thread per Run, and One Thread for Everyone

`sync_to_async` has a flag that decides *which thread* runs your sync code:

| `thread_sensitive` | Runs on | Good for |
|---|---|---|
| `True` (default) | one thread per `ThreadSensitiveContext` — or, if there is none, **one global thread for the whole process** | the ORM (connections are per-thread; transactions need the same thread) |
| `False` | the loop's default thread pool | pure HTTP / CPU work that never touches the ORM |

Two consequences found here:

- **Inside a run**, a slow tool (a 60 s download, an image generation, rendering a
  `.pptx`) used the default `True`, so it sat on the run's only thread. The run's DB
  calls and its "parallel" sibling tools queued behind it. Fix: split the pure work
  (`thread_sensitive=False`) from the DB write (stays `True`).
- **WebSocket consumers** (Django Channels 4.3) run in *no* `ThreadSensitiveContext`,
  so all their `database_sync_to_async` calls, across every user and socket, fell through
  to asgiref's **single process-wide thread**. Fix: give each socket its own context.

**Rule:** ORM → thread-sensitive. Everything else → not. Never blanket-flip it; ORM on
the shared pool leaks connections and breaks transactions.

---

## Bottleneck 4: One Process, One Core, Too Little RAM

- One Daphne process runs Python on **one core** at a time (the GIL), even on a 2 vCPU box.
- The containers' memory limits added up to **~1.3 GB on a 913 MB box**, so under load
  it swaps to an EBS disk, which is very slow.
- A 913 MB / 2 vCPU EC2 instance is probably a burstable **t3.micro**: when its CPU
  credits run out, it is throttled to a fraction of a core.

Why not just add workers? Because some state lives **in the process's memory**: the live
chat stream buffers, the steering mailbox, the coding-task registry. With two workers, a
"steer" request could land on the worker that doesn't own the run and silently do
nothing. Scaling out requires moving that state to Redis (or sticky routing) first.

**Rule:** before scaling horizontally, find your in-process state. It decides whether a
second worker helps or quietly breaks things.

---

## How the Investigation Went (the Method Is the Lesson)

1. **Start from the topology**, not the code: one process, one loop, 10 DB connections,
   913 MB. Scarcity tells you where to look.
2. **Follow the lifetime of each scarce thing.** Who takes a DB connection, and when do
   they give it back? That exposed the "held across a model call" bug.
3. **Read library source on the hot path.** The SQLite saver's `self.lock` and
   `dumps_typed` were two lines in site-packages.
4. **Check what *isn't* the problem**, too: token streaming was in-memory queues, and
   broadcasts were per step not per token. That saves time chasing the wrong thing.
5. **Measure before fixing.** Code-reading gives hypotheses. An event-loop-lag ticker
   and pool `get_stats()` turn them into numbers, and give each fix a before/after.

---

## Interview Questions

1. *In async Django, what's the difference between `thread_sensitive=True` and `False`?
   When must you use each?*
   → True runs on a per-context (or global) single thread; required for the ORM because
   connections and transactions are per-thread. False uses a thread pool; for pure I/O/CPU.

2. *Your async server slows down only when several requests run at once, and CPU is low.
   Where do you look?*
   → Shared, bounded resources: connection pools, locks, single-thread executors,
   semaphores. Then check who holds them across a wait.

3. *Why is "increase the pool size" usually the wrong fix for pool exhaustion?*
   → It hides a hold-across-wait bug, costs DB memory per connection (Postgres ~5–10 MB
   each), and just moves the ceiling.

4. *What blocks an asyncio event loop even when all your I/O is `await`ed?*
   → CPU work in coroutines (serialisation, parsing, rendering) and any sync call made
   without `to_thread`/`sync_to_async`. Detect it with a loop-lag ticker.

5. *Why can't you just run 4 uvicorn workers to scale this app?*
   → In-process state (stream buffers, mailboxes, registries) means a request must reach
   the worker that owns the run. Move the state to Redis or use sticky routing first.

6. *Why did the SQLite checkpointer hurt more as conversations got longer?*
   → It serialised and wrote the *full* state every step, so per-step cost grew with the
   transcript, and a run's total cost grew roughly quadratically.
