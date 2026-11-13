/**
 * Connections: the wire shapes for MCP servers, custom tools (the user's own
 * API and database connections), and messaging channels.
 *
 * Copied from the web app:
 *  - MCPServer, MCPTool, HeldTool, HeldToolsGroup, CreateMCPServerData,
 *    MCPServerType, MCPServerCategory:    better-n8n-frontend/src/api/mcp.ts
 *  - ApiConnection, DataConnection, ApiAuth, SharedTool, CredentialNeed,
 *    CustomToolKind:                      better-n8n-frontend/src/api/datasources.ts
 *  - ShareVisibility:                     better-n8n-frontend/src/api/templates.ts
 *  - MessagingChannel, ChannelCredential, ChannelAccount, CreatedAccount:
 *                                         better-n8n-frontend/src/api/messaging.ts
 *
 * The error class in the web (`MCPToolsError`) is in ./errors.ts, not here.
 */

/**
 * How the backend reaches a server. `http` is MCP's streamable HTTP transport
 * (hosted connectors). `sse` is its predecessor, kept so existing rows stay
 * readable. `native` is not a transport: a curated card whose tools are built
 * into the backend (Gmail, Drive, Sheets, Calendar over REST). Never user-creatable.
 */
export type MCPServerType = 'stdio' | 'http' | 'sse' | 'native';

export const REMOTE_SERVER_TYPES: readonly MCPServerType[] = ['http', 'sse'];

export type MCPServerCategory =
  | 'google_workspace'
  | 'communication'
  | 'productivity'
  | 'development'
  | 'utilities'
  | 'custom';

export interface MCPServer {
  id: number;
  name: string;
  type: MCPServerType;

  // Stdio config
  command?: string;
  args?: string[];

  // Remote config
  url?: string;

  env?: Record<string, string>;

  // Credential wiring
  required_credential_types?: string[];
  credential_env_map?: Record<string, string>;
  credential_header_map?: Record<string, string>;

  /* Presentation, served from the database. `icon_slug` is the stable key the
     icon map keys off, never `name`, which is user-facing copy. */
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
  /** Announced, not yet shippable. Always paired with `enabled: false`. */
  coming_soon: boolean;
  /** Whether this server is live *for the current user*. The value to render. */
  effective_enabled: boolean;
  /** True for curated system servers: config is read-only, the toggle is not. */
  is_system: boolean;
  /** Structural answer (remote + has a URL), not a probe. */
  supports_oauth: boolean;
  /** Whether this user has completed an authorization for this server. */
  oauth_connected: boolean;
  user: number | null;
  created_at: string;
  updated_at: string;
}

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

/** GET /mcp/servers/{id}/validate_credentials/. */
export interface CredentialValidation {
  ok: boolean;
  errors: string[];
}

/** A tool withheld until the user reviews it (`mcp_integration/pinning.py`). */
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

/** Error codes the tools and OAuth endpoints send with their `error` sentence. */
export type MCPToolsErrorCode =
  | 'credential_missing'
  | 'credential_invalid'
  | 'connection_timeout'
  | 'connection_failed'
  | 'oauth_unavailable'
  | 'oauth_rejected'
  | 'oauth_failed'
  | 'unknown';

// Custom tools (the user's own API and database connections)

export type CustomToolKind = 'api' | 'data';

export type ShareVisibility = 'link' | 'platform' | 'public';

export interface ApiAuth {
  type: 'none' | 'bearer' | 'basic' | 'header' | 'query';
  secret_ref?: string;
  header?: string;
  param?: string;
}

export interface ApiConnection {
  id: number;
  name: string;
  base_url: string;
  openapi_spec: Record<string, unknown>;
  auth: ApiAuth;
  allowed_methods: string[];
  operations_count: number;
  created_at: string;
  updated_at: string;
}

export interface DataConnection {
  id: number;
  kind: 'postgres' | 'mysql' | 'bigquery' | 'sqlite';
  name: string;
  host: string;
  port: number | null;
  database: string;
  username: string;
  secret_ref: string;
  vfs_path: string;
  ssl_mode: string;
  allow_write: boolean;
  created_at: string;
  updated_at: string;
}

/** What the installer must link after taking a copy: a type, never a value. */
export interface CredentialNeed {
  tool: string;
  slug: string;
  field: string;
}

export interface SharedTool {
  slug: string;
  tool_kind: CustomToolKind;
  name: string;
  tagline: string;
  description: string;
  author: string;
  is_mine: boolean;
  visibility: ShareVisibility;
  is_listed: boolean;
  install_count: number;
  version: number;
  updated_at: string;
  auth_shape: {
    type?: string;
    header?: string;
    param?: string;
    needs?: { slug: string; field: string };
  };
  operations_count: number | null;
  tool_config: Record<string, unknown>;
}

/** GET /datasources/{api|data}/{id}/share/. */
export interface SharePreview {
  published: boolean;
  slug: string | null;
  visibility: ShareVisibility;
  is_listed: boolean;
  version: number;
  install_count: number;
  tagline: string;
  description: string;
  auth_shape: SharedTool['auth_shape'];
  tool_config: Record<string, unknown>;
}

/** POST /datasources/{api|data}/{id}/share/ body. */
export interface PublishShareInput {
  tagline: string;
  description?: string;
  visibility?: ShareVisibility;
}

/** POST /datasources/shared/{slug}/install/ answers the new copy and what to link. */
export interface InstallSharedResult {
  tool: ApiConnection | DataConnection;
  credentials_needed: CredentialNeed[];
}

/** Body for creating or editing a custom API or database tool (sent as-is). */
export type CustomToolInput = Record<string, unknown>;

// Messaging channels (Slack, WhatsApp, Teams, SMS, Telegram)

export interface ChannelCredentialField {
  name: string;
  label: string;
  secret: boolean;
  required: boolean;
}

export interface ChannelCredential {
  slug: string;
  name: string;
  fields: ChannelCredentialField[];
  stored: boolean;
}

export interface ChannelAccount {
  id: number;
  label: string;
  verified: boolean;
}

export type ChannelStatus = 'ready' | 'needs_key' | 'needs_account' | 'gated';

export interface MessagingChannel {
  id: string;
  label: string;
  blurb: string;
  tools: string[];
  cost: string;
  credential: ChannelCredential;
  account: ChannelAccount | null;
  webhook_url: string | null;
  status: ChannelStatus;
  status_reason?: string;
  setup: string[];
  inbound: string;
}

export interface CreatedAccount {
  id: number;
  channel: string;
  label: string;
  verified: boolean;
  created: boolean;
  webhook_url: string | null;
}

export interface RegisteredAccount {
  id: number;
  verified: boolean;
  webhook_url: string;
}
