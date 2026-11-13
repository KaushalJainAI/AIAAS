/**
 * React Query hooks for connections: MCP servers, their tools and credential
 * checks, held tools, the user's own API and database tools and their sharing,
 * and messaging channels.
 *
 * The Connections page re-reads the server list after any change and
 * re-checks each connection's credentials, because "Connected" is only honest
 * when the assistant can actually call the tools. `useMcpValidation` does that.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  approveHeldTool,
  createApiConnection,
  createDataConnection,
  createMessagingAccount,
  deleteApiConnection,
  deleteDataConnection,
  deleteMcpServer,
  getMcpServerTools,
  getSharePreview,
  installSharedTool,
  listApiConnections,
  listDataConnections,
  listHeldTools,
  listMcpServers,
  listMessagingChannels,
  listSharedTools,
  mcpOAuthCallback,
  mcpOAuthDisconnect,
  publishShare,
  registerMessagingAccount,
  setMcpServerEnabled,
  updateApiConnection,
  updateDataConnection,
  validateMcpCredentials,
  withdrawShare,
  getSharedTool,
} from './api';
import type {
  CredentialValidation,
  CustomToolInput,
  CustomToolKind,
  MCPServer,
  PublishShareInput,
} from './types';
import { credentialKeys } from '../credentials/queries';

export const connectionKeys = {
  all: ['connections'] as const,
  servers: ['connections', 'servers'] as const,
  tools: (serverId: number) => ['connections', 'tools', serverId] as const,
  validation: (serverIds: number[]) => ['connections', 'validation', serverIds.join(',')] as const,
  held: ['connections', 'held-tools'] as const,
  apiTools: ['connections', 'api-tools'] as const,
  dataTools: ['connections', 'data-tools'] as const,
  shared: ['connections', 'shared'] as const,
  sharedTool: (slug: string) => ['connections', 'shared', slug] as const,
  share: (kind: CustomToolKind, id: number | string) => ['connections', 'share', kind, id] as const,
  channels: ['connections', 'channels'] as const,
};

// MCP servers

/** Every connection visible to the caller, with `effective_enabled` for this user. */
export function useMcpServers() {
  return useQuery({
    queryKey: connectionKeys.servers,
    queryFn: listMcpServers,
  });
}

/**
 * What one connection can do, read live. Not retried: a missing credential or a
 * broken connector will not fix itself, and the reason is what the user needs.
 */
export function useMcpServerTools(serverId: number, enabled = true) {
  return useQuery({
    queryKey: connectionKeys.tools(serverId),
    queryFn: () => getMcpServerTools(serverId),
    enabled: enabled && Number.isFinite(serverId),
    retry: false,
  });
}

/**
 * Credential checks for each listed connection, in parallel. A failed check
 * becomes a "could not check" entry for that connection rather than failing the
 * whole map. Keyed by server id.
 */
export function useMcpValidation(serverIds: number[]) {
  return useQuery({
    queryKey: connectionKeys.validation(serverIds),
    queryFn: async (): Promise<Record<number, CredentialValidation>> => {
      const entries = await Promise.all(
        serverIds.map(async (id): Promise<[number, CredentialValidation]> => {
          try {
            return [id, await validateMcpCredentials(id)];
          } catch {
            return [id, { ok: false, errors: ['Could not check this connection.'] }];
          }
        }),
      );
      return Object.fromEntries(entries) as Record<number, CredentialValidation>;
    },
    enabled: serverIds.length > 0,
  });
}

/**
 * Turn a connection on or off for this user. The server answers the resulting
 * `effective_enabled`. A 409 means the connection is off at platform level.
 */
export function useSetMcpServerEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: number; enabled: boolean }) => setMcpServerEnabled(args.id, args.enabled),
    onSuccess: (updated: MCPServer) => {
      void queryClient.invalidateQueries({ queryKey: connectionKeys.servers });
      void queryClient.invalidateQueries({ queryKey: connectionKeys.tools(updated.id) });
    },
  });
}

/** Remove a custom connection. Curated rows cannot be deleted. */
export function useDeleteMcpServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteMcpServer(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectionKeys.servers });
      void queryClient.invalidateQueries({ queryKey: ['connections', 'validation'] });
    },
  });
}

/** Finish an MCP OAuth sign-in with the `code` and `state` the provider returned. */
export function useMcpOAuthCallback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: number; code: string; state: string }) =>
      mcpOAuthCallback(args.id, args.code, args.state),
    onSettled: (_data, _error, args) => {
      void queryClient.invalidateQueries({ queryKey: connectionKeys.servers });
      void queryClient.invalidateQueries({ queryKey: ['connections', 'validation'] });
      void queryClient.invalidateQueries({ queryKey: connectionKeys.tools(args.id) });
    },
  });
}

