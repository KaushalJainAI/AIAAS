/**
 * React Query hooks for the file library: listings, folders, the recycle bin,
 * storage, versions, recents, app tabs and writes.
 *
 * Invalidation is by key prefix. `fileKeys.documents` covers every document
 * listing, detail and search, so a write that changes a document's row refreshes
 * all of them at once. The same holds for `fileKeys.folders` and
 * `fileKeys.recents`. Mutations name the prefixes they change and nothing else.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import { shareFile } from '../pages/api';
import { pageKeys } from '../pages/queries';
import type { PageVisibility } from '../pages/types';
import {
  copyDocument,
  createDocument,
  createFolder,
  downloadVersion,
  editOffice,
  emptyTrash,
  exportDocument,
  forgetRecent,
  getAppSession,
  getDocument,
  getFolder,
  getStorage,
  getViewState,
  getWorkbook,
  importDocument,
  listArchive,
  listDocuments,
  listExportFormats,
  listFolders,
  listRecents,
  listTrash,
  listVersions,
  moveItems,
  ragQuery,
  ragSearch,
  recordOpen,
  renameDocument,
  restoreTrash,
  restoreVersion,
  saveAppSession,
  saveDraft,
  saveViewState,
  searchFiles,
  setDocumentSharing,
  trashDocument,
  trashFolder,
  updateDocumentContent,
  updateFolder,
  clearRecents,
  uploadDocument,
} from './api';
import type { UploadFile } from './upload';
import type {
  AppSession,
  ArchiveListing,
  Document,
  DocumentListPage,
  DocumentListParams,
  DocumentSearchParams,
  DocumentSearchResult,
  DocumentVersion,
  DraftBody,
  ExportedFile,
  Folder,
  FolderChanges,
  FolderDetail,
  FolderListPage,
  ImportedDocument,
  MovePayload,
  MoveResult,
  OfficeEditBody,
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

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export const fileKeys = {
  documents: ['files', 'documents'] as const,
  documentLists: ['files', 'documents', 'list'] as const,
  documentList: (params: Omit<DocumentListParams, 'cursor' | 'my_cursor' | 'public_cursor'>) =>
    ['files', 'documents', 'list', params] as const,
  document: (id: number) => ['files', 'documents', 'detail', id] as const,
  search: (params: DocumentSearchParams) => ['files', 'documents', 'search', params] as const,

  folders: ['files', 'folders'] as const,
  folderList: (parentId: number | null) => ['files', 'folders', 'list', parentId ?? 'root'] as const,
  folder: (id: number) => ['files', 'folders', 'detail', id] as const,

  trash: ['files', 'trash'] as const,
  storage: ['files', 'storage'] as const,

  versions: (id: number) => ['files', 'versions', id] as const,
  workbook: (id: number) => ['files', 'workbook', id] as const,
  archive: (id: number) => ['files', 'archive', id] as const,
  exportFormats: (id: number) => ['files', 'export-formats', id] as const,

  recents: ['files', 'recents'] as const,
  recentList: (opts: RecentListParams) => ['files', 'recents', 'list', opts] as const,
  viewState: (id: number) => ['files', 'recents', 'view-state', id] as const,
  appSession: (app: string) => ['files', 'app-session', app] as const,
};

/** Invalidate several key prefixes. Refetches run in the background. */
function invalidate(queryClient: QueryClient, ...keys: (readonly unknown[])[]): void {
  for (const queryKey of keys) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

/**
 * The rows of one listing page. A personal listing reads `my_documents`; the
 * shared library (`scope: 'public'`) reads `public_documents`.
 */
export function flattenDocuments(
  pages: DocumentListPage[] | undefined,
  half: 'my' | 'public' = 'my',
): Document[] {
  if (!pages) return [];
  return pages.flatMap((p) => (half === 'my' ? p.my_documents : p.public_documents));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * A cursor-paged listing. The first page is shown at once; `fetchNextPage`
 * loads the next when `hasNextPage` is true. Read rows with `flattenDocuments`.
 */
export function useDocumentList(
  params: Omit<DocumentListParams, 'cursor' | 'my_cursor' | 'public_cursor'> = {},
) {
  return useInfiniteQuery({
    queryKey: fileKeys.documentList(params),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => listDocuments({ ...params, cursor: pageParam }),
    getNextPageParam: (last) => (last.has_more ? last.next_cursor : undefined),
  });
}

/** One document in full, including extracted text and `metadata.spec`. */
export function useDocument(id: number) {
  return useQuery({
    queryKey: fileKeys.document(id),
    queryFn: () => getDocument(id),
    enabled: Number.isFinite(id),
  });
}

/**
 * Search the library. The server answers empty under two characters, but the
 * hook stays idle until there are two, so no request is made for a single key.
 */
export function useDocumentSearch(params: DocumentSearchParams) {
  return useQuery<DocumentSearchResult>({
    queryKey: fileKeys.search(params),
    queryFn: () => searchFiles(params),
    enabled: params.q.trim().length >= 2,
  });
}

/** Children of one folder (`null` = the user's root), with breadcrumbs. */
export function useFolderList(parentId: number | null, enabled = true) {
  return useQuery<FolderListPage>({
    queryKey: fileKeys.folderList(parentId),
    queryFn: () => listFolders(parentId),
    enabled,
  });
}

export function useFolder(id: number) {
  return useQuery<FolderDetail>({
    queryKey: fileKeys.folder(id),
    queryFn: () => getFolder(id),
    enabled: Number.isFinite(id),
  });
}

/** The recycle bin, cursor-paged. Read `folders` and `documents` from each page. */
export function useTrash() {
  return useInfiniteQuery({
    queryKey: fileKeys.trash,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => listTrash(pageParam),
    getNextPageParam: (last: TrashPage) => (last.has_more ? last.next_cursor : undefined),
  });
}

/** Bytes and files held against the quota, trash included. */
export function useStorage() {
  return useQuery<StorageUsage>({
    queryKey: fileKeys.storage,
    queryFn: getStorage,
  });
}

/** What the file held before each overwrite, newest first. */
export function useVersions(id: number) {
  return useQuery<DocumentVersion[]>({
    queryKey: fileKeys.versions(id),
    queryFn: async () => (await listVersions(id)).versions,
    enabled: Number.isFinite(id),
  });
}

/** Every sheet of an .xlsx: raw cells and calculated values. */
export function useWorkbook(id: number) {
  return useQuery<WorkbookGrid>({
    queryKey: fileKeys.workbook(id),
    queryFn: () => getWorkbook(id),
    enabled: Number.isFinite(id),
  });
}

/** The entries of a zip: names, sizes and dates. Never the bytes. */
export function useArchive(id: number) {
  return useQuery<ArchiveListing>({
    queryKey: fileKeys.archive(id),
    queryFn: () => listArchive(id),
    enabled: Number.isFinite(id),
  });
}

/** The formats this file can be exported as. */
export function useExportFormats(id: number) {
  return useQuery<string[]>({
    queryKey: fileKeys.exportFormats(id),
    queryFn: async () => (await listExportFormats(id)).formats,
    enabled: Number.isFinite(id),
  });
}

/** Recently opened files, newest first. */
export function useRecentFiles(opts: RecentListParams = {}) {
  return useQuery<RecentFile[]>({
    queryKey: fileKeys.recentList(opts),
    queryFn: () => listRecents(opts),
  });
}

/** Where the user was in one file (page, zoom…). */
export function useViewState(id: number) {
  return useQuery<ViewState>({
    queryKey: fileKeys.viewState(id),
    queryFn: () => getViewState(id),
    enabled: Number.isFinite(id),
  });
}

/** An app's open tabs, so a fresh launch restores them. */
export function useAppSession(app: string) {
  return useQuery<AppSession>({
    queryKey: fileKeys.appSession(app),
    queryFn: () => getAppSession(app),
    enabled: app.length > 0,
  });
}

// ---------------------------------------------------------------------------
// Documents: create, change, share, delete
// ---------------------------------------------------------------------------

/** Upload a picked file into a folder (`null` = root). */
export function useUploadDocument(folderId: number | null) {
  const queryClient = useQueryClient();
  return useMutation<Document, Error, UploadFile>({
    mutationFn: (file) => uploadDocument(file, folderId),
    onSuccess: () => {
      invalidate(queryClient, fileKeys.documents, fileKeys.folders, fileKeys.storage);
    },
  });
}

/** Create a blank file, or a text file holding `content`. */
export function useCreateDocument(folderId: number | null) {
  const queryClient = useQueryClient();
  return useMutation<Document, Error, { name: string; content?: string }>({
    mutationFn: ({ name, content }) => createDocument(name, folderId, content),
    onSuccess: () => {
      invalidate(queryClient, fileKeys.documents, fileKeys.folders, fileKeys.storage);
    },
  });
}

/** Rename in place. Recents and the trash show names too, so they are refreshed. */
export function useRenameDocument(id: number) {
  const queryClient = useQueryClient();
  return useMutation<Document, Error, string>({
    mutationFn: (name) => renameDocument(id, name),
    onSuccess: () => {
      invalidate(queryClient, fileKeys.documents, fileKeys.recents, fileKeys.trash);
    },
  });
}

/** Duplicate into a folder (`null` = root). */
export function useCopyDocument() {
  const queryClient = useQueryClient();
  return useMutation<Document, Error, { id: number; folderId: number | null }>({
    mutationFn: ({ id, folderId }) => copyDocument(id, folderId),
    onSuccess: () => {
      invalidate(queryClient, fileKeys.documents, fileKeys.folders, fileKeys.storage);
    },
  });
}

/** Send a file to the recycle bin. It is restorable for `purges_after_days`. */
export function useTrashDocument() {
  const queryClient = useQueryClient();
  return useMutation<TrashResult, Error, number>({
    mutationFn: (id) => trashDocument(id),
    onSuccess: () => {
      invalidate(
        queryClient,
        fileKeys.documents,
        fileKeys.folders,
        fileKeys.trash,
        fileKeys.storage,
        fileKeys.recents,
      );
    },
  });
}

/** Toggle sharing into the public library. */
export function useToggleDocumentSharing(id: number) {
  const queryClient = useQueryClient();
  return useMutation<SharingResult, Error, void>({
    mutationFn: () => setDocumentSharing(id),
    onSuccess: () => {
      invalidate(queryClient, fileKeys.documents);
    },
  });
}

/**
 * Save a text document. The save makes a version of what it replaced, and
 * changes the size, so versions and storage are refreshed too.
 */
export function useUpdateDocumentContent(id: number) {
  const queryClient = useQueryClient();
  return useMutation<Document, Error, { content: string; expectedUpdatedAt?: string }>({
    mutationFn: ({ content, expectedUpdatedAt }) => updateDocumentContent(id, content, expectedUpdatedAt),
    onSuccess: () => {
      invalidate(queryClient, fileKeys.documents, fileKeys.versions(id), fileKeys.storage);
    },
  });
}

/** Park an office autosave. The bytes are rebuilt later, so only the row changes now. */
export function useSaveDraft(id: number) {
  const queryClient = useQueryClient();
  return useMutation<Document, Error, { body: DraftBody; expectedUpdatedAt?: string }>({
    mutationFn: ({ body, expectedUpdatedAt }) => saveDraft(id, body, expectedUpdatedAt),
    onSuccess: () => {
      invalidate(queryClient, fileKeys.document(id));
    },
  });
}

/** Cell edits to a workbook, or a spec for a deck or Word file. */
export function useEditOffice(id: number) {
  const queryClient = useQueryClient();
  return useMutation<Document, Error, { body: OfficeEditBody; expectedUpdatedAt?: string }>({
    mutationFn: ({ body, expectedUpdatedAt }) => editOffice(id, body, expectedUpdatedAt),
    onSuccess: () => {
      invalidate(
        queryClient,
        fileKeys.documents,
        fileKeys.workbook(id),
        fileKeys.versions(id),
        fileKeys.storage,
      );
    },
  });
}

/** Convert an uploaded Word or PowerPoint file into an editable spec. */
export function useImportDocument(id: number) {
  const queryClient = useQueryClient();
  return useMutation<ImportedDocument, Error, string | undefined>({
    mutationFn: (expectedUpdatedAt) => importDocument(id, expectedUpdatedAt),
    onSuccess: () => {
      invalidate(queryClient, fileKeys.documents, fileKeys.versions(id), fileKeys.storage);
    },
  });
}

/** Export to another format. Nothing is stored, so nothing is invalidated. */
export function useExportDocument(id: number) {
  return useMutation<ExportedFile, Error, string>({
    mutationFn: (format) => exportDocument(id, format),
  });
}

/** Put a version back. The replaced state becomes a version, so this is undoable. */
export function useRestoreVersion(id: number) {
  const queryClient = useQueryClient();
  return useMutation<Document, Error, { versionId: number; expectedUpdatedAt?: string }>({
    mutationFn: ({ versionId, expectedUpdatedAt }) => restoreVersion(id, versionId, expectedUpdatedAt),
    onSuccess: () => {
      invalidate(queryClient, fileKeys.documents, fileKeys.versions(id), fileKeys.storage);
    },
  });
}

/** Fetch the bytes of one earlier version, for previewing or saving. */
export function useDownloadVersion(id: number) {
  return useMutation<Response, Error, { versionId: number; inline?: boolean }>({
    mutationFn: ({ versionId, inline }) => downloadVersion(id, versionId, { inline }),
  });
}

/**
 * Share one of the user's files by link. The file is copied as it is now, so
 * the link is a snapshot. Published pages are refreshed.
 */
export function useShareFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { documentId: number; title: string; visibility: PageVisibility }) =>
      shareFile(input.documentId, input.title, input.visibility),
    onSuccess: () => {
      invalidate(queryClient, pageKeys.all);
    },
  });
}

