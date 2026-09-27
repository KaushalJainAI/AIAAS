/**
 * The File menu every productivity app shares: New, Open, Rename, copy,
 * download, export, print, history, move, reveal, trash.
 *
 * Each item calls the same route the Files page or the API already serves —
 * the menu is a shorter path to an existing operation, not a second
 * implementation of one. Export formats come from the server
 * (`exportFormats`), so a format is offered exactly where it can be produced.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight, Copy, Download, FileOutput, FolderInput, FolderOpen, History,
  Loader2, Pencil, Printer, Search, Trash2,
} from 'lucide-react';

import { documentsService, foldersService, type Document } from '../../api/documents';
import type { AppMeta, NewFileOption } from '../../lib/apps';
import { apiErrorMessage } from '../../lib/apiError';
import { downloadBlob } from '../../lib/downloadFile';
import { fileIcon } from '../../lib/fileDisplay';
import { toast } from '../../lib/toastStore';
import { cn } from '../../lib/utils';
import FolderPickerModal from '../documents/FolderPickerModal';

interface Props {
  app: AppMeta;
  doc: Document | null;
  onRename: () => void;
  onNewFile: (opt: NewFileOption) => void;
  onOpenFile: (doc: Document) => void;
  onChanged: (doc: Document) => void;
  onTrashed: () => void;
  onShowHistory: () => void;
  onClose: () => void;
}

export default function FileMenu(props: Props) {
  const { app, doc } = props;
  const [exportOpen, setExportOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  // No export section until the server answers; a file with no formats keeps
  // the empty list, which hides the section rather than spinning for ever.
  const [formats, setFormats] = useState<string[] | null>(doc ? null : []);
  const [exporting, setExporting] = useState<string | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moveBusy, setMoveBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { onClose } = props;

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Mounted fresh each time the menu opens (`key` on the caller), so this
  // runs once per opening for the open file.
  useEffect(() => {
    if (!doc) return;
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

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['app-files'] });
    qc.invalidateQueries({ queryKey: ['documents'] });
  };

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const doCopy = () =>
    withBusy(async () => {
      if (!doc) return;
      try {
        const copy = await documentsService.copy(doc.id, null);
        refresh();
        toast.success(`Copied as ${copy.filename}`);
        props.onClose();
      } catch (err) {
        toast.error('Could not copy the file', apiErrorMessage(err, 'Please try again.'));
      }
    });

  const doDownload = () =>
    withBusy(async () => {
      if (!doc) return;
      try {
        downloadBlob(await documentsService.download(doc.id), doc.filename);
        props.onClose();
      } catch (err) {
        toast.error('Could not download the file', apiErrorMessage(err, 'Please try again.'));
      }
    });

  const doExport = (fmt: string) =>
    withBusy(async () => {
      if (!doc) return;
      setExporting(fmt);
      try {
        const { blob, filename } = await documentsService.exportAs(doc.id, fmt);
        downloadBlob(blob, filename);
        toast.success(`Exported as ${filename}`);
        props.onClose();
      } catch (err) {
        toast.error('Could not export the file', apiErrorMessage(err, 'Please try again.'));
      } finally {
        setExporting(null);
      }
    });

  const doTrash = () =>
    withBusy(async () => {
      if (!doc) return;
      try {
        await documentsService.delete(doc.id);
        refresh();
        toast.success('Moved to Trash');
        props.onTrashed();
        props.onClose();
      } catch (err) {
        toast.error('Could not trash the file', apiErrorMessage(err, 'Please try again.'));
      }
    });

  const doMove = async (target: number | null) => {
    if (!doc) return;
    setMoveBusy(true);
    try {
      await foldersService.move({ document_ids: [doc.id], target_folder_id: target });
      refresh();
      toast.success('Moved');
      setMoving(false);
      props.onClose();
    } catch (err) {
      toast.error('Could not move the file', apiErrorMessage(err, 'Please try again.'));
    } finally {
      setMoveBusy(false);
    }
  };

  const newOptions = app.newFiles ?? [];
  const item =
    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] text-foreground hover:bg-muted disabled:opacity-40';

  return (
    <>
      <div ref={wrapRef} className="absolute left-0 top-full z-40 mt-1 w-60 rounded-lg border border-border/60 bg-popover p-1 shadow-lg">
        {newOptions.length > 0 && (
          <div className="relative">
            <button
              type="button"
              disabled={busy}
              onClick={() => setNewOpen((o) => !o)}
              className={item}
              aria-expanded={newOpen}
            >
              <Copy className="h-4 w-4 text-muted-foreground" /> New
              <ChevronRight className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
            </button>
            {newOpen && (
              <div className="absolute left-full top-0 z-40 ml-1 w-52 rounded-lg border border-border/60 bg-popover p-1 shadow-lg">
                {newOptions.map((o) => (
                  <button
                    key={o.ext}
                    type="button"
                    onClick={() => props.onNewFile(o)}
                    className={item}
                  >
                    {o.label} <span className="ml-auto text-[11px] text-muted-foreground">.{o.ext}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => setQuickOpen(true)}
          className={item}
        >
          <Search className="h-4 w-4 text-muted-foreground" /> Open…
        </button>
        <div className="mx-2 my-1 h-px bg-border/60" aria-hidden />
        <button
          type="button"
          disabled={!doc || busy}
          onClick={() => {
            props.onRename();
            props.onClose();
          }}
          className={item}
        >
          <Pencil className="h-4 w-4 text-muted-foreground" /> Rename
        </button>
        <button type="button" disabled={!doc || busy} onClick={() => void doCopy()} className={item}>
          <Copy className="h-4 w-4 text-muted-foreground" /> Make a copy
        </button>
        <button type="button" disabled={!doc || busy} onClick={() => void doDownload()} className={item}>
          <Download className="h-4 w-4 text-muted-foreground" /> Download
        </button>
        {formats !== null && formats.length > 0 && (
          <div className="relative">
            <button
              type="button"
              disabled={!doc || busy}
              onClick={() => setExportOpen((o) => !o)}
              className={item}
              aria-expanded={exportOpen}
            >
              <FileOutput className="h-4 w-4 text-muted-foreground" /> Export as
              <ChevronRight className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
            </button>
            {exportOpen && (
              <div className="absolute left-full top-0 z-40 ml-1 w-48 rounded-lg border border-border/60 bg-popover p-1 shadow-lg">
                {formats.map((f) => (
                  <button
                    key={f}
                    type="button"
                    disabled={exporting !== null}
                    onClick={() => void doExport(f)}
                    className={item}
                  >
                    {exporting === f ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <FileOutput className="h-4 w-4 text-muted-foreground" />
                    )}
                    .{f}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          disabled={!doc || busy}
          onClick={() => {
            props.onClose();
            window.print();
          }}
          className={item}
        >
          <Printer className="h-4 w-4 text-muted-foreground" /> Print
        </button>
        <div className="mx-2 my-1 h-px bg-border/60" aria-hidden />
        <button
          type="button"
          disabled={!doc || busy}
          onClick={() => {
            props.onShowHistory();
            props.onClose();
          }}
          className={item}
        >
          <History className="h-4 w-4 text-muted-foreground" /> Version history
        </button>
        <button
          type="button"
          disabled={!doc || busy}
          onClick={() => setMoving(true)}
          className={item}
        >
          <FolderInput className="h-4 w-4 text-muted-foreground" /> Move to…
        </button>
        <button
          type="button"
          disabled={!doc || busy}
          onClick={() => {
            if (doc) navigate(`/documents?doc=${doc.id}`);
            props.onClose();
          }}
          className={item}
        >
          <FolderOpen className="h-4 w-4 text-muted-foreground" /> Show in Files
        </button>
        <div className="mx-2 my-1 h-px bg-border/60" aria-hidden />
        <button
          type="button"
          disabled={!doc || busy}
          onClick={() => void doTrash()}
          className={cn(item, 'text-destructive hover:bg-destructive/10')}
        >
          <Trash2 className="h-4 w-4" /> Move to Trash
        </button>
      </div>

      {quickOpen && (
        <QuickOpenDialog
          app={app}
          onOpen={(d) => {
            setQuickOpen(false);
            props.onOpenFile(d);
            props.onClose();
          }}
          onCancel={() => setQuickOpen(false)}
        />
      )}
      <FolderPickerModal
        isOpen={moving}
        onCancel={() => setMoving(false)}
        onConfirm={(target) => void doMove(target)}
        isBusy={moveBusy}
      />
    </>
  );
}

function QuickOpenDialog({
  app,
  onOpen,
  onCancel,
}: {
  app: AppMeta;
  onOpen: (doc: Document) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<Document[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    documentsService
      .list({ scope: 'personal', limit: 100, types: app.accepts?.types.join(',') })
      .then((page) => {
        if (!cancelled) setFiles(page.my_documents);
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err, 'Could not load your files.'));
      });
    return () => {
      cancelled = true;
    };
  }, [app]);

  const needle = query.trim().toLowerCase();
  const shown = (files ?? []).filter(
    (d) =>
      !needle ||
      d.filename.toLowerCase().includes(needle) ||
      (d.folder_path ?? '').toLowerCase().includes(needle),
  );

  return (
    <div className="overlay z-50 flex items-start justify-center p-4 pt-24" role="dialog" aria-label="Open a file">
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-border bg-card shadow-lg">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onCancel();
              if (e.key === 'Enter' && shown.length > 0) onOpen(shown[0]);
            }}
            placeholder={`Open in ${app.title}…`}
            aria-label="Search files to open"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-72 overflow-auto p-1">
          {error ? (
            <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">{error}</p>
          ) : files === null ? (
            <p className="flex items-center justify-center gap-2 px-3 py-8 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : shown.length === 0 ? (
            <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">
              Nothing matches “{query}”.
            </p>
          ) : (
            <ul className="m-0 list-none p-0">
              {shown.slice(0, 30).map((d) => {
                const Icon = fileIcon(d);
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(d)}
                      className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-muted"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px]">{d.filename}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {d.folder_path ?? 'My Files'}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
