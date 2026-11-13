/**
 * Account API: profile preferences, avatar, password and email change, API
 * keys, organisations and invitations, and the model catalogue.
 *
 * Mirrors, endpoint for endpoint:
 *  - better-n8n-frontend/src/api/auth.ts      profile, avatar, change-password
 *                                             (OTP), email change, password reset,
 *                                             API keys (list, create, rotate)
 *  - better-n8n-frontend/src/api/orgs.ts      orgs, members, invites, active org
 *  - better-n8n-frontend/src/api/nodeService.ts  llm/models, llm/models/refresh,
 *                                             llm/fallback
 *
 * Paths are relative to /api; `api()` prepends it. Two things differ from the web:
 *  - Avatar upload is multipart, which `api()` does not send. `uploadAvatar`
 *    builds the request itself with the same token refresh.
 *  - Password and email changes return a fresh token pair. It is stored here,
 *    as the web's `keepFreshPair` does, or the next request signs the user out.
 */

import { API_URL } from '../../config';
import { ApiError, api, endSession, refreshAccessToken } from '../../api/client';
import { getAccessToken, setTokens } from '../../api/tokens';
import type {
  AccountProfile,
  AccountProfilePatch,
  ApiKey,
  ApiKeyCreated,
  ApiKeyRotated,
  AccountProfileResponse,
  AvatarFile,
  ChangePasswordInput,
  EmailChangeConfirmResult,
  InviteList,
  InviteSent,
  MyInvite,
  ModelCatalogue,
  Org,
  OrgInvite,
  OrgMember,
  OrgPatch,
  OrgRole,
  OtpVerifyResult,
  PasswordResetConfirmInput,
  RefreshSummary,
  TokenPairResponse,
  FallbackModel,
  Tier,
} from './types';


/** DRF returns a bare list or `{results}` depending on pagination. Accept both. */
function listOf<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    const results = (data as { results?: unknown }).results;
    if (Array.isArray(results)) return results as T[];
  }
  return [];
}

/** Keep the new pair a password or email change returns, or the next request signs the user out. */
async function keepFreshPair(data: TokenPairResponse | null | undefined): Promise<void> {
  if (data?.access && data?.refresh) await setTokens(data.access, data.refresh);
}

// Profile

function mapProfile(data: AccountProfileResponse): AccountProfile {
  return {
    id: data.user.id,
    email: data.user.email,
    name: `${data.user.first_name || ''} ${data.user.last_name || ''}`.trim() || data.user.username,
    display_name: data.display_name,
    avatar: data.avatar,
    bio: data.bio,
    instance_name: data.instance_name,
    timezone: data.timezone,
    language: data.language,
    tier: data.tier as Tier,
    credits: data.credits_remaining,
    llm_provider: data.llm_provider,
    llm_model: data.llm_model,
    llm_effort: data.llm_effort,
    default_temperature: data.default_temperature,
    default_max_tokens: data.default_max_tokens,
    tts_model: data.tts_model,
    tts_voice: data.tts_voice,
    decision_provider: data.decision_provider,
    decision_model: data.decision_model,
    default_autonomy: data.default_autonomy,
    theme_preference: data.theme_preference,
    accent_color: data.accent_color,
    createdAt: data.created_at,
  };
}

/** The signed-in account's profile, flattened. */
export async function getAccountProfile(): Promise<AccountProfile> {
  return mapProfile(await api<AccountProfileResponse>('/auth/profile/'));
}

/**
 * Save preferences (the model, effort, default autonomy, theme, voice, names).
 * Email is not accepted here; see `requestEmailChange`.
 */
export async function updateAccountProfile(patch: AccountProfilePatch): Promise<AccountProfile> {
  return mapProfile(
    await api<AccountProfileResponse>('/auth/profile/', { method: 'PATCH', body: patch }),
  );
}

