import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import type {
  MemoryList,
  NotificationPreferences,
  NotificationPreferencesPatch,
  ProfileNamePatch,
  ProfileResponse,
} from './types';

export const settingsKeys = {
  profile: ['settings', 'profile'] as const,
  memory: ['settings', 'memory'] as const,
  preferences: ['settings', 'notification-preferences'] as const,
};

/** GET /api/auth/profile/ */
export function useProfile() {
  return useQuery({
    queryKey: settingsKeys.profile,
    queryFn: () => api<ProfileResponse>('/auth/profile/'),
  });
}

/** PATCH /api/auth/profile/ with { user: { first_name, last_name } }. */
export function useUpdateProfileName() {
  const queryClient = useQueryClient();
  const { refreshUser } = useAuth();
  return useMutation({
    mutationFn: (body: ProfileNamePatch) =>
      api<ProfileResponse>('/auth/profile/', { method: 'PATCH', body }),
    onSuccess: (updated) => {
      queryClient.setQueryData(settingsKeys.profile, updated);
      // Other screens read the name from the auth context.
      refreshUser().catch(() => undefined);
    },
  });
}

/** GET /api/memory/ */
export function useMemory() {
  return useQuery({
    queryKey: settingsKeys.memory,
    queryFn: async (): Promise<MemoryList> => {
      const data = await api<MemoryList>('/memory/');
      return {
        memories: Array.isArray(data?.memories) ? data.memories : [],
        max_per_category: data?.max_per_category ?? 25,
        max_prompt_chars: data?.max_prompt_chars,
      };
    },
    staleTime: 30 * 1000,
  });
}

/** DELETE /api/memory/{id}/. Refetches because removing one fact can move another into the prompt. */
export function useForgetMemory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<null>(`/memory/${id}/`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: settingsKeys.memory });
    },
  });
}

/** DELETE /api/memory/ (forget everything). */
export function useForgetAllMemory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<null>('/memory/', { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: settingsKeys.memory });
    },
  });
}

/** GET /api/notifications/preferences/ */
export function useNotificationPreferences() {
  return useQuery({
    queryKey: settingsKeys.preferences,
    queryFn: () => api<NotificationPreferences>('/notifications/preferences/'),
  });
}

/**
 * PATCH /api/notifications/preferences/. The change shows at once and rolls
 * back to the previous value if the server refuses it.
 */
export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: NotificationPreferencesPatch) =>
      api<NotificationPreferences>('/notifications/preferences/', { method: 'PATCH', body: patch }),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: settingsKeys.preferences });
      const previous = queryClient.getQueryData<NotificationPreferences>(settingsKeys.preferences);
      if (previous) {
        queryClient.setQueryData<NotificationPreferences>(settingsKeys.preferences, { ...previous, ...patch });
      }
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) {
        queryClient.setQueryData(settingsKeys.preferences, context.previous);
      }
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(settingsKeys.preferences, updated);
    },
  });
}
