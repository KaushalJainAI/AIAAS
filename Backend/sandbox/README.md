# `sandbox/`: running the AI's Python safely

The user sees this as code execution: the model writes Python, runs it, and
gets the output back. It serves the `execute_python` and `run_python_on_files`
tools. Not a Django app, just a Python package.

**One entry point:** `engine.py::arun_code`. The `SANDBOX_ENGINE` setting picks the engine:

| Engine | When | How safe |
|---|---|---|
| `service` | Production (docker-compose sets it) | Sends the code to the locked-down container in `../sandbox_service/`. Real confinement |
| `inprocess` | Local development only (the default when unset) | `safe_execution.py`: an AST denylist, then `exec` on a thread. **Much weaker** |

There is no automatic fallback from `service` to `inprocess`. If the service is
down, the tool fails.

## Files

| File | What it does |
|---|---|
| `engine.py` | The one door: `arun_code(code, files=, collect=)` picks the engine and runs the code. Files in and out go through the same call |
| `service_client.py` | Talks to the sidecar over HTTP on the private network |
| `safe_execution.py` | The dev-only in-process engine. A timed-out run is stopped by raising into its thread, and the result says whether that worked |

## Rules

- Never add a second way to run code. Every caller goes through `arun_code`.
- Do not treat `inprocess` as a sandbox. Its limits are described in `safe_execution.py`.

Design: [`docs/SANDBOX_EXECUTION.md`](../docs/SANDBOX_EXECUTION.md). The container: [`sandbox_service/README.md`](../sandbox_service/README.md).

## Tests

`sandbox/tests/`: `test_engine.py`, `test_service_client.py`, `test_timeout_kill.py`, `test_imports.py`.
