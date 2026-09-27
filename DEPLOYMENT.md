# Deployment Pipeline

End-to-end deployment guide for the AIAAS platform: local development, container builds, image publishing, and EC2 production deploy. See [CLAUDE.md](./CLAUDE.md) for project structure and [learning/11_docker_wsl_storage_relocation.md](./learning/11_docker_wsl_storage_relocation.md) if Docker storage runs out on your dev machine.

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
                                                                │  EC2 host    │
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

Locally (`docker-compose.yml`) the stack is **redis**, **backend**, **frontend**, plus an optional **worker** activated by the `async` compose profile. Production (`docker-compose.prod.yml`) runs **redis**, **db** (PostgreSQL), **sandbox**, **backend**, **frontend** and **caddy** (TLS), and has **no worker**.

---

## Environments

| Environment | Compose file | Database | Workflows | Public URL |
|---|---|---|---|---|
| Local dev | `docker-compose.yml` | SQLite (`backend_data` volume) | Sync (`RUN_WORKFLOWS_ASYNC=False`) | `http://localhost:3000` |
| Local dev + async | `docker-compose.yml` + `--profile async` | SQLite | Async via Celery + Redis | `http://localhost:3000` |
| EC2 production | `docker-compose.prod.yml` | PostgreSQL (`db` service, `pgdata` volume) | Sync; no worker | `https://aiaas.kaushaljain.com` |

The same `Backend/Dockerfile` and `better-n8n-frontend/Dockerfile` build both local and EC2 images. The difference between environments is **which images are referenced** (`build:` locally, `image:` on EC2) and **which env vars are set**.

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

The EC2 compose file consumes prebuilt images from Docker Hub:

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

### Multi-arch (ARM EC2)
If targeting Graviton, use buildx:

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t kaushaljainai/aiaas-backend:latest --push ./Backend
```

### Tagging strategy
- `:latest` — always points to the most recent push; what EC2 pulls
- `:vYYYY-MM-DD` or `:<git-sha>` — pin a known-good build for rollback

Tag both before pushing:
```bash
SHA=$(git rev-parse --short HEAD)
docker tag kaushaljainai/aiaas-backend:latest kaushaljainai/aiaas-backend:$SHA
docker push kaushaljainai/aiaas-backend:$SHA
```

---

## 3. EC2 Production Deploy

### Host prerequisites (one-time)
- Docker Engine + Compose plugin installed
- `docker-compose.prod.yml`, `Caddyfile` and `.env` placed in the deploy directory
- Inbound security group rules: 80 and 443 only — caddy is the one service that publishes a host port
- Domain `aiaas.kaushaljain.com` resolving straight to the host (no proxy in front)
- Resolve the domain to the *current* host IP before trusting any IP written down
  anywhere (`nslookup aiaas.kaushaljain.com`): the Elastic IP has changed before
  (2026-09-22: `15.252.76.239` → `13.127.148.207`), and `ALLOWED_HOSTS` in the
  compose file carries a hardcoded copy that must be updated to match
- Amazon Linux 2023 minimal ships no cron: `sudo dnf install -y cronie &&
  sudo systemctl enable --now crond` before installing the §5b lines

### Deploy / update flow

Nothing is built on the box: images are built and pushed from a dev machine (§2) and pulled here.

```bash
# On the EC2 host, in the deploy directory. Dump the database first:
docker exec aiaas-db pg_dump -U <user> -Fc <db> > ~/predeploy_$(date +%F).dump

