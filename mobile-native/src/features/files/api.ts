/**
 * Files API: documents, folders, the recycle bin, storage, versions, exports,
 * recents and app tabs. Paths, params and bodies are the ones the web app sends.
 *
 * Mirrors:
 *   better-n8n-frontend/src/api/documents.ts  -> documentsService.* and foldersService.* (+ RAG search/query)
 *   better-n8n-frontend/src/api/recents.ts    -> recentsService.*
 *   better-n8n-frontend/src/api/pages.ts      -> pagesService.shareFile (the share call lives in features/pages/api.ts)
 *
 * Backend reference: Backend/docs/API.md section 7 (/api/inference/...).
 *
 * Differences from the web, all deliberate:
 * - The web's `If-Match` headers are not sent: `api()` takes no headers. Every
 *   route that accepts `If-Match` also accepts `expected_updated_at` in the body,
 *   and that field is sent instead (API.md: "takes `expected_updated_at` /
 *   `If-Match`").
 * - Binary responses (`download`, `previewImageBlob`, `exportAs`, `assetBlob`,
 *   version downloads) return the raw Response, not a Blob. Read `.blob()` or
 *   `.arrayBuffer()` in the screen that saves or shows the bytes.
 * - `previewUrl` is `documentDownloadPath` here: it is a path, not a URL, and a
 *   native `<Image>` must send `authorizationHeaders()` with it.
 */
import { api } from '../../api/client';
import { authorizedFetch, fetchFile, filenameFrom } from './transfer';
import type {
  AppSession,
  ArchiveListing,
  DocumentListPage,
  DocumentListParams,
  DocumentSearchParams,
  DocumentSearchResult,
  DocumentVersion,
  DraftBody,
  Document,
  ExportedFile,
  ExportFormatsResult,
  Folder,
  FolderChanges,
  FolderDetail,
  FolderListPage,
  ImportedDocument,
  MovePayload,
  MoveResult,
  OfficeEditBody,
  PurgeResult,
  RAGQueryResponse,
  RagSearchResponse,
  RecentFile,
  RecentListParams,
  RestorePayload,
  RestoreResult,
  SharingResult,
  StorageUsage,
  TrashPage,
  TrashResult,
  ViewState,
  WorkbookGrid,
} from './types';

export { uploadDocument, uploadDocumentImage } from './upload';

const enc = encodeURIComponent;

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/** `GET /inference/documents/` — the listing. Cursor pages carry `my_documents`, `has_more`, `next_cursor`. */
export function listDocuments(params: DocumentListParams = {}): Promise<DocumentListPage> {
  return api<DocumentListPage>('/inference/documents/', {
    query: {
      limit: params.limit,
      cursor: params.cursor,
      my_cursor: params.my_cursor,
      public_cursor: params.public_cursor,
      scope: params.scope,
      folder_id: params.folder_id,
      types: params.types,
    },
  });
}

/** `GET /inference/documents/{id}/` — detail, with `content` and `metadata.spec`. */
export function getDocument(id: number): Promise<Document> {
  return api<Document>(`/inference/documents/${id}/`);
}

/**
 * `GET /inference/documents/search/` — names and contents, ranked and capped
 * (no cursor; `truncated` says to keep typing). Under 2 characters the server
 * answers empty, so the caller may send it on every keystroke.
 */
export function searchFiles(params: DocumentSearchParams): Promise<DocumentSearchResult> {
  return api<DocumentSearchResult>('/inference/documents/search/', {
    query: {
      q: params.q,
      folder_id: params.folder_id,
      scope: params.scope,
      types: params.types,
      limit: params.limit,
    },
  });
}

/** `POST /inference/documents/{id}/share/` — toggles sharing into the public library. */
export function setDocumentSharing(id: number): Promise<SharingResult> {
  return api<SharingResult>(`/inference/documents/${id}/share/`, { method: 'POST' });
}

/**
 * `DELETE /inference/documents/{id}/` — moves the file to the recycle bin. It is
 * restorable for `purges_after_days`; the permanent delete is the sweep's job.
 */
export function trashDocument(id: number): Promise<TrashResult> {
  return api<TrashResult>(`/inference/documents/${id}/`, { method: 'DELETE' });
}

