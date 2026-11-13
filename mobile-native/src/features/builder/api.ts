/**
 * Agent builder over HTTP. Mirrors, path for path and body for body:
 *  - better-n8n-frontend/src/api/agents.ts   (list, get, create, update, remove,
 *                                             restoreRevision, wizardQuestions,
 *                                             wizardPropose)
 *  - better-n8n-frontend/src/api/logs.ts     (listRevisions)
 *  - better-n8n-frontend/src/api/nodeService.ts (getAIModels: `/llm/models/`)
 *
 * Backend: `agents/views/` on `/api/orchestrator/` (agents, templates, wizard),
 * `logs/` on `/api/logs/` (revisions), and `llm/views.py` on `/api/llm/`.
 *
 * Errors come back as `ApiError` with a message, a status and the parsed body. A
 * 400 names the refused field in that body; `refusal.ts` reads it so the builder
 * can put the field on screen the way the web does.
 */
import { api } from '../../api/client';
import type {
  Agent,
  AgentConfig,
  AgentInput,
  AgentRevision,
  CursorPage,
  ModelCatalogue,
  WizardProposal,
  WizardQuestionsResult,
} from './types';

/** A list endpoint answers a bare array or a `{results}` envelope. Mirrors web `asArray`. */
function listOf<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    const results = (data as { results?: unknown }).results;
    if (Array.isArray(results)) return results as T[];
  }
  return [];
}

export const agentsApi = {
  /** The caller's agents. */
  list: async (): Promise<Agent[]> => listOf<Agent>(await api<unknown>('/orchestrator/agents/')),

  get: (id: number | string) => api<Agent>(`/orchestrator/agents/${id}/`),

  /** Create an agent from a full configuration. Schedules are not part of it. */
  create: (config: AgentInput) => api<Agent>('/orchestrator/agents/', { method: 'POST', body: config }),

  /**
   * PATCH, so a knob the caller did not send keeps its current value. A PUT with a
   * partial config would reset unmentioned grants to their defaults, which for a
   * permission is the difference between narrowing and widening.
   */
  update: (id: number | string, config: Partial<AgentConfig>) =>
    api<Agent>(`/orchestrator/agents/${id}/`, { method: 'PATCH', body: config }),

  /** Delete the agent. Its past runs stay on record, marked as deleted. */
  remove: (id: number | string) => api<void>(`/orchestrator/agents/${id}/`, { method: 'DELETE' }),

  /** Put the configuration back to revision `number`. Recorded as a new revision. */
  restoreRevision: (id: number | string, number: number) =>
    api<Agent>(`/orchestrator/agents/${id}/revisions/${number}/restore/`, { method: 'POST' }),

  /**
   * An agent's configuration changes, newest first, with what each one changed.
   * Keyset-paged: the builder asks for a few, the history screen walks the rest.
   */
  listRevisions: (agentId: number | string, params: { limit?: number; cursor?: string | null } = {}) =>
    api<CursorPage<AgentRevision>>(`/logs/agents/${agentId}/revisions/`, {
      query: {
        limit: params.limit,
        cursor: params.cursor ? params.cursor : undefined,
      },
    }),

  /**
   * The creation wizard's questions. Read-only: nothing is created here. The
   * empty arrays are kept if the server omits either field.
   */
  wizardQuestions: async (description: string): Promise<WizardQuestionsResult> => {
    const data = await api<Partial<WizardQuestionsResult> | null>('/orchestrator/agents/wizard/questions/', {
      method: 'POST',
      body: { description },
    });
    return { questions: data?.questions ?? [], memory_hints: data?.memory_hints ?? [] };
  },

  /**
   * The wizard's proposed configuration, for approval. Read-only: creation goes
   * through `create`, so the same serializer checks it as a hand-built agent.
   */
  wizardPropose: (description: string, answers: Record<string, unknown>) =>
    api<WizardProposal>('/orchestrator/agents/wizard/propose/', {
      method: 'POST',
      body: { description, answers },
    }),
};

export const modelsApi = {
  /**
   * The model catalogue: providers, and each provider's models with their effort
   * rungs and whether this account can run them. The picker shows what is callable.
   */
  catalogue: () => api<ModelCatalogue>('/llm/models/'),
};
