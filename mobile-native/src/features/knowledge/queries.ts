/**
 * React Query hooks for knowledge bases and extraction.
 *
 * Mirrors the reads and writes of better-n8n-frontend/src/api/knowledgeBases.ts
 * and extraction.ts. Mutations invalidate every key they can change: a review or
 * an extract run moves row counts on the schema list as well as the rows.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { listDocuments, ragQuery, ragSearch } from '../files/api';

import { extractionApi, knowledgeBasesApi } from './api';
import { fetchPersonalDocuments } from './documents';
import type {
  ExtractReviewBody,
  ExtractionSchema,
  KnowledgeBaseSharingPatch,
  RowStatus,
} from './types';

export const knowledgeKeys = {
  all: ['knowledge'] as const,
  bases: ['knowledge', 'bases'] as const,
  basesFor: (orgId: number | null | undefined) => ['knowledge', 'bases', orgId ?? 'own'] as const,
  schemas: ['knowledge', 'schemas'] as const,
  schema: (id: number | string) => ['knowledge', 'schemas', id] as const,
  schemaRows: (id: number | string, params?: { status?: RowStatus; page?: number }) =>
    ['knowledge', 'schemas', id, 'rows', params ?? {}] as const,
  rows: (params?: { status?: RowStatus; page?: number }) =>
    ['knowledge', 'rows', params ?? {}] as const,
  personalDocuments: ['knowledge', 'personal-documents'] as const,
  pickerDocuments: ['knowledge', 'picker-documents'] as const,
};

/** The caller's knowledge bases, plus `orgId`'s shared ones when given. */
export function useKnowledgeBases(orgId?: number | null) {
  return useQuery({
    queryKey: knowledgeKeys.basesFor(orgId),
    queryFn: () => knowledgeBasesApi.list(orgId),
  });
}

/** Share one of the caller's knowledge bases with an organisation, or switch that off. */
export function useSetKnowledgeSharing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: KnowledgeBaseSharingPatch }) =>
      knowledgeBasesApi.setSharing(id, patch),
    onSettled: () => queryClient.invalidateQueries({ queryKey: knowledgeKeys.bases }),
  });
}

export function useExtractionSchemas() {
  return useQuery({
    queryKey: knowledgeKeys.schemas,
    queryFn: () => extractionApi.listSchemas(),
  });
}

export function useExtractionSchema(id: number) {
  return useQuery({
    queryKey: knowledgeKeys.schema(id),
    queryFn: () => extractionApi.getSchema(id),
    enabled: Number.isFinite(id),
  });
}

export function useSchemaRows(id: number, params?: { status?: RowStatus; page?: number }) {
  return useQuery({
    queryKey: knowledgeKeys.schemaRows(id, params),
    queryFn: () => extractionApi.rows(id, params),
    enabled: Number.isFinite(id),
  });
}

/** The review queue across every schema. */
export function useExtractionRows(params?: { status?: RowStatus; page?: number }) {
  return useQuery({
    queryKey: knowledgeKeys.rows(params),
    queryFn: () => extractionApi.allRows(params),
  });
}

export function useCreateSchema() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<ExtractionSchema>) => extractionApi.createSchema(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: knowledgeKeys.schemas }),
  });
}

export function useUpdateSchema() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<ExtractionSchema> }) =>
      extractionApi.updateSchema(id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: knowledgeKeys.schemas }),
  });
}

export function useRemoveSchema() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => extractionApi.removeSchema(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: knowledgeKeys.all }),
  });
}

/** Run a schema's extraction over documents. Inline or queued: the rows arrive either way. */
export function useExtractDocuments(schemaId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentIds: number[]) => extractionApi.extract(schemaId, documentIds),
    onSettled: () => queryClient.invalidateQueries({ queryKey: knowledgeKeys.all }),
  });
}

/** Accept, correct or reject one held row. Moves the schema's review count too. */
export function useReviewRow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ rowId, body }: { rowId: number; body?: ExtractReviewBody }) =>
      extractionApi.review(rowId, body),
    onSettled: () => queryClient.invalidateQueries({ queryKey: knowledgeKeys.all }),
  });
}

/** The documents an extraction run can take: the first page of the person's own files, as the web's picker lists them. */
export function usePickerDocuments(enabled: boolean) {
  return useQuery({
    queryKey: knowledgeKeys.pickerDocuments,
    queryFn: () => listDocuments({ scope: 'personal', limit: 100 }).then((page) => page.my_documents),
    enabled,
    staleTime: 30_000,
  });
}

/** The person's own files, for source names and a base's documents. Capped by `fetchPersonalDocuments`. */
export function usePersonalDocuments() {
  return useQuery({
    queryKey: knowledgeKeys.personalDocuments,
    queryFn: () => fetchPersonalDocuments(10),
  });
}

/** Vector search over the person's knowledge bases (or one of them). Returns passages, not an answer. */
export function useRagSearch() {
  return useMutation({
    mutationFn: ({ query, kbId }: { query: string; kbId: number | null }) =>
      ragSearch(query, 8, false, kbId ?? undefined),
  });
}

/** A short answer drawn from the person's knowledge, with the passages it used. */
export function useRagAsk() {
  return useMutation({
    mutationFn: (question: string) => ragQuery(question, 5),
  });
}
