# Deployment Pipeline

End-to-end deployment guide for the AIAAS platform: local development, container builds, image publishing, and the production deploy on a **Google Cloud (GCP) Compute Engine VM** (moved off AWS EC2 in late September 2026, see §3). See [CLAUDE.md](./CLAUDE.md) for project structure and [learning/11_docker_wsl_storage_relocation.md](./learning/11_docker_wsl_storage_relocation.md) if Docker storage runs out on your dev machine.

---

## Architecture Overview

```
┌─────────────────┐   builds   ┌──────────────────┐   pushes    ┌──────────────┐
│  Dev machine    │ ─────────▶ │  Local images    │ ──────────▶ │  Docker Hub  │
│  (compose up)   │            │  via Dockerfile  │             │  kaushal...  │
└─────────────────┘            └──────────────────┘             └──────┬───────┘
                                                                       │ pull
                                                                       ▼
                                                                ┌──────────────┐
                                                                │  GCP VM      │
                                                                │ compose -f   │
                                                                │ prod.yml up  │
                                                                └──────┬───────┘
                                                                       │
                                       ┌───────────────────────────────┴──┐
                                       ▼                                  ▼
                              ┌─────────────────┐                ┌────────────────┐
                              │ aiaas-backend   │  Channels WS   │ aiaas-frontend │
                              │ (Django + ASGI) │ ◀────────────▶ │ (nginx + React)│
                              └────────┬────────┘                └────────────────┘
                                       │
                          ┌────────────┴────────────┐
                          ▼                         ▼
                  ┌──────────────┐         ┌──────────────────┐
                  │   redis      │         │ aiaas-worker     │
                  │ (channels +  │ ◀─────▶ │ (Celery, async   │
                  │  celery)     │         │  profile only)   │
                  └──────────────┘         └──────────────────┘
```

Locally (`docker-compose.yml`) the stack is **redis**, **backend**, **frontend**, plus an optional **worker** activated by the `async` compose profile. Production (`docker-compose.prod.yml` in the repo, `~/aiaas/docker-compose.yml` on the VM) runs **redis**, **db** (PostgreSQL), **sandbox**, **backend** and **frontend**, and has **no worker**. TLS is terminated by the VM's shared `edge-caddy` (§3); the repo file still carries a `caddy` service for a dedicated box.

---

## Environments

| Environment | Compose file | Database | Workflows | Public URL |
|---|---|---|---|---|
| Local dev | `docker-compose.yml` | SQLite (`backend_data` volume) | Sync (`RUN_WORKFLOWS_ASYNC=False`) | `http://localhost:3000` |
| Local dev + async | `docker-compose.yml` + `--profile async` | SQLite | Async via Celery + Redis | `http://localhost:3000` |
| Production (GCP VM) | `~/aiaas/docker-compose.yml` on the VM (repo: `docker-compose.prod.yml`) | PostgreSQL (`db` service, `pgdata` volume) | Sync; no worker | `https://aiaas.kaushaljain.com` |

The same `Backend/Dockerfile` and `better-n8n-frontend/Dockerfile` build both local and production images. The difference between environments is **which images are referenced** (`build:` locally, `image:` in production) and **which env vars are set**.

---

## 1. Local Development

### Prerequisites
- Docker Desktop running. If C: is full, see [learning/11_docker_wsl_storage_relocation.md](./learning/11_docker_wsl_storage_relocation.md).
- `Backend/.env` populated from `Backend/.env.example`.

### First-time setup
```bash
cp Backend/.env.example Backend/.env   # then edit values
docker compose build
docker compose up
```

Services come up in dependency order: `redis → backend → frontend`. The `worker` is gated behind the `async` profile and only runs when explicitly requested:

```bash
docker compose --profile async up
```

### Endpoints (local)
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000/api
- Backend WS: ws://localhost:8000/ws
- Redis: localhost:6379

### Hot reload
The local compose mounts no source code into containers — it builds the image. For frontend iteration use the Vite dev server directly:

```bash
cd better-n8n-frontend
npm run dev      # http://localhost:5173 with HMR
```

…and run the backend natively (`python manage.py runserver`) when iterating on Django code. The Docker stack is for full-stack integration testing.

