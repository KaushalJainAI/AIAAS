/**
 * Words and small pure helpers for knowledge bases and extraction. Plain
 * language, the same wording as the web where the web has one.
 */
import type { ExtractionSchema, FieldType, KnowledgeBaseBackend, RowStatus } from './types';

/** Short name for each backend, and what it means for a person searching. */
export const BACKEND_LABEL: Record<KnowledgeBaseBackend, string> = {
  vector: 'Semantic',
  fulltext: 'Keyword',
  raw: 'Raw files',
  hybrid: 'Semantic and keyword',
};

export const BACKEND_HINT: Record<KnowledgeBaseBackend, string> = {
  vector: 'Finds passages by meaning, so the words need not match.',
  fulltext: 'Finds passages that contain the words you type.',
  raw: 'The assistant reads whole documents rather than searching passages.',
  hybrid: 'Uses both meaning and exact words.',
};

export const ROW_STATUS_LABEL: Record<RowStatus, string> = {
  needs_review: 'Needs review',
  accepted: 'Accepted',
  reviewed: 'Reviewed',
  rejected: 'Rejected',
};

export const SOURCE_LABEL: Record<ExtractionSchema['source_kind'], string> = {
  upload: 'Manual upload',
  gmail: 'Gmail',
  gdrive: 'Google Drive',
};

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  string: 'Text',
  number: 'Number',
  date: 'Date',
  currency: 'Currency',
  boolean: 'Yes or no',
};

/** Starting field names for a new schema, as the web's form suggests. */
export const DEFAULT_FIELD_TEXT = 'vendor\ndate\ngstin\ntotal';

/** Rows per page on the rows endpoints (the web uses the same page size). */
export const ROWS_PAGE_SIZE = 50;

/** The most documents one extraction run takes (`extraction` API limit). */
export const EXTRACT_LIMIT = 100;

/** Field names as typed, one per line: trimmed, empties dropped. */
export function parseFieldNames(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** A 0–1 confidence as a whole percentage. */
export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** The sentence a failed call should show: the server's own words, or the fallback. */
export function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Turns a row's stored value into text for display or for editing. */
export function valueText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}
