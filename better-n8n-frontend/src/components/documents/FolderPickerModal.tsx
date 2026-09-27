import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Folder as FolderIcon, Home, Loader2, X } from 'lucide-react';
import { useState } from 'react';

import { foldersService } from '../../api/documents';
import { cn } from '../../lib/utils';

interface FolderPickerModalProps {
  isOpen: boolean;
  title?: string;
  /** Folders being moved — they and their descendants cannot be the target. */
  excludeFolderIds?: number[];
  onCancel: () => void;
  onConfirm: (targetFolderId: number | null) => void;
  isBusy?: boolean;
}

/**
 * Pick a destination folder by walking into it.
 *
 * This is the *contract* for moving; drag-and-drop is the accelerator on top.
 * Shipping only the drag would leave the operation untestable and unusable on
 * touch, so the menu path exists first and always works.
 *
 * A folder being moved is shown but not selectable — the server refuses a move
 * into self or a descendant with a 400, and refusing it here first is kinder
 * than round-tripping to find out.
 */
export default function FolderPickerModal({
  isOpen,
  title = 'Move to…',
  excludeFolderIds = [],
  onCancel,
  onConfirm,
  isBusy = false,
}: FolderPickerModalProps) {
  const [browsingId, setBrowsingId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['folders', browsingId],
    queryFn: () => foldersService.list(browsingId),
    enabled: isOpen,
  });

  if (!isOpen) return null;

  const excluded = new Set(excludeFolderIds);
  const current = data?.folder ?? null;
  const trail = data?.breadcrumbs ?? [];

  return (
    <div className="overlay z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-lg bg-card shadow-lg border border-border overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-semibold text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 rounded-md text-muted-foreground hover:bg-secondary"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-border flex items-center gap-1 text-sm overflow-x-auto">
          <button
            type="button"
            onClick={() => setBrowsingId(null)}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-muted-foreground hover:bg-secondary shrink-0"
          >
            <Home className="w-3.5 h-3.5" />
            My Files
          </button>
          {[...trail, ...(current ? [{ id: current.id, name: current.name }] : [])].map((crumb) => (
            <div key={crumb.id} className="flex items-center gap-1 shrink-0">
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
              <button
                type="button"
                onClick={() => setBrowsingId(crumb.id)}
                className="px-2 py-1 rounded-md text-foreground hover:bg-secondary truncate max-w-[8rem]"
              >
                {crumb.name}
              </button>
            </div>
          ))}
        </div>

        <div className="max-h-72 overflow-y-auto p-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : data && data.folders.length > 0 ? (
            <ul className="space-y-0.5">
              {data.folders.map((folder) => {
                const blocked = excluded.has(folder.id);
                return (
                  <li key={folder.id}>
                    <button
                      type="button"
                      disabled={blocked}
                      onClick={() => setBrowsingId(folder.id)}
                      className={cn(
                        'w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left text-sm transition-colors',
                        blocked
                          ? 'opacity-40 cursor-not-allowed'
                          : 'hover:bg-secondary'
                      )}
                      title={blocked ? 'You cannot move a folder into itself' : undefined}
                    >
                      <FolderIcon className="w-4 h-4 text-warning shrink-0" />
                      <span className="truncate text-foreground">{folder.name}</span>
                      <ChevronRight className="w-3.5 h-3.5 ml-auto text-muted-foreground" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No folders here. You can still move items into this one.
            </p>
          )}
          {data?.truncated && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              Showing the first {data.count} folders.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button
            type="button"
            onClick={onCancel}
            className="btn-secondary px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => onConfirm(browsingId)}
            className="btn-primary px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {isBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Move {current ? `to “${current.name}”` : 'to My Files'}
          </button>
        </div>
      </div>
    </div>
  );
}
