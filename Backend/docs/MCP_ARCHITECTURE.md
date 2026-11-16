# MCP architecture

**Model Context Protocol (MCP)** lets the platform call tools running in
external processes. In AIAAS, every MCP server is a live process (or remote
endpoint) exposing a named set of tools. The platform brokers all
interactions: credential injection, session pooling, caching, access control.

This app is the *runtime* surface for MCP. Tools are minted at runtime from
what each server advertises, namespaced so they never collide with built-in
tools, and merged into the chat agent's and agent runs' tool loops.

MCP route list: [API.md](API.md) §10.

## End-to-end

```
Chat message / agent turn
    ▼
chat/tools/__init__.py — get_available_tools()    ← advertises MCP tools
    │   gated by the `mcp` grant, server enabled, credentials present
    ▼
MCPToolProvider.get_openai_tool_descriptors()     ← tool_provider.py
    │   all servers queried concurrently; listing reads storage only
    ▼
MCPToolProvider.execute(name, args, user)         ← resolves mcp__<id>__<tool> binding
    ▼
MCPClientManager.call_tool()                      ← client.py
    │   re-checks visibility + enabled + user preference at connection time
    ▼
CredentialInjector.resolve()                      ← credential_injector.py
    │   decrypts keys from the vault; env vars (stdio) or headers (http/sse)
    ▼
_session() — connection pool
    │   stdio → spawns subprocess + handshake
    ▼
session.call_tool(tool_name, args)  ← MCP SDK
    ▼
_serialise_tool_result()  → JSON-safe dict back to the tool loop
```

There is no workflow node any more; `MCPToolProvider` is the only integration
surface. MCP tool output also flows through the central backstop in
`chat/tools/tool_output.py` like any other tool's output.

## The six components

### 1. MCPServer + MCPServerPreference (`models.py`)

`MCPServer` describes one server:

| Field | Purpose |
|---|---|
| `type` | `stdio` (subprocess), `http` (streamable HTTP), `sse` (deprecated), `native` (built-in tools) |
| `command` / `args` | Executable + arguments for stdio servers |
| `url` | Endpoint for `http`/`sse` servers |
| `env` | Non-secret environment variables (write-only over the API) |
| `required_credential_types` | Credential slugs that must exist before any tool call |
| `credential_env_map` | `ENV_VAR → "slug:field"` for stdio injection |
| `credential_header_map` | `Header-Name → "Bearer {slug:field}"` for `http`/`sse` |
| `user` | `NULL` = system-wide (read-only for everyone but the toggle); set = user-private |

`MCPServerPreference` holds **per-user** enable/disable state; a missing row
means "inherit `MCPServer.enabled`". System-wide servers are shared templates
— one user turning Gmail off must not turn it off for everyone, so per-user
toggles live in preference rows. The serializer exposes `effective_enabled`
and the API lists the user's `disabled_server_ids` once per request.

`command` is validated against `ALLOWED_STDIO_COMMANDS` in `serializers.py` —
a stdio server is spawned with the user's credentials in its env, so an
unrestricted command would be arbitrary code execution by any authenticated
user. `http`/`sse` URLs are checked against private/link-local addresses at
registration **and re-checked at every connection** (DNS rebinding).

### 2. MCPClientManager (`client.py`)

The single object callers use for `list_tools` and `call_tool`. It hides
pooling entirely.

**Connection pool:** one live `ClientSession` per `(server_id, user_id)`,
kept for a TTL. Starting a stdio server is expensive, so the pool pays that
once, not per call. Sessions are not concurrency-safe, so an `asyncio.Lock` per entry
serialises callers.

**Each session lives in its own task.** `_SessionWorker` opens the transport
and unwinds its own exit stack when evicted. Both transports are built on
anyio task groups, and a task group may only be exited by the task that
entered it — a pooled session is opened by whichever request needed it
first and evicted by whichever request notices it expired. A naive close
raised `RuntimeError: Attempted to exit cancel scope in a different task…`
and orphaned the subprocess.

**Lifecycle:** first call → evict stale → spawn worker → handshake → store;
subsequent calls reuse the session and refresh TTL; error mid-call → evict;
connect failure → remembered for a TTL.

**Budgets** (`client.py`):

| Constant | Value | Bounds |
|---|---|---|
| `CONNECT_TIMEOUT` | 25 s | Opening a session (spawn + install + handshake) |
| `LIST_TOOLS_TIMEOUT` | 30 s | `GET /tools/` — a person is watching a spinner |
| `RPC_TIMEOUT` | 15 s | `list_tools` on an open session |
| `CALL_TOOL_TIMEOUT` | 120 s | One tool call |
| `CLOSE_TIMEOUT` | 5 s | Waiting for a worker to unwind before cancelling |
| `SESSION_TTL` | 300 s (`MCP_SESSION_TTL`, 120 in prod) | How long an idle session holds its subprocess |
| `FAILURE_TTL` / `BUDGET_FAILURE_TTL` | 60 s / 10 s | How long a connect failure — or a memory refusal — is remembered |

