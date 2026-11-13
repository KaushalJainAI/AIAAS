/**
 * React Query hooks for the tools library.
 *
 * The catalogue key is shared with the builder, which reads it to know which
 * tools a grant unlocks. A successful update writes the server's answer straight
 * into the cache, so the toggle the person just pressed is the one they see.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { toolsApi } from './api';
import type { ToolChange, ToolsCatalogue } from './types';

export const toolKeys = {
  all: ['tools'] as const,
  catalogue: ['tools', 'catalogue'] as const,
  usage: ['tools', 'usage'] as const,
};

export function useToolCatalogue() {
  return useQuery({
    queryKey: toolKeys.catalogue,
    queryFn: () => toolsApi.catalogue(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useToolUsage() {
  return useQuery({
    queryKey: toolKeys.usage,
    queryFn: () => toolsApi.usage(),
    staleTime: 5 * 60 * 1000,
  });
}

/** Switch tools, or set their budgets. The returned catalogue replaces the cached one. */
export function useUpdateTools() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: Record<string, ToolChange>) => toolsApi.update(changes),
    onSuccess: (catalogue: ToolsCatalogue) => {
      queryClient.setQueryData(toolKeys.catalogue, catalogue);
    },
  });
}
