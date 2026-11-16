# Deployment Runbook

How to build, deploy, roll back and back up AIAAS. For what each part is, read [INFRASTRUCTURE_SIMPLE_GUIDE.md](./INFRASTRUCTURE_SIMPLE_GUIDE.md). For every environment variable, read [Backend/.env.example](./Backend/.env.example). Open items are listed in [Backend/docs/OPEN_WORK.md](./Backend/docs/OPEN_WORK.md).

---

## 1. Prerequisites

**Dev machine**
- Docker with the Compose plugin, and a Docker Hub login that can push `kaushaljainai/aiaas-*`.
- The SSH key for the VM.
- A benchmark account with an OpenRouter key (used by the deploy gate in §2).

**Production VM**
- Google Cloud Compute Engine, `e2-medium` (2 vCPU, 4 GB RAM).
- The VM is **shared with another project** (NGU, containers `ngu-*`). Both share the 4 GB. Run compose from `~/aiaas` only, so a deploy never recreates `ngu-*` or `edge-caddy`.
- A **reserved static** external IP. An ephemeral IP changes when the VM stops, and then DNS points nowhere.
- Firewall: inbound TCP 80 and 443, plus SSH. Nothing else is public.
- DNS: `aiaas.kaushaljain.com` resolves to the VM's IP (`nslookup aiaas.kaushaljain.com`). `ALLOWED_HOSTS` in the server's compose file holds the same IP, so change both if it changes.
- Layout: `~/aiaas` holds `docker-compose.yml`, `.env` and `pg_backup.sh`. `~/edge` holds the shared `edge-caddy` proxy and its `Caddyfile`.
- `.env` holds `CREDENTIAL_ENCRYPTION_KEY`. Keep a copy **off the VM**. Without that key, a restored database's stored credentials cannot be read.

The server's `~/aiaas/docker-compose.yml` is the repo's `docker-compose.prod.yml` without its `caddy` service. Edit the server file in place. Do not copy the repo file over it, and do not run the repo file on the VM: its `caddy` service would fight `edge-caddy` for ports 80 and 443.

---

## 2. Build and Push (dev machine)

Nothing is built on the VM. Run the deploy gate first. It runs on the dev machine against the dev database, never on the production box:

```bash
cd Backend
pytest -q
python manage.py benchmark run --tier smoke --gate --user <benchmark account>
```

Build the three images and tag each with `:latest` and the git SHA. The SHA tag is what you roll back to.

```bash
SHA=$(git rev-parse --short HEAD)
docker build -t kaushaljainai/aiaas-backend:latest ./Backend
docker build -t kaushaljainai/aiaas-sandbox:latest ./Backend/sandbox_service
docker build -t kaushaljainai/aiaas-frontend:latest ./better-n8n-frontend

for img in aiaas-backend aiaas-sandbox aiaas-frontend; do
  docker tag kaushaljainai/$img:latest kaushaljainai/$img:$SHA
  docker push kaushaljainai/$img:latest
  docker push kaushaljainai/$img:$SHA
done
```

- The frontend needs no build arguments. It calls `/api` and `/ws` on its own origin, and nginx forwards them.
- The VM is x86-64. For an ARM machine, use `docker buildx build --platform linux/amd64,linux/arm64 --push`.

---

## 3. Deploy

```bash
ssh -i ~/.ssh/id_ed25519 kaushaljain7000@34.0.5.162
cd ~/aiaas
./pg_backup.sh                          # dump first (see §7)
docker compose pull backend frontend sandbox
docker compose up -d backend frontend sandbox
docker compose ps                       # wait until every service is healthy
docker compose logs -f backend
```

Checklist:
- [ ] Dump taken with `./pg_backup.sh`, and copied off the VM (§7).
- [ ] Images pulled.
- [ ] `docker compose ps` shows every service healthy.
- [ ] The checks in §9 pass.

On start, the backend runs `manage.py boot` (migrate, then seed the catalogue) and then `exec daphne`. A restart takes about 11 seconds. Open streams drop, and clients reconnect. Named volumes (`pgdata`, `backend_data`, `backend_media`, `redis_data`) survive `up -d`, so the database, uploads and agent checkpoints are kept.

