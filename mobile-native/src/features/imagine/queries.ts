/**
 * React Query hooks for Imagine: the catalogue, generation jobs, and the agent
 * conversation.
 *
 * The web app learns about finished jobs from a socket and falls back to a poll.
 * This layer has no socket, so every job that is still pending or processing is
 * re-read every few seconds while it is on screen, and the interval stops as soon
 * as the job settles.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { imagineAgentApi, imagineApi } from './api';
import { isLiveGeneration } from './request';
import type { Generation, GenerationRequest, ImagineResumeDecision, ImagineIntent } from './types';

/** How often a live job is re-read while on screen. */
export const GENERATION_POLL_MS = 3000;

export const imagineKeys = {
  all: ['imagine'] as const,
  capabilities: ['imagine', 'capabilities'] as const,
  generations: ['imagine', 'generations'] as const,
  generation: (id: number) => ['imagine', 'generations', id] as const,
  conversations: ['imagine', 'conversations'] as const,
  conversation: (id: number) => ['imagine', 'conversations', id] as const,
};

/** The model catalogue. The server caches it for an hour, so the client holds it for five minutes. */
export function useImagineCapabilities() {
  return useQuery({
    queryKey: imagineKeys.capabilities,
    queryFn: () => imagineApi.capabilities(),
    staleTime: 5 * 60 * 1000,
  });
}

/** Ask the server to rebuild the catalogue, then cache the answer. */
export function useRefreshImagineCapabilities() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => imagineApi.capabilities({ refresh: true }),
    onSuccess: (caps) => {
      queryClient.setQueryData(imagineKeys.capabilities, caps);
    },
  });
}

/**
 * The caller's generations. Re-read while any of them is still pending or
 * processing, so a finished image appears without a manual refresh.
 */
export function useGenerations() {
  return useQuery({
    queryKey: imagineKeys.generations,
    queryFn: () => imagineApi.list(),
    refetchInterval: (query) =>
      (query.state.data ?? []).some((g) => isLiveGeneration(g.status)) ? GENERATION_POLL_MS : false,
  });
}

/** One job. Re-read every few seconds while it is still running. */
export function useGeneration(id: number) {
  return useQuery({
    queryKey: imagineKeys.generation(id),
    queryFn: () => imagineApi.get(id),
    enabled: Number.isFinite(id),
    refetchInterval: (query) =>
      isLiveGeneration((query.state.data as Generation | undefined)?.status) ? GENERATION_POLL_MS : false,
  });
}

/** Start a generation. Its job joins the list, and the list polls it until it settles. */
export function useCreateGeneration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: GenerationRequest) => imagineApi.create(req),
    onSuccess: (generation) => {
      queryClient.setQueryData(imagineKeys.generation(generation.id), generation);
      void queryClient.invalidateQueries({ queryKey: imagineKeys.generations });
    },
  });
}

export function useRemoveGeneration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => imagineApi.remove(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: imagineKeys.generations }),
  });
}

export function useImagineConversations() {
  return useQuery({
    queryKey: imagineKeys.conversations,
    queryFn: () => imagineAgentApi.listConversations(),
  });
}

/**
 * One conversation with its messages. Disabled while `id` is null (no chat yet).
 * Re-read every few seconds while a generation in it is still running, so the
 * finished image arrives without a refresh.
 */
export function useImagineConversation(id: number | null) {
  return useQuery({
    queryKey: imagineKeys.conversation(id ?? 0),
    queryFn: () => imagineAgentApi.getConversation(id as number),
    enabled: id != null && Number.isFinite(id),
    refetchInterval: (query) => {
      const conv = query.state.data;
      if (!conv) return false;
      const running =
        conv.status === 'generating' ||
        (conv.messages ?? []).some((m) => isLiveGeneration(m.generation?.status));
      return running ? GENERATION_POLL_MS : false;
    },
  });
}

/**
 * Send one message to the media agent. Pass `model` to pin a catalogue entry for
 * this turn. The conversation and its list are re-read afterwards.
 */
export function useImagineChat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ message, conversationId, model }: { message: string; conversationId?: number; model?: string | null }) =>
      imagineAgentApi.chat(message, conversationId, model),
    onSettled: (_data, _error, vars) => {
      void queryClient.invalidateQueries({ queryKey: imagineKeys.conversations });
      if (vars.conversationId != null) {
        void queryClient.invalidateQueries({ queryKey: imagineKeys.conversation(vars.conversationId) });
      }
    },
  });
}

/** Answer a paused intent: approve, edit, or cancel. */
export function useImagineResume() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      conversationId,
      decision,
      overrides,
    }: {
      conversationId: number;
      decision: ImagineResumeDecision;
      overrides?: Partial<ImagineIntent>;
    }) => imagineAgentApi.resume(conversationId, decision, overrides),
    onSettled: (_data, _error, vars) => {
      void queryClient.invalidateQueries({ queryKey: imagineKeys.conversations });
      void queryClient.invalidateQueries({ queryKey: imagineKeys.conversation(vars.conversationId) });
      void queryClient.invalidateQueries({ queryKey: imagineKeys.generations });
    },
  });
}

export function useDeleteImagineConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => imagineAgentApi.deleteConversation(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: imagineKeys.conversations }),
  });
}

/**
 * Rename a conversation. Wired to the same call as the web, which the server
 * currently refuses with 405. Expect this mutation to fail until the backend
 * allows PATCH on the conversation viewset.
 */
export function useRenameImagineConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: number; title: string }) =>
      imagineAgentApi.updateConversation(id, { title }),
    onSettled: (_data, _error, vars) => {
      void queryClient.invalidateQueries({ queryKey: imagineKeys.conversations });
      void queryClient.invalidateQueries({ queryKey: imagineKeys.conversation(vars.id) });
    },
  });
}