/** `PATCH /inference/documents/{id}/` `{name}` — rename in place; the extension must stay. */
export function renameDocument(id: number, name: string): Promise<Document> {
  return api<Document>(`/inference/documents/${id}/`, { method: 'PATCH', body: { name } });
}

/** `GET /inference/documents/{id}/download/` — the original bytes (`inline` previews them). */
export function downloadDocument(id: number, opts: { inline?: boolean } = {}): Promise<Response> {
  return fetchFile(`/inference/documents/${id}/download/`, {
    query: opts.inline ? { inline: 1 } : undefined,
  });
}

/**
 * The path a preview or download is read from. Not a request: pass it to
 * `authorizedFetch` / `authorizationHeaders()`. A bare URL without the header
 * answers 401.
 */
export function documentDownloadPath(id: number): string {
  return `/inference/documents/${id}/download/`;
}

/**
 * `PATCH /inference/documents/{id}/content/` — save a text document. A stale
 * `expected_updated_at` answers 412 with the fresh stamp, so an older editor
 * cannot overwrite a newer save.
 */
export function updateDocumentContent(
  id: number,
  content: string,
  expectedUpdatedAt?: string,
): Promise<Document> {
  return api<Document>(`/inference/documents/${id}/content/`, {
    method: 'PATCH',
    body: { content, ...(expectedUpdatedAt ? { expected_updated_at: expectedUpdatedAt } : {}) },
  });
}

/**
 * `POST /inference/documents/new/` — a blank file, or a text file holding
 * `content`. The extension decides the type; a taken name is numbered.
 */
export function createDocument(name: string, folderId?: number | null, content?: string): Promise<Document> {
  return api<Document>('/inference/documents/new/', {
    method: 'POST',
    body: {
      name,
      ...(folderId != null ? { folder_id: folderId } : {}),
      ...(content ? { content } : {}),
    },
  });
}

/** `POST /inference/documents/{id}/copy/` — duplicate into `folderId` (null = root). */
export function copyDocument(id: number, folderId: number | null): Promise<Document> {
  return api<Document>(`/inference/documents/${id}/copy/`, {
    method: 'POST',
    body: folderId != null ? { folder_id: folderId } : {},
  });
}

/** `GET /inference/documents/{id}/office/` — every sheet of an .xlsx, formulas and calculated values. */
export function getWorkbook(id: number): Promise<WorkbookGrid> {
  return api<WorkbookGrid>(`/inference/documents/${id}/office/`);
}

/**
 * `POST /inference/documents/{id}/office/` — cell edits to an .xlsx, or
 * `{spec}` for a deck / Word file made in the app.
 */
export function editOffice(
  id: number,
  body: OfficeEditBody,
  expectedUpdatedAt?: string,
): Promise<Document> {
  return api<Document>(`/inference/documents/${id}/office/`, {
    method: 'POST',
    body: { ...body, ...(expectedUpdatedAt ? { expected_updated_at: expectedUpdatedAt } : {}) },
  });
}

/**
 * `POST /inference/documents/{id}/draft/` — park an office autosave cheaply.
 * The bytes are rebuilt after a quiet spell, or on the next read that needs them.
 */
export function saveDraft(id: number, body: DraftBody, expectedUpdatedAt?: string): Promise<Document> {
  return api<Document>(`/inference/documents/${id}/draft/`, {
    method: 'POST',
    body: { ...body, ...(expectedUpdatedAt ? { expected_updated_at: expectedUpdatedAt } : {}) },
  });
}

/**
 * `POST /inference/documents/{id}/import/` — convert an uploaded Word or
 * PowerPoint file into an editable spec. The original upload stays version 1.
 */
export function importDocument(id: number, expectedUpdatedAt?: string): Promise<ImportedDocument> {
  return api<ImportedDocument>(`/inference/documents/${id}/import/`, {
    method: 'POST',
    body: expectedUpdatedAt ? { expected_updated_at: expectedUpdatedAt } : {},
  });
}

/** `GET /inference/documents/{id}/asset/?path=` — an image the spec embeds. Raster types only. */
export function getDocumentAsset(id: number, path: string): Promise<Response> {
  return fetchFile(`/inference/documents/${id}/asset/`, { query: { path } });
}

