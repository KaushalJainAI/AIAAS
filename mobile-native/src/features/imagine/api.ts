/**
 * Imagine over HTTP. Mirrors:
 *  - better-n8n-frontend/src/api/imagine.ts       (capabilities, jobs)
 *  - better-n8n-frontend/src/api/imagineAgent.ts  (conversation with the agent)
 *
 * Backend: `imagine/urls.py` on `/api/imagine/`. None of these routes stream, so
 * nothing here uses `streamSse`. Jobs are read by polling (see queries.ts).
 */
import { api } from '../../api/client';
import { EMPTY_CAPABILITIES, pruneRequest } from './request';
import type {
  Capabilities,
  Generation,
  GenerationRequest,
  ImagineChatResponse,
  ImagineConversation,
  ImagineIntent,
  ImagineResumeDecision,
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

export const imagineApi = {
  /**
   * The model catalogue per modality. Merged over the empty shape, so a response
   * missing a modality still renders as "no models" rather than crashing.
   * `refresh` bypasses the server's one-hour cache.
   */
  capabilities: async (opts?: { refresh?: boolean }): Promise<Capabilities> => {
    const data = await api<Capabilities | null>('/imagine/capabilities/', {
      query: opts?.refresh ? { refresh: 1 } : undefined,
    });
    return { ...EMPTY_CAPABILITIES, ...(data ?? {}) };
  },

  /** The caller's generations, newest first as the server sends them. */
  list: async (): Promise<Generation[]> => listOf<Generation>(await api<unknown>('/imagine/')),

  get: (id: number) => api<Generation>(`/imagine/${id}/`),

  /**
   * Start a generation. Blank fields are stripped first, so a model's own
   * defaults apply. Image and audio may answer already finished; video answers
   * `pending` and is polled.
   */
  create: (req: GenerationRequest) =>
    api<Generation>('/imagine/', { method: 'POST', body: pruneRequest(req) }),

  remove: (id: number) => api<void>(`/imagine/${id}/`, { method: 'DELETE' }),
};

export const imagineAgentApi = {
  /**
   * One turn with the media agent. `model` is optional: when it names a real
   * catalogue entry the server uses exactly that model and takes the modality from
   * it, so picking a video model is asking for a video.
   */
  chat: (message: string, conversationId?: number, model?: string | null) =>
    api<ImagineChatResponse>('/imagine/agent/chat/', {
      method: 'POST',
      body: {
        message,
        conversation_id: conversationId,
        model: model || undefined,
      },
    }),

  /** Answer a paused intent: approve it, edit it with overrides, or cancel it. */
  resume: (
    conversationId: number,
    decision: ImagineResumeDecision,
    overrides?: Partial<ImagineIntent>,
  ) =>
    api<ImagineChatResponse>('/imagine/agent/resume/', {
      method: 'POST',
      body: { conversation_id: conversationId, decision, overrides },
    }),

  /** The caller's conversations, most recently updated first. */
  listConversations: async (): Promise<ImagineConversation[]> =>
    listOf<ImagineConversation>(await api<unknown>('/imagine/conversations/')),

  /** One conversation with its messages. */
  getConversation: (id: number) => api<ImagineConversation>(`/imagine/conversations/${id}/`),

  deleteConversation: (id: number) =>
    api<void>(`/imagine/conversations/${id}/`, { method: 'DELETE' }),

  /**
   * Rename a conversation. Mirrors the web's call, but note: the server's
   * conversation viewset only allows GET and DELETE, so this answers 405 today.
   * Kept so the call matches the web one-for-one; see the report on this feature.
   */
  updateConversation: (id: number, patch: Partial<Pick<ImagineConversation, 'title'>>) =>
    api<ImagineConversation>(`/imagine/conversations/${id}/`, { method: 'PATCH', body: patch }),
};
