/**
 * Missions API: list, start, read, pause, resume, cancel, delete.
 *
 * Mirrors better-n8n-frontend/src/api/missions.ts, endpoint for endpoint.
 * Paths are relative to /api; `api()` prepends it.
 */

import { api } from '../../api/client';
import type {
  Mission,
  MissionActionResult,
  MissionCreateInput,
  MissionCreated,
  MissionDetail,
  MissionVerb,
} from './types';

/**
 * The caller's missions, newest first, capped at 50 by the server. The body is
 * `{missions: [...]}`, not a bare array, so unwrap it here.
 */
export async function listMissions(): Promise<Mission[]> {
  const data = await api<{ missions?: Mission[] }>('/missions/');
  return Array.isArray(data?.missions) ? data.missions : [];
}

export function getMission(id: number): Promise<MissionDetail> {
  return api<MissionDetail>(`/missions/${id}/`);
}

/** Start a mission through the same service the model's `start_mission` tool uses. */
export function createMission(input: MissionCreateInput): Promise<MissionCreated> {
  return api<MissionCreated>('/missions/', { method: 'POST', body: input });
}

/** Pause, resume or cancel. Resume re-arms the wake and resets the stall count. */
export function missionAction(id: number, verb: MissionVerb): Promise<MissionActionResult> {
  return api<MissionActionResult>(`/missions/${id}/${verb}/`, { method: 'POST', body: {} });
}

/**
 * Delete a stopped mission. 409 while it is active or waiting (cancel it
 * first). Past runs keep their rows; only the goal goes.
 */
export function deleteMission(id: number): Promise<null> {
  return api<null>(`/missions/${id}/`, { method: 'DELETE' });
}