If the new backend does not reach healthy, read `docker compose logs backend`. Then roll back (§8). Do not wait for it to recover on its own.

| Environment | Compose file | Database | Public URL |
|---|---|---|---|
| Local dev | `docker-compose.yml` | SQLite | `http://localhost:3000` |
| Production | `~/aiaas/docker-compose.yml` on the VM | PostgreSQL | `https://aiaas.kaushaljain.com` |

Production runs no Celery worker and no beat service. Agent runs are detached tasks inside the backend process.

---

## 4. Migrations

- Migrations run on every backend start, through `manage.py boot`. Do not run them by hand in production unless you must.
- A migration cannot be undone by redeploying. Take a dump before each deploy (§3). Read the migration first if it drops or rewrites columns.
- The model catalogue (`populate_models.py`) is upsert-only and runs once per container after migrate. A crash restart does not reseed. A new deploy does.
- After restoring a database by hand, reseed:
  `docker compose exec backend python manage.py boot --force-seed`
- To run the catalogue sync by hand, use `shell -c`, not a piped `shell`, which does nothing silently:
  `docker compose exec backend python manage.py shell -c 'import populate_models; populate_models.populate()'`

---

## 5. Production Configuration

Values from `docker-compose.prod.yml`:

| Service | Image | Memory limit | Notes |
|---|---|---|---|
| backend | `kaushaljainai/aiaas-backend` | 768 MB (256 MB reserved) | Daphne. App DB pool 2 to 16. `AGENT_CHECKPOINTER=postgres`, pool 4. `SANDBOX_ENGINE=service`. `DEBUG=False`. Stdio MCP off. |
| frontend | `kaushaljainai/aiaas-frontend` | 128 MB | nginx: serves the React build, proxies `/api` and `/ws`. |
| sandbox | `kaushaljainai/aiaas-sandbox` | 600 MB | Runs `execute_python`. Two slots, 256 MB per run, no network. |
| db | `postgres:16-alpine` | 512 MB (`shm_size` 256 MB) | `max_connections=40`, `shared_buffers=128MB`. |
| redis | `redis:7-alpine` | 192 MB | `maxmemory 128mb`, `allkeys-lru`. Channel layer and cache. |

- **Total:** about 2.2 GB of limits. NGU shares the 4 GB VM. Run `docker stats --no-stream` before you raise any limit.
- **Connection budget:** the backend's app pool (`DB_POOL_MAX_SIZE`, 16) plus its checkpointer pool (`AGENT_CHECKPOINT_POOL_MAX`, 4) must stay below Postgres `max_connections` (40). The rest is for psql, migrations and `pg_dump`. A second backend process doubles the app side.
- **Config source:** `.env` is loaded through `env_file`. The compose `environment:` block overrides it. Do not set `DB_ENGINE` or `DATABASE_URL` in compose. Doing that once left production silently on SQLite.
- **Run state:** agent checkpoints live in Postgres. This needs a backend image from 2026-10-01 or later.
- **Edge proxy:** `edge-caddy` owns ports 80 and 443. It sends `aiaas.kaushaljain.com` to `aiaas-frontend:80` and sends every other host, including the bare IP, to NGU. To change routing, edit `~/edge/Caddyfile` and run `docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile`. The repo's `Caddyfile` is for a dedicated box and is not used on this VM.

---

## 6. Schedules and Background Jobs

Schedules, reminders, run recovery and the other periodic jobs run inside the backend process, under a database lease. Production has no cron and no Celery. Do not add cron lines that call `manage.py` for these: each `docker compose exec` starts a second Django process inside the backend's memory limit. See [REALTIME_AND_PROTOCOLS_SIMPLE_GUIDE.md](./REALTIME_AND_PROTOCOLS_SIMPLE_GUIDE.md) §7.

---

## 7. Backups

