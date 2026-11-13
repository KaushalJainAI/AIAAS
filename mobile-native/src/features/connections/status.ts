/**
 * The one status a connection card shows. Mirrors `statusOf` in
 * better-n8n-frontend/src/pages/Connections.tsx, so the phone and the web never
 * disagree about whether a connection works.
 */

import type { CredentialValidation, MCPServer } from './types';

export type ConnectionStatus =
  | 'always'
  | 'connected'
  | 'needs_auth'
  | 'off'
  | 'unavailable'
  | 'coming_soon';

/** The web's words, unchanged. */
export const STATUS_LABEL: Record<ConnectionStatus, string> = {
  always: 'Ready',
  connected: 'Connected',
  needs_auth: 'Not connected',
  off: 'Off',
  unavailable: 'Unavailable',
  coming_soon: 'Coming soon',
};

/** True when the platform, not the user, has switched the connection off. Its switch is inert. */
export function isPlatformOff(status: ConnectionStatus): boolean {
  return status === 'unavailable' || status === 'coming_soon';
}

/** A connection that needs any credential or mapping to work. */
export function needsCredentials(server: MCPServer): boolean {
  return (
    (server.required_credential_types?.length ?? 0) > 0 ||
    Object.keys(server.credential_env_map ?? {}).length > 0 ||
    Object.keys(server.credential_header_map ?? {}).length > 0
  );
}

/**
 * `validation` is the live dry run and wins once it has landed. Until then a
 * missing required credential type is the fallback reading.
 */
export function statusOf(
  server: MCPServer,
  check: { validation?: CredentialValidation; missingRequired: boolean },
): ConnectionStatus {
  if (server.is_system && !server.enabled && server.coming_soon) return 'coming_soon';
  if (server.is_system && !server.enabled) return 'unavailable';
  if (!server.effective_enabled) return 'off';
  if (check.validation) {
    if (!check.validation.ok) return 'needs_auth';
    return needsCredentials(server) ? 'connected' : 'always';
  }
  if ((server.required_credential_types?.length ?? 0) === 0) return 'always';
  return check.missingRequired ? 'needs_auth' : 'connected';
}

/** Green only for "working"; every other status is muted, as on the web. */
export function statusIsWorking(status: ConnectionStatus): boolean {
  return status === 'always' || status === 'connected';
}
