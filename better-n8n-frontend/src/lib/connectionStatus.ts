/**
 * What state one connection is in, for this person: the single rule.
 *
 * The Connections page shows it on every row, and the chat's "Get set up" card
 * asks whether any row is `connected`. They used to carry two copies of this
 * rule; one place means they cannot disagree.
 *
 * Every required credential is checked, not just the first (the old page read
 * `required_credential_types[0]`, so a server needing two showed "Connected"
 * with one, then failed at run time). Credential *rows* are only a fallback
 * while the validation sweep is loading. Once it lands, `connected` means the
 * credentials really resolve; anything else is `needs_auth`, because the
 * agent's tool list is filtered by the same resolution.
 */
import type { Credential, CredentialType } from '@/api/credentials';
import type { MCPServer } from '@/api/mcp';

export type ConnectionStatus =
  | 'always'
  | 'connected'
  | 'needs_auth'
  | 'off'
  | 'unavailable'
  | 'coming_soon';

export interface ConnectionContext {
  credentials: readonly Credential[];
  types: readonly CredentialType[];
  /**
   * The result of the Connections page's credential sweep (`['mcpValidation']`),
   * when it has run. Absent means "not checked yet".
   */
  validation?: ReadonlyMap<number, { ok: boolean }>;
}

/** Credentials this server needs that the user does not yet hold. */
export function missingCredentialTypes(
  server: MCPServer,
  { credentials, types }: Pick<ConnectionContext, 'credentials' | 'types'>,
): CredentialType[] {
  const typeBySlug = new Map(types.map((type) => [type.slug, type]));
  const held = new Set(credentials.map((credential) => credential.credential_type));
  return (server.required_credential_types ?? [])
    .map((slug) => typeBySlug.get(slug))
    .filter((type): type is CredentialType => type !== undefined)
    .filter((type) => !held.has(type.id));
}

export function connectionStatus(server: MCPServer, ctx: ConnectionContext): ConnectionStatus {
  // The platform's own switch first: a row turned off there can never be
  // turned on by the user, so calling it their `off` would offer an action that
  // does not exist. `coming_soon` before `unavailable`, which it is a special
  // case of: an upcoming connector is not a fault.
  if (server.is_system && !server.enabled && server.coming_soon) return 'coming_soon';
  if (server.is_system && !server.enabled) return 'unavailable';
  if (!server.effective_enabled) return 'off';

  const credentials = credentialStatus(server, ctx);
  // An API card is connected only when its credential resolves AND the user
  // has linked the card to it. A saved credential alone is not enough: the
  // card's non-secret fields (a subdomain, a region) have not been given yet,
  // so the call would not know where to go. Connect is offered until both hold.
  const credentialsReady = credentials === 'connected' || credentials === 'always';
  if (server.kind === 'api' && credentialsReady && !server.card_connected) return 'needs_auth';
  return credentials;
}

/** The credential half of the rule: does everything this server needs resolve? */
function credentialStatus(server: MCPServer, ctx: ConnectionContext): ConnectionStatus {
  const check = ctx.validation?.get(server.id);
  if (check) {
    if (!check.ok) return 'needs_auth';
    const needsCredentials =
      (server.required_credential_types?.length ?? 0) > 0 ||
      Object.keys(server.credential_env_map ?? {}).length > 0 ||
      Object.keys(server.credential_header_map ?? {}).length > 0;
    return needsCredentials ? 'connected' : 'always';
  }

  if ((server.required_credential_types ?? []).length === 0) return 'always';
  return missingCredentialTypes(server, ctx).length === 0 ? 'connected' : 'needs_auth';
}

/**
 * Whether the person has connected any account. A connector that needs no
 * account (`always`) is not something they connected, so it does not count.
 */
export function anyConnected(
  servers: readonly MCPServer[],
  ctx: ConnectionContext,
): boolean {
  return servers.some((server) => connectionStatus(server, ctx) === 'connected');
}
