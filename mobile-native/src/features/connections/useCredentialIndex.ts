/**
 * Which credentials the user holds, indexed the way the Connections screens
 * need them: by type slug (what a connection asks for) and by type id (what
 * the vault stores). Shared by the list and the detail screen so both decide
 * "connected" the same way.
 */

import { useCallback, useMemo } from 'react';

import { useCredentials, useCredentialTypes } from '../credentials/queries';
import type { Credential, CredentialType } from '../credentials/types';
import type { MCPServer } from './types';

export function useCredentialIndex() {
  const creds = useCredentials();
  const types = useCredentialTypes();

  const typeBySlug = useMemo(
    () => new Map((types.data ?? []).map((t) => [t.slug, t] as const)),
    [types.data],
  );

  // The newest row per type wins, as on the web.
  const credByTypeId = useMemo(() => {
    const map = new Map<number, Credential>();
    for (const c of creds.data ?? []) {
      const existing = map.get(c.credential_type);
      if (!existing || new Date(c.updated_at) > new Date(existing.updated_at)) map.set(c.credential_type, c);
    }
    return map;
  }, [creds.data]);

  /** Credential types a connection requires that the user does not hold yet. */
  const missingTypes = useCallback(
    (server: MCPServer): CredentialType[] =>
      (server.required_credential_types ?? [])
        .map((slug) => typeBySlug.get(slug))
        .filter((t): t is CredentialType => t !== undefined)
        .filter((t) => !credByTypeId.has(t.id)),
    [typeBySlug, credByTypeId],
  );

  /** Every required type of a connection, held or not, in the order the server lists them. */
  const requiredTypes = useCallback(
    (server: MCPServer): CredentialType[] =>
      (server.required_credential_types ?? [])
        .map((slug) => typeBySlug.get(slug))
        .filter((t): t is CredentialType => t !== undefined),
    [typeBySlug],
  );

  return {
    isPending: creds.isPending || types.isPending,
    credentials: creds.data ?? [],
    types: types.data ?? [],
    typeBySlug,
    credByTypeId,
    missingTypes,
    requiredTypes,
    refetch: () => Promise.all([creds.refetch(), types.refetch()]),
  };
}
