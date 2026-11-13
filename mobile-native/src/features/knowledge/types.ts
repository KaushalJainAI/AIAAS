/**
 * Knowledge bases and extraction: the wire shapes this feature reads and writes.
 *
 * Copied from the web app so the field names cannot drift:
 *  - KnowledgeBaseRow, KnowledgeBaseListPage, KnowledgeBaseSharingPatch:
 *                             better-n8n-frontend/src/api/knowledgeBases.ts
 *  - KnowledgeBaseBackend:    better-n8n-frontend/src/api/documents.ts
 *  - FieldType, SchemaField, ExtractionSchema, RowStatus, ExtractedRow,
 *    ExtractRunResult, ExtractReviewBody, ExtractedRowReviewed:
 *                             better-n8n-frontend/src/api/extraction.ts
 *  - Page, Listing:           better-n8n-frontend/src/api/paging.ts
 */

export type KnowledgeBaseBackend = 'vector' | 'fulltext' | 'raw' | 'hybrid';

/** One knowledge base as the list endpoint returns it. */
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

/** DRF's paged envelope. Sub-resources use it; top-level lists may not. */
export interface Page<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/** A list plus how many exist in total, so a screen can say when a list is truncated. */
export interface Listing<T> {
  items: T[];
  count: number;
}

export type FieldType = 'string' | 'number' | 'date' | 'currency' | 'boolean';

export interface SchemaField {
  name: string;
  label?: string;
  type?: FieldType;
  required?: boolean;
}

export interface ExtractionSchema {
  id: number;
  name: string;
  description: string;
  fields: SchemaField[];
  field_count: number;
  source_kind: 'upload' | 'gmail' | 'gdrive';
  source_ref: string;
  /** Fraction, not percent. Below this a row is held for review. */
  confidence_threshold: number;
  /** Blank resolves to the platform default vision model. */
  llm_model?: string;
  row_count: number;
  review_count: number;
  created_at: string;
  updated_at: string;
}

export type RowStatus = 'accepted' | 'needs_review' | 'reviewed' | 'rejected';

export interface ExtractedRow {
  id: number;
  document_name: string;
  document: number | null;
  data: Record<string, unknown>;
  /** Per-field confidence, so review can point at the offending cell. */
  field_confidence: Record<string, number>;
  confidence: number;
  status: RowStatus;
  /** The owning schema's name, for cross-schema queues. */
  schema_name?: string;
  reviewed_at: string | null;
  created_at: string;
}

/**
 * What `POST schemas/{id}/extract/` answers: either an inline run (`async: false`
 * with counts) or a queued one (`async: true` with a task id).
 */
export type ExtractRunResult = { async: boolean; task_id?: string } & Record<string, unknown>;

/** Body of `POST rows/{id}/review/`. Empty accepts the row as it is. */
export interface ExtractReviewBody {
  data?: Record<string, unknown>;
  reject?: boolean;
}

/** The row after a review, with `corrected` telling a real correction from a plain accept. */
export type ExtractedRowReviewed = ExtractedRow & { corrected: boolean };
