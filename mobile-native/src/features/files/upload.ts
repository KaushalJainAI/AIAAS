/**
 * Multipart uploads: a file picked on the device, sent as FormData.
 *
 * Mirrors the two web calls that send `multipart/form-data`:
 *   better-n8n-frontend/src/api/documents.ts  documentsService.upload   -> POST /inference/documents/
 *   better-n8n-frontend/src/api/documents.ts  documentsService.uploadImage -> POST /inference/documents/{id}/images/
 *
 * React Native's FormData takes a `{uri, name, type}` file part rather than a
 * Blob, and the DOM typings do not describe that, so the append is typed loosely
 * in one place (`formWith`).
 */
import { authorizedFetch, readJson } from './transfer';
import type { Document, UploadedImage } from './types';

/** A picked file as the device hands it over: a uri, not a Blob. */
export interface UploadFile {
  uri: string;
  name: string;
  /** MIME type, e.g. `application/pdf`. */
  type: string;
}

function formWith(field: string, file: UploadFile): FormData {
  const form = new FormData();
  const loose = form as unknown as { append(name: string, value: unknown): void };
  loose.append(field, { uri: file.uri, name: file.name, type: file.type });
  return form;
}

/**
 * Upload a file into `folderId` (null or absent = the user's root).
 * Answers the created Document.
 */
export async function uploadDocument(file: UploadFile, folderId?: number | null): Promise<Document> {
  const form = formWith('file', file);
  // Absent means the user's root, so only send it when we are inside one.
  if (folderId != null) {
    (form as unknown as { append(name: string, value: string): void }).append('folder_id', String(folderId));
  }
  const res = await authorizedFetch('/inference/documents/', { method: 'POST', body: form });
  return readJson<Document>(res);
}

/**
 * Save an image beside a document so its spec can embed it.
 * Answers the spec path to store (the caller puts it in the spec).
 */
export async function uploadDocumentImage(documentId: number, file: UploadFile): Promise<UploadedImage> {
  const form = formWith('file', file);
  const res = await authorizedFetch(`/inference/documents/${documentId}/images/`, {
    method: 'POST',
    body: form,
  });
  return readJson<UploadedImage>(res);
}
