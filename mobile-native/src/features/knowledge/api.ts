/**
 * Knowledge bases and extraction over HTTP.
 *
 * Mirrors, path for path and body for body:
 *  - better-n8n-frontend/src/api/knowledgeBases.ts  (list, setSharing)
 *  - better-n8n-frontend/src/api/extraction.ts      (schemas, rows, extract, review)
 *
 * Backend: `inference/kb_views.py` (`/api/inference/knowledge-bases/`) and the
 * extraction routes (`/api/extraction/`). `api()` prepends `/api`.
 */
import { api } from '../../api/client';
import type {
  ExtractedRow,
  ExtractedRowReviewed,
  ExtractionSchema,
  ExtractReviewBody,
  ExtractRunResult,
  KnowledgeBaseListPage,
  KnowledgeBaseRow,
  KnowledgeBaseSharingPatch,
  Listing,
  Page,
  RowStatus,
} from './types';

/** DRF returns a bare list or a `{results}` envelope depending on pagination. Mirrors web `asArray`. */
function listOf<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    const results = (data as { results?: unknown }).results;
    if (Array.isArray(results)) return results as T[];
  }
  return [];
}

export const knowledgeBasesApi = {
  /**
   * The caller's own knowledge bases. With `orgId`, that organisation's shared
   * ones are added (marked `is_mine: false`). Mirrors `knowledgeBasesService.list`.
   */
  list: (orgId?: number | null) =>
    api<KnowledgeBaseListPage>('/inference/knowledge-bases/', {
      query: { org: orgId ? orgId : undefined },
    }),

  /**
   * Owner-only, except a curator of the organisation, who may only switch
   * `shared_with_org` off. Other callers get 403 (or 404 if they cannot see it).
   */
  setSharing: (id: number, patch: KnowledgeBaseSharingPatch) =>
    api<KnowledgeBaseRow>(`/inference/knowledge-bases/${id}/`, { method: 'PATCH', body: patch }),
};

export const extractionApi = {
  /** `GET /extraction/schemas/`. Accepts a bare array or a paged envelope. */
  listSchemas: async (): Promise<Listing<ExtractionSchema>> => {
    const data = await api<Page<ExtractionSchema> | ExtractionSchema[]>('/extraction/schemas/');
    const items = listOf<ExtractionSchema>(data);
    return {
      items,
      count: Array.isArray(data) ? items.length : (data?.count ?? items.length),
    };
  },

  getSchema: (id: number | string) => api<ExtractionSchema>(`/extraction/schemas/${id}/`),

  createSchema: (body: Partial<ExtractionSchema>) =>
    api<ExtractionSchema>('/extraction/schemas/', { method: 'POST', body }),

  updateSchema: (id: number | string, body: Partial<ExtractionSchema>) =>
    api<ExtractionSchema>(`/extraction/schemas/${id}/`, { method: 'PATCH', body }),

  removeSchema: (id: number | string) =>
    api<void>(`/extraction/schemas/${id}/`, { method: 'DELETE' }),

  /** Rows of one schema, optionally filtered by status and paged. */
  rows: (id: number | string, params?: { status?: RowStatus; page?: number }) =>
    api<Page<ExtractedRow>>(`/extraction/schemas/${id}/rows/`, {
      query: { status: params?.status, page: params?.page },
    }),

  /**
   * Rows across the caller's schemas: the review queue. `status` filters;
   * default lists everything.
   */
  allRows: (params?: { status?: RowStatus; page?: number }) =>
    api<Page<ExtractedRow>>('/extraction/rows/', {
      query: { status: params?.status, page: params?.page },
    }),

  /**
   * Run the schema's LLM extraction over the given documents (at most 100).
   * Returns either an inline result or `{async: true, task_id}`.
   */
  extract: (id: number | string, documentIds: number[]) =>
    api<ExtractRunResult>(`/extraction/schemas/${id}/extract/`, {
      method: 'POST',
      body: { document_ids: documentIds },
    }),

  /**
   * Accept a held row, optionally correcting it first. The response says whether
   * the values changed (`corrected`), so a real correction is never mistaken for
   * a plain accept.
   */
  review: (rowId: number | string, body?: ExtractReviewBody) =>
    api<ExtractedRowReviewed>(`/extraction/rows/${rowId}/review/`, {
      method: 'POST',
      body: body ?? {},
    }),
};