- [ ] **Nightly dump.** `~/aiaas/pg_backup.sh` runs from the user crontab. It writes `~/aiaas/backups/app_db-<stamp>.dump.gz`. The log is `~/aiaas/backups.log`. Confirm the cron line with `crontab -l`. The dump sits on the VM's own disk.
- [ ] **Pre-deploy dump.** Run `./pg_backup.sh` before every deploy.
- [ ] **Off-VM copy.** Not set up. Dumps and uploads (`backend_media`) need copying to a bucket. Tracked in OPEN_WORK.md.
- [ ] **Disk snapshot schedule** on the boot disk. Not set up.
- [ ] **Copy of `.env`** kept off the VM, in a password manager.
- [ ] **Restore test.** Restore the latest dump into a local Postgres and sign in. Never restore into `aiaas-db`.

A backup on the same disk as the database is not a backup.

Not in the dump: `backend_data`, `backend_media` (uploads, see the off-VM copy above) and `redis_data` (cache and live channels). Agent checkpoints live in Postgres, so the dump includes them.

Production data flows one way only. To debug with production data, dump it and restore it into a local Postgres:

```bash
docker exec aiaas-db pg_dump -U admin -d app_db -Fc > ~/aiaas_prod_$(date +%F).dump
# copy the file to the dev machine, then, into a LOCAL Postgres only:
pg_restore -U <localuser> -d <localdb> --clean ~/aiaas_prod_<date>.dump
```

---

## 8. Rollback

Pin the previous image by its tag. The SHA from §2 is one option.

```bash
cd ~/aiaas
# edit the backend (and frontend) image: line in docker-compose.yml to the old tag, then:
docker compose pull backend
docker compose up -d backend
```

- To undo a migration, restore the pre-deploy dump into `aiaas-db` with `pg_restore --clean`. Everything written after the dump is lost.
- To stop using Postgres for checkpoints, set `AGENT_CHECKPOINTER: sqlite` and `AGENT_CHECKPOINT_PATH: /app/data/checkpoints.sqlite3` in the server's compose file, then `docker compose up -d backend`. Runs paused at that moment lose their state.

---

## 9. Health Checks

Compose health checks (`docker compose ps` shows them):

| Service | Check |
|---|---|
| redis | `redis-cli ping` |
| db | `pg_isready` |
| sandbox | `GET /health` on the sidecar |
| backend | `GET /api/health/` (90 s start period) |
| frontend | `GET /health` on nginx |

The backend waits for db, redis and sandbox. The frontend waits for the backend.

From outside the VM:

```bash
curl -s https://aiaas.kaushaljain.com/api/health/                       # {"status": "healthy", ...}
curl -sI https://aiaas.kaushaljain.com/ | grep -i last-modified        # when the frontend image was built
curl -s -o /dev/null -w '%{http_code}\n' https://aiaas.kaushaljain.com/api/<new-route>/   # 401 = deployed, 404 = not
```

A signed-in `GET /api/orchestrator/triggers/health/` says whether the in-process scheduler holds its lease.

Logs:

```bash
docker compose logs -f backend
docker logs --tail=200 edge-caddy
```

Container logs are `json-file`, capped at 10 MB by 3 files.

Disk: `docker system df` shows usage, and `docker image prune` removes dangling images. Never run `docker system prune -a --volumes` on the VM. It removes unused volumes, and a stopped database's volume is one of them. On a Windows dev machine whose C: drive is full, see [learning/12_docker_build_speed_and_deploy.md](./learning/12_docker_build_speed_and_deploy.md), "Docker's disk on Windows".

---

## 10. Local Development

- Copy `Backend/.env.example` to `Backend/.env.local`. The local compose file reads that name. Set `SECRET_KEY`, `CREDENTIAL_ENCRYPTION_KEY` and `OPENROUTER_API_KEY`.
- `docker compose up --build` starts redis, backend (SQLite in `backend_data`), frontend and sandbox. Ports: 3000 (web), 8000 (API), 6379 (Redis).
- `docker compose --profile async up` adds a Celery `worker` and `beat`. Local only.
- For day-to-day work, run `npm run dev` in `better-n8n-frontend` (port 5173, hot reload) and `python manage.py runserver` in `Backend`. The compose images copy code at build time, so they do not reload.
- Local data never goes into production (§7).
