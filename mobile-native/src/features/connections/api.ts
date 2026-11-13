/**
 * Connections API: MCP servers (connectors), their tools, credential checks,
 * OAuth, held tools, the user's own API and database tools, their sharing, and
 * messaging channels.
 *
 * Mirrors, endpoint for endpoint:
 *  - better-n8n-frontend/src/api/mcp.ts          servers, enable, tools,
 *                                                validate, oauth init/callback/
 *                                                disconnect, held tools
 *  - better-n8n-frontend/src/api/datasources.ts  api-connections, data-connections,
 *                                                share, shared, install
 *  - better-n8n-frontend/src/api/messaging.ts    channels, accounts, register
 *
 * Paths are relative to /api; `api()` prepends it.
 */

import { api } from '../../api/client';
import { ConnectionToolsError } from './errors';
import type {
  ApiConnection,
  CreateMCPServerData,
  CredentialValidation,
  CreatedAccount,
  CustomToolInput,
  CustomToolKind,
  DataConnection,
  HeldToolsGroup,
  InstallSharedResult,
  MCPServer,
  MCPTool,
  MessagingChannel,
  PublishShareInput,
  RegisteredAccount,
  SharePreview,
  SharedTool,
} from './types';

const enc = encodeURIComponent;

/** The custom-tool share routes use `api` or `data`, not the kind's own word. */
const sharePrefix = (kind: CustomToolKind) => (kind === 'api' ? 'api' : 'data');

/** DRF returns a bare list or `{results}` depending on pagination. Accept both. */
function listOf<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    const results = (data as { results?: unknown }).results;
    if (Array.isArray(results)) return results as T[];
  }
  return [];
}

// MCP servers

/** Every connection visible to the caller. The body is `{servers}`; unwrap it. */
export async function listMcpServers(): Promise<MCPServer[]> {
  const data = await api<{ servers?: MCPServer[] }>('/mcp/servers/');
  return Array.isArray(data?.servers) ? data.servers : [];
}

export function getMcpServer(id: number): Promise<MCPServer> {
  return api<MCPServer>(`/mcp/servers/${id}/`);
}

export function createMcpServer(data: CreateMCPServerData): Promise<MCPServer> {
  return api<MCPServer>('/mcp/servers/', { method: 'POST', body: data });
}

/** PATCH. Shared curated rows refuse config edits; use `setMcpServerEnabled` for the switch. */
export function updateMcpServer(id: number, data: Partial<CreateMCPServerData>): Promise<MCPServer> {
  return api<MCPServer>(`/mcp/servers/${id}/`, { method: 'PATCH', body: data });
}

export function deleteMcpServer(id: number): Promise<null> {
  return api<null>(`/mcp/servers/${id}/`, { method: 'DELETE' });
}

/**
 * Turn a connection on or off for the current user. Curated servers are shared
 * rows no single account may edit, so this is a per-user preference and not a
 * PATCH of `enabled`. The answer carries the resulting `effective_enabled`.
 * 409 means the connection is off at the platform level; the message says so.
 */
export function setMcpServerEnabled(id: number, enabled: boolean): Promise<MCPServer> {
  return api<MCPServer>(`/mcp/servers/${id}/set-enabled/`, { method: 'POST', body: { enabled } });
}

/**
 * What a connection can actually do, read live from the server. Failures carry
 * the server's `code` and sentence through `ConnectionToolsError`.
 */
export async function getMcpServerTools(id: number): Promise<{ tools: MCPTool[] }> {
  try {
    return await api<{ tools: MCPTool[] }>(`/mcp/servers/${id}/tools/`);
  } catch (err) {
    throw ConnectionToolsError.from(err);
  }
}

/** Dry-run credential resolution: whether every credential this server needs exists and decrypts. */
export function validateMcpCredentials(id: number): Promise<CredentialValidation> {
  return api<CredentialValidation>(`/mcp/servers/${id}/validate_credentials/`);
}

// MCP OAuth

/**
 * Begin an OAuth authorization for a remote server. Returns the provider URL to
 * open. Discovery and PKCE happen server-side first, so a server that cannot be
 * connected fails here, not after a trip through the browser. `redirectUri` is
 * where the provider sends the user back; it must be one the backend allows.
 */
export async function mcpOAuthInit(id: number, redirectUri: string): Promise<{ url: string }> {
  try {
    return await api<{ url: string }>(`/mcp/servers/${id}/oauth/init/`, {
      query: { redirect_uri: redirectUri },
    });
  } catch (err) {
    throw ConnectionToolsError.from(err);
  }
}

/** Hand back the `code` and `state` the provider redirected with. */
export function mcpOAuthCallback(id: number, code: string, state: string): Promise<{ connected: boolean }> {
  return api<{ connected: boolean }>(`/mcp/servers/${id}/oauth/callback/`, {
    method: 'POST',
    body: { code, state },
  });
}

