/**
 * Skills — reusable instruction fragments an agent can be given.
 *
 * The only place the app calls `/skills/`: the agent builder lists what it can
 * attach, and the Skills page searches, edits, shares and forks through the
 * same service, so the envelope handling lives in one file.
 */
import apiClient from './client';
import { asArray } from './unwrap';

export interface Skill {
  id: number;
  title: string;
  description: string;
  content: string;
  author: string;
  isShared: boolean;
  category: string;
  updatedAt: string;
}

export type SkillTab = 'mine' | 'public';

/** The fields a person edits; the server fills in the rest. */
export interface SkillInput {
  title: string;
  description: string;
  content: string;
  category: string;
}

export interface SkillSearchPage {
  results: Skill[];
  total: number;
}

const skillsService = {
  /** Everything the caller may attach: their own plus anything shared. */
  list: async (): Promise<Skill[]> => {
    const { data } = await apiClient.get<unknown>('/skills/');
    return asArray<Skill>(data);
  },

  /** One page of the Skills screen: the caller's own, or the public ones. */
  search: async (query: string, tab: SkillTab, pageSize = 20): Promise<SkillSearchPage> => {
    const { data } = await apiClient.get<SkillSearchPage>('/skills/search/', {
      params: { query, tab, page_size: pageSize },
    });
    return { results: data.results, total: data.total };
  },

  create: async (input: SkillInput): Promise<void> => {
    await apiClient.post('/skills/', input);
  },

  update: async (id: Skill['id'], input: SkillInput): Promise<void> => {
    await apiClient.patch(`/skills/${id}/`, input);
  },

  remove: async (id: Skill['id']): Promise<void> => {
    await apiClient.delete(`/skills/${id}/`);
  },

  /** Flips sharing on or off; the server's sentence says which. */
  toggleShare: async (id: Skill['id']): Promise<string> => {
    const { data } = await apiClient.post<{ message: string }>(`/skills/${id}/share/`);
    return data.message;
  },

  /** Copies a public skill into the caller's own collection. */
  fork: async (id: Skill['id']): Promise<void> => {
    await apiClient.post(`/skills/${id}/fork/`);
  },
};

export default skillsService;
