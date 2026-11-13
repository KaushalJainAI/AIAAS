/**
 * Account: the profile fields the Settings and Profile screens change beyond
 * the name (which `features/settings` already covers), password and email
 * change, API keys, organisations and invitations, and the model catalogue the
 * model picker reads.
 *
 * Copied from the web app:
 *  - Profile, password/email change, API keys, avatar:  better-n8n-frontend/src/api/auth.ts
 *  - Org, OrgMember, OrgInvite, MyInvite, roles:        better-n8n-frontend/src/api/orgs.ts
 *  - AIModel, AIProvider, FallbackModel, CatalogueMeta: better-n8n-frontend/src/api/nodeService.ts
 *  - Effort ladder and labels:                          better-n8n-frontend/src/hooks/useEffortSelection.ts
 *
 * Not included: the ChatGPT plan (local installs only; the hosted app never
 * shows it), and billing endpoints. The web has none beyond the profile's tier
 * and credits, which come with the profile.
 */

export type Tier = 'free' | 'pro' | 'enterprise';

export type ThemePreference = 'light' | 'dark' | 'system';

/** New chats start on this. `full` is set per chat only, and the server refuses it as a default. */
export type DefaultAutonomy = 'plan' | 'ask' | 'auto';

/** GET/PATCH /auth/profile/ as the backend returns it. */
export interface AccountProfileResponse {
  user: {
    id: number;
    email: string;
    first_name?: string;
    last_name?: string;
    username: string;
  };
  display_name?: string;
  avatar?: string;
  bio?: string;
  instance_name?: string;
  timezone?: string;
  language?: string;
  tier: Tier;
  credits_remaining: number;
  llm_provider?: string;
  llm_model?: string;
  /** Default reasoning effort. `''` means the model's own default. */
  llm_effort?: string;
  default_temperature?: number;
  default_max_tokens?: number;
  tts_model?: string;
  tts_voice?: string;
  decision_provider?: string;
  decision_model?: string;
  default_autonomy?: string;
  theme_preference?: ThemePreference;
  accent_color?: string;
  created_at: string;
}

/** The same profile, flattened the way the web app reads it (`mapProfileResponse`). */
export interface AccountProfile {
  id: number;
  email: string;
  name: string;
  display_name?: string;
  avatar?: string;
  bio?: string;
  instance_name?: string;
  timezone?: string;
  language?: string;
  tier: Tier;
  credits: number;
  llm_provider?: string;
  llm_model?: string;
  llm_effort?: string;
  default_temperature?: number;
  default_max_tokens?: number;
  tts_model?: string;
  tts_voice?: string;
  decision_provider?: string;
  decision_model?: string;
  default_autonomy?: string;
  theme_preference?: ThemePreference;
  accent_color?: string;
  createdAt: string;
}

/**
 * PATCH /auth/profile/ body. Names go in the nested `user` object. Email is not
 * sent here: changing it needs a code to the new address (`requestEmailChange`).
 */
export interface AccountProfilePatch {
  display_name?: string;
  bio?: string;
  instance_name?: string;
  timezone?: string;
  language?: string;
  llm_provider?: string;
  llm_model?: string;
  /** `''` is a real choice (the model's own default); see `llm_effort` on AccountProfile. */
  llm_effort?: string;
  default_temperature?: number;
  tts_model?: string;
  tts_voice?: string;
  decision_provider?: string;
  decision_model?: string;
  default_autonomy?: DefaultAutonomy;
  theme_preference?: ThemePreference;
  accent_color?: string;
  user?: { first_name?: string; last_name?: string };
}

/** The picked avatar as React Native hands it over (a `file://` URI). */
export interface AvatarFile {
  uri: string;
  name: string;
  type: string;
}

// Password change (signed in): old password, then an emailed code, then the new password.

/** POST /auth/change-password/verify-otp/ answers a token the final step must present. */
export interface OtpVerifyResult {
  detail: string;
  verification_token: string;
}

export interface ChangePasswordInput {
  old_password: string;
  verification_token: string;
  new_password: string;
  confirm_password: string;
}

// Email change (signed in): the code is sent to the new address, and the change lands only when it comes back.

export interface EmailChangeConfirmResult {
  detail: string;
  email: string;
}

// Password reset (signed out). Listed here because the web keeps it in the same service.

