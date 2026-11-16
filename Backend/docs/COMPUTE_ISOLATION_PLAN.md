# Compute isolation — plan (for discussion)

## Status

**For discussion** (2026-09-22). Nothing here is built. Decides the
provider question left open as decision D1 in `PLATFORM_CAPABILITIES_PLAN.md`,
and two questions from the owner: *Docker sandboxes or VMs?* and *per agent
or per user?*

Note: this plan predates the move to the GCP e2-medium box (2 vCPU, 4 GB,
shared with NGU). The "never on our 913 MB box" rule below still applies —
user machines never run on the shared production host either.

## The short answer

1. **Yes to isolation, but a plain Docker container is not enough.**
   Containers share the host kernel — fine for the stateless snippet
   sidecar, not for a machine where a model runs any shell command it
   likes, for hours, with the internet. Use **microVMs** (Firecracker) or
   **gVisor-sandboxed containers**.
2. **Never on the shared production host.** User machines run on a
   provider (or later a separate rented host), sharing no RAM, CPU or
   kernel with the website and database.
3. **One machine per user**, agents separated *inside* it (own folder, own
   limits). Untrusted agents (installed from someone else's template) get
   a **throwaway machine per run** instead.
4. **The plumbing exists.** `workspaces/` has the models, the one-door
   engine, the tools (`workspace_exec`, `start_job`, `ws_*`…), grants and
   the idle sweep. **The engine behind it is a stub**: every method raises
   "no engine configured". The work is mostly one thing — implement the
   engine for one provider.

## What exists today

| Piece | What it is | State |
|---|---|---|
| `sandbox_service/` sidecar | Runs `execute_python` snippets; one container shared by all users; no network, 256 MB per run in production, 30 s max per run | **Live in prod. Keep it.** |
| `workspaces/models.py` | `Workspace` (one per user, `OneToOneField`), `WorkspaceJob`, `CodeProject`, `CodeChange`, `CodeLease` | Built, migrated |
| `workspaces/engine.py` | One door: `ensure / exec / read / write / listdir / hibernate / destroy`; `WORKSPACE_ENGINE = none \| docker \| <provider>` | **Stub. Every call raises.** No `docker` engine exists despite the docstring |
| `chat/tools/compute.py`, `code.py` | `workspace_exec`, `start_job`, `job_status`, `job_logs`, `cancel_job`, `sync_files`, `ws_*`, `git_*` | Built; hidden while engine is `none` |
| `workspaces/sweep.py` | Idle hibernate | Built |

The sidecar can't become the cloud computer: it's **shared** by all users,
safe only because nothing persists, nothing reaches the network, and every
run dies in 30 s. Persistent files, `pip install`, internet access or a
6-hour job change the threat model entirely.

## Docker vs gVisor vs microVM

| | Docker | gVisor (`runsc`) | Firecracker microVM | Full VM |
|---|---|---|---|---|
| Kernel | shared | shared (user-space kernel) | **own** | own |
| Start | <1 s | ~1 s | ~1 s (snapshot: ms) | 30–60 s |
| Memory | ~0 | small | ~5 MB + guest | 100s MB |
| Good for | snippet sidecar | self-host, dev | **user machines (hosted)** | too slow per user |
| Offered by | us | Modal; self-host on Linux | E2B, Fly Machines | AWS |

**Recommendation:** microVMs from a provider for v1 (kernel-level
separation per user without a hypervisor fleet on our box); Docker +
gVisor for local development and as the self-host option. Docker rules if
it's ever used: never mount `/var/run/docker.sock` into the backend
(talk through a narrow launcher service or the provider API), and use
`--runtime=runsc`, an egress proxy, `--memory`, `--pids-limit`,
`--read-only` root + a writable `/home/user`.

## Per user or per agent

**One machine per user** wins on every axis that matters to the product —
shared disk (researcher writes, writer reads), cost, cold starts, `pip`
once per machine, and fit with existing per-user code (`Workspace.user`,
`CodeLease`, `FileScope`). The blast radius is the user's *own* data their
own agent was already allowed to touch. Per-agent machines would need a
model change and every tool re-scoped, and a user with 8 agents would get
8 computers.

Separation *inside* the machine:

- **Folders** — each agent works in its own folder; `FileScope`
  (`read_all_write_own`) applies on the machine's disk as it does in the
  VFS; `CodeLease` stops two runs writing the same file.
- **Per-command limits** — every `exec` under `systemd-run --scope`
  (`MemoryMax`, `CPUQuota`, `TasksMax`, wall-clock timeout).
- **Per-run process group** — a run's processes are killed with it.

**Exception:** agents installed from someone else's template, runs with
`compute` but no `fileAccess`, and anything scheduled + unattended +
`full` get an **ephemeral** machine destroyed at run end (Phase D, later).
Three tiers: snippet sidecar → the user's machine → the ephemeral machine.

## Rules every tier keeps

1. **No platform secrets in a machine** — user secrets enter only as
   `credentials/refs.py` references resolved into *one command's*
   environment after approval, scrubbed from output.
2. **Egress through an allowlist** — default PyPI, npm, GitHub + the
   agent's `workspaceEgress`; always blocked: `169.254.169.254`, our
   backend's private address, private ranges.
3. **Idle hibernate** after 15 min (`WORKSPACE_IDLE_SECONDS`); disk
   survives, RAM doesn't.
4. **Quotas per tier** (machine size, disk, CPU-minutes/day, concurrent
   jobs), metered into `CostEntry(kind='compute')` so the spend cap covers it.
5. **Destroyed with the account.**
6. **The machine can't call our backend** except the job-finished webhook
   (`/api/workspaces/hooks/<secret>/`, opaque 404 like every other
   secret-in-path route).

## Decisions for the owner (§6, answers needed)

| # | Question | Options | Recommendation |
|---|---|---|---|
| C1 | Provider for v1 | E2B · Fly Machines · Modal · Daytona · self-host (gVisor) | Spike **E2B** and **Fly Machines**, pick on the spike table |
| C2 | Who gets a machine | Everyone · paid tiers · invite-only first | **Invite-only first** (machines cost money while awake) |
| C3 | Machine size v1 | 1 vCPU / 1 GB · 2 vCPU / 2 GB · 2 vCPU / 4 GB | **1 vCPU / 2 GB**, 5 GB disk |
| C4 | Keep disk when hibernated? | Yes · No | **Yes** — otherwise it's a sandbox, not "a computer" |
| C5 | Region | India (Mumbai) required? | Near `ap-south-1` |
| C6 | Untrusted-agent ephemeral tier | In v1 · later | **Later** (until then, installed-from-others agents get no `compute`/`shell` grant) |

## Build plan (after the owner answers §6)

**Phase A** — provider spike (1–2 days, throwaway scripts): create, `echo
hi`, `pip install`, write a file, hibernate, resume, verify the file and
the package survived, a 3 GB allocation must be killed, the metadata IP
must fail. Record: disk survives pause, resume time, exec round-trip,
egress controls, PTY/port forward (for the Code tab), idle vs active
cost, Python SDK async?

**Phase B** — the engine: `workspaces/engines/` package (`base.py` +
`<provider>.py`), `workspaces/engine.py` dispatches by `WORKSPACE_ENGINE`,
**no tool changes**. Execution uses the per-command limits; provider SDK
is optional and import-guarded (`workspace_available()` false → tools
hidden); `docker_gvisor.py` is dev-only, never in deployment. Egress via
provider firewall rules or an HTTPS proxy allowlist. Contract tests run
in CI against a fake engine and nightly against the real provider.

**Phase C** — quotas, metering (`CostEntry(kind='compute')` per exec), the
`/computer` page (status / Wake / Sleep / Reset; later a terminal), hibernate
sweep on the in-process scheduler.

**Phase D** — ephemeral per-run machines (optional, after C).

## Not doing

- A machine per agent. - User code on the production host, in any form.
- Mounting the Docker socket into the backend. - GPUs in v1.
- A desktop-style "Files app" over the machine.
- Replacing the snippet sidecar — it stays for `execute_python`.
