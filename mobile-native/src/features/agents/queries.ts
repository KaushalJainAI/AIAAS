/**
 * Read-and-run hooks for agents. Paths are the ones the web app calls
 * (better-n8n-frontend/src/api/agents.ts and logs.ts); `api()` prepends `/api`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import type {
  Agent,
  AgentRunStarted,
  CancelResult,
  CursorPage,
  ExecutionDetail,
  ExecutionLog,
  SteerResult,
} from './types';

/** How often a live run is re-read while its screen is focused. */
export const RUN_POLL_MS = 3000;

export const agentKeys = {
  agents: ['agents'] as const,
  agent: (id: number) => ['agents', id] as const,
  recentRuns: ['runs', 'recent'] as const,
  agentRuns: (id: number) => ['runs', 'agent', id] as const,
  run: (executionId: string) => ['runs', 'detail', executionId] as const,
};

/** A run that can still change. Mirrors the web's LIVE_STATUSES. */
export function isLiveStatus(status: string | null | undefined): boolean {
  return status === 'running' || status === 'pending' || status === 'paused';
}

/** The list endpoints answer a bare array or a DRF envelope; accept either. */
function listOf<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    const results = (data as { results?: unknown }).results;
    if (Array.isArray(results)) return results as T[];
  }
  return [];
}

export function useAgents() {
  return useQuery({
    queryKey: agentKeys.agents,
    queryFn: async () => listOf<Agent>(await api<unknown>('/orchestrator/agents/')),
  });
}

export function useAgent(id: number) {
  return useQuery({
    queryKey: agentKeys.agent(id),
    queryFn: () => api<Agent>(`/orchestrator/agents/${id}/`),
    enabled: Number.isFinite(id),
  });
}

/**
 * The newest 100 runs across every agent. The agents list uses it to show each
 * agent's last run without one request per agent. Rows are newest first.
 */
export function useRecentRuns() {
  return useQuery({
    queryKey: agentKeys.recentRuns,
    queryFn: async () => {
      const page = await api<CursorPage<ExecutionLog>>('/logs/executions/', { query: { limit: 100 } });
      return page.results;
    },
  });
}

/** One agent's most recent runs, newest first. Eval sweeps are excluded by the server. */
export function useAgentRuns(agentId: number) {
  return useQuery({
    queryKey: agentKeys.agentRuns(agentId),
    queryFn: async () => {
      const page = await api<CursorPage<ExecutionLog>>('/logs/executions/', {
        query: { workflow_id: agentId, limit: 20 },
      });
      return page.results;
    },
    enabled: Number.isFinite(agentId),
  });
}

/**
 * One run in full. While `watching` is true and the run is still live, it is
 * re-read every few seconds; the interval stops on its own once the run ends.
 */
export function useRun(executionId: string, watching: boolean) {
  return useQuery({
    queryKey: agentKeys.run(executionId),
    queryFn: () => api<ExecutionDetail>(`/logs/executions/${encodeURIComponent(executionId)}/`),
    refetchInterval: (query) =>
      watching && isLiveStatus(query.state.data?.status) ? RUN_POLL_MS : false,
  });
}

/** Start a run. Resolves with an execution id; the run itself continues on the server. */
export function useStartRun(agentId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (goal: string) =>
      api<AgentRunStarted>(`/orchestrator/agents/${agentId}/execute/`, {
        method: 'POST',
        body: { goal },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentKeys.agentRuns(agentId) });
      void queryClient.invalidateQueries({ queryKey: agentKeys.recentRuns });
    },
  });
}

/** Stop one run. A 409 means it cannot be stopped from here; the message says why. */
export function useCancelRun(executionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<CancelResult>(`/orchestrator/runs/${encodeURIComponent(executionId)}/cancel/`, {
        method: 'POST',
      }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: agentKeys.run(executionId) });
      void queryClient.invalidateQueries({ queryKey: agentKeys.recentRuns });
    },
  });
}

/** Queue an instruction for this run, read at its next step. Addressed by execution, not agent. */
export function useSteerRun(executionId: string) {
  return useMutation({
    mutationFn: (message: string) =>
      api<SteerResult>(`/orchestrator/runs/${encodeURIComponent(executionId)}/steer/`, {
        method: 'POST',
        body: { message },
      }),
  });
}
