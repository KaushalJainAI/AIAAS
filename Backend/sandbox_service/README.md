# `sandbox_service/`: the container that runs the AI's code

The container behind `execute_python`, `run_python_on_files`,
`execute_javascript` and `run_command`. The AI writes Python or JavaScript, or
asks for a few text commands, and this small separate program runs them inside a
locked-down container.

It is **not** part of the Django app, and the backend never imports it. The
backend sends code over HTTP on a private network that only the two share. The
backend side is `../sandbox/`.

Design and threat model: [`docs/SANDBOX_EXECUTION.md`](../docs/SANDBOX_EXECUTION.md).

## Files

| File | What it does |
|---|---|
| `server.py` | A small HTTP server with three routes: `GET /health`, `POST /execute`, `POST /commands`. Runs only a few jobs at once |
| `executor.py` | Starts a fresh restricted process per run: memory and CPU limits, a throwaway working folder, and the whole process group killed on timeout |
| `runner.py` | The code that runs inside that process for Python. Prints one JSON result. Blocks network calls and starting any other program |
| `launch.py` | The same for Node and for commands. Each process it starts may start exactly one program, the one we chose |
| `commands.py` | The list of commands `run_command` may use, and the check that refuses everything else |
| `Dockerfile` | The image: Python 3.12 slim, numpy and pandas, the `node` binary (no npm), the commands, non-root user |
| `requirements.txt` | Kept very small, because this process runs untrusted code |

## Request and reply

`POST /execute` with `{"code": "..."}` runs Python. Add `"language": "javascript"`
or `"typescript"` for Node. To give the code files, add
`"files": {"name": "<base64>"}`. To get files back, add `"collect": ["name"]`.

`POST /commands` with
`{"pipeline": [{"command": "grep", "args": ["-i", "error", "app.log"]}, {"command": "wc", "args": ["-l"]}], "stdin": "...", "files": {...}}`
runs the stages as a pipe. There is no shell: arguments go to the program as
written. A command not on the list gets a 400 that says why.

Every run answers in the same shape. The in-process fallback answers the same way:

```json
{"success": true, "result": 42, "output": "stdout…", "stderr": "", "error": null, "timed_out": false}
```

When files were collected, the reply also has `files_out`. A command run also
has `exit_codes`, one per stage.

## The commands

Look at files: `cat head tail wc ls stat du file`. Search and reshape text:
`grep sed awk cut tr sort uniq paste join comm column nl fold fmt rev tac expand unexpand`.
Compare: `diff cmp`. JSON: `jq`. Encodings and archives:
`base64 md5sum sha1sum sha256sum iconv od gzip gunzip zcat unzip`. Small
generators: `date seq echo printf`.

Left out on purpose: anything that can start another program (`sh`, `bash`,
`python`, `node`, `env`, `xargs`, `find`, `timeout`, `tar`, `zip`, `split`,
`sqlite3`) and anything that talks to the network. `sed` and `awk` always run
in their sandbox mode, and `sort --compress-program` is refused. Adding a
command means adding it to `commands.py` (the image build fails if it is not
installed) and to `RUN_COMMAND_NAMES` in `chat/tools/sandbox.py` (a test fails
if the two lists differ).

## Running it

Normally it starts with everything else: `docker compose up --build` locally.

For a quick check without Docker (uses your own Python; numpy only works if you
have it, and JavaScript and commands need Linux):

```bash
cd Backend/sandbox_service && python server.py
curl -s -XPOST localhost:8100/execute -H 'Content-Type: application/json' -d '{"code":"result=2+2"}'
```

## Rules

- The container is the real wall. Process limits and seccomp are extra depth. See the design doc for the layers.
- The service has no authentication. It relies on its network having no route in from outside.
- No process may start a program we did not choose. Python cannot start one at all; each Node or command process can start only its own.

## Tests

`sandbox_service/tests/`: `test_executor.py` (runs real processes), `test_files.py`,
`test_concurrency.py`, `test_commands.py` (the allowlist, any platform) and
`test_languages.py` (Node, commands and the exec guard, run for real). Run from
`Backend/` with `python -m pytest sandbox_service/tests`; on Windows
`test_languages.py` skips, so run it in the image:

```bash
docker build -t aiaas-sandbox Backend/sandbox_service
docker run --rm --read-only --tmpfs /tmp --cap-drop ALL \
    --security-opt no-new-privileges --network none \
    -v "$PWD/Backend/sandbox_service/tests:/srv/tests:ro" \
    aiaas-sandbox python -m unittest discover -s tests -v
```