---

## 2. Building & Publishing Images

**Before you build** — the deploy gate (benchmark smoke, < 5 min, < $0.05 on
the dev machine against the dev database; never on the production box):

```bash
cd Backend
pytest -q
python manage.py benchmark run --tier smoke --gate --user <benchmark account>
# only then: docker build … && docker push …
```

The benchmark runs on the **dev machine** against the dev database — never on
the production box. The benchmark account needs an OpenRouter key.

The production compose file consumes prebuilt images from Docker Hub:

```yaml
backend:  image: kaushaljainai/aiaas-backend:latest
frontend: image: kaushaljainai/aiaas-frontend:latest
```

Build and push from the dev machine:

```bash
# Backend
docker build -t kaushaljainai/aiaas-backend:latest ./Backend
docker push kaushaljainai/aiaas-backend:latest

# Sandbox sidecar (production runs `execute_python` here, never in-process)
docker build -t kaushaljainai/aiaas-sandbox:latest ./Backend/sandbox_service
docker push kaushaljainai/aiaas-sandbox:latest

# Frontend — same-origin relative URLs (`/api`, `/ws` via nginx.conf), so no
# build-time configuration is needed. (Older revisions of this doc passed
# `VITE_* --build-arg`s; the Dockerfile ignores them by design.)
docker build -t kaushaljainai/aiaas-frontend:latest ./better-n8n-frontend
docker push kaushaljainai/aiaas-frontend:latest
```

> **Vite needs no build args.** The frontend talks to the backend over same-origin
> relative URLs (`/api`, `/ws`), proxied by `nginx.conf` in the image (and by
> `vite.config.ts` during `npm run dev`). There is nothing environment-specific
> to bake in, so a frontend image built on a laptop works in production as-is.

