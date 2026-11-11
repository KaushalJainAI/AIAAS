/**
 * "Import from a document" (K3.2): pick one of your own files and ask the
 * server to read the fixes in it. The fixes arrive as drafts, which nobody else
 * can see until someone shares them, so the dialog says that before the choice.
 *
 * It reuses the library's own file list (`documentsService.list`), filtered to
 * the types that carry text the importer can read. There is no separate file
 * input: the server takes a document you already have, not an upload.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { FileText, Loader2 } from 'lucide-react';

import documentsService, { type Document } from '../../api/documents';
import solutionsService from '../../api/solutions';
import { detailOf } from '../../lib/solutionForm';
import { toast } from '../../lib/toastStore';
import { Button } from '../ui/Button';
import { Modal, ModalBody } from '../ui/Modal';

/** The file types the importer reads text from (`solutions/importer.py`). */
export const IMPORT_FILE_TYPES = 'md,txt,docx,pdf';

/** Files still being uploaded, or that failed to read, have nothing to import. */
function importable(doc: Document): boolean {
  return doc.status !== 'uploading' && doc.status !== 'failed';
}

export default function DocumentImportDialog({
  org,
  onClose,
}: {
  /** The organisation the drafts belong to, or null for personal drafts. */
  org: number | null;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState('');

  const files = useInfiniteQuery({
    queryKey: ['solutions', 'import-files'],
    queryFn: ({ pageParam }) =>
      documentsService.list({
        scope: 'personal',
        types: IMPORT_FILE_TYPES,
        limit: 30,
        my_cursor: pageParam,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => (page.my_has_more && page.my_next_cursor ? page.my_next_cursor : undefined),
  });

  const start = useMutation({
    mutationFn: (doc: Document) => solutionsService.importDocument(org, doc.id),
    onSuccess: () => {
      toast.success("Importing — you'll get a notification when the drafts are ready.");
      onClose();
    },
    onError: (e) => toast.error('The import did not start.', detailOf(e, 'Please try again.')),
  });

  const loaded = (files.data?.pages.flatMap((p) => p.my_documents) ?? []).filter(importable);
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? loaded.filter((doc) => (doc.title || doc.filename).toLowerCase().includes(needle))
    : loaded;

  return (
    <Modal size="md" label="Import from a document" onClose={onClose}>
      <ModalBody>
        <h2 className="text-base font-medium">Import from a document</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Choose a file from your library. Each fix found in it is saved as a draft for you to review.
          Nothing is shared until you share it.
        </p>

        <div className="mt-4 space-y-3">
          {files.isLoading && (
            <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
          )}
          {files.isError && <p className="py-6 text-center text-sm text-muted-foreground">Your files could not be loaded.</p>}

          {!files.isLoading && !files.isError && loaded.length === 0 && (
            <div className="space-y-2 py-6 text-center text-sm text-muted-foreground">
              <p>No Word, PDF, Markdown or text files in your library yet.</p>
              <Link to="/documents" className="text-primary hover:underline">Add a file in Documents</Link>
            </div>
          )}

          {loaded.length > 0 && (
            <>
              <label className="block">
                <span className="sr-only">Filter files by name</span>
                <input
                  type="search"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter by name"
                  className="w-full min-w-0 rounded border border-border bg-background px-2.5 py-1.5 text-sm"
                />
              </label>
              {shown.length === 0 ? (
                <p className="py-4 text-center text-[12px] text-muted-foreground">No file matches that name.</p>
              ) : (
                <ul className="max-h-[50dvh] divide-y divide-border/60 overflow-y-auto rounded-md border border-border/60">
                  {shown.map((doc) => (
                    <li key={doc.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{doc.title || doc.filename}</p>
                        <p className="truncate text-[12px] text-muted-foreground">
                          {doc.file_type.toUpperCase()} · {doc.folder_path || 'Top level'}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={start.isPending && start.variables?.id === doc.id}
                        disabled={start.isPending && start.variables?.id !== doc.id}
                        onClick={() => start.mutate(doc)}
                        aria-label={`Import from ${doc.title || doc.filename}`}
                      >
                        Import
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {files.hasNextPage && (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={files.isFetchingNextPage}
                  onClick={() => void files.fetchNextPage()}
                >
                  Load more files
                </Button>
              )}
            </>
          )}
        </div>
      </ModalBody>
    </Modal>
  );
}