/** `GET /inference/documents/{id}/preview-image/` — a browser-proof PNG for TIFF, BMP and HEIC. */
export function getPreviewImage(id: number): Promise<Response> {
  return fetchFile(`/inference/documents/${id}/preview-image/`);
}

/** `GET /inference/documents/{id}/archive/` — the entries of a zip (names, sizes, dates; never bytes). */
export function listArchive(id: number): Promise<ArchiveListing> {
  return api<ArchiveListing>(`/inference/documents/${id}/archive/`);
}

/** `GET /inference/documents/{id}/versions/` — what the file held before each overwrite, newest first. */
export function listVersions(id: number): Promise<{ versions: DocumentVersion[] }> {
  return api<{ versions: DocumentVersion[] }>(`/inference/documents/${id}/versions/`);
}

/** `GET /inference/documents/{id}/versions/{vid}/download/` — the bytes of one earlier version. */
export function downloadVersion(
  id: number,
  versionId: number,
  opts: { inline?: boolean } = {},
): Promise<Response> {
  return fetchFile(`/inference/documents/${id}/versions/${versionId}/download/`, {
    query: opts.inline ? { inline: 1 } : undefined,
  });
}

/**
 * `POST /inference/documents/{id}/versions/{vid}/restore/` — put a version back.
 * The replaced state becomes a version too, so the restore can be undone.
 */
export function restoreVersion(id: number, versionId: number, expectedUpdatedAt?: string): Promise<Document> {
  return api<Document>(`/inference/documents/${id}/versions/${versionId}/restore/`, {
    method: 'POST',
    body: expectedUpdatedAt ? { expected_updated_at: expectedUpdatedAt } : {},
  });
}

/** `GET /inference/documents/{id}/export/` (no `to`) — the formats this file can be exported as. */
export function listExportFormats(id: number): Promise<ExportFormatsResult> {
  return api<ExportFormatsResult>(`/inference/documents/${id}/export/`);
}

/**
 * `GET /inference/documents/{id}/export/?to=<format>` — the file in another
 * format. The filename comes from Content-Disposition.
 */
export async function exportDocument(id: number, format: string): Promise<ExportedFile> {
  const res = await authorizedFetch(`/inference/documents/${id}/export/`, { query: { to: format } });
  return { response: res, filename: filenameFrom(res, `export.${format}`) };
}

/** `POST /inference/rag/search/` — vector search over the user's knowledge bases. */
export function ragSearch(
  query: string,
  topK = 5,
  includePlatform = false,
  kbId?: number,
): Promise<RagSearchResponse> {
  return api<RagSearchResponse>('/inference/rag/search/', {
    method: 'POST',
    body: { query, top_k: topK, include_platform: includePlatform, kb_id: kbId },
  });
}

/** `POST /inference/rag/query/` — a RAG answer (search, then the model). */
export function ragQuery(question: string, topK = 5): Promise<RAGQueryResponse> {
  return api<RAGQueryResponse>('/inference/rag/query/', {
    method: 'POST',
    body: { question, top_k: topK },
  });
}

// ---------------------------------------------------------------------------
// Folders, moves, the recycle bin, storage
// ---------------------------------------------------------------------------

/**
 * `GET /inference/folders/?parent=<id>` — children of `parentId`, with
 * breadcrumbs. `null` lists the user's root (the parameter is then omitted).
 */
export function listFolders(parentId: number | null): Promise<FolderListPage> {
  return api<FolderListPage>('/inference/folders/', {
    query: { parent: parentId },
  });
}

/** `GET /inference/folders/{id}/` — one folder with breadcrumbs. */
export function getFolder(id: number): Promise<FolderDetail> {
  return api<FolderDetail>(`/inference/folders/${id}/`);
}

/** `POST /inference/folders/` — create. A duplicate sibling name is a 400, not renumbered. */
export function createFolder(name: string, parentId: number | null): Promise<Folder> {
  return api<Folder>('/inference/folders/', {
    method: 'POST',
    body: { name, parent_id: parentId },
  });
}

