# 16 — Deploy Downtime: What Happens to Users and Background Work During a Restart

> Source: `Backend/Dockerfile` (the `CMD`), `docker-compose.prod.yml` (healthchecks,
> `depends_on`), the host crontab on the EC2 box, `agents/scheduler.py` (the lease),
> `agents/recovery.py`, `notifications/scheduled.py`, `notifications/reminders.py`
> Measured: 2026-09-26 (one deploy, one crash restart) · Related: `learning/12`, `learning/13`

---

## The Setup

On 2026-09-26 two things restarted the backend within ten minutes:

1. **A deploy** (`docker compose pull` + `up -d`) at 12:16 UTC.
2. **A crash** at 12:26 UTC. The kernel killed the web server for going over the
   container's 384 MB memory limit. A user signing in with Google at that moment
   got a **502**.

Both are the same event from the system's point of view: the one backend process
goes away, and a new one takes its place. So the useful question is not "how do we
deploy?" but **"what is everything doing when the backend disappears, and what
happens to it?"** That covers users, open streams, running agents, the scheduler,
and the cron jobs.

The lesson in one line: **downtime is not one number.** Each kind of work
experiences a restart differently, and each needs its own answer.

---

## The Measured Timeline

From the container's own timestamped logs (`docker logs -t aiaas-backend`):

| Time (UTC) | What happened | Gap |
|---|---|---|
| 12:16:34 | Old container stopped, new container created | (stop took ≤ 10 s) |
| 12:16:52 | `collectstatic --clear` finished | 18 s |
| 12:16:59 | `migrate` started | 7 s |
| 12:17:00 | Migration applied (`inference.0023`) | 1 s |
| 12:17:18 | `populate_models` finished, **daphne listening** | 18 s |
| 12:17:49 | First health check passed (took 2.2 s, cold) | 31 s |
| ~12:18 | Frontend container recreated (compose waited for "healthy") | a few s |

**API downtime: about 45–55 seconds** per deploy. That is the stop (up to 10 s)
plus 44 s of boot. **The whole site, static pages included, is down for a few more
seconds** while the frontend container restarts, because Caddy proxies everything
through it.

The crash restart looked the same: killed 12:26:32, restarted 12:26:50, then the
same 44 s boot. **About a minute** of 502s.

### Where the 44 seconds go

The Dockerfile's `CMD` runs, on *every* start:

```
collectstatic --noinput --clear  →  migrate  →  populate_models  →  daphne
        18 s                          ~1 s          18 s
```

Only the last step serves traffic. **About 36 of the 44 seconds are one-off
preparation that repeats on every restart**, including crash restarts, where
nothing changed at all. That is the single biggest lever (see Fix 2).

---

## What Each Kind of Work Experiences

### 1. A user clicking something (HTTP requests)

Caddy → frontend nginx → backend. While the backend is down, nginx cannot connect
and answers **502 Bad Gateway**. The browser shows it as an error. This is exactly
the sign-in failure.

- **GET requests** (loading a page, a list) are safe to retry. The user presses
  reload and it works.
- **POST requests** (sign in, send a message, create an agent) may or may not have
  reached the server before it died. The client cannot tell, so it cannot safely
  retry blindly.

### 2. A chat answer that is streaming (SSE)

A chat turn runs as a detached task *inside the backend process*
(`chat/turn/runs.py`). When the process dies, the task dies with it. The stream
closes mid-answer. Anything queued in the steering mailbox (also in memory) is
lost.

### 3. WebSockets (live run updates, notifications)

Dropped. The frontend's one socket helper (`lib/websocket.ts::useSocket`)
reconnects with exponential backoff, so these **heal by themselves** once the
backend is back. That is the model to copy elsewhere.

### 4. An agent run in progress (up to 2 hours)

Agent runs are also detached tasks in the backend process. Two things matter:

- **Its state survives.** Production uses the SQLite checkpointer on a volume
  (`AGENT_CHECKPOINTER=sqlite`, `/app/data/checkpoints.sqlite3`), so the graph's
  progress is on disk.
- **Nothing picks it back up.** `agents/recovery.py` exists to find `running` rows
  whose process died and either resume or close them. But in production it is
  **not scheduled anywhere**: no cron line, no Celery beat, and it is not in the
  in-process loop. So a run cut off by a deploy **stays "running" forever**. The
  deployment notes had already seen this ("10 orphaned running eval runs") without
  naming the cause.

This is the most important gap in this document. The resume machinery was built
and tested, but nothing runs it.