docker compose -f docker-compose.prod.yml pull        # fetch latest :latest images
docker compose -f docker-compose.prod.yml up -d       # recreate changed containers
docker compose -f docker-compose.prod.yml ps          # verify health
docker compose -f docker-compose.prod.yml logs -f backend
```

`up -d` honors existing volumes (`pgdata`, `backend_data`, `backend_media`, `redis_data`, `caddy_data`), so the database, uploaded media and the agent checkpoint file persist across redeploys.

The backend container re-syncs the model catalogue (`populate_models.py`, upsert-only) on every boot after `migrate`, so a redeploy also heals catalogue drift — e.g. new `effort_levels` the database rows predate. If you ever need to run it by hand, `manage.py shell < populate_models.py` silently does nothing (the `__main__` guard does not fire under a piped shell); use `python manage.py shell -c 'import populate_models; populate_models.populate()'` instead.

### No Celery in production
`docker-compose.prod.yml` has no `worker` or `beat` service and pins `RUN_WORKFLOWS_ASYNC=False` — even on the 2 GB box the memory is spoken for by the app services. Schedules sweep on a loop inside the backend process itself (§5b); the remaining periodic work (HITL reminders, recycle-bin purge, run recovery) still runs from host cron.

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
# Edit the backend image: line in docker-compose.prod.yml to that tag, then:
docker compose -f docker-compose.prod.yml up -d backend
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
| `ALLOWED_HOSTS` | Django host header validation | Include domain + the host's *current* EC2 public IP + `backend` for compose internal calls |
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
# REMOVE this line if present (crontab -e on the EC2 host):
# * * * * * cd /path/to/deploy && docker compose -f docker-compose.prod.yml exec -T backend python manage.py run_due_triggers >> /var/log/aiaas-sweep.log 2>&1
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

```bash
# crontab -e on the EC2 host — this is the complete set
0 3 * * 0 cd /path/to/deploy && flock -w 600 /tmp/aiaas-cron.lock docker compose -f docker-compose.prod.yml exec -T backend python manage.py refresh_models >> /var/log/aiaas-models.log 2>&1
```

**Swap containers under the same lock**, so no cron job starts while the
backend is being replaced or is booting (boot plus a job could exceed the
container's memory limit):

```bash
docker compose -f docker-compose.prod.yml pull backend frontend
flock -w 120 /tmp/aiaas-cron.lock docker compose -f docker-compose.prod.yml up -d backend frontend
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
docker compose -f docker-compose.prod.yml exec backend python manage.py run_due_triggers
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
- Production (the `pgdata` volume on EC2) holds real users. Restoring a local dump
  into `aiaas-db` would overwrite real accounts, agent configs and run history
  with dev data — this screws up the experience of the users and is never to be done.

The model catalogue is the one exception, and it is already safe:
`populate_models.py` is upsert-only (`update_or_create` on provider slug / model
value, deactivates retired rows, deletes nothing), so running it — or just
redeploying, since the backend runs it on every boot (§3) — syncs models without
touching user data.

Allowed direction: prod → local (for debugging production state locally):

```bash
# On the EC2 host: dump prod (custom format, safe to copy down)
docker exec aiaas-db pg_dump -U <user> -Fc <db> > ~/aiaas_prod_$(date +%F).dump
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
docker compose -f docker-compose.prod.yml logs -f backend
docker compose -f docker-compose.prod.yml logs --tail=200 frontend
```

Application logs also stream via WebSocket to the frontend's execution panel — see `streaming/consumers.py` and the `logs/` app.

### Storage hygiene
On the EC2 host (and dev machines):
```bash
docker system df                    # see what's taking space
docker image prune                  # dangling images
docker system prune -a --volumes    # nuclear — drops unused volumes too
```

On Windows dev, if C: fills up despite this, the issue is the WSL2 VHDX not shrinking — see [learning/11_docker_wsl_storage_relocation.md](./learning/11_docker_wsl_storage_relocation.md) for the relocation recipe and `sparseVhd=true` `.wslconfig` setting.

### Backups
The database lives in the `aiaas-db` container. The backend image has no
`pg_dump`, so `manage.py backup_db` refuses in production — dump through the
database container instead:

```bash
docker exec aiaas-db pg_dump -U <user> -Fc <db> > ~/aiaas_$(date +%F).dump
```

Also worth keeping: the `backend_media` volume (user-uploaded files) and
`backend_data` (the agent checkpoint file).

---

## 7. CI/CD (Future / Optional)

The repo currently builds and pushes manually. A GitHub Actions workflow would:

1. On push to `main`: run backend tests (`python manage.py test`) and frontend lint+build
2. Build both Docker images with the commit SHA as tag
3. Push to Docker Hub as `kaushaljainai/aiaas-backend:<sha>` and `:latest`
4. SSH into EC2 and run `docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d`

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

# Deploy on EC2
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d

# Health
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f backend
```