export interface PasswordResetConfirmInput {
  email: string;
  verification_token: string;
  new_password: string;
  confirm_password: string;
}

/**
 * A password or email change ends every session, this one included, and the
 * response carries a new pair for this device. Store it, or the next request
 * 401s and the user is signed out by their own change.
 */
export interface TokenPairResponse {
  access?: string;
  refresh?: string;
}

// API keys

/** One key row. The secret itself is never returned after creation. */
export interface ApiKey {
  id: number;
  name: string;
  /** The first characters, shown as a hint. */
  key_prefix: string;
  is_active: boolean;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

/** POST /auth/api-keys/ answers the full key once, next to the row. */
export interface ApiKeyCreated {
  api_key: string;
  message: string;
  data: ApiKey;
}

/** POST /auth/api-keys/{id}/rotate/ answers the new key once. */
export interface ApiKeyRotated {
  new_key: string;
  old_prefix: string;
  message: string;
}

// Organisations (`core/orgs.py`)

/** `curator` approves and edits team solutions; it cannot manage people. */
export type OrgRole = 'owner' | 'admin' | 'curator' | 'member';

/** Roles that may change an organisation's settings and its people. */
export const MANAGER_ROLES: readonly OrgRole[] = ['owner', 'admin'];

/** Roles that may act on the review queue. */
export const CURATOR_ROLES: readonly OrgRole[] = ['owner', 'admin', 'curator'];

/** `suggest`: a fix found in chat is offered to its author as a draft. `auto`: saved at once. */
export type CaptureMode = 'suggest' | 'auto';

/** `open`: a share reaches the team at once. `curated`: a curator approves each one. */
export type ReviewPolicy = 'open' | 'curated';

export interface Org {
  id: number;
  name: string;
  role: OrgRole;
  share_by_default: boolean;
  capture_mode: CaptureMode;
  review_policy: ReviewPolicy;
}

export interface OrgMember {
  user_id: number;
  email: string;
  name: string;
  role: OrgRole;
}

/** An open invitation, as the manager of its org sees it. */
export interface OrgInvite {
  id: number;
  email: string;
  role: OrgRole;
  invited_by_name: string | null;
  created_at: string;
  expires_at: string;
}

/** An invitation addressed to the signed-in account. */
export interface MyInvite {
  id: number;
  org_id: number;
  org_name: string;
  role: OrgRole;
  invited_by_name: string | null;
  expires_at: string;
  /** False until the account's email is verified. Declining still works. */
  can_accept: boolean;
}

export interface InviteList<T> {
  invites: T[];
  /** True when the server cut the list at its cap. */
  truncated: boolean;
}

export interface OrgPatch {
  name?: string;
  share_by_default?: boolean;
  capture_mode?: CaptureMode;
  review_policy?: ReviewPolicy;
}

export interface InviteSent {
  invited: string;
  expires_at: string;
}

// The model catalogue (GET /llm/models/)

/** One model a provider serves. `effort_levels` is always present; `[]` is a real answer: no effort control. */
export interface AIModel {
  name: string;
  value: string;
  is_free: boolean;
  description: string;
  /** Whether this account can run it now: a key for its provider, or a free model on a platform key. */
  available?: boolean;
  /** Cheapest first, from the backend's effort ladder. */
  effort_levels: string[];
  /** The rung used when nobody chooses. `''` means the provider's own default. */
  default_effort: string;
  supports_effort: boolean;
}

export interface AIProvider {
  name: string;
  slug: string;
  description: string;
  icon: string;
  has_credentials: boolean;
  models: AIModel[];
}

/** The platform fallback: what runs execute on when their model is retired or unknown. */
export interface FallbackModel {
  provider: string;
  model: string;
}

export interface CatalogueMeta {
  last_refresh: {
    at: string;
    by: string;
    added: number;
    updated: number;
    retired: { value: string; replaced_by: string }[];
    new_upstream: string[];
    affected_agents: unknown[];
  } | null;
  fallback: FallbackModel;
}

/** GET /llm/models/ */
export interface ModelCatalogue {
  providers: AIProvider[];
  meta?: CatalogueMeta;
}

/** POST /llm/models/refresh/ (staff). */
export interface RefreshSummary {
  added: number;
  updated: number;
  retired: { value: string; replaced_by: string }[];
  new_upstream: string[];
  affected_agents: { id: number; name: string; old: string; suggested: string }[];
}
