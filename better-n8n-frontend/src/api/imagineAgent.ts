import apiClient from './client';

export interface ImagineIntent {
  type: 'image' | 'video' | 'audio';
  model: string | null;
  prompt: string;
  params: Record<string, unknown>;
  confidence: number;
  missing_required: string[];
  clarifying_question: string | null;
  estimated_cost_usd: number;
  reasoning?: string;
}

export interface ImagineGeneration {
  id: number;
  type: 'image' | 'video' | 'audio';
  prompt: string;
  model: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  output_url: string | null;
  error_message: string | null;
}

export interface ImagineChatResponse {
  conversation_id: number;
  message_id: number;
  assistant_message: string;
  intent_preview?: ImagineIntent;
  requires_hitl: boolean;
  generation: ImagineGeneration | null;
  error?: string;
}

export interface ImagineMessage {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  intent: ImagineIntent | null;
  generation: ImagineGeneration | null;
  requires_hitl: boolean;
  created_at: string;
}

export interface ImagineConversation {
  id: number;
  title: string;
  status: 'idle' | 'awaiting_hitl' | 'generating';
  pending_intent: ImagineIntent | null;
  created_at: string;
  updated_at: string;
  messages?: ImagineMessage[];
  last_message?: { role: string; content: string } | null;
}

export const imagineAgent = {
  /**
   * @param model Optional model the user pinned in the composer. When it names
   * a real catalog entry the backend uses exactly that model and takes the
   * modality from it, so picking a video model *is* asking for a video.
   */
  chat: (message: string, conversationId?: number, model?: string | null) =>
    apiClient.post<ImagineChatResponse>('/imagine/agent/chat/', {
      message,
      conversation_id: conversationId,
      model: model || undefined,
    }).then(r => r.data),

  resume: (
    conversationId: number,
    decision: 'approve' | 'edit' | 'cancel',
    overrides?: Partial<ImagineIntent>
  ) =>
    apiClient.post<ImagineChatResponse>('/imagine/agent/resume/', {
      conversation_id: conversationId,
      decision,
      overrides,
    }).then(r => r.data),

  listConversations: () =>
    apiClient.get<{ results: ImagineConversation[] } | ImagineConversation[]>('/imagine/conversations/')
      .then(r => Array.isArray(r.data) ? r.data : r.data.results),

  getConversation: (id: number) =>
    apiClient.get<ImagineConversation>(`/imagine/conversations/${id}/`).then(r => r.data),

  deleteConversation: (id: number) =>
    apiClient.delete(`/imagine/conversations/${id}/`).then(() => undefined),

  updateConversation: (id: number, patch: Partial<Pick<ImagineConversation, 'title'>>) =>
    apiClient.patch<ImagineConversation>(`/imagine/conversations/${id}/`, patch).then(r => r.data),
};
