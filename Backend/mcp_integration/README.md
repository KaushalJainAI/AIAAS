# `mcp_integration/`: the Connections page

The user sees this as the Connections page: the outside services the assistant
can use (Gmail, Drive, Slack, Notion and others), each with an on/off switch and
the credential it needs. Two kinds of connection sit behind it:

- **MCP servers**: programs that speak the Model Context Protocol. Their tools
  are found at runtime and named `mcp__<server>__<tool>`. They run as a local
  process (`stdio`) or over HTTP.
- **Native connectors** (`type='native'`): Gmail, Drive, Sheets, Calendar and
  **Notion**. Their tools are our own code, in `chat/tools/google/` and
  `chat/tools/notion.py`, calling the vendor's REST API from this process. The
  `MCPServer` row holds only the switch and the credential. Native is the
  default for these because a Node process per connector did not fit the box.

Design: [`docs/MCP_ARCHITECTURE.md`](../docs/MCP_ARCHITECTURE.md) (the old
`MCP_INTEGRATION.md` was folded into it).

## Data (`models.py`)

| Model | What it is |
|---|---|
| `MCPServer` | A connection. `user=NULL` is a shared built-in one everyone sees |
| `MCPServerPreference` | Your own on/off switch for a shared connection |
| `MCPToolCatalogue` | The last known tool list per server, so listing tools never has to start one |
| `MCPToolPin` | What each tool looked like when you connected it |
| `MCPOAuthClient`, `MCPOAuthFlow`, `MCPOAuthToken` | OAuth login for remote MCP servers |

## Files

| File | What it does |
|---|---|
| `client.py` | Opens connections to MCP servers, keeps a small pool, lists and calls tools |
| `tool_provider.py` | Turns MCP tools into tools the AI loop can call |
| `tool_cache.py` | Tool lists: Redis first, then the database, then the server |
| `pinning.py` | Trust on first use. A new tool whose text addresses an AI is held, and a tool whose definition changed is held until you approve it |
| `credential_injector.py` | Fills in the user's credentials when a server starts (env vars, headers or a temp file) |
| `supervisor.py` | Memory budget for local MCP processes, so they cannot take down the server |
| `launch.py` | How a local server process is started |
| `native.py` | Which native connectors are live for a user: switched on **and** credential present |
| `oauth.py` | OAuth for remote MCP servers |
| `views.py`, `urls.py`, `serializers.py` | `/api/mcp/servers/...` |

## Rules

- A local MCP server gets a short allow-listed environment, never the server's own (see `client.py::_build_subprocess_env`).
- Listing tools never starts a server. Only calling a tool does.
- In production `MCP_ALLOW_STDIO=False`, so local-process servers are refused.
- Users cannot add their own servers (`MCP_CUSTOM_SERVERS_ENABLED=False`, every
  environment). Their old rows are kept but reach no agent, and the owner can
  still delete them. Connectors come from the curated catalogue
  (`Backend/docs/CONNECTOR_CATALOGUE_PLAN.md`).
- Connector tools are offered only when the connection is live. A failed read means "not live".

## Tests

`mcp_integration/tests/`: `test_connections.py`, `test_native_connectors.py`,
`test_subprocess_env.py`, `test_supervisor.py`, `test_tool_pins.py`,
`test_custom_servers_retired.py`.
