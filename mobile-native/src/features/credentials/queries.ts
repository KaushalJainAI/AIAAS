/**
 * React Query hooks for credentials and credential types.
 *
 * Mutations invalidate the credential list and, because a connection's status
 * depends on whether its credentials exist and verify, the connections keys too
 * (by the `['connections']` prefix, which this file does not import).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  completeGoogleOAuth,
  createCredential,
  deleteCredential,
  listCredentials,
  listCredentialTypes,
  updateCredential,
  verifyCredential,
} from './api';
import type {
  CreateCredentialInput,
  GoogleOAuthCompleteInput,
  UpdateCredentialInput,
} from './types';

export const credentialKeys = {
  all: ['credentials'] as const,
  list: ['credentials', 'list'] as const,
  types: ['credentials', 'types'] as const,
};

/** Credential types change only when the platform is re-seeded. Cache them for a while. */
export function useCredentialTypes() {
  return useQuery({
    queryKey: credentialKeys.types,
    queryFn: listCredentialTypes,
    staleTime: 10 * 60 * 1000,
  });
}

export function useCredentials() {
  return useQuery({
    queryKey: credentialKeys.list,
    queryFn: listCredentials,
  });
}

/** Store a new credential. The values travel once and are never returned. */
export function useCreateCredential() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCredentialInput) => createCredential(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: credentialKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
  });
}

export function useUpdateCredential(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateCredentialInput) => updateCredential(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: credentialKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
  });
}

/** Delete a credential. A connection that needed it will show as not connected. */
export function useDeleteCredential() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteCredential(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: credentialKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
  });
}

/** Check a stored secret against its provider. */
export function useVerifyCredential() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => verifyCredential(id),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: credentialKeys.list });
    },
  });
}

/** Finish a Google sign-in: the callback's code becomes a stored credential. */
export function useCompleteGoogleOAuth() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: GoogleOAuthCompleteInput) => completeGoogleOAuth(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: credentialKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
  });
}