export function useMcpOAuthDisconnect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => mcpOAuthDisconnect(id),
    onSettled: (_data, _error, id) => {
      void queryClient.invalidateQueries({ queryKey: connectionKeys.servers });
      void queryClient.invalidateQueries({ queryKey: ['connections', 'validation'] });
      void queryClient.invalidateQueries({ queryKey: connectionKeys.tools(id) });
    },
  });
}

// Held tools

/** Tools withheld until the user reviews them, grouped by server. */
export function useHeldTools() {
  return useQuery({
    queryKey: connectionKeys.held,
    queryFn: listHeldTools,
  });
}

/** Trust one held tool in its current form, and drop the cached tool list it was held out of. */
export function useApproveHeldTool() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { serverId: number; toolName: string }) =>
      approveHeldTool(args.serverId, args.toolName),
    onSuccess: (_data, args) => {
      void queryClient.invalidateQueries({ queryKey: connectionKeys.held });
      void queryClient.invalidateQueries({ queryKey: connectionKeys.tools(args.serverId) });
    },
  });
}

// The user's own API tools

export function useApiConnections() {
  return useQuery({
    queryKey: connectionKeys.apiTools,
    queryFn: listApiConnections,
  });
}

export function useCreateApiConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CustomToolInput) => createApiConnection(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectionKeys.apiTools });
    },
  });
}

export function useUpdateApiConnection(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CustomToolInput) => updateApiConnection(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectionKeys.apiTools });
    },
  });
}

export function useDeleteApiConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteApiConnection(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectionKeys.apiTools });
    },
  });
}

// The user's own database tools

export function useDataConnections() {
  return useQuery({
    queryKey: connectionKeys.dataTools,
    queryFn: listDataConnections,
  });
}

export function useCreateDataConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CustomToolInput) => createDataConnection(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectionKeys.dataTools });
    },
  });
}

export function useUpdateDataConnection(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CustomToolInput) => updateDataConnection(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectionKeys.dataTools });
    },
  });
}

export function useDeleteDataConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteDataConnection(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectionKeys.dataTools });
    },
  });
}

// Sharing a custom tool

/** What is published for one of the caller's tools. Enabled only when a tool is chosen. */
export function useSharePreview(kind: CustomToolKind, id: number | string, enabled = true) {
  return useQuery({
    queryKey: connectionKeys.share(kind, id),
    queryFn: () => getSharePreview(kind, id),
    enabled,
  });
}

export function usePublishShare(kind: CustomToolKind, id: number | string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PublishShareInput) => publishShare(kind, id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectionKeys.share(kind, id) });
      void queryClient.invalidateQueries({ queryKey: connectionKeys.shared });
    },
  });
}

export function useWithdrawShare(kind: CustomToolKind, id: number | string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => withdrawShare(kind, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectionKeys.share(kind, id) });
      void queryClient.invalidateQueries({ queryKey: connectionKeys.shared });
    },
  });
}

/** Listed platform and public tools, plus the caller's own. */
export function useSharedTools() {
  return useQuery({
    queryKey: connectionKeys.shared,
    queryFn: listSharedTools,
  });
}

export function useSharedTool(slug: string) {
  return useQuery({
    queryKey: connectionKeys.sharedTool(slug),
    queryFn: () => getSharedTool(slug),
    enabled: slug.length > 0,
  });
}

/**
 * Install a private copy of a shared tool. The copy is new in the caller's own
 * list, and the credentials it needs must be linked next (`credentials_needed`).
 */
export function useInstallSharedTool() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => installSharedTool(slug),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectionKeys.apiTools });
      void queryClient.invalidateQueries({ queryKey: connectionKeys.dataTools });
      void queryClient.invalidateQueries({ queryKey: connectionKeys.shared });
      void queryClient.invalidateQueries({ queryKey: credentialKeys.all });
    },
  });
}

// Messaging channels

export function useMessagingChannels() {
  return useQuery({
    queryKey: connectionKeys.channels,
    queryFn: listMessagingChannels,
  });
}

export function useCreateMessagingAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { channel: string; label?: string }) =>
      createMessagingAccount(args.channel, args.label ?? ''),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectionKeys.channels });
    },
  });
}

export function useRegisterMessagingAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => registerMessagingAccount(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectionKeys.channels });
    },
  });
}
