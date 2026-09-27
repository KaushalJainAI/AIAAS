# Model Context Protocol (MCP)

> Source: `Backend/mcp_integration/`, `Frontend/src/api/mcp.ts`, `Frontend/src/pages/MCPServers.tsx`
> Commits: `4ca3cf0` (frontend), `93281ba`, `bca505f` (backend)

---

## What is MCP?

Model Context Protocol is an open standard (by Anthropic) for connecting LLMs to external tools and data sources. Think of it as USB-C for AI — a single protocol so any AI model can talk to any tool server.

Before MCP: every AI product implemented its own tool format. After MCP: tools are described and invoked the same way, regardless of which model or framework is using them.

**Official repo:** [github.com/modelcontextprotocol](https://github.com/modelcontextprotocol)

---

## Two Transport Types

```typescript
export type MCPServerType = 'stdio' | 'sse';
```

| Type | How it works | Use case |
|------|-------------|----------|
| `stdio` | Child process; communicate via stdin/stdout | Local tools (CLI scripts, local databases) |
| `sse` | HTTP Server-Sent Events to a URL | Remote tools, cloud services, hosted servers |

**stdio example:** `command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"]`
**sse example:** `url: "https://mcp.example.com/sse"`

---

## The MCP Server Model (What Gets Stored)

```typescript
export interface MCPServer {
  id: number;
  name: string;
  type: MCPServerType;         // 'stdio' | 'sse'
  
  // Stdio fields
  command?: string;            // e.g., 'npx'
  args?: string[];             // e.g., ['-y', '@mcp/server-github']
  
  // SSE fields
  url?: string;                // e.g., 'https://api.example.com/mcp'
  
  // Environment + credentials
  env?: Record<string, string>;
  credential_env_map?: Record<string, string>;  // credentialId → env var name
  credential_header_map?: Record<string, string>; // credentialId → HTTP header name
  
  required_credential_types?: string[];  // what the user must configure
  enabled: boolean;
}
```

**Credential injection:** When the backend starts an MCP server, it reads the user's stored credentials (AES-decrypted from the DB), maps them to env vars or HTTP headers, and passes them to the MCP client. The user never writes API keys into the MCP config directly.

---

## How MCP Tools Are Called (in this codebase)

```python
# In chat/tools.py and buddy/views.py
from mcp_integration.client import MCPClientManager, get_all_tools_from_all_servers

# Get all available tools from all enabled MCP servers
tools = await get_all_tools_from_all_servers(user)
# tools is a list of: {"name": "...", "description": "...", "inputSchema": {...}, "server_name": "..."}

# Invoke a specific tool
result = await client_manager.call_tool(server_name, tool_name, arguments)
```

The chat agent includes these tools in its tool list alongside built-in tools (Python sandbox, HTTP requests, etc.). The LLM selects which tool to call based on the user's question.

---

## Tool Caching (Performance Pattern)

MCP server tool lists are fetched once and cached:

```python
# From commit 93281ba — mcp: add credential injection, tool caching
_tool_cache = {}  # {user_id: {"tools": [...], "cached_at": datetime}}

async def get_all_tools_from_all_servers(user):
    cache_key = user.id
    if cache_key in _tool_cache:
        cached = _tool_cache[cache_key]
        if (datetime.now() - cached["cached_at"]).seconds < 300:  # 5-min TTL
            return cached["tools"]
    
    tools = await _fetch_tools_from_all_servers(user)
    _tool_cache[cache_key] = {"tools": tools, "cached_at": datetime.now()}
    return tools
```

Why cache: connecting to MCP servers (especially stdio) is slow — it spawns a subprocess. Tool schemas rarely change. 5-minute TTL balances freshness vs latency.

---

## Frontend: MCP Service Layer

```typescript
export const mcpService = {
  async list(): Promise<{ servers: MCPServer[] }> {
    const response = await apiClient.get<{ servers: MCPServer[] }>('/mcp/servers/');
    return response.data;
  },
  async create(data: CreateMCPServerData): Promise<MCPServer> {
    const response = await apiClient.post<MCPServer>('/mcp/servers/', data);
    return response.data;
  },
  async update(id: number, data: Partial<CreateMCPServerData>): Promise<MCPServer> {
    const response = await apiClient.patch<MCPServer>(`/mcp/servers/${id}/`, data);
    return response.data;
  },
  async delete(id: number): Promise<void> {
    await apiClient.delete(`/mcp/servers/${id}/`);
  },
  async test(id: number): Promise<{ success: boolean; tools: string[]; error?: string }> {
    const response = await apiClient.post(`/mcp/servers/${id}/test/`);
    return response.data;
  },
};
```

`Partial<CreateMCPServerData>` for `update` — only send changed fields. This maps to `PATCH` (partial update) rather than `PUT` (full replacement). Always prefer `PATCH` for edit forms.

---

## User-Scoped Access Control

```python
# From commit bca505f — mcp: implement user-scoped access control
class MCPServerViewSet(viewsets.ModelViewSet):
    def get_queryset(self):
        # User sees their own servers + platform-wide servers (user=null)
        return MCPServer.objects.filter(
            Q(user=self.request.user) | Q(user__isnull=True)
        )
    
    def perform_create(self, serializer):
        serializer.save(user=self.request.user)
```

`user=null` servers are platform-wide defaults (like Puppeteer, Filesystem). User-created servers are private. The `Q` object lets you compose OR conditions in Django ORM.

---

## Interview Questions

**Q: What is MCP and why does it matter?**
MCP is a standard protocol for AI-tool integration. Before MCP, connecting an LLM to a database or API required custom integration per model. With MCP, you write one server that works with Claude, GPT, Gemini, etc.

**Q: What's the difference between stdio and SSE MCP servers?**
stdio spawns a local subprocess and communicates via pipes — good for local tools, no network needed. SSE uses HTTP streaming from a remote URL — good for hosted/cloud tools.

**Q: How do you securely pass API keys to MCP servers?**
Store credentials encrypted in the DB. At runtime, decrypt them and inject as environment variables (for stdio) or headers (for SSE). The user configures credentials separately from the MCP server config — they never put raw keys in the MCP config.

**Q: What's `Q` in Django ORM?**
`Q` objects let you compose complex WHERE clauses with OR (`|`), AND (`&`), and NOT (`~`).
`Q(user=request.user) | Q(user__isnull=True)` → `WHERE user_id = ? OR user_id IS NULL`