`MCP_DISABLED=True` is the emergency brake: every listing path returns no
tools without spawning anything.

### 3. Native connectors — a card is not a process

Gmail, Google Drive, Google Sheets and Google Calendar are `type='native'`
rows (migration `0019`). Their tools are built-ins in `chat/tools/google/`
calling Google's REST APIs from the web process with the user's
`google-oauth2` token; each declares `@tool(connector=<icon_slug>)`.

Every curated connector used to be an `npx` server — 70–150 MB of Node — on
a 384 MB container. Google's hosted MCP servers were (and are) Workspace
Developer Preview needing per-project enablement, so REST was the stable
base. The row stays because it *governs* the connector:

| Concern | Mechanism |
|---|---|
| On/off per user | `MCPServerPreference` |
| Needs an account | `required_credential_types=['google-oauth2']` |
| Agent scope | `agent_context['connectors']` server ids |
| Approval | `permissions.carries_credentials` is True, so unattended runs gate reads |

`mcp_integration/native.py::live_native_connectors` answers which cards are
live (enabled for the user **and** credential held); chat's
`get_available_tools` and `execute_tool`, and the agent toolbox, all consult
it — both doors, as for MCP. A native row is excluded from
`get_openai_tool_descriptors`, `list_tools` answers from the registry, and
`_session` refuses it outright.

Chat (the orchestrator) is offered only the **read** half of connectors —
native tools with `effect="read"`, MCP tools whose names pass
`looks_read_only` — and refuses the rest in `execute_chat_tool`. See
CLAUDE.md, "Core rules".

`MCP_ALLOW_STDIO` (False in `settings/deployment.py`) refuses stdio rows at
save and at connect; the image carries no Node. Gmail's and Drive's
restricted scopes need a CASA assessment past 100 users.

### 4. Listing never starts a connector

Which tools exist is a question about a catalogue, and the catalogue is on
disk (`MCPToolCatalogue`, Redis in front). `list_tools(cached_only=True)`
answers from storage or returns `[]` and queues a refresh; **a connector
starts when a tool is called**. Background refreshes drain through one
serial queue. Tests: `tests/test_listing_never_spawns.py`.

### 5. The memory budget (`supervisor.py`)

`MAX_POOLED_SESSIONS` is a *cache* policy — which already-connected session
to drop. It cannot prevent an OOM when eight connectors are all mid-start.
The supervisor is an admission control:

`supervisor.admit()` reserves an estimate *before* a spawn, evicting
least-recently-used idle sessions until it fits and refusing — inside
`ADMIT_WAIT_SECONDS` — when nothing can be freed. `commit()` attributes the
processes that appeared, so later admissions reason in measured megabytes
(`/proc`) rather than a default. Past `CONTAINER_HIGH_WATER` the container's
own cgroup usage is a backstop: connectors lose rather than daphne.
Eviction frees the accounting synchronously and kills the process tree.

| Env | Default | Meaning |
|---|---|---|
| `MCP_MEMORY_BUDGET_MB` | 150 | Total resident MB for all connectors; 0 disables |
| `MCP_MAX_CONCURRENT_STARTS` | 1 | Connectors that may be starting at once |
| `MCP_DEFAULT_CONNECTOR_MB` | 110 | Assumed cost until measured |
| `MCP_ADMIT_WAIT_SECONDS` | 10 | How long an admission waits for room |
| `MCP_CONTAINER_HIGH_WATER` | 0.85 | Ceiling on the cgroup limit; a start must fit *below* it |

Measured in the 384 MB image, one process per connector: **memory 69 MB,
Gmail ~150 MB**. The container check compares `cost` against *headroom*, not
a usage fraction against a ceiling — at 220 MB daphne + one 70 MB connector
the container is at 76%, and the next connector to admit is the 150 MB one;
admitting it reaches 440 MB and the kernel kills daphne without anything
having looked over the mark.

Tests: `tests/test_supervisor.py`.

### 6. Direct `node` launch (`launch.py`)

`npx -y <pkg>` is two Node processes: the launcher (kept resident) and the
server. When the package is provably installed under `MCP_PACKAGE_ROOT`
(default `/opt/mcp/node_modules`), the launch is rewritten to `node <pkg>/<bin>`,
which halves per-connector memory. Catalogue rows keep saying `npx -y`;
anything not installed starts exactly as before. The image itself carries no
Node (see the Dockerfile), so this matters only where Node is installed.
Tests: `tests/test_launch.py`.

## CredentialInjector (`credential_injector.py`)

Translates the server's mapping config into concrete env vars and HTTP
headers using the user's encrypted vault.

```json
{ "GITHUB_TOKEN": "github_token:api_key" }
```

