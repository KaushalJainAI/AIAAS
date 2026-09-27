/**
 * MCP Service
 * 
 * Management of Model Context Protocol (MCP) servers.
 */

import apiClient from './client';

/**
 * How the backend reaches a server.
 *
 * `http` is MCP's streamable HTTP transport and is what hosted connectors speak
 * (`https://mcp.notion.com/mcp`). `sse` is its deprecated predecessor, kept so
 * existing rows stay editable — the modal never *creates* one, but it must not
 * silently rewrite a row that already is one.
 */
/** `native` is not a transport: a curated card whose tools are built into the
 *  backend (Gmail, Drive, Sheets, Calendar over REST). Never user-creatable. */
export type MCPServerType = 'stdio' | 'http' | 'sse' | 'native';

/** The transports that reach a server over the network rather than spawn it. */
export const REMOTE_SERVER_TYPES: readonly MCPServerType[] = ['http', 'sse'];

export const isRemoteServerType = (type: MCPServerType): boolean =>
  REMOTE_SERVER_TYPES.includes(type);

/** Why a connection could not report its capabilities. */
export type MCPToolsErrorCode =
  | 'credential_missing'
  | 'credential_invalid'
  | 'connection_timeout'
  | 'connection_failed'
  | 'unknown';

/**
 * A capability lookup that failed, carrying the backend's own explanation.
 *
 * The reason is the whole value of this call: it is the one thing on the
 * Connections page a non-technical user can act on, and "add a credential",
 * "reconnect your account" and "this connector is broken, not you" are three
 * different next steps.
 */
export class MCPToolsError extends Error {
  code: MCPToolsErrorCode;
  status?: number;

  constructor(message: string, code: MCPToolsErrorCode, status?: number) {
    super(message);
    this.name = 'MCPToolsError';
    this.code = code;
    this.status = status;
  }

  static from(err: unknown): MCPToolsError {
    const response = (err as { response?: { status?: number; data?: unknown } })?.response;
    const data = response?.data as { error?: string; code?: string } | undefined;
    const code = (data?.code ?? 'unknown') as MCPToolsErrorCode;
    const message =
      data?.error?.trim() ||
      (err instanceof Error ? err.message : '') ||
      'Could not reach this connection.';
    return new MCPToolsError(message, code, response?.status);
  }

  /** Whether the user can fix this themselves, and how. */
  get isCredentialProblem(): boolean {
    return this.code === 'credential_missing' || this.code === 'credential_invalid';
  }
}

export interface MCPServer {
  id: number;
  name: string;
  type: MCPServerType;
  
  // Stdio Config
  command?: string;
  args?: string[];
  
  // SSE Config
  url?: string;
  
  // Execution Environment
  env?: Record<string, string>;
  
  // Credential wiring
  required_credential_types?: string[];
  credential_env_map?: Record<string, string>;
  credential_header_map?: Record<string, string>;

  /* Presentation, served from the database so adding a connector never means
     editing this app. `icon_slug` is the stable key the icon map keys off —
     never `name`, which is user-facing copy. */
  display_name?: string;
  /** `display_name` with a fallback to `name`; always populated. */
  label: string;
  category: MCPServerCategory;
  tagline?: string;
  icon_slug?: string;
  help_url?: string;

  setup_notes?: string;
  /** The server's own flag. Shared templates have this on for everyone. */
  enabled: boolean;
  /** Announced, not yet shippable. Presentation only: always paired with
   *  `enabled: false`, which is what actually withholds the tools. */
  coming_soon: boolean;
  /** Whether this server is live *for the current user* — the value to render. */
  effective_enabled: boolean;
  /** True for curated system servers: config is read-only, the toggle is not. */
  is_system: boolean;
  /**
   * Whether Connect is worth offering — a structural answer (remote + has a
   * URL), not a probe. Discovering whether a server *really* speaks OAuth
   * costs two fetches, so a server that turns out not to says so on click.
   */
  supports_oauth: boolean;
  /** Whether this user has completed an authorization for this server. */
  oauth_connected: boolean;
  user: number | null;
  created_at: string;
  updated_at: string;
}

export type MCPServerCategory =
  | 'google_workspace'
  | 'communication'
  | 'productivity'
  | 'development'
  | 'utilities'
  | 'custom';

/** One capability a connection grants, as reported by the server itself. */
export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface CreateMCPServerData {
  name: string;
  type: MCPServerType;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  required_credential_types?: string[];
  credential_env_map?: Record<string, string>;
  credential_header_map?: Record<string, string>;
  setup_notes?: string;
  enabled?: boolean;
}