export function mcpOAuthDisconnect(id: number): Promise<{ connected: boolean }> {
  return api<{ connected: boolean }>(`/mcp/servers/${id}/oauth/disconnect/`, {
    method: 'POST',
    body: {},
  });
}

// Held tools

/** Tools withheld until the user reviews them, grouped by server. The body is `{servers}`. */
export async function listHeldTools(): Promise<HeldToolsGroup[]> {
  const data = await api<{ servers?: HeldToolsGroup[] }>('/mcp/servers/held-tools/');
  return Array.isArray(data?.servers) ? data.servers : [];
}

/** Trust one held tool in its current form. 404 if nothing is held under that name. */
export function approveHeldTool(serverId: number, toolName: string): Promise<{ approved: string; held: unknown[] }> {
  return api<{ approved: string; held: unknown[] }>(`/mcp/servers/${serverId}/held-tools/approve/`, {
    method: 'POST',
    body: { tool_name: toolName },
  });
}

// The user's own API tools

export function listApiConnections(): Promise<ApiConnection[]> {
  return api<unknown>('/datasources/api-connections/').then(listOf<ApiConnection>);
}

export function createApiConnection(body: CustomToolInput): Promise<ApiConnection> {
  return api<ApiConnection>('/datasources/api-connections/', { method: 'POST', body });
}

export function updateApiConnection(id: number, body: CustomToolInput): Promise<ApiConnection> {
  return api<ApiConnection>(`/datasources/api-connections/${id}/`, { method: 'PATCH', body });
}

export function deleteApiConnection(id: number): Promise<null> {
  return api<null>(`/datasources/api-connections/${id}/`, { method: 'DELETE' });
}

// The user's own database tools

export function listDataConnections(): Promise<DataConnection[]> {
  return api<unknown>('/datasources/data-connections/').then(listOf<DataConnection>);
}

export function createDataConnection(body: CustomToolInput): Promise<DataConnection> {
  return api<DataConnection>('/datasources/data-connections/', { method: 'POST', body });
}

export function updateDataConnection(id: number, body: CustomToolInput): Promise<DataConnection> {
  return api<DataConnection>(`/datasources/data-connections/${id}/`, { method: 'PATCH', body });
}

export function deleteDataConnection(id: number): Promise<null> {
  return api<null>(`/datasources/data-connections/${id}/`, { method: 'DELETE' });
}

// Sharing a custom tool

/** What is published for one of the caller's tools, if anything. */
export function getSharePreview(kind: CustomToolKind, id: number | string): Promise<SharePreview> {
  return api<SharePreview>(`/datasources/${sharePrefix(kind)}/${id}/share/`);
}

/** Publish a snapshot of the tool (without secrets). Re-publishing bumps the version. */
export function publishShare(kind: CustomToolKind, id: number | string, body: PublishShareInput): Promise<SharedTool> {
  return api<SharedTool>(`/datasources/${sharePrefix(kind)}/${id}/share/`, { method: 'POST', body });
}

/** Withdraw a shared tool. It is unlisted, not deleted. */
export function withdrawShare(kind: CustomToolKind, id: number | string): Promise<null> {
  return api<null>(`/datasources/${sharePrefix(kind)}/${id}/share/`, { method: 'DELETE' });
}

/** Listed platform and public tools, plus the caller's own. `truncated` says the list was capped. */
export async function listSharedTools(): Promise<{ results: SharedTool[]; truncated: boolean }> {
  const data = await api<unknown>('/datasources/shared/');
  return {
    results: listOf<SharedTool>(data),
    truncated: Boolean((data as { truncated?: unknown } | null)?.truncated),
  };
}

/** One shared tool. No `openapi_spec`; the card shows the operations count instead. */
export function getSharedTool(slug: string): Promise<SharedTool> {
  return api<SharedTool>(`/datasources/shared/${enc(slug)}/`);
}

/** Install a private copy owned by the caller. `credentials_needed` lists what to link next. */
export function installSharedTool(slug: string): Promise<InstallSharedResult> {
  return api<InstallSharedResult>(`/datasources/shared/${enc(slug)}/install/`, { method: 'POST' });
}

// Messaging channels

/** Every channel the platform can message on, with this caller's setup state. */
export async function listMessagingChannels(): Promise<MessagingChannel[]> {
  const data = await api<{ channels?: MessagingChannel[] }>('/messaging/channels/');
  return Array.isArray(data?.channels) ? data.channels : [];
}

/** Create the caller's account on a channel. Answers the webhook URL to register with the provider. */
export function createMessagingAccount(channel: string, label = ''): Promise<CreatedAccount> {
  return api<CreatedAccount>('/messaging/accounts/', { method: 'POST', body: { channel, label } });
}

/** Verify an account with its provider. */
export function registerMessagingAccount(id: number): Promise<RegisteredAccount> {
  return api<RegisteredAccount>(`/messaging/accounts/${id}/register/`, { method: 'POST' });
}