### Multi-arch (ARM VMs)
The current VM is x86-64, which is what a plain `docker build` on the dev
machine produces. If production ever moves to an ARM machine type (GCP T2A /
C4A), build both architectures with buildx:

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t kaushaljainai/aiaas-backend:latest --push ./Backend
```

### Tagging strategy
- `:latest` — always points to the most recent push; what the production VM pulls
- `:vYYYY-MM-DD` or `:<git-sha>` — pin a known-good build for rollback

Tag both before pushing:
```bash
SHA=$(git rev-parse --short HEAD)
docker tag kaushaljainai/aiaas-backend:latest kaushaljainai/aiaas-backend:$SHA
docker push kaushaljainai/aiaas-backend:$SHA
```

---

## 3. Production Deploy (GCP)

### Where production runs (verified on the VM, 2026-10-01)

| | |
|---|---|
| Provider | Google Cloud, project `project-17c9e517-9fa3-47e0-888` |
| VM | `instance-20260930-190958`, **e2-medium** (2 vCPU, 4 GB RAM), zone **`asia-south2-b`** (Delhi) |
| OS / disk | Ubuntu 24.04 LTS, x86_64, 61 GB root disk, 4 GB swapfile, timezone Asia/Kolkata (cron times are IST) |
| External IP | `34.0.5.162` (VM network tags `http-server`, `https-server`) |
| SSH | `ssh -i ~/.ssh/id_ed25519 kaushaljain7000@34.0.5.162` |
| Deploy dir | `~/aiaas` = `/home/kaushaljain7000/aiaas` (`docker-compose.yml`, `.env`, `pg_backup.sh`, `backups/`) |
| Proxy / TLS | **Shared** `edge-caddy`, run from `~/edge` (`~/edge/Caddyfile`), keeps its certificates on the `aiaas_caddy_data` volume |
| Database | `aiaas-db` (postgres:16), user `admin`, database `app_db` |

**The VM is shared with another project.** It also runs NGU (`~/NGU`: `ngu-*`
containers, its own Postgres, pgbouncer and whisper). That changes three things
compared with the old dedicated box:

- **One proxy for both.** AIAAS no longer runs its own `aiaas-caddy`. The
  `edge-caddy` container in `~/edge` owns ports 80/443 and routes
  `aiaas.kaushaljain.com` to `aiaas-frontend:80`. The bare IP, or any unknown
  host, goes to NGU. The server's `~/aiaas/docker-compose.yml` therefore has
  **no `caddy` service**, unlike the repo's `docker-compose.prod.yml`.
  Change proxy rules in `~/edge/Caddyfile`, then run
  `docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile`. Do not
  `docker compose up` the repo compose file on this VM as-is: its `caddy`
  service would fight `edge-caddy` for port 80/443.
- **Memory is shared.** 4 GB total. NGU uses about 1 GB at rest (its backend
  sits near its 512 MB cap, whisper about 275 MB), and AIAAS about 330 MB. The
  per-container `mem_limit`s still apply. Check `docker stats --no-stream`
  before raising any of them.
- **Deploys touch only AIAAS services.** Run compose from `~/aiaas`, so it
  never recreates `ngu-*` or `edge-caddy`.

**Why it moved, and what was lost (September 2026).** Production ran on an AWS
EC2 t3.micro (913 MB RAM, `13.127.148.207`, instance `i-0e3a02e396ca7abe1`).
The most recent copy of that box is a file-level snapshot taken
**2026-09-26 12:14 UTC**. The new VM was built from it on 2026-09-30/10-01, and
the restore kit is still on the VM in `~/restore/aiaas`: `manifest.json`,
`db/app_db.dump`, volume tarballs and `rowcounts.txt`. The snapshot's dump was
restored into `aiaas-db`, and then the newer images applied the migrations
that came after it (to `solutions.0001`, `missions.0002`). As restored: 29
users, 709 chat messages, 378 subagents, 42 documents; last chat message
2026-09-26 04:58 UTC. **Everything written on the old box after the snapshot
is gone**: chats, runs, uploads and sign-ups from 2026-09-26 12:14 UTC until the
box died. That includes whatever was used during the 2026-09-28 and 09-29
deploys. Code was not lost; it is in git and on Docker Hub. The lesson is in
§6: **a backup on the same disk as the database is not a backup.**

**What is live (checked 2026-10-01): `main` as of 2026-09-29.** Running
images: backend `sha256:d9f49a3e…` (built 2026-09-29 09:11 UTC), frontend
`sha256:873192af…` (09:44 UTC), sandbox `sha256:cb2d97bc…` (2026-09-22). The
frontend bundle contains text from the 2026-09-29 commits up to `cab9cbb`, and
`/api/chat/transcribe/` and `/api/chat/speak/` answer 401, not 404. `b66574d`,
the head of `main`, is layout-only, and the frontend was built four minutes
after it.

How to tell which code is live:

```bash
# On the VM: which image each container is running
docker inspect aiaas-backend --format '{{.Image}}' | xargs docker image inspect --format '{{index .RepoDigests 0}} {{.Created}}'
# From anywhere:
curl -s  https://aiaas.kaushaljain.com/api/health/                 # {"status": "healthy", ...}
curl -sI https://aiaas.kaushaljain.com/ | grep -i last-modified   # when the frontend IMAGE was built
# A new API route answers 401 when it is deployed and 404 when it is not:
curl -s -o /dev/null -w '%{http_code}\n' https://aiaas.kaushaljain.com/api/<new-route>/
```

`Last-Modified` is the build time, not a commit. To pin a commit, push a
`:<git-sha>` tag with every build (§2 Tagging).

**Retuned for the 4 GB VM (2026-10-01).** The server's
`~/aiaas/docker-compose.yml` and the repo's `docker-compose.prod.yml` now carry
the same settings. The one difference is the `caddy` service, which only the
repo file has. The previous server file is kept as
`~/aiaas/docker-compose.yml.bak-2026-10-01`.

| Setting | Before (913 MB box) | Now |
|---|---|---|
| backend `mem_limit` / reservation | 384m / 192m (idled at 220 MB, 57%) | **768m / 256m** |
| db `mem_limit` | 256m | **512m** (`shm_size: 256m`) |
| Postgres `shared_buffers` / `effective_cache_size` | 40MB / 128MB | **128MB / 384MB**; the 69 MB database fits in memory |
| Postgres `work_mem` / `maintenance_work_mem` | 2MB / 16MB | **8MB / 64MB** |
| Postgres `max_connections` | 25 | **40**, plus `random_page_cost=1.1` and `effective_io_concurrency=200` (SSD) |
| backend `DB_POOL_MAX_SIZE` | 10 | **16** |
| sandbox | 300m, 1 slot | **600m, `SANDBOX_MAX_CONCURRENCY: "2"`** |
| redis | `maxmemory 64mb`, 128m | **`128mb`, 192m** |
| backend `CORS_ALLOW_ALL_ORIGINS` | `"True"` (`.env` still says True too) | **`"False"` in compose**, which beats `.env`. Checked: a foreign Origin gets no `Access-Control-Allow-Origin` |
| `AGENT_CHECKPOINTER` | `sqlite` (one lock for every run) | **`postgres`**, pool of 4 — see below |
| NGU `ngu-backend` memory | 512M (3 gunicorn workers at ~168 MB, 82% full) | **768M**, in `~/NGU/docker-compose.yml` (backup `.bak-2026-10-01`) |

AIAAS limits now total about 2.2 GB. NGU uses about 1 GB at rest, and the VM has 4 GB of swap.
A few minutes after the restart the backend was at 305 MB, which would have
been 79% of the old 384m cap. The VM still had 2 GB available. The limits are
room to grow into, not memory in use.

**The Postgres checkpointer needs a backend image from 2026-10-01 or later**
(`kaushaljainai/aiaas-backend:2026-10-01`, `sha256:37d2df34…`). The first
attempt that day, on the older image, failed every chat turn with
`psycopg_pool.PoolClosed` and was reverted within minutes; no chat or run
happened in that window. The library saver had three problems:
- it never opened its pool;
- it never created its tables (only the recovery sweep did, and that sweep
  returns early when there's nothing to recover);
- it held a process-wide `asyncio.Lock` around every query, so a pool would not
  have removed the queueing anyway.

`chat/turn/checkpoints.py::_pooled_saver_class` fixes all three. On first use it
opens the pool and creates the tables, once, under a lock, and it borrows one
connection per query with no global lock. Verified in production after the
deploy:
- the four `checkpoint*` tables were created on first use;
- a checkpoint round trip worked with no setup call;
- four 0.3 s queries finished in 0.33 s rather than 1.2 s.

The tests in `chat/tests/test_checkpoints.py` run against a real Postgres when
`AGENT_CHECKPOINT_TEST_DSN` is set. They fail on the old code with the
production error. Run them inside the image, next to a Postgres container on a
Docker network: on Windows a host port may be reserved, and psycopg's async mode
cannot use the default Windows event loop.

**Rolling back:** set `AGENT_CHECKPOINTER: sqlite` and
`AGENT_CHECKPOINT_PATH: /app/data/checkpoints.sqlite3` in
`~/aiaas/docker-compose.yml`, then `docker compose up -d backend`. The previous
image is tagged `kaushaljainai/aiaas-backend:rollback-2026-10-01` on the VM.
Runs paused at that moment lose their saved state either way.

When changing the server file, edit it in place. Do not copy the repo file over
it, because of the `caddy` service.

### Host prerequisites (for a rebuild)
- A Compute Engine VM with Docker Engine and the Compose plugin. The AIAAS
  `mem_limit`s add up to about 1.3 GB without Caddy. With NGU on the same VM,
  e2-medium (4 GB) plus swap is the floor.
- `docker-compose.yml` (the repo's `docker-compose.prod.yml` minus `caddy`),
  `.env` and `pg_backup.sh` in `~/aiaas`. The edge proxy lives in `~/edge`.
  `.env` holds `CREDENTIAL_ENCRYPTION_KEY`. Keep a copy of `.env` **off the VM**
  (a password manager): without that key, a restored database's credentials are
  unreadable.
- **The external IP must be a reserved static address.** Check VPC network →
  IP addresses: `34.0.5.162` should be listed as *Static*. If it says
  *Ephemeral*, click *Reserve*. An ephemeral IP changes when the VM is stopped
  and started, and then DNS for both AIAAS and NGU points at nothing.
- **VPC firewall: inbound tcp:80 and tcp:443 only** (the `http-server` /
  `https-server` tags), plus SSH. Only `edge-caddy` publishes host ports.
  Postgres, Redis and the sandbox stay on the internal compose network.
- The domain resolves to the *current* VM IP (`nslookup aiaas.kaushaljain.com`).
  `ALLOWED_HOSTS` in the compose file carries a hardcoded copy of the IP that
  must match. Past IPs: AWS `15.252.76.239` → `13.127.148.207` (2026-09-22) →
  GCP `34.0.5.162`.
- SSH is key-based as `kaushaljain7000` with the dev machine's
  `~/.ssh/id_ed25519`. The old `my-pem.pem` / `aiaas-ec2.pem` were AWS keys and
  do not open this VM.
- Ubuntu ships cron. The user crontab holds the nightly backups (§6).

### Deploy / update flow

Nothing is built on the VM: images are built and pushed from a dev machine (§2) and pulled here.

```bash
ssh -i ~/.ssh/id_ed25519 kaushaljain7000@34.0.5.162
cd ~/aiaas                                   # compose file here is docker-compose.yml
./pg_backup.sh                               # dump first (§6); copy it off the VM too