### 5. The in-process scheduler (the "heartbeat")

Agent schedules fire from a loop inside the backend (`agents/scheduler.py`). It
ticks every 30 s and holds a database **lease** so only one process fires
schedules. Each tick renews the lease for 90 s (`LEASE_SECONDS`).

When the process is killed, it cannot release the lease. The new process only
takes over once the old lease **expires**:

```
last renewal ── up to 90 s ──► lease expires ──► new process wins it on its next tick
```

So **schedules can pause for up to ~90 seconds after a restart.** Nothing fires
twice (the per-slot claim in `sweep.prepare` guarantees that), and a slot that
came due during the gap fires once, late, on the first sweep after takeover.

This is the lease doing its job. It trades a short delay for never
double-firing, which is the right trade for "send the Monday report".

### 6. Host cron jobs

The box runs management commands with `docker compose exec` *into the backend
container*. During a restart, three things can happen:

| When the job starts | What happens |
|---|---|
| Container is being replaced | `exec` fails ("service not running"). Harmless, logged, retried next minute |
| New container is booting | The job **runs during the boot**. Boot peaks at ~311 MB, a job adds 50–80 MB, and the limit is 384 MB. **This can OOM-kill the boot itself** |
| Job was mid-run when the container stopped | It is killed partway. Whether that is safe depends on the job (next section) |

The same pile-up also happened with no deploy at all. Before 2026-09-26, cron
started two full Django processes every minute and a third every five minutes,
with nothing stopping them from overlapping. At 12:26 five were running (~350 MB)
and the kernel killed the web server. That was the 502, and the root cause of the
September crash-restarts. The fix was one shared lock:
`flock -w 50 /tmp/aiaas-cron.lock` on every line, so at most one extra process
exists at a time. It is documented in `DEPLOYMENT.md` §5b.

---

## Killed Mid-Job: At-Least-Once vs At-Most-Once

A job that sends something and records that it sent it has **two steps**. If the
process dies *between* them, the order of the steps decides the outcome. This
codebase has one of each:

**Scheduled reminders: send, then record → at-least-once.**

```python
_deliver(reminder, now)            # 1. send it
reminder.next_run_at = ...         # 2. record it
reminder.save(...)
```

Killed between 1 and 2, the row still looks due, so the next run **sends it
again**. The user gets a duplicate reminder.

**Daily digest: record, then send → at-most-once.**

```python
prefs.last_digest_sent_on = local_date   # 1. claim the day
prefs.save(...)
...                                       # 2. then send
```

Killed between 1 and 2, the day is already claimed, so the digest **is never
sent** that day.

Neither is wrong; they are choices. A duplicate reminder is mildly annoying. A
duplicate email is worse (so the digest chose at-most-once, with a hard one per
day cap). The rule is to **pick deliberately, per job, and write down why**. The
general tools:

- **Claim with a conditional update** (`UPDATE ... WHERE status='due'`, check the
  row count) before doing the work. Only one worker can win, and a crash leaves a
  row you can see and repair. `sweep.prepare` already does this for schedules.
- **An idempotency key** (the recipient's system ignores a repeat of the same
  key). This is how "exactly once" is approximated in practice.
- **Short jobs.** A 5-second job has a much smaller window to die in than a
  5-minute one.

---

## Fixes, Ranked by Value for Effort

Built for this box: one 913 MB server, and a backend with a 384 MB limit. That
rules out the textbook answer (run two backends) for now. See Fix 6.

### Fix 1 — Hold the cron lock during a deploy (minutes, no code)

The deploy takes **the same lock** the cron jobs use, so no job can start while
containers are being swapped or the new one is booting:

```bash
cd ~/aiaas && flock -w 120 /tmp/aiaas-cron.lock \
  sudo docker compose -f docker-compose.prod.yml up -d backend frontend
```

Jobs that wait longer than 50 s give up and run on the next minute. That removes
the "job runs during boot" OOM risk and needs nothing but the lock that already
exists.

### Fix 2 — Take the one-off work out of the boot (small, biggest downtime win)

- **`collectstatic` at build time.** Add `RUN python manage.py collectstatic
  --noinput` to the Dockerfile. Static files are part of the image, so they never
  change between restarts of the same image.
- **`migrate` and `populate_models` as a separate deploy step**, before the swap:

  ```bash
  docker compose -f docker-compose.prod.yml run --rm backend python manage.py migrate
  docker compose -f docker-compose.prod.yml run --rm backend python -c "import populate_models; populate_models.populate()"
  docker compose -f docker-compose.prod.yml up -d backend frontend
  ```

