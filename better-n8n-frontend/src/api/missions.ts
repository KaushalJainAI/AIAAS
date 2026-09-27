/**
 * Missions — the HTTP routes P7 left out (§18.7).
 *
 * Before these, only the model could start a mission (through the
 * `start_mission` tool). `/goal` and the confirm sheet call these instead,
 * through the same service.
 */
import apiClient from './client';

export interface Mission {
  id: number;
  goal: string;
  status: 'active' | 'waiting' | 'paused' | 'done' | 'failed' | 'cancelled';
  plan?: { text: string; status: string }[];
  budget_inr: number;
  spent_inr: number;
  runs_done: number;
  max_runs: number;
  next_wake_at: string | null;
  last_report?: string;
  deadline?: string | null;
  agent_id?: number;
  open_todos?: number;
  total_todos?: number;
}

const missionsService = {
  async list(): Promise<Mission[]> {
    const { data } = await apiClient.get<{ missions: Mission[] }>(
      '/missions/',
    );
    return Array.isArray(data?.missions) ? data.missions : [];
  },

  async get(id: number | string): Promise<Mission> {
    const { data } = await apiClient.get<Mission>(`/missions/${id}/`);
    return data;
  },

  async create(input: {
    goal: string;
    agent_id: number;
    budget_inr: number;
    deadline_days?: number;
    max_runs?: number;
  }): Promise<{ mission_id: number; [key: string]: unknown }> {
    const { data } = await apiClient.post('/missions/', input);
    return data;
  },

  async pause(id: number | string) {
    const { data } = await apiClient.post(`/missions/${id}/pause/`);
    return data;
  },

  async resume(id: number | string) {
    const { data } = await apiClient.post(`/missions/${id}/resume/`);
    return data;
  },

  async cancel(id: number | string) {
    const { data } = await apiClient.post(`/missions/${id}/cancel/`);
    return data;
  },

  /**
   * Delete a stopped mission. 409 while active/waiting (cancel first).
   * Past runs keep their rows — only the goal goes.
   */
  async remove(id: number | string): Promise<void> {
    await apiClient.delete(`/missions/${id}/`);
  },
};

export default missionsService;