/** Multipart POST with one token refresh on 401, like `api()`. Throws an ApiError on failure. */
async function postAvatar(file: AvatarFile, token: string | null): Promise<Response> {
  const body = new FormData();
  // React Native's FormData takes a {uri, name, type} object for a file part.
  body.append('avatar', { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${API_URL}/auth/profile/avatar/`, { method: 'POST', headers, body });
}

async function avatarError(res: Response): Promise<ApiError> {
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    /* not JSON: fall through to the generic sentence */
  }
  const text = [data.detail, data.error, data.message].find(
    (v): v is string => typeof v === 'string' && v.trim().length > 0,
  );
  return new ApiError(text ?? 'Could not upload that picture.', res.status);
}

/** Upload a profile picture (PNG, JPEG, GIF or WebP, 2 MB or less). Answers the new URL. */
export async function uploadAvatar(file: AvatarFile): Promise<{ avatar_url: string }> {
  let res = await postAvatar(file, getAccessToken());
  if (res.status === 401) {
    const fresh = await refreshAccessToken();
    if (!fresh) {
      await endSession();
      throw await avatarError(res);
    }
    res = await postAvatar(file, fresh);
  }
  if (!res.ok) throw await avatarError(res);
  return (await res.json()) as { avatar_url: string };
}

// Password change (signed in): old password, then an emailed code, then the new password.

/** Step 1: check the old password and email a code. */
export function requestPasswordChangeOtp(oldPassword: string): Promise<{ detail: string }> {
  return api<{ detail: string }>('/auth/change-password/request-otp/', {
    method: 'POST',
    body: { old_password: oldPassword },
  });
}

/** Step 2: check the emailed code. The answer carries the token step 3 needs. */
export function verifyPasswordChangeOtp(otpCode: string): Promise<OtpVerifyResult> {
  return api<OtpVerifyResult>('/auth/change-password/verify-otp/', {
    method: 'POST',
    body: { otp_code: otpCode },
  });
}

/** Step 3: set the new password. Every other session ends; this device gets a new pair. */
export async function changePassword(input: ChangePasswordInput): Promise<{ detail: string }> {
  const data = await api<{ detail: string } & TokenPairResponse>('/auth/change-password/', {
    method: 'POST',
    body: input,
  });
  await keepFreshPair(data);
  return { detail: data.detail };
}

// Email change (signed in): the code goes to the new address, and the change lands only when it comes back.

/** Send a code to `newEmail`. The address changes only once it is confirmed. */
export function requestEmailChange(newEmail: string, password: string): Promise<{ detail: string }> {
  return api<{ detail: string }>('/auth/email/change/request/', {
    method: 'POST',
    body: { new_email: newEmail, password },
  });
}

/** Apply the new address with the code. Every other session ends; this device gets a new pair. */
export async function confirmEmailChange(otpCode: string): Promise<EmailChangeConfirmResult> {
  const data = await api<EmailChangeConfirmResult & TokenPairResponse>('/auth/email/change/confirm/', {
    method: 'POST',
    body: { otp_code: otpCode },
  });
  await keepFreshPair(data);
  return { detail: data.detail, email: data.email };
}

// Password reset (signed out). Same service as the web, used by the forgot-password screen.

export function requestPasswordReset(email: string): Promise<{ detail: string }> {
  return api<{ detail: string }>('/auth/password-reset-request/', {
    method: 'POST',
    body: { email },
    auth: false,
  });
}

export function verifyPasswordResetOtp(email: string, otpCode: string): Promise<OtpVerifyResult> {
  return api<OtpVerifyResult>('/auth/password-reset-verify/', {
    method: 'POST',
    body: { email, otp_code: otpCode },
    auth: false,
  });
}

export function confirmPasswordReset(input: PasswordResetConfirmInput): Promise<{ detail: string }> {
  return api<{ detail: string }>('/auth/password-reset-confirm/', {
    method: 'POST',
    body: input,
    auth: false,
  });
}

// API keys

/** The caller's keys. Only the prefix is returned; the secret was shown once, at creation. */
export async function listApiKeys(): Promise<ApiKey[]> {
  return listOf<ApiKey>(await api<unknown>('/auth/api-keys/'));
}

/** Create a key. The full secret is in `api_key` and is not shown again. */
export function createApiKey(name: string): Promise<ApiKeyCreated> {
  return api<ApiKeyCreated>('/auth/api-keys/', { method: 'POST', body: { name } });
}

/** Replace a key's secret. The old one stops working at once. */
export function rotateApiKey(id: number): Promise<ApiKeyRotated> {
  return api<ApiKeyRotated>(`/auth/api-keys/${id}/rotate/`, { method: 'POST', body: {} });
}

export function deleteApiKey(id: number): Promise<null> {
  return api<null>(`/auth/api-keys/${id}/`, { method: 'DELETE' });
}

// Organisations (`core/orgs.py`). Membership is checked live; a foreign org is a 404.

/** Orgs the caller belongs to, and which one is active. The body is `{orgs, active_org_id}`. */
export async function listOrgs(): Promise<{ orgs: Org[]; active_org_id: number | null }> {
  const data = await api<{ orgs?: Org[]; active_org_id?: number | null }>('/orgs/');
  return {
    orgs: Array.isArray(data?.orgs) ? data.orgs : [],
    active_org_id: data?.active_org_id ?? null,
  };
}

export function createOrg(name: string): Promise<Org> {
  return api<Org>('/orgs/', { method: 'POST', body: { name } });
}

/** Managers only. `name` and the sharing settings, and `capture_mode` / `review_policy`. */
export function updateOrg(id: number, patch: OrgPatch): Promise<Org> {
  return api<Org>(`/orgs/${id}/`, { method: 'PATCH', body: patch });
}

/** Owner only. */
export function deleteOrg(id: number): Promise<null> {
  return api<null>(`/orgs/${id}/`, { method: 'DELETE' });
}

/** Choose the org new chats and runs use. `null` goes back to personal. */
export function setActiveOrg(orgId: number | null): Promise<{ active_org_id: number | null }> {
  return api<{ active_org_id: number | null }>('/orgs/active/', {
    method: 'POST',
    body: { org_id: orgId },
  });
}

/** Members of one org. The body is `{members}`. */
export async function listOrgMembers(id: number): Promise<OrgMember[]> {
  const data = await api<{ members?: OrgMember[] }>(`/orgs/${id}/members/`);
  return Array.isArray(data?.members) ? data.members : [];
}

/**
 * Send an invitation. Answers the same whether or not the address has an
 * account, so it cannot be used to find who is registered.
 */
export function inviteOrgMember(
  id: number,
  email: string,
  role: Exclude<OrgRole, 'owner'> = 'member',
): Promise<InviteSent> {
  return api<InviteSent>(`/orgs/${id}/members/`, { method: 'POST', body: { email, role } });
}

/** Pending invitations of one org (managers only). */
export async function listOrgInvites(id: number): Promise<InviteList<OrgInvite>> {
  const data = await api<{ invites?: OrgInvite[]; truncated?: boolean }>(`/orgs/${id}/invites/`);
  return {
    invites: Array.isArray(data?.invites) ? data.invites : [],
    truncated: data?.truncated === true,
  };
}

export function revokeOrgInvite(id: number, inviteId: number): Promise<null> {
  return api<null>(`/orgs/${id}/invites/${inviteId}/`, { method: 'DELETE' });
}

/** Invitations addressed to the signed-in account. */
export async function listMyInvites(): Promise<InviteList<MyInvite>> {
  const data = await api<{ invites?: MyInvite[]; truncated?: boolean }>('/orgs/invites/');
  return {
    invites: Array.isArray(data?.invites) ? data.invites : [],
    truncated: data?.truncated === true,
  };
}

/**
 * Accept (answers `{org_id, role}`) or decline (204, no body; resolves to null).
 * Accepting needs a verified email; declining works either way.
 */
export function respondToInvite(
  inviteId: number,
  accept: boolean,
): Promise<{ org_id: number; role: OrgRole } | null> {
  return api<{ org_id: number; role: OrgRole } | null>(`/orgs/invites/${inviteId}/`, {
    method: 'POST',
    body: { accept },
  });
}

/** Change a member's role. Managers only. Owners cannot be demoted here. */
export function setOrgMemberRole(id: number, userId: number, role: OrgRole): Promise<unknown> {
  return api<unknown>(`/orgs/${id}/members/${userId}/`, { method: 'PATCH', body: { role } });
}

export function removeOrgMember(id: number, userId: number): Promise<null> {
  return api<null>(`/orgs/${id}/members/${userId}/`, { method: 'DELETE' });
}

// The model catalogue

/**
 * Every provider and model, with whether this account can run each. This is
 * what the model picker reads. An empty `effort_levels` means no effort control.
 */
export function getAIModels(): Promise<ModelCatalogue> {
  return api<ModelCatalogue>('/llm/models/');
}

/** Re-read the live OpenRouter catalogue (staff only). 409 while a refresh is already running. */
export function refreshModelCatalogue(): Promise<RefreshSummary> {
  return api<RefreshSummary>('/llm/models/refresh/', { method: 'POST', body: {} });
}

/** Change the platform fallback model (staff only). 403 for everyone else. */
export function updateFallbackModel(provider: string, model: string): Promise<FallbackModel & { warning?: string }> {
  return api<FallbackModel & { warning?: string }>('/llm/fallback/', {
    method: 'PATCH',
    body: { provider, model },
  });
}