// ---------------------------------------------------------------------------
// Folders, moves and the recycle bin
// ---------------------------------------------------------------------------

/** Bulk move. Folder counts and document locations both change. */
export function useMoveItems() {
  const queryClient = useQueryClient();
  return useMutation<MoveResult, Error, MovePayload>({
    mutationFn: (payload) => moveItems(payload),
    onSuccess: () => {
      invalidate(queryClient, fileKeys.documents, fileKeys.folders);
    },
  });
}

/** Create a folder. A duplicate sibling name is refused by the server. */
export function useCreateFolder(parentId: number | null) {
  const queryClient = useQueryClient();
  return useMutation<Folder, Error, string>({
    mutationFn: (name) => createFolder(name, parentId),
    onSuccess: () => {
      invalidate(queryClient, fileKeys.folders);
    },
  });
}

/**
 * Rename and/or move a folder. A move changes the location every document in
 * it shows, so documents and recents are refreshed as well.
 */
export function useUpdateFolder(id: number) {
  const queryClient = useQueryClient();
  return useMutation<FolderDetail, Error, FolderChanges>({
    mutationFn: (changes) => updateFolder(id, changes),
    onSuccess: () => {
      invalidate(queryClient, fileKeys.folders, fileKeys.documents, fileKeys.recents);
    },
  });
}