Reads the `api_key` field from the user's `github_token` credential, sets
`GITHUB_TOKEN=<decrypted value>` in the subprocess environment. Header maps
support `{slug:field}` template strings, e.g. `"Bearer {github_token:api_key}"`.
Field lookup also falls back to a Credential's `access_token`/`refresh_token`
columns, where the OAuth flow stores tokens.

- Credentials are decrypted only inside `CredentialInjector.resolve()`,
  immediately before transport open.
- Decrypted values never enter Django logs, never reach the frontend, never
  leave the server process boundary.
- `CredentialInjector.validate()` is a dry-run returning error strings, used
  by `/validate_credentials/`.

## MCPToolCache (`tool_cache.py`)

Redis wrapper for `list_tools` responses. Tool schemas change rarely.

| Behaviour | Detail |
|---|---|
| TTL | 1800 s soft; a stale entry is still served and refreshed, up to a 86400 s hard TTL |
| Key | `mcp_tools:v3:{server_id}:user:{user_id or "system"}` |
| Invalidation | update, delete, set-enabled and the preference write path |
| Fallback | cache error → logged and suppressed; cache miss → live fetch |

## MCPToolProvider (`tool_provider.py`)

The bridge between MCP servers and the platform's tool loops, and the only
consumer of the pool on the agent path. Tool names are namespaced:

```
mcp__<server_id>__<tool_name>_<sha1-digest-8>
```

- **`get_openai_tool_descriptors(user, server_ids=None)`** — OpenAI-format
  specs for every tool on every enabled server visible to the user, queried
  concurrently. Listing reads storage only and never starts a connector. A
  server with a missing
  credential is **skipped entirely**. `server_ids` narrows the set to a
  chosen few connections: an agent run passes its own `connectors` selection;
  chat passes `None`. Narrowing is applied *after* `get_servers_for_user`, so
  a stale id only ever takes tools away.
- **`execute(name, arguments, user)`** — resolves the namespaced name back to
  its server and tool, calls it, returns a string. Credential and permission
  failures become structured error JSON with `code`s
  (`credential_missing`, `credential_invalid`, `tool_not_found`,
  `tool_error`) — the loop never crashes.

`chat/tools/__init__.py` advertises MCP tools only when the `mcp` grant is
held (agents) / the MCP capability is on (chat); a failure inside
`mcp_integration` costs the user their MCP tools, not the built-ins.

## Permission policy (`chat/tools/permissions.py`)

A credentialed MCP call is gated unless its name begins with a read-only
verb (`get_`, `list_`, `read_`, `search_`, `fetch_`, `query_`). The allowlist
is that way round on purpose — guessing "write" costs a click, guessing
"read" sends the email. Reads are exempt in chat (a human is watching);
`unattended_policy` withdraws that exemption for agent runs.

## Credential readiness — where it is checked

1. **At advertisement** — a server whose required credentials are missing or
   invalid is skipped; its tools never appear.
2. **At execution** — a credential that disappeared between turns becomes
   structured error JSON, not an exception.

## Visibility rules

| Server `user` | Who can see it |
|---|---|
| `NULL` | All authenticated users (system-wide) |
| `user_id=42` | Only user 42 |

`_visible_servers_queryset` (in `client.py`) enforces both halves: system +
own rows, `enabled=True`, minus servers the user turned off via
`MCPServerPreference`. `MCPClientManager` re-checks visibility at connection
time, so a server deleted mid-execution raises `PermissionDenied`.

Ownership rules: **system-wide servers are read-only config** — any PATCH
403s, **except** a body of exactly `{enabled}` (a per-user preference write,
200). `set-enabled` works uniformly for system and owned servers, so the UI
renders one toggle.

## Debugging

- Credential errors: `GET /api/mcp/servers/{id}/validate_credentials/`.
  While a required credential is missing, the server's tools are not
  advertised at all.
- Connection failures (502 from the tools endpoint): check `command` is on
  `PATH`; for `http`/`sse`, check reachability. `GET .../tools/` reports the
  child process's stderr, so a nonexistent package says `npm error 404`, not
  `TimeoutError`.
- A failed connect is cached for 60 s. When retrying a fix, wait it out or
  restart the process — otherwise the second attempt replays the first
  error.
- Stale tool list: the cache is fresh for 1800 s; updating, deleting, or
  toggling a server invalidates it.

## Source map

| File | Role |
|---|---|
| `mcp_integration/models.py` | `MCPServer` + `MCPServerPreference` |
| `mcp_integration/client.py` | connection pool + `MCPClientManager` |
| `mcp_integration/tool_provider.py` | runtime tool minting + dispatch |
| `mcp_integration/credential_injector.py` | credential resolution + injection |
| `mcp_integration/tool_cache.py` | Redis tool-list cache |
| `mcp_integration/serializers.py` | DRF serializer; `ALLOWED_STDIO_COMMANDS`, SSRF guard, `effective_enabled` |
| `mcp_integration/supervisor.py` | memory admission control |
| `mcp_integration/launch.py` | direct `node` launch for installed packages |
| `chat/tools/permissions.py` | read-verb allowlist |
