/**
 * Knowledge bases over HTTP: the list a person sees and the team-sharing switch
 * (`inference/kb_views.py`, K6).
 *
 * Read sharing only. A shared knowledge base is still owned by the person who
 * made it; members of the organisation can search and read it from a chat.
 * Every rule is on the server: an unknown id, a hidden corpus and a knowledge
 * base you cannot see all answer the same 404.
 */
import apiClient from './client';
import type { KnowledgeBaseBackend } from './documents';

export interface KnowledgeBaseRow {
  id: number;
  name: string;
  description: string;
  backend: KnowledgeBaseBackend;
  doc_count: number;
  size_human: string;
  is_default: boolean;
  /** The organisation this knowledge base is shared with, or null. */
  org: number | null;
  shared_with_org: boolean;
  /** True for the caller's own knowledge bases. */
  is_mine: boolean;
  owner_name: string;
}

export interface KnowledgeBaseListPage {
  knowledge_bases: KnowledgeBaseRow[];
  count: number;
  /** Present when the server cut the list short. */
  truncated?: boolean;
}

export interface KnowledgeBaseSharingPatch {
  org?: number | null;
  shared_with_org?: boolean;
}

export const knowledgeBasesService = {
  /** The caller's own knowledge bases. With `orgId`, that organisation's shared
   *  ones are added (marked `is_mine: false`). */
  async list(orgId?: number | null): Promise<KnowledgeBaseListPage> {
    const r = await apiClient.get<KnowledgeBaseListPage>('/inference/knowledge-bases/', {
      params: orgId ? { org: orgId } : undefined,
    });
    return r.data;
  },

  /** Owner-only, except a curator of the organisation, who may only switch
   *  `shared_with_org` off. Other callers get 403 (or 404 if they cannot see it). */
  async setSharing(id: number, patch: KnowledgeBaseSharingPatch): Promise<KnowledgeBaseRow> {
    const r = await apiClient.patch<KnowledgeBaseRow>(`/inference/knowledge-bases/${id}/`, patch);
    return r.data;
  },
};

export default knowledgeBasesService;