docker compose pull backend frontend sandbox # fetch the new :latest images
docker compose up -d backend frontend sandbox
docker compose ps                            # verify health
docker compose logs -f backend
```

`up -d` honors existing volumes (`pgdata`, `backend_data`, `backend_media`, `redis_data`; `aiaas_caddy_data` now belongs to `edge-caddy`), so the database, uploaded media and the agent checkpoint file persist across redeploys.

The backend container re-syncs the model catalogue (`populate_models.py`, upsert-only) on every boot after `migrate`, so a redeploy also heals catalogue drift — e.g. new `effort_levels` the database rows predate. If you ever need to run it by hand, `manage.py shell < populate_models.py` silently does nothing (the `__main__` guard does not fire under a piped shell); use `python manage.py shell -c 'import populate_models; populate_models.populate()'` instead.

### No Celery in production
`docker-compose.prod.yml` has no `worker` or `beat` service and pins `RUN_WORKFLOWS_ASYNC=False` — the 4 GB VM is shared with NGU, so the memory is spoken for. Schedules sweep on a loop inside the backend process itself (§5b); so does the other periodic work (HITL reminders, recycle-bin purge, run recovery). Host cron holds only the nightly backup (§6).

### Health checks
Compose-level healthchecks include:
- `redis`: `redis-cli ping`
- `backend`: `GET /api/health/`
- `frontend`: `GET /health` on nginx

`depends_on: condition: service_healthy` enforces startup ordering — the backend waits for `db`, `redis` and `sandbox`, and the frontend waits for the backend.

### Rollback
```bash
# Pin to a known-good SHA (see "Tag both before pushing" in §2):
docker pull kaushaljainai/aiaas-backend:abc1234
# Edit the backend image: line in ~/aiaas/docker-compose.yml to that tag, then:
cd ~/aiaas && docker compose up -d backend
```

If a migration has to be undone as well, restore the pre-deploy dump into `aiaas-db` with `pg_restore`.

---

## 4. Environment Variables

Critical entries in `.env`/`Backend/.env` (see `Backend/.env.example` for full list):

| Var | Purpose | Notes |
|---|---|---|
| `SECRET_KEY` | Django crypto signing | Regenerate per environment |
| `CREDENTIAL_ENCRYPTION_KEY` | AES key for stored API credentials | **Losing this bricks all stored credentials** |
| `DEBUG` | Django debug mode | `False` in production |
| `REDIS_URL` | Celery + Django Channels backend | `redis://redis:6379/0` inside compose network |
| `RUN_WORKFLOWS_ASYNC` | Sync vs Celery execution | `False` for sync (production is pinned to it); `True` requires the local `async` profile |
| `DB_ENGINE` / `DATABASE_URL` | Database selection | `DATABASE_URL` overrides per-field DB vars |
| `GOOGLE_OAUTH_CLIENT_ID/SECRET` | Social login via allauth | Must match Google Console redirect URI |
| `AGENT_CHECKPOINTER` | Run-state durability (`memory`/`sqlite`/`postgres`) | `sqlite` in production (file at `AGENT_CHECKPOINT_PATH` on the `backend_data` volume); unset previously meant `memory`, so paused runs died on redeploy |
| `ALLOWED_HOSTS` | Django host header validation | Include domain + the VM's *current* external IP + `backend` for compose internal calls. Set in the compose file's `environment:` (on the VM: `~/aiaas/docker-compose.yml`), which beats `.env` |
| `CORS_ALLOWED_ORIGINS` | WS + REST cross-origin | Frontend host(s) only |

