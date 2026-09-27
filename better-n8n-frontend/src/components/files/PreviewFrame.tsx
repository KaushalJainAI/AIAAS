/**
 * One preview frame for every surface: the Files side pane, the full-preview
 * dialog and the chat drawer.
 *
 * Same header everywhere — name, location, "Open in <app>", Download,
 * Export ▸ and Close — so a file offers the same actions wherever it is met.
 * What is inside stays the caller's: the side pane and the dialog show the
 * full preview, the drawer its own.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Download, FileOutput, Loader2, X } from 'lucide-react';

import { documentsService, type Document } from '../../api/documents';
import { useRecordOpen } from '../../hooks/useRecents';
import { defaultAppFor, openInAppPath } from '../../lib/apps';
import { downloadBlob } from '../../lib/downloadFile';
import { apiErrorMessage } from '../../lib/apiError';
import { toast } from '../../lib/toastStore';
import { cn } from '../../lib/utils';
import { downloadDocument } from '../../lib/filePreview';

function useExportFormats(doc: Document) {
  const [formats, setFormats] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    documentsService
      .exportFormats(doc.id)
      .then((r) => {
        if (!cancelled) setFormats(r.formats);
      })
      .catch(() => {
        if (!cancelled) setFormats([]);
      });
    return () => {
      cancelled = true;
    };
  }, [doc]);
  return formats;
}

export function ExportMenu({ doc, formats, onDone }: {
  doc: Document;
  formats: string[];
  onDone: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!formats.length) return null;
  return (
    <div className="absolute right-0 top-full z-40 mt-1 w-44 rounded-lg border border-border/60 bg-popover p-1 shadow-lg">
      {formats.map((fmt) => (
        <button
          key={fmt}
          type="button"
          disabled={busy !== null}
          onClick={() => {
            setBusy(fmt);
            documentsService
              .exportAs(doc.id, fmt)
              .then(({ blob, filename }) => {
                downloadBlob(blob, filename);
                onDone();
              })
              .catch((err) => toast.error('Could not export the file', apiErrorMessage(err, 'Please try again.')))
              .finally(() => setBusy(null));
          }}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-muted disabled:opacity-50"
        >
          {busy === fmt ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          ) : (
            <FileOutput className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          .{fmt}
        </button>
      ))}
    </div>
  );
}

interface FrameProps {
  doc: Document;
  /** Absent in the side pane, which is closed by selecting elsewhere. */
  onClose?: () => void;
  /** Extra actions beside Download, e.g. the pane's Full preview button. */
  extra?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export default function PreviewFrame({ doc, onClose, extra, children, className }: FrameProps) {
  const app = defaultAppFor(doc);
  const openPath = (app && openInAppPath(doc, app)) || `/documents?doc=${doc.id}`;
  const formats = useExportFormats(doc);
  // A preview is an open too: the Files pane, the dialog and the chat drawer
  // all come through here, so each of them feeds "Jump back in".
  useRecordOpen(doc.id, 'preview');
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!exportOpen) return;
    const onDown = (e: PointerEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [exportOpen]);

  const download = async () => {
    try {
      await downloadDocument(doc);
    } catch {
      toast.error('Download failed');
    }
  };

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border/60 px-3 py-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13px] font-semibold text-foreground">{doc.filename}</h2>
          <p className="truncate text-[11px] text-muted-foreground">
            {doc.folder_path && doc.folder_path !== '/' ? doc.folder_path : 'Your files'}
          </p>
        </div>
        <Link
          to={openPath}
          title={app ? `Open in ${app.title}` : 'Show in Files'}
          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-2 py-1.5 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
        >
          {app ? `Open in ${app.title}` : 'Show in Files'}
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
        <button
          type="button"
          onClick={download}
          title="Download"
          aria-label="Download"
          className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Download className="h-4 w-4" />
        </button>
        {extra}
        {formats !== null && formats.length > 0 && (
          <div ref={exportRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setExportOpen((o) => !o)}
              aria-expanded={exportOpen}
              title="Export as"
              className="rounded-md px-2 py-2 text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Export ▸
            </button>
            {exportOpen && <ExportMenu doc={doc} formats={formats} onDone={() => setExportOpen(false)} />}
          </div>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            title="Close"
            aria-label="Close preview"
            className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}
