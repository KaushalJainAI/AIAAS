# Code Execution Sandbox

The `execute_python` tool runs untrusted, LLM-authored Python. The threat model
is hostile: assume the code actively tries to escape, read secrets, and reach
the network. Two engines exist, chosen by `SANDBOX_ENGINE`, behind one door.

## One door: `sandbox/engine.py`

```python
from sandbox.engine import arun_code
outcome = await arun_code(code)   # -> {success, result, output, stderr, error, timed_out}
```

`arun_code` picks the engine and returns the same envelope either way. There is
**no automatic fallback**: if the production engine's sidecar is down, a run
fails loudly rather than quietly dropping to the weaker one. Only config
(`SANDBOX_ENGINE`) selects an engine.

## Production engine: the hardened sidecar (`sandbox_service/`)

A **separate container** that runs the untrusted code. The container *is* the
security boundary; the process-level controls inside it are defence in depth.

```
backend  --HTTP(internal network)-->  sandbox container
                                        └─ subprocess per run (rlimits, seccomp)
```

Layers, outermost first:

1. **Container** (`sandbox_service/Dockerfile` + `docker-compose*.yml`):
   - lives only on an `internal: true` docker network — **no route to the
     internet**, no published ports; the backend joins that network to reach it.
   - `cap_drop: ALL`, `security_opt: no-new-privileges`, **read-only root** with
     a small tmpfs `/tmp` for scratch, a **non-root** user.
   - `mem_limit` + `pids_limit` caps.
   - holds **no application code and no secrets** — a full interpreter breakout
     lands in a throwaway container with nothing to steal and nowhere to send it.
2. **Per-run subprocess** (`sandbox_service/executor.py`): a fresh process in its
   own session, so `os.killpg(SIGKILL)` reaps a fork bomb; `setrlimit` for CPU,
   address space (memory), file size and core; a scrubbed environment; an
   ephemeral cwd removed afterwards; a wall-clock timeout that kills the group.
3. **In-child seccomp** (`sandbox_service/runner.py`): a best-effort filter
   blocking socket creation, so a snippet cannot open a connection back to the
   backend over the internal network, and blocking `execve`, so a snippet
   cannot start a shell (`subprocess.run(["bash", ...])`) or any other
   program. Best-effort because the container is the wall; this is the inner
   layer, not the only one.

The sidecar exposes three internal routes (`server.py`): `GET /health`,
`POST /execute {code, language?, wall_seconds?, cpu_seconds?, mem_mb?, files?, collect?}`
and `POST /commands {pipeline, stdin?, files?, ...}`. No auth — the network it
sits on has no route in from anywhere but the backend. A concurrency semaphore
stops a burst from spawning more subprocesses than the box can hold.

### JavaScript and commands (2026-11-24)

Two more things run on the sidecar, and **only** there: the in-process engine
has nothing that could confine Node or a native program, so their tools
(`execute_javascript`, `run_command`) carry `requires="sidecar"` and are not
offered on it (`sandbox/engine.py::sidecar_available`).

- **JavaScript/TypeScript** (`language` on `/execute`): the `node` binary
  copied from the official image (no npm, no packages), run with
  `--permission` so child processes, workers, addons and files outside the
  run's folder are refused, and a heap cap under the memory limit. TypeScript
  is stripped by Node itself (`--input-type=module-typescript`,
  `--experimental-transform-types` for enums). Memory is capped with
  `RLIMIT_DATA`, not `RLIMIT_AS`: V8 reserves about 1 GB of address space
  just to start, so a 256 MB `RLIMIT_AS` kills it before it runs a line.
- **Commands** (`/commands`): a pipeline of up to 5 stages, each a command
  from `sandbox_service/commands.py::COMMANDS` plus an argument list. No shell
  is involved, so `;`, `|`, `$( )` and `>` inside an argument are plain text.
  The list holds text tools (`grep`, `sed`, `awk`, `sort`, `jq`, ...) and
  leaves out everything that can start another program (shells, interpreters,
  `env`, `xargs`, `find`, `tar`, ...). `sed` and `awk` (gawk) always run with
  `--sandbox`; `sort --compress-program` is refused. Input files arrive in
  the run's folder by name; nothing written comes back.
- **The exec guard** (`sandbox_service/launch.py`): both of these run through
  a harness that forks each process and installs a seccomp filter in which
  `execve` succeeds only for the exact buffer holding the chosen binary's
  path, then calls `execve` with that buffer. The program starts; any later
  `execve` (a missed flag, a `system()` call) fails. gawk *without*
  `--sandbox` cannot run `system("id")` under it (`test_languages.py` proves
  it). It **fails closed**: no pyseccomp, nothing runs.

numpy and pandas are installed in the image; they are the whole reason the
sandbox is a container and not a WASM guest (C extensions WASM cannot load).

### Settings

| Env | Default | Meaning |
|-----|---------|---------|
| `SANDBOX_ENGINE` | `inprocess` | `service` (prod) or `inprocess` (dev). Compose sets `service`. |
| `SANDBOX_SERVICE_URL` | `http://sandbox:8100` | Where the backend reaches the sidecar. |
| `SANDBOX_WALL_SECONDS` | `10` | Wall-clock timeout per run. |
| `SANDBOX_CPU_SECONDS` | `8` | Hard CPU-seconds rlimit. |
| `SANDBOX_MEM_MB` | `384` | Per-run memory cap (kept under the container's `mem_limit`). |

## Dev fallback: in-process engine (`sandbox/safe_execution.py`)

`SANDBOX_ENGINE=inprocess` (the default for a bare `manage.py runserver`, since
Windows has none of the POSIX primitives the sidecar needs). It compiles the
code, runs an **AST denylist** validator (blocked imports/builtins/attributes,
including the `mro`/`__subclasses__` class-walk escapes), then `exec`s on a
worker thread with restricted builtins and a `PyThreadState_SetAsyncExc` timeout
kill (`_stop_thread`).

This is **explicitly the weaker engine** and is for local development only. An
AST denylist is not a real isolation boundary — it guards against an infinite
space of expressions by pattern — which is exactly why production uses the
container instead.

## Deploying the sidecar

- Local: `docker compose up --build` brings up the `sandbox` service alongside
  the backend.
- EC2: push `kaushaljainai/aiaas-sandbox:latest` from a dev machine, then
  `docker compose -f docker-compose.prod.yml pull sandbox && ... up -d` on the
  box — nothing is built there. A run's memory is capped by
  `SANDBOX_MEM_MB`.

## Tests

- `sandbox/tests/test_engine.py` — engine selection, no-fallback rule, service
  client normalization, in-process AST hardening.
- `sandbox/tests/test_timeout_kill.py` — the in-process timeout actually stops
  the thread.
- `sandbox_service/tests/test_executor.py` — the subprocess executor: result
  capture, error reporting, timeout kill, and (POSIX) the memory cap.
- `sandbox_service/tests/test_commands.py` — the command allowlist (any platform).
- `sandbox_service/tests/test_languages.py` — Node, TypeScript, command
  pipelines and the exec guard, run for real; skips off the image, so run it in
  the container (command in `sandbox_service/README.md`).
- `chat/tests/test_sandbox_languages.py` — the backend half: both tools
  offered only on the sidecar, the `codeExecution` grant, approval sets, and
  the command list the model reads equal to the sidecar's.
