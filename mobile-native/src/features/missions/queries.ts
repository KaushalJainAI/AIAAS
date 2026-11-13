/**
 * React Query hooks for missions. A mission advances in the background, so its
 * list is re-read while the screen is focused and something in it can still move.
 * The screen decides that: `watching` comes from `useIsLive`.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { listExecutions } from '../runs/api';
import { runKeys } from '../runs/queries';
import {
  createMission,
  deleteMission,
  getMission,
  listMissions,
  missionAction,
} from './api';
import { LIVE_MISSION_STATUSES, type Mission, type MissionCreateInput, type MissionVerb } from './types';

/** How often the list is re-read while a mission in it is still going. */
export const MISSION_POLL_MS = 30_000;

export const missionKeys = {
  all: ['missions'] as const,
  list: ['missions', 'list'] as const,
  detail: (id: number) => ['missions', 'detail', id] as const,
  runs: (id: number) => ['missions', 'runs', id] as const,
};

export function useMissions(watching = false) {
  return useQuery({
    queryKey: missionKeys.list,
    queryFn: listMissions,
    refetchInterval: (query) =>
      watching && query.state.data?.some((m: Mission) => LIVE_MISSION_STATUSES.includes(m.status))
        ? MISSION_POLL_MS
        : false,
  });
}

export function useMission(id: number, watching = false) {
  return useQuery({
    queryKey: missionKeys.detail(id),
    queryFn: () => getMission(id),
    enabled: Number.isFinite(id),
    refetchInterval: (query) =>
      watching && query.state.data && LIVE_MISSION_STATUSES.includes(query.state.data.status)
        ? MISSION_POLL_MS
        : false,
  });
}

/**
 * The recent runs that belong to one mission. The list endpoint has no mission
 * filter, so this reads the newest 50 runs and keeps the ones tagged with the
 * mission. An older run of a long mission can fall outside that window.
 */
export function useMissionRuns(id: number, watching = false) {
  return useQuery({
    queryKey: missionKeys.runs(id),
    queryFn: async () => {
      const page = await listExecutions({ limit: 50 });
      return page.results.filter((run) => run.mission_id === id);
    },
    enabled: Number.isFinite(id),
    refetchInterval: watching ? MISSION_POLL_MS : false,
  });
}

/** Start a mission. Its runs appear in the run list as the sweep launches them. */
export function useCreateMission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: MissionCreateInput) => createMission(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: missionKeys.all });
    },
  });
}

/** Pause, resume or cancel one mission. */
export function useMissionAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: number; verb: MissionVerb }) => missionAction(args.id, args.verb),
    onSettled: (_data, _error, args) => {
      void queryClient.invalidateQueries({ queryKey: missionKeys.all });
      void queryClient.invalidateQueries({ queryKey: runKeys.all });
      void queryClient.invalidateQueries({ queryKey: missionKeys.detail(args.id) });
    },
  });
}

/** Delete a stopped mission. Refused (409) while it is still active or waiting. */
export function useDeleteMission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteMission(id),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: missionKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: missionKeys.all });
    },
  });
}
