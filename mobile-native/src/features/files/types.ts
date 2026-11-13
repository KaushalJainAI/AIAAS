/**
 * Types for the file library: documents, folders, the recycle bin, versions,
 * recents and app tabs. Copied from the web app so field names match the API
 * exactly.
 *
 * Mirrors:
 *   better-n8n-frontend/src/api/documents.ts  (types + documentsService, foldersService)
 *   better-n8n-frontend/src/api/recents.ts    (RecentFile, AppSession, ViewState)
 */

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

/** The agent or chat that wrote a file. */
export interface DocumentAuthor {
  kind: 'agent' | 'chat';
  name: string;
  agent_id: number | null;
  execution_id: string | null;
}

export type DocumentStatus = 'pending' | 'processing' | 'indexed' | 'stored' | 'failed' | 'uploading';

export type DocumentSharingMode = 'private' | 'shared_read' | 'shared_write';

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
  status: DocumentStatus;
  error_message?: string;
  sharing_mode?: DocumentSharingMode;
  author_name?: string;
  /** Who wrote the file, when it was written by someone other than the owner. `null` for files the owner made themselves and for older rows. */
  author?: DocumentAuthor | null;
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

/** What the account holds against its quota (`GET /inference/storage/`). */
export interface StorageUsage {
  used_bytes: number;
  /** 0 when the deployment enforces no byte quota. */
  limit_bytes: number;
  percent: number | null;
  file_count: number;
  file_limit: number;
  breakdown: {
    documents: number;
    trash: number;
    versions: number;
    chat_attachments: number;
    published_pages: number;
  };
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
 * What a file held before one overwrite — the version history.
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

/** A page of the document listing. Personal rows are `my_*`; the shared library is `public_*`. */
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

/** Flat scalars only: the server refuses nested values. */
export type ViewState = Record<string, string | number | boolean | null>;

export interface RecentFile {
  document: Document;
  /** The app it was last opened in (`docs`, `pdf`, `preview`, ...). */
  app: string;
  opened_at: string;
  open_count: number;
  view_state: ViewState;
}

export interface AppSessionTab {
  id: number;
  name: string;
  file_type: string;
}

export interface AppSession {
  app: string;
  tabs: AppSessionTab[];
  active: number | null;
  updated_at: string | null;
}

/** Result of toggling a document's sharing (`POST /inference/documents/{id}/share/`). */
export interface SharingResult {
  is_shared: boolean;
  shared_at: string | null;
  message: string;
}

/** Which form of export a file offers (`GET /inference/documents/{id}/export/`). */
export interface ExportFormatsResult {
  formats: string[];
}

/** A `to=` export: the blob's filename comes from Content-Disposition. */
export interface ExportedFile {
  filename: string;
  response: Response;
}

export interface OfficeCellEdit {
  cell: string;
  value: string | number | boolean | null;
}

/** Cell edits to an .xlsx, or `{spec}` for a deck / Word file made here. */
export interface OfficeEditBody {
  sheet?: string;
  set_cells?: OfficeCellEdit[];
  spec?: unknown;
}

/** Autosave for an office file: `{spec}` for a deck / Word file, `{grid}` / `{snapshot}` for a workbook. */
export interface DraftBody {
  spec?: unknown;
  grid?: unknown;
  snapshot?: unknown;
}

export interface UploadedImage {
  /** The spec path to store for embedding. */
  path: string;
}

export interface ImportedDocument extends Document {
  converted?: boolean;
  warnings?: string[];
}

/** What emptying the recycle bin permanently removed (`DELETE /inference/trash/empty/`). */
export interface PurgeResult {
  purged_documents: number;
  purged_folders: number;
}

export interface RagSearchResponse {
  results: SearchResult[];
  platform_results: SearchResult[];
}

/** Files and folders a bulk move names. Ids only. */
export interface MovePayload {
  folder_ids?: number[];
  document_ids?: number[];
  target_folder_id: number | null;
}

export interface RestorePayload {
  folder_ids?: number[];
  document_ids?: number[];
}

export interface FolderChanges {
  name?: string;
  parent_id?: number | null;
}

/** Listing filter: the user's own files, the shared library, or both. */
export type DocumentScope = 'personal' | 'public' | 'all';

export interface DocumentListParams {
  limit?: number;
  cursor?: string | null;
  my_cursor?: string | null;
  public_cursor?: string | null;
  scope?: DocumentScope;
  /** Narrow the personal half to one folder. Omit for the flat listing. `'root'` for the user's root. */
  folder_id?: number | 'root';
  /** Narrow the personal half to these `file_type`s, comma-separated. */
  types?: string;
}

export interface DocumentSearchParams {
  q: string;
  folder_id?: number;
  scope?: 'personal' | 'public';
  types?: string;
  limit?: number;
}

export interface RecentListParams {
  app?: string;
  types?: string[];
  limit?: number;
}
