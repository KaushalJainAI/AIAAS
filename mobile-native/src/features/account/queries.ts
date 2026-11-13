/**
 * React Query hooks for the account: profile preferences, avatar, password and
 * email change, API keys, organisations and invitations, and the model catalogue.
 *
 * Profile changes also invalidate `['settings', 'profile']`, the key the
 * Settings feature reads the name from, so the two screens agree after a save.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  changePassword,
  confirmEmailChange,
  confirmPasswordReset,
  createApiKey,
  createOrg,
  deleteApiKey,
  deleteOrg,
  getAccountProfile,
  getAIModels,
  inviteOrgMember,
  listApiKeys,
  listMyInvites,
  listOrgInvites,
  listOrgMembers,
  listOrgs,
  refreshModelCatalogue,
  removeOrgMember,
  requestEmailChange,
  requestPasswordChangeOtp,
  requestPasswordReset,
  respondToInvite,
  revokeOrgInvite,
  rotateApiKey,
  setActiveOrg,
  setOrgMemberRole,
  updateAccountProfile,
  updateFallbackModel,
  updateOrg,
  uploadAvatar,
  verifyPasswordChangeOtp,
  verifyPasswordResetOtp,
} from './api';
import type {
  AccountProfilePatch,
  AvatarFile,
  ChangePasswordInput,
  OrgPatch,
  OrgRole,
  PasswordResetConfirmInput,
} from './types';

export const accountKeys = {
  profile: ['account', 'profile'] as const,
  apiKeys: ['account', 'api-keys'] as const,
  orgs: ['account', 'orgs'] as const,
  orgMembers: (orgId: number) => ['account', 'orgs', orgId, 'members'] as const,
  orgInvites: (orgId: number) => ['account', 'orgs', orgId, 'invites'] as const,
  myInvites: ['account', 'my-invites'] as const,
  models: ['account', 'models'] as const,
};

/** The model list changes when a key is added or the catalogue is refreshed, not between renders. */
export const MODEL_CATALOGUE_STALE_MS = 5 * 60 * 1000;

// Profile

export function useAccountProfile() {
  return useQuery({
    queryKey: accountKeys.profile,
    queryFn: getAccountProfile,
  });
}

/** Save preferences. The new profile replaces the cached one at once. */
export function useUpdateAccountProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: AccountProfilePatch) => updateAccountProfile(patch),
    onSuccess: (updated) => {
      queryClient.setQueryData(accountKeys.profile, updated);
      void queryClient.invalidateQueries({ queryKey: ['settings', 'profile'] });
    },
  });
}

export function useUploadAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: AvatarFile) => uploadAvatar(file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accountKeys.profile });
      void queryClient.invalidateQueries({ queryKey: ['settings', 'profile'] });
    },
  });
}

// Password change (signed in)

export function useRequestPasswordChangeOtp() {
  return useMutation({
    mutationFn: (oldPassword: string) => requestPasswordChangeOtp(oldPassword),
  });
}

export function useVerifyPasswordChangeOtp() {
  return useMutation({
    mutationFn: (otpCode: string) => verifyPasswordChangeOtp(otpCode),
  });
}

/** Ends every other session. The new token pair is stored by the API call itself. */
export function useChangePassword() {
  return useMutation({
    mutationFn: (input: ChangePasswordInput) => changePassword(input),
  });
}

// Email change (signed in)

export function useRequestEmailChange() {
  return useMutation({
    mutationFn: (args: { newEmail: string; password: string }) =>
      requestEmailChange(args.newEmail, args.password),
  });
}

/** The address changes only here. The profile is re-read so the new one shows. */
export function useConfirmEmailChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (otpCode: string) => confirmEmailChange(otpCode),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accountKeys.profile });
      void queryClient.invalidateQueries({ queryKey: ['settings', 'profile'] });
    },
  });
}

// Password reset (signed out)

export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: (email: string) => requestPasswordReset(email),
  });
}

export function useVerifyPasswordResetOtp() {
  return useMutation({
    mutationFn: (args: { email: string; otpCode: string }) =>
      verifyPasswordResetOtp(args.email, args.otpCode),
  });
}

