/**
 * Credentials: the vault entries a connection needs. Values are never returned.
 *
 * Copied from better-n8n-frontend/src/api/credentials.ts.
 */

export type CredentialAuthMethod = 'api_key' | 'oauth2' | 'basic' | 'bearer' | 'custom';

export type CredentialHealth = 'ok' | 'expiring' | 'failed' | 'unverified';

export interface CredentialFieldSchema {
  name: string;
  label: string;
  type: 'text' | 'password' | 'select' | 'textarea';
  required: boolean;
  placeholder?: string;
  default?: string;
  options?: { value: string; label: string }[];
}

/** A credential type: the template a credential is filled in against. Read-only on the API. */
export interface CredentialType {
  id: number;
  name: string;
  slug: string;
  service_identifier?: string;
  description: string;
  icon: string;
  auth_method: CredentialAuthMethod;
  fields_schema: CredentialFieldSchema[];
  oauth_config?: {
    auth_url?: string;
    token_url?: string;
    scopes?: string[];
  };
}

/** One stored field. `value` is masked by the server; it is shown only as a presence check. */
export interface CredentialField {
  key: string;
  label: string;
  type: string;
  value: string;
}

export interface Credential {
  id: number;
  name: string;
  credential_type: number;
  credential_type_display: string;
  is_valid: boolean;
  is_verified: boolean;
  last_error?: string;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  fields: CredentialField[];
  /** When the stored token stops working (ISO), or null when it does not expire. */
  token_expires_at?: string | null;
  /** Last known state. Optional: rows from before this field fall back to is_valid/is_verified. */
  health?: CredentialHealth;
}

/** POST /credentials/ body. `credential_type` is a primary key or a slug. */
export interface CreateCredentialInput {
  name: string;
  credential_type: number | string;
  data: Record<string, string>;
}

/** PATCH /credentials/{id}/ body: any subset of the create body. */
export type UpdateCredentialInput = Partial<CreateCredentialInput>;

/** POST /credentials/{id}/verify/. */
export interface CredentialVerifyResult {
  valid: boolean;
  message: string;
}

/** POST /credentials/oauth/google/callback/ body: the code the provider redirected with. */
export interface GoogleOAuthCompleteInput {
  code: string;
  redirect_uri: string;
  state?: string;
  name?: string;
}