export const mcpService = {
  /**
   * List MCP servers
   */
  async list(): Promise<{ servers: MCPServer[] }> {
    const response = await apiClient.get<{ servers: MCPServer[] }>('/mcp/servers/');
    return response.data;
  },

  /**
   * Get MCP server details
   */
  async get(id: number): Promise<MCPServer> {
    const response = await apiClient.get<MCPServer>(`/mcp/servers/${id}/`);
    return response.data;
  },

  /**
   * Create MCP server
   */
  async create(data: CreateMCPServerData): Promise<MCPServer> {
    const response = await apiClient.post<MCPServer>('/mcp/servers/', data);
    return response.data;
  },

  /**
   * Update MCP server
   */
  async update(id: number, data: Partial<CreateMCPServerData>): Promise<MCPServer> {
    const response = await apiClient.patch<MCPServer>(`/mcp/servers/${id}/`, data);
    return response.data;
  },

  /**
   * Delete MCP server
   */
  async delete(id: number): Promise<void> {
    await apiClient.delete(`/mcp/servers/${id}/`);
  },

  /**
   * Turn a connection on or off for the current user.
   *
   * Curated servers are shared rows that no single account may edit, so this
   * cannot be a PATCH of `enabled` — that is what used to answer 403. The
   * backend records the choice per user and returns the resulting
   * `effective_enabled`.
   */
  async setEnabled(id: number, enabled: boolean): Promise<MCPServer> {
    const response = await apiClient.post<MCPServer>(
      `/mcp/servers/${id}/set-enabled/`,
      { enabled }
    );
    return response.data;
  },

  /**
   * List what a connection can actually do. Live from the server, so it is the
   * honest answer rather than a hand-maintained description — and it is the only
   * thing on the page a non-technical user can act on.
   */
  async getTools(id: number): Promise<{ tools: MCPTool[] }> {
    try {
      const response = await apiClient.get<{ tools: MCPTool[] }>(
        `/mcp/servers/${id}/tools/`
      );
      return response.data;
    } catch (err) {
      // The backend answers every failure with a `code` and a human-readable
      // `error`. Rethrowing the raw Axios error threw both away, so a missing
      // credential, an expired token and a connector whose package does not
      // exist all rendered as the same "could not reach this connection" —
      // three different problems, one dead end.
      throw MCPToolsError.from(err);
    }
  },

  /**
   * Dry-run credential resolution: whether every credential this server needs
   * actually exists, decrypts, and carries the mapped fields. This is the
   * difference between "a credential row exists" and "the assistant can call
   * this" — a server with a mistyped map or an expired OAuth token otherwise
   * shows "Connected" while silently vanishing from the agent.
   */
  async validateCredentials(id: number): Promise<{ ok: boolean; errors: string[] }> {
    const response = await apiClient.get<{ ok: boolean; errors: string[] }>(
      `/mcp/servers/${id}/validate_credentials/`
    );
    return response.data;
  },

  /**
   * Begin an OAuth authorization for a remote server.
   *
   * Returns the provider URL to send the user to. Discovery, dynamic client
   * registration and PKCE all happen server-side before this resolves, so a
   * server that cannot be connected fails here rather than after a round trip
   * through the browser.
   */
  async oauthInit(id: number, redirectUri: string): Promise<{ url: string }> {
    const response = await apiClient.get<{ url: string }>(
      `/mcp/servers/${id}/oauth/init/`,
      { params: { redirect_uri: redirectUri } },
    );
    return response.data;
  },

  /** Hand back the code the provider redirected with. */
  async oauthCallback(id: number, code: string, state: string): Promise<{ connected: boolean }> {
    const response = await apiClient.post<{ connected: boolean }>(
      `/mcp/servers/${id}/oauth/callback/`, { code, state },
    );
    return response.data;
  },

  async oauthDisconnect(id: number): Promise<{ connected: boolean }> {
    const response = await apiClient.post<{ connected: boolean }>(
      `/mcp/servers/${id}/oauth/disconnect/`, {},
    );
    return response.data;
  },

  /**
   * Tools withheld until the user reviews them (`mcp_integration/pinning.py`):
   * new ones whose description is addressed to an AI, and ones a server
   * changed after the user connected it.
   */
  async heldTools(): Promise<{ servers: HeldToolsGroup[] }> {
    const response = await apiClient.get<{ servers: HeldToolsGroup[] }>('/mcp/servers/held-tools/');
    return response.data;
  },

  async approveHeldTool(serverId: number, toolName: string): Promise<void> {
    await apiClient.post(`/mcp/servers/${serverId}/held-tools/approve/`, { tool_name: toolName });
  },
};

export interface HeldTool {
  tool_name: string;
  status: 'changed' | 'quarantined';
  reason: string;
  description: string;
  updated_at: string;
}

export interface HeldToolsGroup {
  server_id: number;
  server_name: string;
  tools: HeldTool[];
}

export default mcpService;
