/**
 * React Query hooks for the agent builder: loading a board, saving it, and the
 * wizard. The keys for agents are the agents feature's own (`agentKeys`), so a save
 * here refreshes the agents list and the agent detail there, and the reverse.
 *
 * Screens do the checking and the shaping with `validateAgentDraft` and
 * `buildSavePayload` (payload.ts) before calling `mutate`.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { agentKeys } from '../agents/queries';
import { listTriggers } from '../schedules/api';
import { agentsApi, modelsApi } from './api';
import { duplicatePayload } from './payload';
import type { Agent, AgentConfig, AgentInput } from './types';

export const builderKeys = {
  models: ['llm', 'models'] as const,
  revisions: (agentId: number, limit: number) => ['agents', agentId, 'revisions', limit] as const,
};

/** Every agent on the account. The delegation picker and the agents list both read it. */
export function useAgentList() {
  return useQuery({
    queryKey: agentKeys.agents,
    queryFn: () => agentsApi.list(),
    staleTime: 60 * 1000,
  });
}

/** One agent's full configuration, as the board edits it. Disabled while `id` is null (a new agent). */
export function useAgentConfig(id: number | null) {
  return useQuery({
    queryKey: agentKeys.agent(id ?? 0),
    queryFn: () => agentsApi.get(id as number),
    enabled: id != null && Number.isFinite(id),
  });
}

/** The model catalogue. Cached for five minutes: it changes when a credential is added, not between renders. */
export function useModelCatalogue() {
  return useQuery({
    queryKey: builderKeys.models,
    queryFn: () => modelsApi.catalogue(),
    staleTime: 5 * 60 * 1000,
  });
}

/** The schedules that belong to one agent, from the Schedules page's rows. */
export function useAgentSchedules(agentId: number | null) {
  return useQuery({
    queryKey: ['builder', 'schedules', agentId ?? 0] as const,
    queryFn: () => listTriggers(agentId as number),
    enabled: agentId != null && Number.isFinite(agentId),
  });
}

/** Every configuration change, a page at a time, for the history screen. */
export function useAgentRevisionPages(agentId: number | null) {
  return useInfiniteQuery({
    queryKey: ['agents', agentId ?? 0, 'revisions', 'all'] as const,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      agentsApi.listRevisions(agentId as number, { limit: 25, cursor: pageParam }),
    getNextPageParam: (last) => (last.has_more ? last.next_cursor : undefined),
    enabled: agentId != null && Number.isFinite(agentId),
  });
}

/** The newest few configuration changes, for the board's "what changed" view. */
export function useAgentRevisions(agentId: number | null, limit = 3) {
  return useQuery({
    queryKey: builderKeys.revisions(agentId ?? 0, limit),
    queryFn: () => agentsApi.listRevisions(agentId as number, { limit }),
    enabled: agentId != null && Number.isFinite(agentId),
  });
}

/** Create an agent. The new agent's detail is cached so the board opens without a second read. */
export function useCreateAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config: AgentInput) => agentsApi.create(config),
    onSuccess: (agent) => {
      queryClient.setQueryData(agentKeys.agent(agent.id), agent);
      void queryClient.invalidateQueries({ queryKey: agentKeys.agents });
    },
  });
}

/**
 * Save an existing agent. The board adopts what the server stored, not what was
 * sent: the server normalises, and a board that differs by normalisation alone
 * would read as unsaved forever.
 */
export function useSaveAgent(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config: Partial<AgentConfig>) => agentsApi.update(id, config),
    onSuccess: (agent) => {
      queryClient.setQueryData(agentKeys.agent(id), agent);
      void queryClient.invalidateQueries({ queryKey: agentKeys.agents });
    },
  });
}

/** Delete an agent and drop its cached detail. */
export function useDeleteAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => agentsApi.remove(id),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: agentKeys.agent(id) });
      void queryClient.invalidateQueries({ queryKey: agentKeys.agents });
    },
  });
}

/**
 * Archive an agent: hidden from the list and never run automatically, and
 * restorable. The first answer to "get this out of my list", since delete keeps
 * only the runs.
 */
export function useArchiveAgent(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => agentsApi.update(id, { status: 'archived' }),
    onSuccess: (agent) => {
      queryClient.setQueryData(agentKeys.agent(id), agent);
      void queryClient.invalidateQueries({ queryKey: agentKeys.agents });
    },
  });
}

/** Make a draft copy of an agent (no schedule). Resolves to the new agent. */
export function useDuplicateAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ source, currentName }: { source: Partial<AgentConfig>; currentName: string }) =>
      agentsApi.create(duplicatePayload(source, currentName)),
    onSuccess: (agent: Agent) => {
      queryClient.setQueryData(agentKeys.agent(agent.id), agent);
      void queryClient.invalidateQueries({ queryKey: agentKeys.agents });
    },
  });
}

/**
 * Put an agent back to an earlier revision. The server answers with the restored
 * agent; a refusal (a connection or skill the old version names is gone) comes back
 * as an ApiError whose message names what to fix.
 */
export function useRestoreRevision(agentId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (number: number) => agentsApi.restoreRevision(agentId, number),
    onSuccess: (agent) => {
      queryClient.setQueryData(agentKeys.agent(agentId), agent);
      void queryClient.invalidateQueries({ queryKey: agentKeys.agents });
    },
  });
}

/** The wizard's questions for a plain-language description. Creates nothing. */
export function useWizardQuestions() {
  return useMutation({
    mutationFn: (description: string) => agentsApi.wizardQuestions(description),
  });
}

/** The wizard's proposal, from the description and the answers. Creates nothing. */
export function useWizardPropose() {
  return useMutation({
    mutationFn: ({ description, answers }: { description: string; answers: Record<string, unknown> }) =>
      agentsApi.wizardPropose(description, answers),
  });
}