/** Send a folder, and everything under it, to the recycle bin. */
export function useTrashFolder() {
  const queryClient = useQueryClient();
  return useMutation<TrashResult, Error, number>({
    mutationFn: (id) => trashFolder(id),
    onSuccess: () => {
      invalidate(
        queryClient,
        fileKeys.folders,
        fileKeys.documents,
        fileKeys.trash,
        fileKeys.storage,
        fileKeys.recents,
      );
    },
  });
}

/**
 * Put trashed rows back. Restores go to their recorded parent; the answer lists
 * what was restored and what was refused, with reasons.
 */
export function useRestoreTrash() {
  const queryClient = useQueryClient();
  return useMutation<RestoreResult, Error, RestorePayload>({
    mutationFn: (payload) => restoreTrash(payload),
    onSuccess: () => {
      invalidate(queryClient, fileKeys.trash, fileKeys.folders, fileKeys.documents, fileKeys.storage);
    },
  });
}

/** Purge the whole recycle bin now. */
export function useEmptyTrash() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => emptyTrash(),
    onSuccess: () => {
      invalidate(queryClient, fileKeys.trash, fileKeys.storage);
    },
  });
}

// ---------------------------------------------------------------------------
// Recents and app tabs
// ---------------------------------------------------------------------------

/** Record an open. The answer carries where the file was left. */
export function useRecordOpen() {
  const queryClient = useQueryClient();
  return useMutation<RecentFile, Error, { documentId: number; app: string }>({
    mutationFn: ({ documentId, app }) => recordOpen(documentId, app),
    onSuccess: () => {
      invalidate(queryClient, fileKeys.recents);
    },
  });
}