- The container's `CMD` becomes just `daphne ...`.

**Expected: boot drops from ~44 s to single-digit seconds**, for deploys *and* for
crash restarts. It needs one discipline, though: the migration now runs while the
*old* code is still serving. So migrations must be **backwards-compatible**
("expand, then contract"): add a column in this release, start using it in the
code, and only drop the old one in a *later* release.

### Fix 3 — Schedule run recovery (small code change)

Run `agents/recovery.py` from the in-process scheduler loop, shortly after the
lease is won. This closes the gap in section 4: runs cut off by a restart get
resumed from their checkpoint or closed with a clear message, instead of staying
"running" forever. The recovery module already uses only the row and the agent's
own `maxRunSeconds` to decide what is orphaned, so it is safe to run from a live
process.

### Fix 4 — Move the notification sweeps in-process too (small code change)

`send_scheduled_notifications` and `send_hitl_reminders` could run on the same
30-second loop, under the same lease, as the schedules. Then there are **no extra
processes at all**, no cron, no locks, and no memory spikes. This is the long-term
version of the flock fix.

### Fix 5 — Graceful shutdown and a friendly error (small)

- `stop_grace_period: 30s` on the backend, so a short chat turn can finish before
  Docker sends the hard kill. (A two-hour agent run cannot finish, which is what
  Fix 3 is for.)
- A Caddy `handle_errors` page for 502/503: "Updating, back in a minute", with
  auto-retry for page loads. Users see a message instead of a broken screen.
- Frontend: retry idempotent GETs once after a short delay. Never auto-retry a
  POST unless the endpoint is idempotent.

### Fix 6 — Zero downtime: run old and new side by side (needs more RAM)

The real fix for downtime is to **never have zero backends**:

1. Start the new backend container next to the old one.
2. Wait until its health check passes.
3. Point the proxy at it (nginx `upstream` with both, plus `proxy_next_upstream
   error` so a failed connection tries the other one).
4. Stop the old one gracefully.

This is a *blue-green* or *rolling* deploy. Three things make it harder here than
in a textbook:

- **Memory.** Two backends (~130–150 MB each) plus one booting (~311 MB peak) do
  not fit beside Postgres, Redis and the sandbox in 913 MB. **It needs the
  t3.small resize first.**
- **In-process state.** Chat turns, steering mailboxes and detached runs live
  in the process that started them. During the overlap, a steer or a cancel must
  reach the *right* process. That needs sticky routing, or moving that state to
  Redis (see `learning/13`, "one process, one core").
- **Singletons.** The scheduler is safe (the lease already handles two
  processes), but any other "only one of me" loop needs the same lease pattern.

---

## Update (same day): Fixes 1–4 Built

| | Before | After |
|---|---|---|
| `docker stop` | up to 10 s, then a hard kill | **1.3 s**, clean exit |
| Crash restart, start to serving | 44 s | **11.4 s** |
| Periodic jobs running in production | schedules only (+2 via cron) | **every job but missions** |
| Extra Django processes from cron | 2 every minute, 3 every fifth | **none** |
| **Production deploy, API unavailable** | ~50–55 s | **~20 s** (whole site stayed up: only the backend was swapped) |

The first three rows were measured in the built image on a dev machine under
the same 384 MB limit. The deploy row is production (13:57 UTC): last 200 at
13:57:02.9, old container stopped by 13:57:05, `boot` done 13:57:16.8 (migrate
1.4 s, seed 0.4 s), listening 13:57:23. The box's slower CPU explains 20 s vs
11 s: most of what remains is Python importing Django twice (once for `boot`,
once for daphne). The first in-process sweep ran at 13:58:35, 72 s after
listening, which is the 90 s lease handover from the killed process. Its run
recovery closed **10 runs that had read "running" since earlier restarts**.

- **Fix 1:** a deploy takes the cron lock (`DEPLOYMENT.md`). Only the weekly
  catalogue refresh is left in cron.
- **Fix 2:** static files are collected at build time; `manage.py boot` migrates
  and seeds the catalogue once per container, then `exec daphne`. The `exec` was
  a bonus find: under `sh -c` the shell was PID 1, ignored SIGTERM, and every
  stop waited out the 10 s grace before killing the server mid-request.
- **Fixes 3 and 4:** `agents/scheduler.py::PERIODIC_JOBS` runs run recovery,
  both notification sweeps, the recycle-bin purge and checkpoint pruning on the
  lease-holding loop. A test fails if the beat schedule and this list drift.