/** `PATCH /inference/folders/{id}/` — rename and/or move in one call. */
export function updateFolder(id: number, changes: FolderChanges): Promise<FolderDetail> {
  return api<FolderDetail>(`/inference/folders/${id}/`, { method: 'PATCH', body: changes });
}

/** `DELETE /inference/folders/{id}/` — sends the folder and everything under it to the bin. */
export function trashFolder(id: number): Promise<TrashResult> {
  return api<TrashResult>(`/inference/folders/${id}/`, { method: 'DELETE' });
}

/** `POST /inference/fs/move/` — bulk reparent folders and/or documents (capped at 200 ids). */
export function moveItems(payload: MovePayload): Promise<MoveResult> {
  return api<MoveResult>('/inference/fs/move/', { method: 'POST', body: payload });
}

/** `GET /inference/trash/` — what the caller can still restore. Cursor-paged. */
export function listTrash(cursor?: string | null): Promise<TrashPage> {
  return api<TrashPage>('/inference/trash/', { query: { cursor } });
}

/**
 * `POST /inference/trash/restore/` — put rows back where they came from. There
 * is no target parameter: a restore goes to the row's recorded parent.
 */
export function restoreTrash(payload: RestorePayload): Promise<RestoreResult> {
  return api<RestoreResult>('/inference/trash/restore/', { method: 'POST', body: payload });
}

/** `DELETE /inference/trash/empty/` — purge the whole bin now. */
export function emptyTrash(): Promise<PurgeResult> {
  return api<PurgeResult>('/inference/trash/empty/', { method: 'DELETE' });
}

/** `GET /inference/storage/` — bytes and files held against the account's quota, trash included. */
export function getStorage(): Promise<StorageUsage> {
  return api<StorageUsage>('/inference/storage/');
}

// ---------------------------------------------------------------------------
// Recents and app tabs
// ---------------------------------------------------------------------------

/**
 * `GET /inference/recent/` — recently opened files, newest first. The web
 * unwraps `results`; this does the same.
 */
export async function listRecents(opts: RecentListParams = {}): Promise<RecentFile[]> {
  const data = await api<{ results: RecentFile[] }>('/inference/recent/', {
    query: {
      app: opts.app,
      types: opts.types?.length ? opts.types.join(',') : undefined,
      limit: opts.limit,
    },
  });
  return data.results;
}

/** `POST /inference/recent/` — record an open. Answers where the file was left. */
export function recordOpen(documentId: number, app: string): Promise<RecentFile> {
  return api<RecentFile>('/inference/recent/', {
    method: 'POST',
    body: { document_id: documentId, app },
  });
}

/** `GET /inference/recent/{id}/` — only the saved `view_state` (page, zoom…). */
export async function getViewState(documentId: number): Promise<ViewState> {
  const row = await api<{ view_state: ViewState }>(`/inference/recent/${documentId}/`);
  return row.view_state;
}

/** `PATCH /inference/recent/{id}/` — save where the user is in a file, without counting an open. */
export function saveViewState(documentId: number, viewState: ViewState): Promise<unknown> {
  return api<unknown>(`/inference/recent/${documentId}/`, {
    method: 'PATCH',
    body: { view_state: viewState },
  });
}

/** `DELETE /inference/recent/{id}/` — drop one file from the list. */
export function forgetRecent(documentId: number): Promise<unknown> {
  return api<unknown>(`/inference/recent/${documentId}/`, { method: 'DELETE' });
}

/** `DELETE /inference/recent/` — clear the whole list. */
export function clearRecents(): Promise<unknown> {
  return api<unknown>('/inference/recent/', { method: 'DELETE' });
}

/** `GET /inference/app-sessions/{app}/` — an app's open tabs. */
export function getAppSession(app: string): Promise<AppSession> {
  return api<AppSession>(`/inference/app-sessions/${enc(app)}/`);
}

/** `PUT /inference/app-sessions/{app}/` — replace the app's tabs wholesale (ids only, ≤20). */
export function saveAppSession(app: string, tabs: number[], active: number | null): Promise<AppSession> {
  return api<AppSession>(`/inference/app-sessions/${enc(app)}/`, {
    method: 'PUT',
    body: { tabs, active },
  });
}

