/**
 * Credentials API: the vault, its types, verification, and the Google OAuth
 * exchange that stores a connected account.
 *
 * Mirrors better-n8n-frontend/src/api/credentials.ts, endpoint for endpoint.
 * Paths are relative to /api; `api()` prepends it.
 *
 * Credential types are read-only over the API: they are seeded by
 * `manage.py seed_connector_credentials`, not created here.
 */

import { api } from '../../api/client';
import type {
  Credential,
  CredentialType,
  CredentialVerifyResult,
  CreateCredentialInput,
  GoogleOAuthCompleteInput,
  UpdateCredentialInput,
} from './types';

/** Every credential type the platform knows. The body is `{types}`. */
export async function listCredentialTypes(): Promise<CredentialType[]> {
  const data = await api<{ types?: CredentialType[] }>('/credentials/types/');
  return Array.isArray(data?.types) ? data.types : [];
}

/** The caller's credentials, without values. The body is `{credentials}`. */
export async function listCredentials(): Promise<Credential[]> {
  const data = await api<{ credentials?: Credential[] }>('/credentials/');
  return Array.isArray(data?.credentials) ? data.credentials : [];
}

export function getCredential(id: number): Promise<Credential> {
  return api<Credential>(`/credentials/${id}/`);
}

export function createCredential(input: CreateCredentialInput): Promise<Credential> {
  return api<Credential>('/credentials/', { method: 'POST', body: input });
}

/** PATCH: an unmentioned field keeps its value. */
export function updateCredential(id: number, input: UpdateCredentialInput): Promise<Credential> {
  return api<Credential>(`/credentials/${id}/`, { method: 'PATCH', body: input });
}

export function deleteCredential(id: number): Promise<null> {
  return api<null>(`/credentials/${id}/`, { method: 'DELETE' });
}

/** Check the stored secret against its provider. */
export function verifyCredential(id: number): Promise<CredentialVerifyResult> {
  return api<CredentialVerifyResult>(`/credentials/${id}/verify/`, { method: 'POST', body: {} });
}

/**
 * Start the Google OAuth flow and return the provider URL to open.
 *
 * `scopes` is sent as repeated `scopes=` query parameters, because the backend
 * reads them with `QueryDict.getlist('scopes')`. Array-style `scopes[]=` would
 * be silently dropped and every connection would get the default scope set.
 * The query is built here by hand for that reason; `api()` does not encode arrays.
 */
export async function initGoogleOAuth(redirectUri: string, scopes?: string[]): Promise<{ url: string }> {
  const params = new URLSearchParams({ redirect_uri: redirectUri });
  (scopes ?? []).forEach((scope) => params.append('scopes', scope));
  return api<{ url: string }>(`/credentials/oauth/google/init/?${params.toString()}`);
}

/** Exchange the code the provider redirected with for tokens, and store the credential. */
export function completeGoogleOAuth(input: GoogleOAuthCompleteInput): Promise<Credential> {
  return api<Credential>('/credentials/oauth/google/callback/', { method: 'POST', body: input });
}