- **Still open:** the missions sweep waits for each run to finish, so it cannot
  run on a web-server thread. Missions do not advance in production until it
  launches runs detached. Fixes 5 and 6 are not built.

The scheduled-reminder sweep also became **claim-then-send**, because during
the rollout the old cron job and the new loop would both sweep in the same
minute. It is at-most-once now, with a failed delivery handed back for retry.

---

## A Deploy Runbook for Today's Box

With Fixes 1–4 in, a deploy is about 20 seconds of API downtime (measured), with
no side damage:

1. **Check in-flight work first.** Are agent runs `running`? If a long run matters,
   wait for it: after a restart it will not be resumed (until Fix 3).
2. **Back up the database:** `pg_dump -Fc` from the db container.
   A probe loop measuring the swap must not run under `set -e`: the first
   refused connection makes `curl` exit non-zero and silently kills the probe
   (it did, on the first measurement).
3. **Pull first, swap second.** `docker compose pull` while the old version still
   serves, so the download is not part of the downtime.
4. **Swap under the cron lock** (Fix 1): `flock -w 120 /tmp/aiaas-cron.lock docker
   compose up -d backend` (add `frontend` only when it changed: swapping it takes
   the whole site down for a few seconds). The crontab now holds only the weekly
   catalogue refresh.
5. **Verify:** container health, `/api/health/` 200, and the unauthenticated chat
   stream answering `data: {"type":"error","message":"Authentication required."}`.
6. **Watch memory for a few minutes** (`docker stats`, `dmesg | grep -i oom`),
   because boot plus the first cron jobs is the riskiest window.

---

## How This Was Found (the Method Is the Lesson)

1. **Start from the symptom and a timestamp.** "502 on sign-in" became "what was
   the backend doing at that second?"
2. **Read the kernel, not the app.** `dmesg` said the web server was OOM-killed,
   but it held only 15 MB. The **process table in the same kill record** showed
   five `python` processes holding ~350 MB. The victim was not the culprit.
3. **Find who started them.** The app spawns no Python subprocesses (`git grep` for
   `subprocess`/`multiprocessing` found none), so they came from outside:
   `docker events` showed `exec_start: python manage.py ...` every minute, and the
   host crontab explained why.
4. **Time the boot from the container's own logs** (`docker logs -t`), instead of
   guessing "a deploy takes a minute".
5. **Check that the documented fix was applied.** `DEPLOYMENT.md` already said to
   remove the duplicate cron line. The box never had it removed. Docs describe
   intent; the server shows reality.

---

## Interview Questions

1. *Your service returns 502s for about a minute on every deploy. Where does the
   time go, and how do you cut it?*
   → Measure the boot from timestamped logs. Here, 36 of 44 seconds were one-off
   work (static files, migrations, data seeding) repeated on every start. Move it
   into the image build or a separate pre-deploy step, so the container starts
   only the server.

2. *Why can't you just run migrations in a separate step before switching versions?*
   → You can, but then the old code runs against the new schema for a while. So
   migrations must be backwards-compatible: expand first (add), migrate code, then
   contract (remove) in a later release.

3. *A process was OOM-killed but was using almost no memory. How?*
   → The limit is per container (cgroup), not per process. The kernel kills by its
   own scoring, and here it killed the web server while five short-lived jobs in
   the same container held the memory. Read the process table in the kill record.

4. *What's the difference between at-least-once and at-most-once, and how do you
   choose?*
   → Record-after-send can repeat after a crash; record-before-send can drop. Pick
   by the cost of a duplicate versus the cost of a miss (a duplicate email is
   worse than a duplicate in-app reminder), and use a conditional-update claim or
   an idempotency key to narrow the window.

5. *How does a leader lease behave when its holder is killed?*
   → It cannot be released, so it must expire. Work pauses for up to one lease
   length, then another process takes over. You trade a short delay for never
   having two leaders.

6. *Why is blue-green hard for this app specifically?*
   → Memory (two backends plus a boot peak do not fit), and in-process state (chat
   streams, steering, detached runs) that a request must reach in the right
   process. It needs sticky routing or shared state first.

7. *A long-running job's state is checkpointed to disk. Is it safe across restarts?*
   → Only if something resumes it. Durable state with nothing scheduled to read it
   back is a job that looks "running" for ever. Here, `recover_runs` existed and
   was never scheduled in production.
