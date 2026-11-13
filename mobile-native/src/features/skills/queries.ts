/**
 * React Query hooks for skills. Every write invalidates the whole `skills` key,
 * because the builder's skill picker and the Skills screen read the same list.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { skillsApi } from './api';
import type { Skill, SkillInput, SkillTab } from './types';

export const skillKeys = {
  all: ['skills'] as const,
  list: ['skills', 'list'] as const,
  search: (query: string, tab: SkillTab, pageSize: number) =>
    ['skills', 'search', tab, query, pageSize] as const,
};

/** Everything the caller may attach. The builder lists these in its skill picker. */
export function useSkills() {
  return useQuery({
    queryKey: skillKeys.list,
    queryFn: () => skillsApi.list(),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * One page of the Skills screen. Keeps the previous page on screen while a new
 * search is in flight, so typing does not blank the list.
 */
export function useSkillSearch(query: string, tab: SkillTab, pageSize = 20) {
  return useQuery({
    queryKey: skillKeys.search(query, tab, pageSize),
    queryFn: () => skillsApi.search(query, tab, pageSize),
    placeholderData: keepPreviousData,
  });
}

function useSkillMutation<TVars>(fn: (vars: TVars) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: skillKeys.all }),
  });
}

export function useCreateSkill() {
  return useSkillMutation((input: SkillInput) => skillsApi.create(input));
}

export function useUpdateSkill() {
  return useSkillMutation(({ id, input }: { id: Skill['id']; input: SkillInput }) =>
    skillsApi.update(id, input));
}

export function useRemoveSkill() {
  return useSkillMutation((id: Skill['id']) => skillsApi.remove(id));
}

/** Sharing on or off. Resolves to the server's sentence. */
export function useToggleSkillShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: Skill['id']) => skillsApi.toggleShare(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: skillKeys.all }),
  });
}

/** Copy a public skill into the caller's own collection. */
export function useForkSkill() {
  return useSkillMutation((id: Skill['id']) => skillsApi.fork(id));
}
