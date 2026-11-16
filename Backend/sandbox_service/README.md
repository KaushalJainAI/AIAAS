# `sandbox_service/`: the container that runs the AI's Python

The container behind `execute_python` and `run_python_on_files`. The AI writes
Python, and this small separate program runs it inside a locked-down container.

It is **not** part of the Django app, and the backend never imports it. The
backend sends code over HTTP on a private network that only the two share. The
backend side is `../sandbox/`.

Design and threat model: [`docs/SANDBOX_EXECUTION.md`](../docs/SANDBOX_EXECUTION.md).

## Files

| File | What it does |
|---|---|
| `server.py` | A small HTTP server with two routes: `GET /health` and `POST /execute`. Runs only a few jobs at once |
| `executor.py` | Starts a fresh restricted process per run: memory and CPU limits, a throwaway working folder, and the whole process group killed on timeout |
| `runner.py` | The code that runs inside that process. Prints one JSON result |
| `Dockerfile` | The image: Python 3.12 slim, numpy and pandas, non-root user |
| `requirements.txt` | Kept very small, because this process runs untrusted code |

## Request and reply

Send `{"code": "..."}`. To give the code files, add `"files": {"name": "<base64>"}`.
To get files back, add `"collect": ["name"]`.

Every run answers in the same shape. The in-process fallback answers the same way:

```json
{"success": true, "result": 42, "output": "stdout…", "stderr": "", "error": null, "timed_out": false}
```

When files were collected, the reply also has `files_out`.

## Running it

Normally it starts with everything else: `docker compose up --build` locally.

For a quick check without Docker (uses your own Python; numpy only works if you have it):

```bash
cd Backend/sandbox_service && python server.py
curl -s -XPOST localhost:8100/execute -H 'Content-Type: application/json' -d '{"code":"result=2+2"}'
```

## Rules

- The container is the real wall. Process limits and seccomp are extra depth. See the design doc for the layers.
- The service has no authentication. It relies on its network having no route in from outside.

## Tests

`sandbox_service/tests/`: `test_executor.py` (runs real processes), `test_files.py`, `test_concurrency.py`. Run from `Backend/` with `python -m pytest sandbox_service/tests`.
