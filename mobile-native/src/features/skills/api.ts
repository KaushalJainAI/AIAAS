/**
 * Skills over HTTP. Mirrors better-n8n-frontend/src/api/skills.ts, path for path.
 *
 * Backend: `skills/urls.py` (a router on `/api/skills/`). `share` and `fork` are
 * the viewset's `@action`s in `skills/views.py`; `Backend/docs/API.md` lists the
 * CRUD and search routes but not these two.
 */
import { api } from '../../api/client';
import type { Skill, SkillInput, SkillSearchPage, SkillTab } from './types';

/** DRF returns a bare list or a `{results}` envelope depending on pagination. Mirrors web `asArray`. */
function listOf<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    const results = (data as { results?: unknown }).results;
    if (Array.isArray(results)) return results as T[];
  }
  return [];
}

export const skillsApi = {
  /** Everything the caller may attach: their own plus anything shared. */
  list: async (): Promise<Skill[]> => listOf<Skill>(await api<unknown>('/skills/')),

  /**
   * One page of the Skills screen: the caller's own, or the public ones. The
   * search term travels as `query`, as the web sends it.
   */
  search: async (query: string, tab: SkillTab, pageSize = 20): Promise<SkillSearchPage> => {
    const data = await api<SkillSearchPage>('/skills/search/', {
      query: { query, tab, page_size: pageSize },
    });
    return { results: data?.results ?? [], total: data?.total ?? 0 };
  },

  create: (input: SkillInput) => api<unknown>('/skills/', { method: 'POST', body: input }),

  update: (id: Skill['id'], input: SkillInput) =>
    api<unknown>(`/skills/${id}/`, { method: 'PATCH', body: input }),

  remove: (id: Skill['id']) => api<void>(`/skills/${id}/`, { method: 'DELETE' }),

  /** Flips sharing on or off. Returns the server's sentence saying which. */
  toggleShare: async (id: Skill['id']): Promise<string> => {
    const data = await api<{ message: string }>(`/skills/${id}/share/`, { method: 'POST' });
    return data?.message ?? '';
  },

  /** Copies a public skill into the caller's own collection. */
  fork: (id: Skill['id']) => api<unknown>(`/skills/${id}/fork/`, { method: 'POST' }),
};