/** Save where the user is in a file. Counts as neither an open nor a change. */
export function useSaveViewState(documentId: number) {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, ViewState>({
    mutationFn: (viewState) => saveViewState(documentId, viewState),
    onSuccess: () => {
      invalidate(queryClient, fileKeys.viewState(documentId));
    },
  });
}

/** Drop one file from the recents list. */
export function useForgetRecent() {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, number>({
    mutationFn: (documentId) => forgetRecent(documentId),
    onSuccess: () => {
      invalidate(queryClient, fileKeys.recents);
    },
  });
}

/** Clear the whole recents list. */
export function useClearRecents() {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, void>({
    mutationFn: () => clearRecents(),
    onSuccess: () => {
      invalidate(queryClient, fileKeys.recents);
    },
  });
}

/** Replace an app's open tabs. The answer is written straight into the cache. */
export function useSaveAppSession(app: string) {
  const queryClient = useQueryClient();
  return useMutation<AppSession, Error, { tabs: number[]; active: number | null }>({
    mutationFn: ({ tabs, active }) => saveAppSession(app, tabs, active),
    onSuccess: (data) => {
      queryClient.setQueryData(fileKeys.appSession(app), data);
    },
  });
}

// ---------------------------------------------------------------------------
// Retrieval over the user's knowledge bases
// ---------------------------------------------------------------------------

/** Vector search. Stateless, so it is a mutation: each query is a request the user made. */
export function useRagSearch() {
  return useMutation<
    RagSearchResponse,
    Error,
    { query: string; topK?: number; includePlatform?: boolean; kbId?: number }
  >({
    mutationFn: ({ query, topK, includePlatform, kbId }) => ragSearch(query, topK, includePlatform, kbId),
  });
}

/** A RAG answer. Stateless, so a mutation as `useRagSearch` is. */
export function useRagQuery() {
  return useMutation<RAGQueryResponse, Error, { question: string; topK?: number }>({
    mutationFn: ({ question, topK }) => ragQuery(question, topK),
  });
}
