/**
 * React Query hooks for schedules (triggers).
 *
 * The screen decides whether to poll: each hook that ticks takes `watching`
 * (true only while the screen is focused and the app is open). The web app
 * re-reads the list and scheduler health on the same cadence.
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { runKeys } from '../runs/queries';
import {
  createTrigger,
  deleteTrigger,
  getSchedulerHealth,
  listTriggers,
  patchAgent,
  previewSchedule,
  rotateTriggerSecret,
  runTriggerNow,
  updateTrigger,
} from './api';
import type { PreviewInput, TriggerInput } from './types';

/** How often the list and scheduler health are re-read while the Schedules screen is focused. */
export const SCHEDULE_POLL_MS = 30_000;

export const scheduleKeys = {
  all: ['schedules'] as const,
  list: ['schedules', 'list'] as const,
  health: ['schedules', 'health'] as const,
  preview: (input: PreviewInput) => ['schedules', 'preview', input] as const,
};

/** Every schedule the caller owns. Re-read while `watching`. */
export function useTriggers(watching = false) {
  return useQuery({
    queryKey: scheduleKeys.list,
    queryFn: () => listTriggers(),
    refetchInterval: watching ? SCHEDULE_POLL_MS : false,
  });
}

/** Whether the sweep is running. A stopped scheduler is noticed without a reload. */
export function useSchedulerHealth(watching = false) {
  return useQuery({
    queryKey: scheduleKeys.health,
    queryFn: getSchedulerHealth,
    refetchInterval: watching ? SCHEDULE_POLL_MS : false,
  });
}

/**
 * The server's reading of a cron expression. Disabled while the expression is
 * blank. The caller debounces its input so this runs once per pause, not once
 * per keystroke. The previous reading stays on screen while a new one loads.
 */
export function useSchedulePreview(input: PreviewInput | null) {
  const enabled = !!input && input.cron.trim().length > 0;
  return useQuery({
    queryKey: input ? scheduleKeys.preview(input) : ['schedules', 'preview', 'none'],
    queryFn: () => previewSchedule(input as PreviewInput),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useCreateTrigger() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TriggerInput) => createTrigger(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: scheduleKeys.all });
    },
  });
}

/** PATCH one schedule. The patch is partial: unmentioned fields keep their value. */
export function useUpdateTrigger(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<TriggerInput>) => updateTrigger(id, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: scheduleKeys.all });
    },
  });
}

export function useDeleteTrigger() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteTrigger(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: scheduleKeys.all });
    },
  });
}

/**
 * Fire a schedule now. A run that started shows up in the run list, so that is
 * invalidated too. `outcome` says why nothing ran, when nothing did.
 */
export function useRunTriggerNow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => runTriggerNow(id),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: scheduleKeys.all });
      void queryClient.invalidateQueries({ queryKey: runKeys.all });
    },
  });
}

/** Issue a new webhook secret. The old URL stops working at once. */
export function useRotateTriggerSecret() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => rotateTriggerSecret(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: scheduleKeys.all });
    },
  });
}

/**
 * The two fixes that live on the agent rather than the schedule: letting it run
 * unwatched, and resuming it. Both PATCH the agent, then the schedules are re-read.
 */
export function useAgentFix() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, patch }: { agentId: number; patch: Record<string, unknown> }) =>
      patchAgent(agentId, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: scheduleKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}