export function useConfirmPasswordReset() {
  return useMutation({
    mutationFn: (input: PasswordResetConfirmInput) => confirmPasswordReset(input),
  });
}

// API keys

export function useApiKeys() {
  return useQuery({
    queryKey: accountKeys.apiKeys,
    queryFn: listApiKeys,
  });
}

/** The full secret is in the answer's `api_key`. Show it once; it is not stored or returned again. */
export function useCreateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => createApiKey(name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accountKeys.apiKeys });
    },
  });
}

/** Replace a key's secret. The old one stops working at once. */
export function useRotateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => rotateApiKey(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accountKeys.apiKeys });
    },
  });
}

export function useDeleteApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteApiKey(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accountKeys.apiKeys });
    },
  });
}

// Organisations

/** The caller's orgs and which one is active. */
export function useOrgs() {
  return useQuery({
    queryKey: accountKeys.orgs,
    queryFn: listOrgs,
  });
}

export function useCreateOrg() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => createOrg(name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accountKeys.orgs });
    },
  });
}

export function useUpdateOrg() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: number; patch: OrgPatch }) => updateOrg(args.id, args.patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accountKeys.orgs });
    },
  });
}

export function useDeleteOrg() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteOrg(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accountKeys.orgs });
    },
  });
}

/** Choose the active org. Chats started after this use it; existing chats keep theirs. */
export function useSetActiveOrg() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orgId: number | null) => setActiveOrg(orgId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accountKeys.orgs });
    },
  });
}

export function useOrgMembers(orgId: number, enabled = true) {
  return useQuery({
    queryKey: accountKeys.orgMembers(orgId),
    queryFn: () => listOrgMembers(orgId),
    enabled: enabled && Number.isFinite(orgId),
  });
}

export function useInviteOrgMember(orgId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { email: string; role?: Exclude<OrgRole, 'owner'> }) =>
      inviteOrgMember(orgId, args.email, args.role),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accountKeys.orgInvites(orgId) });
    },
  });
}

export function useOrgInvites(orgId: number, enabled = true) {
  return useQuery({
    queryKey: accountKeys.orgInvites(orgId),
    queryFn: () => listOrgInvites(orgId),
    enabled: enabled && Number.isFinite(orgId),
  });
}

export function useRevokeOrgInvite(orgId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: number) => revokeOrgInvite(orgId, inviteId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accountKeys.orgInvites(orgId) });
    },
  });
}

/** Invitations addressed to the signed-in account. */
export function useMyInvites() {
  return useQuery({
    queryKey: accountKeys.myInvites,
    queryFn: listMyInvites,
  });
}

/** Accept or decline. Accepting adds an org, so the org list is refreshed too. */
export function useRespondToInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { inviteId: number; accept: boolean }) =>
      respondToInvite(args.inviteId, args.accept),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accountKeys.myInvites });
      void queryClient.invalidateQueries({ queryKey: accountKeys.orgs });
    },
  });
}

export function useSetOrgMemberRole(orgId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { userId: number; role: OrgRole }) =>
      setOrgMemberRole(orgId, args.userId, args.role),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accountKeys.orgMembers(orgId) });
    },
  });
}

export function useRemoveOrgMember(orgId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: number) => removeOrgMember(orgId, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accountKeys.orgMembers(orgId) });
    },
  });
}

// The model catalogue

/** Every provider and model, for the model picker. */
export function useAIModels() {
  return useQuery({
    queryKey: accountKeys.models,
    queryFn: getAIModels,
    staleTime: MODEL_CATALOGUE_STALE_MS,
  });
}

/** Staff only. Re-reads the upstream catalogue and refreshes the picker. */
export function useRefreshModelCatalogue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => refreshModelCatalogue(),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: accountKeys.models });
    },
  });
}

/** Staff only. Changes the platform fallback model. */
export function useUpdateFallbackModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { provider: string; model: string }) =>
      updateFallbackModel(args.provider, args.model),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accountKeys.models });
    },
  });
}
