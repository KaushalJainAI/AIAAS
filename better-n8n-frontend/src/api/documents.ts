import apiClient from './client';

export type KnowledgeBaseBackend = 'vector' | 'fulltext' | 'raw' | 'hybrid';

export interface KnowledgeBase {
  id: number;
  name: string;
  description: string;
  backend: KnowledgeBaseBackend;
  embedding_model: string;
  vector_dim: number;
  doc_count: number;
  vector_count: number;
  index_size_bytes: number;
  size_human: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeBaseDetail extends KnowledgeBase {
  documents: Document[];
}

export interface Document {
  id: number;
  title: string;
  filename: string;
  file_type: string;
  file_size: number;
  chunk_count: number;
  is_shared: boolean;
  shared_at: string | null;
  metadata?: Record<string, unknown>;
  /** Extracted text. Detail responses only; lists leave it out. */
  content?: string;
  created_at: string;
  updated_at: string;
  status: 'pending' | 'processing' | 'indexed' | 'stored' | 'failed' | 'uploading';
  error_message?: string;
  sharing_mode?: 'private' | 'shared_read' | 'shared_write';
  author_name?: string;
  knowledge_base_id?: number | null;
  knowledge_base_name?: string | null;
  /** Where the file sits in the user's tree. `null` is their root. */
  folder_id?: number | null;
  /** Human-readable location for display only — never send it back. */
  folder_path?: string | null;
  deleted_at?: string | null;
  purges_at?: string | null;
}

/**
 * One node of the user's private tree.
 *
 * `path` holds *ids* (`/12/45/`), not names, and is display/debug only: the API
 * is id-addressed end to end and will not accept a path as a locator. Render
 * `breadcrumbs` instead.
 */
export interface Folder {
  id: number;
  name: string;
  parent_id: number | null;
  path: string;
  depth: number;
  child_count: number;
  document_count: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  purges_at?: string | null;
}

export interface Breadcrumb {
  id: number;
  name: string;
}

export interface FolderListPage {
  /** The folder being listed, or null when listing the root. */
  folder: Folder | null;
  breadcrumbs: Breadcrumb[];
  folders: Folder[];
  count: number;
  /** The listing is capped server-side; true means there are more. */
  truncated: boolean;
}

export interface FolderDetail extends Folder {
  breadcrumbs: Breadcrumb[];
}

export interface MoveResult {
  moved_folders: number;
  moved_documents: number;
  target_folder_id: number | null;
}

export interface TrashPage {
  folders: Folder[];
  folders_truncated: boolean;
  documents: Document[];
  next_cursor: string | null;
  has_more: boolean;
  /** Read this rather than hardcoding 30 — it is a server-side env var. */
  purges_after_days: number;
}

export interface RestoreOutcome {
  kind: 'folder' | 'document';
  id: number;
  relocated?: boolean;
  folder_id?: number | null;
  renamed_to?: string | null;
  reason?: string;
}

export interface RestoreResult {
  restored: RestoreOutcome[];
  refused: RestoreOutcome[];
}

export interface TrashResult {
  trashed_folders?: number;
  trashed_documents?: number;
  purges_after_days: number;
}

export interface ArchiveEntry {
  name: string;
  size: number;
  modified: string;
}

export interface ArchiveListing {
  entries: ArchiveEntry[];
  truncated: boolean;
  count: number;
}

export interface WorkbookSheet {
  name: string;
  /** Formulas as their `=` source. */
  rows: (string | number | boolean | null)[][];
  /** Calculated values beside the formulas (unevaluable stays null). */
  values: (string | number | boolean | null)[][];
  row_count: number;
  col_count: number;
  truncated: boolean;
}

export interface WorkbookGrid {
  sheets: WorkbookSheet[];
  /** Univer `IWorkbookData` for the Sheets app (xlsx only). */
  snapshot?: unknown;
  updated_at: string;
}

/**
 * What a file held before one overwrite — the version history (Phase A).
 *
 * Each entry is the file *as it was before* that save, so restoring one is
 * undo, and the replaced state becomes a version itself (a restore can be
 * undone). `source` says who saved: the user in an app, an agent, or a
 * restore.
 */
export interface DocumentVersion {
  id: number;
  created_at: string;
  source: 'app' | 'agent' | 'restore';
  name: string;
  size: number;
  has_spec: boolean;
}

export interface DocumentChunk {
  id: number;
  content: string;
  chunk_index: number;
  metadata: Record<string, unknown>;
}

export type DocumentMatchKind = 'name' | 'content' | 'fuzzy';

/** One file in a `searchFiles` answer: the listing row plus how it matched. */
export interface DocumentSearchHit extends Document {
  matched_in: DocumentMatchKind;
  /** ~160-char window around a content match, plain text; null otherwise. */
  snippet: string | null;
  /** Conservative closeness, fuzzy hits only. */
  score?: number;
}

/** One folder in a `searchFiles` answer — enough to navigate to, not a full `Folder`. */
export interface FolderSearchHit {
  id: number;
  name: string;
  parent_id: number | null;
  /** Parent's name path (`/Reports`) for display only — never send it back. */
  location: string;
  updated_at: string;
  matched_in: 'name' | 'fuzzy';
}

export interface DocumentSearchResult {
  query: string;
  exact: DocumentSearchHit[];
  fuzzy: DocumentSearchHit[];
  folders: FolderSearchHit[];
  count: number;
  /** Capped server-side (`limit`); true means keep typing to narrow it down. */
  truncated: boolean;
  note: string | null;
}

export interface SearchResult {
  document_id: number;
  content: string;
  score: number;
  source: 'personal' | 'platform';
  is_image?: boolean;
}

export interface RAGQueryResponse {
  answer: string;
  sources: SearchResult[];
  thought_process?: unknown[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface DocumentListPage {
  my_documents: Document[];
  public_documents: Document[];
  my_next_cursor: string | null;
  public_next_cursor: string | null;
  my_has_more: boolean;
  public_has_more: boolean;
  next_cursor: string | null;
  has_more: boolean;
  limit: number;
}

// KB is internal — one implicit Default KB per user, no CRUD views.
// KnowledgeBase types retained for internal model reference only.

export const documentsService = {
  async list(params?: {
    limit?: number;
    cursor?: string | null;
    my_cursor?: string | null;
    public_cursor?: string | null;
    scope?: 'personal' | 'public' | 'all';
    /**
     * Narrow the personal half to one folder. Omit for the flat listing —
     * that is the pre-folder behaviour and stays the default. Pass `'root'`
     * for the documents sitting directly at the user's root.
     */
    folder_id?: number | 'root';
    /** Narrow the personal half to these `file_type`s, across the whole tree. */
    types?: string;
  }): Promise<DocumentListPage> {
    const r = await apiClient.get<DocumentListPage>('/inference/documents/', { params });
    return r.data;
  },

  async get(id: number): Promise<Document> {
    const r = await apiClient.get<Document>(`/inference/documents/${id}/`);
    return r.data;
  },

  /**
   * Search the caller's files by name and contents, with conservative close
   * matches by name (`GET /inference/documents/search/`).
   *
   * `folder_id` narrows to that subtree (omit for the whole library);
   * `scope: 'public'` searches the shared library flat. Ranked and capped —
   * no cursor: `truncated` says when to keep typing.
   */
  async searchFiles(params: {
    q: string;
    folder_id?: number;
    scope?: 'personal' | 'public';
    types?: string;
    limit?: number;
  }): Promise<DocumentSearchResult> {
    const r = await apiClient.get<DocumentSearchResult>('/inference/documents/search/', { params });
    return r.data;
  },

  async upload(file: File, folderId?: number | null): Promise<Document> {
    const formData = new FormData();
    formData.append('file', file);
    // Absent means the user's root, so only send it when we are inside one.
    if (folderId != null) formData.append('folder_id', String(folderId));
    const r = await apiClient.post<Document>('/inference/documents/', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return r.data;
  },

  async toggleSharing(id: number): Promise<{ is_shared: boolean; shared_at: string | null; message: string }> {
    const r = await apiClient.post<{ is_shared: boolean; shared_at: string | null; message: string }>(
      `/inference/documents/${id}/share/`
    );
    return r.data;
  },

  /** Moves the document to the recycle bin; it stays restorable for
   *  `purges_after_days`. Not a permanent delete — that is the sweep's job. */
  async delete(id: number): Promise<TrashResult> {
    const r = await apiClient.delete<TrashResult>(`/inference/documents/${id}/`);
    return r.data;
  },

  async download(id: number, opts?: { inline?: boolean }): Promise<Blob> {
    const r = await apiClient.get<Blob>(`/inference/documents/${id}/download/`, {
      responseType: 'blob',
      params: opts?.inline ? { inline: '1' } : undefined,
    });
    return r.data;
  },

  /** In-browser save for text documents. Sends `If-Match` so a stale editor
   *  gets a 412 instead of clobbering a newer save. */
  async updateContent(id: number, content: string, expectedUpdatedAt?: string): Promise<Document> {
    const r = await apiClient.patch<Document>(
      `/inference/documents/${id}/content/`,
      { content, ...(expectedUpdatedAt ? { expected_updated_at: expectedUpdatedAt } : {}) },
      expectedUpdatedAt ? { headers: { 'If-Match': expectedUpdatedAt } } : undefined,
    );
    return r.data;
  },

  /** A blank file (or a text file holding `content`). A taken name is numbered. */
  async create(name: string, folderId?: number | null, content?: string): Promise<Document> {
    const r = await apiClient.post<Document>('/inference/documents/new/', {
      name,
      ...(folderId != null ? { folder_id: folderId } : {}),
      ...(content ? { content } : {}),
    });
    return r.data;
  },

  /** Rename in place. The extension must stay the same. */
  async rename(id: number, name: string): Promise<Document> {
    const r = await apiClient.patch<Document>(`/inference/documents/${id}/`, { name });
    return r.data;
  },

  /** Duplicate into `folderId` (null = root). In its own folder it becomes `name - Copy.ext`. */
  async copy(id: number, folderId: number | null): Promise<Document> {
    const r = await apiClient.post<Document>(`/inference/documents/${id}/copy/`, {
      ...(folderId != null ? { folder_id: folderId } : {}),
    });
    return r.data;
  },

  /** Every sheet of an .xlsx as raw cells (formulas as their `=` source). */
  async workbook(id: number): Promise<WorkbookGrid> {
    const r = await apiClient.get<WorkbookGrid>(`/inference/documents/${id}/office/`);
    return r.data;
  },

  /** What the file held before each overwrite, newest first (owner only). */
  async versions(id: number): Promise<{ versions: DocumentVersion[] }> {
    const r = await apiClient.get<{ versions: DocumentVersion[] }>(
      `/inference/documents/${id}/versions/`,
    );
    return r.data;
  },

  /** The bytes of one earlier version, for previewing. */
  async versionDownload(id: number, versionId: number, opts?: { inline?: boolean }): Promise<Blob> {
    const r = await apiClient.get<Blob>(
      `/inference/documents/${id}/versions/${versionId}/download/`,
      {
        responseType: 'blob',
        params: opts?.inline ? { inline: '1' } : undefined,
      },
    );
    return r.data;
  },

  /** Put a version back. The replaced state becomes a version, so this undoes.
   *  Sends `If-Match` so a stale panel gets a 412 instead of clobbering. */
  async restoreVersion(id: number, versionId: number, expectedUpdatedAt?: string): Promise<Document> {
    const r = await apiClient.post<Document>(
      `/inference/documents/${id}/versions/${versionId}/restore/`,
      { ...(expectedUpdatedAt ? { expected_updated_at: expectedUpdatedAt } : {}) },
      expectedUpdatedAt ? { headers: { 'If-Match': expectedUpdatedAt } } : undefined,
    );
    return r.data;
  },

  /** The formats this file can be exported as — what the File menu renders. */
  async exportFormats(id: number): Promise<{ formats: string[] }> {
    const r = await apiClient.get<{ formats: string[] }>(`/inference/documents/${id}/export/`);
    return r.data;
  },

  /** The file in another format, as a blob for saving. */
  async exportAs(id: number, format: string): Promise<{ blob: Blob; filename: string }> {
    const r = await apiClient.get<Blob>(`/inference/documents/${id}/export/`, {
      responseType: 'blob',
      params: { to: format },
    });
    const disposition: string = r.headers?.['content-disposition'] ?? '';
    const match = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(disposition);
    const filename = match ? decodeURIComponent(match[1].replace(/"/g, '')) : `export.${format}`;
    return { blob: r.data, filename };
  },

  /** Park an office autosave cheaply: `{spec}` for a deck / Word file made
   *  here, `{grid: {sheets}}` for a workbook. The bytes rebuild after quiet;
   *  reads needing them flush first. Sends `If-Match` like every other save. */
  async saveDraft(
    id: number,
    body: { spec?: unknown; grid?: unknown; snapshot?: unknown },
    expectedUpdatedAt?: string,
  ): Promise<Document> {
    const r = await apiClient.post<Document>(
      `/inference/documents/${id}/draft/`,
      { ...body, ...(expectedUpdatedAt ? { expected_updated_at: expectedUpdatedAt } : {}) },
    );
    return r.data;
  },

  /** Convert an uploaded Word/PowerPoint file into an editable spec.
   *  The original upload stays version 1; the response says what was lost. */
  async importDoc(id: number, expectedUpdatedAt?: string): Promise<Document & { converted?: boolean; warnings?: string[] }> {
    const r = await apiClient.post<Document & { converted?: boolean; warnings?: string[] }>(
      `/inference/documents/${id}/import/`,
      { ...(expectedUpdatedAt ? { expected_updated_at: expectedUpdatedAt } : {}) },
    );
    return r.data;
  },

  /** An image the file's spec embeds, as a blob for `<img>` display. */
  async assetBlob(id: number, path: string): Promise<Blob> {
    const r = await apiClient.get<Blob>(`/inference/documents/${id}/asset/`, {
      responseType: 'blob',
      params: { path },
    });
    return r.data;
  },

  /** Save an image beside the document, for embedding. Answers its spec path. */
  async uploadImage(id: number, file: File): Promise<{ path: string }> {
    const formData = new FormData();
    formData.append('file', file);
    const r = await apiClient.post<{ path: string }>(`/inference/documents/${id}/images/`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return r.data;
  },

  /** Cell edits to an .xlsx, or `{spec}` for a deck / Word file made here. */
  async editOffice(
    id: number,
    body: { sheet?: string; set_cells?: { cell: string; value: string | number | boolean | null }[]; spec?: unknown },
    expectedUpdatedAt?: string,
  ): Promise<Document> {
    const r = await apiClient.post<Document>(
      `/inference/documents/${id}/office/`,
      { ...body, ...(expectedUpdatedAt ? { expected_updated_at: expectedUpdatedAt } : {}) },
    );
    return r.data;
  },

  /** A browser-proof PNG for a TIFF/BMP/HEIC image (Phase F). The download
   *  stays the original; this is only what the preview shows. */
  async previewImageBlob(id: number): Promise<Blob> {
    const r = await apiClient.get<Blob>(`/inference/documents/${id}/preview-image/`, {
      responseType: 'blob',
    });
    return r.data;
  },

  /** The files inside a zip: name, size and date each — never the bytes. */
  async archive(id: number): Promise<ArchiveListing> {
    const r = await apiClient.get<ArchiveListing>(`/inference/documents/${id}/archive/`);
    return r.data;
  },

  /** Authenticated preview for `<img src>`.
   *  Fetches via `Authorization` header (no token in URL) and returns a
   *  `blob:` URL. Use for previews; `download()` for saves. */
  async previewBlobUrl(id: number): Promise<string> {
    const blob = await this.download(id, { inline: true });
    return URL.createObjectURL(blob);
  },

  /** Legacy helper — kept for non-preview uses. Prefer `download()` / `previewBlobUrl()`.
   *  Direct `<img src>` to this URL without a header **will 401**; it is not
   *  public. `QueryParamJWTAuthentication` accepts `?token=` only as a fallback
   *  for browser-initiated GETs that cannot set headers, but the UI should use
   *  header-based fetch. */
  previewUrl(id: number): string {
    return `/api/inference/documents/${id}/download/`;
  },

  async search(
    query: string,
    topK = 5,
    includePlatform = false,
    kbId?: number
  ): Promise<{ results: SearchResult[]; platform_results: SearchResult[] }> {
    const r = await apiClient.post<{ results: SearchResult[]; platform_results: SearchResult[] }>(
      '/inference/rag/search/',
      { query, top_k: topK, include_platform: includePlatform, kb_id: kbId }
    );
    return r.data;
  },

  async query(question: string, topK = 5): Promise<RAGQueryResponse> {
    const r = await apiClient.post<RAGQueryResponse>('/inference/rag/query/', { question, top_k: topK });
    return r.data;
  },
};

/**
 * The per-user folder tree and its recycle bin.
 *
 * Every call is id-addressed. The server answers 404 for a folder that does not
 * exist *and* for one belonging to someone else — deliberately the same answer,
 * so the API cannot be used to discover which ids are real.
 */
export const foldersService = {
  /** Children of `parentId` (null = the user's root), with breadcrumbs. */
  async list(parentId: number | null): Promise<FolderListPage> {
    const r = await apiClient.get<FolderListPage>('/inference/folders/', {
      params: parentId == null ? undefined : { parent: parentId },
    });
    return r.data;
  },

  async get(id: number): Promise<FolderDetail> {
    const r = await apiClient.get<FolderDetail>(`/inference/folders/${id}/`);
    return r.data;
  },

  async create(name: string, parentId: number | null): Promise<Folder> {
    const r = await apiClient.post<Folder>('/inference/folders/', {
      name,
      parent_id: parentId,
    });
    return r.data;
  },

  /** Rename and/or move in one call — what inline editing needs. */
  async update(
    id: number,
    changes: { name?: string; parent_id?: number | null }
  ): Promise<FolderDetail> {
    const r = await apiClient.patch<FolderDetail>(`/inference/folders/${id}/`, changes);
    return r.data;
  },

  /** Sends the folder and everything under it to the recycle bin. */
  async remove(id: number): Promise<TrashResult> {
    const r = await apiClient.delete<TrashResult>(`/inference/folders/${id}/`);
    return r.data;
  },

  /** Bulk on purpose: one request per dragged item would half-apply. */
  async move(payload: {
    folder_ids?: number[];
    document_ids?: number[];
    target_folder_id: number | null;
  }): Promise<MoveResult> {
    const r = await apiClient.post<MoveResult>('/inference/fs/move/', payload);
    return r.data;
  },

  trash: {
    async list(cursor?: string | null): Promise<TrashPage> {
      const r = await apiClient.get<TrashPage>('/inference/trash/', {
        params: cursor ? { cursor } : undefined,
      });
      return r.data;
    },

    /** No target: rows go back where they came from. */
    async restore(payload: {
      folder_ids?: number[];
      document_ids?: number[];
    }): Promise<RestoreResult> {
      const r = await apiClient.post<RestoreResult>('/inference/trash/restore/', payload);
      return r.data;
    },

    async empty(): Promise<{ purged_documents: number; purged_folders: number }> {
      const r = await apiClient.delete<{ purged_documents: number; purged_folders: number }>(
        '/inference/trash/empty/'
      );
      return r.data;
    },
  },
};

export default documentsService;
