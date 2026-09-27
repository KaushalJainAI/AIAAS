/**
 * User memory — what the assistant has stored about you.
 *
 * Read-and-delete only, mirroring the server (`core/views.py::UserMemoryView`):
 * there is deliberately no create, because a fact typed into a settings
 * screen is a preference and belongs on the profile. This surface exists to
 * audit and correct what the assistant *inferred* — every row rides in the
 * system prompt of every future turn, so a wrong one keeps being wrong until
 * it is removed here. Before this the only surface was the `/memory` slash
 * command; nothing showed or deleted the facts.
 */
import apiClient from './client';

export interface UserMemory {
  id: number;
  text: string;
  category: string;
  source: string;
  updated_at: string;
}

export interface MemoryList {
  memories: UserMemory[];
  max_per_category: number;
}

const memoryService = {
  /** Every durable fact, plus the per-category cap (for "24 of 25" counts). */
  list: async (): Promise<MemoryList> => {
    const { data } = await apiClient.get<MemoryList>('/memory/');
    return {
      memories: Array.isArray(data?.memories) ? data.memories : [],
      max_per_category: data?.max_per_category ?? 25,
    };
  },

  /** Forget one fact. Another user's id and a nonexistent id are both 404. */
  remove: async (id: number): Promise<void> => {
    await apiClient.delete(`/memory/${id}/`);
  },

  /** Forget everything. */
  clearAll: async (): Promise<void> => {
    await apiClient.delete('/memory/');
  },
};

export default memoryService;
