# MCP connectors: a subprocess per user was the wrong unit

## What happened

The MCP integration started as the obvious design. Each connector is a server
process we spawn (stdio) or a URL we call. The client keeps a pool of live
sessions, lists each connector's tools, and passes them to the agent. Five faults
came out of it, each showing up as a different symptom:

- **Secrets leaked to third-party code.** A stdio connector was started with
  `{**os.environ, ...}`. Under docker-compose that is the whole of `Backend/.env`,
  including the key that encrypts every user's credentials. Every npm package we ran
  could read it.
- **The pool had no size limit.** Sessions expired by age only, so the number of
  live subprocesses depended on how many connectors people had touched. That is the
  shape of an out-of-memory crash.
- **Listing tools started connectors.** One chat turn asked all eight connectors
  for their tools. Each answer was a cold `npx` start (two Node processes), inside a
  384 MB container. The kernel killed the web server.
- **The catalogue claimed packages that do not exist.** Six curated rows named npm
  packages that were never published. The page timed out at 5 seconds, shorter than
  a cold `npx` needs, so a broken connector and a healthy one looked the same.
- **A session was closed by the wrong task.** The transport is an anyio task group,
  which must be exited by the task that entered it. Closing it from another request
  orphaned a subprocess each time.

## The fix

- **Env is an allowlist.** `Backend/mcp_integration/client.py::_build_subprocess_env`
  passes only a short list of names, plus `NODE_`, `NPM_` and `UV_` prefixes. `PATH`
  and `NPM_CONFIG_CACHE` must stay on the list, or `npx` cannot be found or runs cold.
  Matching is case-insensitive, because Windows spells these differently.
- **Pool with a cap and LRU.** `MCP_MAX_POOLED_SESSIONS` bounds live sessions, and
  a session in use is never evicted.
- **A session lives in its own task.** `_SessionWorker` opens and closes the
  transport in the same task.
- **Listing never starts a process.** `list_tools(cached_only=True)` answers from the
  stored catalogue (`tool_cache.py`). Refreshes run through one serial queue.
- **Starting a connector needs memory.** `mcp_integration/supervisor.py` reserves an
  estimate before the spawn, evicts idle sessions to make room, and refuses if it
  cannot.
- **Google connectors are not processes.** Gmail, Drive, Sheets, Calendar and Docs are
  native rows (`type='native'`) whose tools are REST calls in
  `Backend/chat/tools/google/`. Stdio connectors are off in production
  (`MCP_ALLOW_STDIO`).
- **Catalogue rows are checked.** `test_fresh_install.py::CuratedPackageTests` pins
  each enabled package to one that was started and listed.

## The lesson

- **A connector is third-party code.** Give it an allowlisted environment, never
  the process's own.
- **Bound every pool by what it costs, not by age alone.** Age decides how long an
  idle session lives. A cap decides how many can exist.
- **Reading a catalogue must not start work.** A question about what exists should
  never spawn the thing it asks about.
- **Check a claim by running it.** A package name in a config file is a claim.
  Starting it and reading back its tool list is evidence.
- **Async resources have an owner.** Open and close an anyio task group in the same
  task, or it leaks.
- **Prefer code you own over a process you spawn.** Native connectors removed a whole
  class of memory and isolation problems for the connectors that matter most.

## Code

- `Backend/mcp_integration/client.py`: `_build_subprocess_env`, `_SessionWorker`, pool
- `Backend/mcp_integration/supervisor.py`: memory admission
- `Backend/mcp_integration/tool_cache.py`: Redis and database catalogue
- `Backend/mcp_integration/native.py`: live native connectors
- `Backend/mcp_integration/pinning.py`: tool-definition pins
- `Backend/chat/tools/google/`: Gmail, Drive, Sheets, Calendar, Docs tools
- `Backend/mcp_integration/tests/test_fresh_install.py`