### Where they come from at runtime
1. `.env` file referenced by `env_file:` in compose
2. `environment:` block in compose (overrides `.env`)
3. Process env on the host (overrides both)

Override order is bottom-up at container start; compose's `environment:` always wins over `env_file:`.

---

## 5. PostgreSQL

Production already runs PostgreSQL in the `db` service; the backend reads
`DB_ENGINE` / `DATABASE_URL` from `.env` (never pin them in compose
`environment:`, which beats `env_file:` — that is how the stack once silently
stayed on SQLite). Connections go through Django's own psycopg 3 pool
(`DB_POOL_MAX_SIZE` must stay under the db service's `max_connections=25`); there
is no PgBouncer. Moving an existing SQLite install over means dumping SQLite
and fixing type coercions (NUL chars, booleans, line endings) before loading
into Postgres; the plan for that move is
`Backend/docs/POSTGRES_PRODUCTION_MIGRATION_PLAN.md`.

---

## 5b. Turning schedules on (nothing to do)

Schedules run inside the backend process: `agents/scheduler.py` sweeps on a
loop that starts with the first HTTP request, under a database lease
(`SchedulerLease`) so exactly one process sweeps even if the app is scaled.
No crontab, no broker, no extra service — a plain `docker compose up` fires
schedules, locally and in production.

If you previously added the `run_due_triggers` host-crontab line below,
**remove it**: it boots a whole Django process every minute inside a 384 MB
container. The lease makes it harmless (it never wins the sweep) but not
free. `manage.py run_due_triggers` stays for debugging, and Celery beat
(Option B) stays available locally — the per-slot claim in `sweep.prepare`
makes running several of them at once safe.

```bash
# REMOVE this line if present (crontab -e on the VM):
# * * * * * cd ~/aiaas && docker compose exec -T backend python manage.py run_due_triggers >> /var/log/aiaas-sweep.log 2>&1
```

**Periodic work runs inside the backend, not from cron (2026-09-26).** The same
loop that fires schedules also runs the reminder sweeps, run recovery, the
recycle-bin purge and checkpoint pruning (`agents/scheduler.py::PERIODIC_JOBS`),
on the intervals in `settings/base.py`. Do **not** add cron lines for
`send_scheduled_notifications` or `send_hitl_reminders`: each `docker compose
exec` boots a whole Django process (50–80 MB) *inside the backend container*,
sharing its 384 MB limit with the web server. On 2026-09-26 five such processes
(~350 MB) were running at once and the kernel killed daphne; users saw a 502 on
sign-in. That stacking was behind the September OOM kills.

The one job left for cron is the weekly model-catalogue refresh (it also runs
on demand from Settings, staff only). Keep it behind the lock a deploy takes
(below), so it can never start during a container swap:

**Not installed on the GCP VM yet** (checked 2026-10-01; its crontab holds only
the two nightly backups). Add it with `crontab -e`:

```bash
# crontab -e on the VM — the AIAAS lines are this plus the §6 backup line
0 3 * * 0 cd ~/aiaas && flock -w 600 /tmp/aiaas-cron.lock docker compose exec -T backend python manage.py refresh_models >> ~/aiaas/models.log 2>&1
```

**Swap containers under the same lock**, so no cron job starts while the
backend is being replaced or is booting (boot plus a job could exceed the
container's memory limit):

```bash
cd ~/aiaas
docker compose pull backend frontend
flock -w 120 /tmp/aiaas-cron.lock docker compose up -d backend frontend
```

A restart takes ~11 s from start to serving (`manage.py boot`, then `exec
daphne`); what a restart does to open streams, running agents, the scheduler
lease and in-flight jobs is written up in
`learning/16_deploy_downtime_and_background_work.md`.

### Option B — Celery beat (local only)

Costs two more Python processes plus Redis, and gives you retries and a proper
task log. Only `docker-compose.yml` defines these services:

```bash
docker compose --profile async up -d
```

Beat must run as **exactly one** process — that is why `beat` is its own
service rather than a flag on `worker`. (Two beats no longer double-fire
schedules — the per-slot claim makes the second one report `busy` — but the
second process is still pure overhead.)

### Verifying it works

Do not wait for a cron slot to find out. In the app, **Schedules → Run once
now** fires a trigger through the same gates the scheduler uses and answers
202 with the run id in under two seconds; a second click while it starts finds
nothing to claim and reports `busy` rather than firing twice. From the host,
the equivalent is:

```bash
cd ~/aiaas && docker compose exec backend python manage.py run_due_triggers
```

A trigger will refuse unless its agent has `allow_unattended` set — the builder
and the Schedules API both block saving an enabled trigger without it, but
agents saved before those checks existed may still be in the refusing state,
and five refusals disable the trigger. The Schedules page shows each row's
`last_outcome`/`last_error`, which is where to look first when a schedule
looks armed but nothing runs.

### 5c. Prod and local databases stay different

The two databases are different data sets and must never be merged local → prod:
- Local (`db.sqlite3` / the `backend_data` volume) holds dev users, test agents and experiments.
- Production (the `pgdata` volume on the GCP VM) holds real users. Restoring a local dump
  into `aiaas-db` would overwrite real accounts, agent configs and run history
  with dev data — this screws up the experience of the users and is never to be done.

The model catalogue is the one exception, and it is already safe:
`populate_models.py` is upsert-only (`update_or_create` on provider slug / model
value, deactivates retired rows, deletes nothing), so running it — or just
redeploying, since the backend runs it on every boot (§3) — syncs models without
touching user data.

Allowed direction: prod → local (for debugging production state locally):

```bash
# On the VM: dump prod (custom format, safe to copy down)
docker exec aiaas-db pg_dump -U admin -d app_db -Fc > ~/aiaas_prod_$(date +%F).dump
# or just take last night's: ls -t ~/aiaas/backups | head -1
# Copy to the dev machine, then restore into a LOCAL postgres only:
pg_restore -U <localuser> -d <localdb> --clean ~/aiaas_prod_<date>.dump
```

Local dev defaults to SQLite; point it at a local Postgres first
(`DB_ENGINE=postgres` + `DATABASE_URL` in `Backend/.env.local`). Never set
`DATABASE_URL` to the production host, and never run `pg_restore` against
`aiaas-db`.

---

## 6. Observability & Maintenance

### Logs
```bash
cd ~/aiaas
docker compose logs -f backend
docker compose logs --tail=200 frontend
docker logs --tail=200 edge-caddy      # the shared proxy (TLS, routing)
```

Application logs also stream via WebSocket to the frontend's execution panel — see `streaming/consumers.py` and the `logs/` app.

### Storage hygiene
On the VM (and dev machines):
```bash
docker system df                    # see what's taking space
docker image prune                  # dangling images
docker system prune -a --volumes    # nuclear — drops unused volumes too
```

On Windows dev, if C: fills up despite this, the issue is the WSL2 VHDX not shrinking — see [learning/11_docker_wsl_storage_relocation.md](./learning/11_docker_wsl_storage_relocation.md) for the relocation recipe and `sparseVhd=true` `.wslconfig` setting.

### Backups — off the VM, every day

This is the section that would have saved the EC2 data (§3). Everything that
matters lives in Docker volumes on the VM's boot disk. A dump written to
`~/` sits on that same disk, so it is lost along with everything else.
A backup counts only once it is **somewhere else**.

**What exists today (checked 2026-10-01): the nightly dump only, and it is on
the VM.** `~/aiaas/pg_backup.sh` runs from the user crontab at 02:45 IST (the VM
is set to Asia/Kolkata; `gcloud` is preinstalled at `/snap/bin/gcloud`) and is logged to `~/aiaas/backups.log`. It runs
`pg_dump -U admin -d app_db -Fc` through `aiaas-db`, flags a dump under
50 KB, gzips it into `~/aiaas/backups/app_db-<stamp>.dump.gz`, and keeps 14
days. The first one was 16 MB. NGU has its own twin script at 02:30. This
protects against a bad migration or deletion, but **not against losing the
VM**, and it does not include uploaded files. Two layers are still missing:

**1. Disk snapshots (whole-machine undo).** In the console go to Compute Engine
→ Snapshots → *Create snapshot schedule*: daily, keep 7, same region. Then
attach the schedule to the VM's boot disk (Disks → the disk → Edit → Snapshot
schedule). A snapshot is stored outside the VM, so it survives the VM being
deleted. Restoring means creating a new disk (or a new VM) from the snapshot.

**2. Copy the nightly dump and the uploads to Cloud Storage.** Create a bucket
in the same region (`asia-south2`), for example `gs://aiaas-backups`, with a
lifecycle rule that deletes objects after 30 days. Give the VM's service
account (`483956890045-compute@developer.gserviceaccount.com`) *Storage Object
Creator* on that bucket.

**Blocker:** the VM's access scopes are the Compute Engine default, which
includes `devstorage.read_only`, so an upload from the VM is refused whatever
IAM says. Changing scopes needs the VM **stopped**: VM → Stop → Edit → Access
scopes → Storage *Read Write* → Start. That stops NGU too, so pick a quiet
moment. First confirm the IP is reserved *Static* (§3 prerequisites), because
a stop/start releases an ephemeral one.

Then append to `~/aiaas/pg_backup.sh` (the backend image has no `pg_dump`, so
`manage.py backup_db` refuses in production; the script already dumps through
`aiaas-db`):

```bash
# Off-box copy of tonight's dump, plus uploaded files (backend_media → /app/media)
gcloud storage cp "${OUT}.gz" gs://aiaas-backups/db/
docker exec aiaas-backend tar czf - -C /app media > "$BACKUP_DIR/media-$STAMP.tgz"
gcloud storage cp "$BACKUP_DIR/media-$STAMP.tgz" gs://aiaas-backups/media/
rm -f "$BACKUP_DIR/media-$STAMP.tgz"
```

Consider running the cron line under the same lock as the other jobs (§5b), so
a backup never overlaps a container swap:

```bash
45 2 * * * flock -w 600 /tmp/aiaas-cron.lock /home/kaushaljain7000/aiaas/pg_backup.sh >> /home/kaushaljain7000/aiaas/backups.log 2>&1
```

A backup you have never restored is a hope, not a backup. Now and then, restore
the latest dump into a **local** Postgres (§5c, prod → local only) and check
that you can sign in.

`backend_data` (the agent checkpoint file) does not need a copy. It only holds
paused runs, and losing it fails those runs; it loses no user data. `.env` is
backed up by hand, off the VM (§3 prerequisites).

---

## 7. CI/CD (Future / Optional)

The repo currently builds and pushes manually. A GitHub Actions workflow would:

1. On push to `main`: run backend tests (`python manage.py test`) and frontend lint+build
2. Build both Docker images with the commit SHA as tag
3. Push to Docker Hub as `kaushaljainai/aiaas-backend:<sha>` and `:latest`
4. SSH into the GCP VM with a deploy-only key and run `cd ~/aiaas && ./pg_backup.sh && docker compose pull backend frontend sandbox && docker compose up -d backend frontend sandbox`

Until that exists, the manual flow in §2 + §3 is the pipeline.

---

## Quick Reference

```bash
# Local dev (sync)
docker compose up --build

# Local dev (async)
docker compose --profile async up --build

# Build & push for prod
docker build -t kaushaljainai/aiaas-backend:latest ./Backend && docker push $_
docker build -t kaushaljainai/aiaas-sandbox:latest ./Backend/sandbox_service && docker push $_
docker build -t kaushaljainai/aiaas-frontend:latest ./better-n8n-frontend && docker push $_

# Deploy on the GCP VM
ssh -i ~/.ssh/id_ed25519 kaushaljain7000@34.0.5.162
cd ~/aiaas && ./pg_backup.sh
docker compose pull backend frontend sandbox
docker compose up -d backend frontend sandbox

# Health
docker compose ps
docker compose logs -f backend
curl -sI https://aiaas.kaushaljain.com/ | grep -i last-modified   # is the new frontend live?
```
