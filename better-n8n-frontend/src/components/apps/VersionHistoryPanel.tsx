/**
 * Version history: what the file held before each overwrite, newest first.
 *
 * Each entry names who saved (you, an agent, or before a restore) and when;
 * Restore puts one back and is itself undoable — the replaced state becomes
 * a version. A stale panel (somebody saved since it was opened) gets a 412
 * and is told to reload rather than clobber.
 */
import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { History, Loader2, RotateCcw, X } from 'lucide-react';

import { documentsService, type Document, type DocumentVersion } from '../../api/documents';
import { apiErrorMessage } from '../../lib/apiError';
import { downloadBlob } from '../../lib/downloadFile';
import { toast } from '../../lib/toastStore';
import { cn } from '../../lib/utils';
import { useSave } from './useSave';

const SOURCE_LABEL: Record<DocumentVersion['source'], string> = {
  app: 'you',
  agent: 'an agent',
  restore: 'before a restore',
};

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function VersionHistoryPanel({
  doc,
  onRestored,
  onClose,
}: {
  doc: Document;
  onRestored: (doc: Document) => void;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<DocumentVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState<number | null>(null);
  const [stale, setStale] = useState(false);
  const qc = useQueryClient();
  const editor = useSave();

  const load = useCallback(() => {
    setError(null);
    documentsService
      .versions(doc.id)
      .then((r) => {
        setVersions(r.versions);
        setStale(false);
      })
      .catch((err) => setError(apiErrorMessage(err, 'Could not load the version history.')));
  }, [doc.id]);

  // Mounted fresh per file (`key` on the caller), so the initial null state
  // is the loading state and this fetch runs once per opening.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const restore = async (v: DocumentVersion) => {
    setRestoring(v.id);
    try {
      // Unsaved typing goes in first, so the restore keeps it as a version
      // and can be undone back to it. Our own save moves the etag, so the
      // guard then uses the file as it now is.
      let expected = doc.updated_at;
      if (editor.dirty && !(await editor.save())) {
        toast.error('Could not save your latest edits', 'Restore was not started.');
        return;
      }
      if (editor.dirty || editor.saving) {
        expected = (await documentsService.get(doc.id)).updated_at;
      }
      const saved = await documentsService.restoreVersion(doc.id, v.id, expected);
      qc.invalidateQueries({ queryKey: ['app-files'] });
      qc.invalidateQueries({ queryKey: ['documents'] });
      toast.success('Version restored — and the restore itself can be undone');
      onRestored(saved);
      load();
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 412) {
        setStale(true);
        toast.error('This file changed since you opened it', 'Reload it, then restore.');
      } else {
        toast.error('Could not restore that version', apiErrorMessage(err, 'Please try again.'));
      }
    } finally {
      setRestoring(null);
    }
  };

  const preview = async (v: DocumentVersion) => {
    setPreviewing(v.id);
    try {
      downloadBlob(await documentsService.versionDownload(doc.id, v.id), v.name);
    } catch (err) {
      toast.error('Could not download that version', apiErrorMessage(err, 'Please try again.'));
    } finally {
      setPreviewing(null);
    }
  };

  return (
    <aside
      className="flex min-h-0 w-72 shrink-0 flex-col border-l border-border/60 bg-card max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-40 max-md:w-80 max-md:max-w-[85vw] max-md:shadow-xl"
      aria-label="Version history"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2.5">
        <History className="h-4 w-4 text-muted-foreground" />
        <h2 className="flex-1 text-[13px] font-semibold">Version history</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close version history"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {error ? (
          <div className="px-2 py-6 text-center">
            <p className="text-[13px] text-muted-foreground">{error}</p>
            <button
              type="button"
              onClick={load}
              className="mt-2 inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12.5px] text-primary hover:bg-muted"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Try again
            </button>
          </div>
        ) : versions === null ? (
          <p className="flex items-center justify-center gap-2 px-2 py-8 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
          </p>
        ) : versions.length === 0 ? (
          <p className="px-2 py-8 text-center text-[13px] text-muted-foreground">
            No earlier versions yet. The next save keeps what the file holds now.
          </p>
        ) : (
          <ul className="m-0 list-none space-y-1 p-0">
            {versions.map((v) => (
              <li
                key={v.id}
                className="rounded-md border border-border/50 bg-background px-2.5 py-2"
              >
                <p className="text-[12.5px] font-medium">
                  Saved by {SOURCE_LABEL[v.source] ?? v.source}
                </p>
                <p className="text-[11.5px] text-muted-foreground">
                  {formatWhen(v.created_at)} · {formatSize(v.size)}
                </p>
                <div className="mt-1.5 flex items-center gap-1">
                  <button
                    type="button"
                    disabled={restoring !== null}
                    onClick={() => void restore(v)}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-primary hover:bg-muted disabled:opacity-50"
                  >
                    {restoring === v.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3 w-3" />
                    )}
                    Restore
                  </button>
                  <button
                    type="button"
                    disabled={previewing !== null}
                    onClick={() => void preview(v)}
                    className={cn(
                      'rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {previewing === v.id ? 'Saving…' : 'Download'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {stale && (
          <p className="px-2 py-2 text-[12px] text-warning">
            This file changed since you opened it — reload it, then restore.
          </p>
        )}
      </div>
    </aside>
  );
}
