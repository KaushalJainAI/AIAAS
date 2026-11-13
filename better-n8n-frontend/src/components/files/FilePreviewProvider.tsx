/**
 * A side pane that previews a file without leaving the page.
 *
 * Clicking a file an agent wrote used to navigate away from the conversation
 * that explains it, and back again cost the scroll position. The pane keeps
 * both on screen: the answer on the left, the file on the right, and "Open in
 * <app>" for when the user does want to work on the file.
 *
 * Two shapes. `docked` (the chat) puts the pane beside the page, the way the
 * preview pane of a coding agent's desktop app sits beside its transcript: the
 * conversation narrows rather than being covered, the pane can be dragged
 * wider or narrower, and opening another file swaps what is in it without
 * sliding it in again. Otherwise (and always on a phone, where there is no
 * room beside anything) it is a drawer over the page.
 *
 * A target by id is fetched directly. A target by path is walked through
 * `lib/vfsPath.ts`, the same resolution the Documents page uses, so a path in
 * prose and a card with an id end up at the same document.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { FileWarning, Loader2 } from 'lucide-react';

import { documentsService, type Document } from '../../api/documents';
import { resolvePath } from '../../lib/vfsPath';
import { cn } from '../../lib/utils';
import FilePreview from './FilePreview';
import PreviewFrame from './PreviewFrame';
import { FilePreviewContext, type FileTarget } from './filePreviewState';

const WIDTH_KEY = 'file-preview-pane-width';
const MIN_WIDTH = 360;
const DEFAULT_WIDTH = 560;
/** The chat keeps at least this much of the window. */
const MIN_PAGE_WIDTH = 420;

function maxWidth(): number {
  return Math.max(MIN_WIDTH, window.innerWidth - MIN_PAGE_WIDTH);
}

function readWidth(): number {
  try {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(saved) && saved >= MIN_WIDTH) return saved;
  } catch {
    // Storage blocked: the default width is fine.
  }
  return DEFAULT_WIDTH;
}

export default function FilePreviewProvider({
  children,
  docked = false,
}: {
  children: ReactNode;
  /** Sit beside the page instead of over it (from the md breakpoint up). */
  docked?: boolean;
}) {
  const [target, setTarget] = useState<FileTarget | null>(null);
  // Bumped on every open, so reopening the same file re-reads it — an agent
  // may have edited it since it was last opened.
  const [openCount, setOpenCount] = useState(0);

  const open = useCallback((t: FileTarget) => {
    setTarget(t);
    setOpenCount((n) => n + 1);
  }, []);
  const close = useCallback(() => setTarget(null), []);

  const pane = target && (
    <FilePane docked={docked} onClose={close}>
      <FileBody key={openCount} target={target} onClose={close} />
    </FilePane>
  );

  if (!docked) {
    return (
      <FilePreviewContext.Provider value={open}>
        {children}
        {pane}
      </FilePreviewContext.Provider>
    );
  }
  return (
    <FilePreviewContext.Provider value={open}>
      <div className="flex h-full w-full min-h-0 min-w-0">
        <div className="h-full min-h-0 min-w-0 flex-1">{children}</div>
        {pane}
      </div>
    </FilePreviewContext.Provider>
  );
}

/** The pane's shell: position, width, the drag handle and Escape to close. */
function FilePane({ docked, onClose, children }: { docked: boolean; onClose: () => void; children: ReactNode }) {
  const [width, setWidth] = useState(readWidth);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = { startX: e.clientX, startWidth: width };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    // The handle is on the pane's left edge: dragging left widens it.
    const next = drag.current.startWidth + (drag.current.startX - e.clientX);
    setWidth(Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(next))));
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      // Not remembered across reloads; the pane still works.
    }
  };

  return (
    <aside
      role="dialog"
      aria-label="File preview"
      style={{ '--pane-w': `max(320px, min(${width}px, calc(100vw - ${MIN_PAGE_WIDTH}px)))` } as CSSProperties}
      className={cn(
        'z-[90] flex flex-col border-l border-border bg-card animate-in slide-in-from-right duration-200',
        // A phone always gets the full-screen drawer.
        'fixed inset-0 w-full',
        docked
          ? 'md:relative md:inset-auto md:z-auto md:h-full md:w-[var(--pane-w)] md:shrink-0'
          : 'sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[var(--pane-w)] sm:shadow-2xl',
      )}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize preview"
        title="Drag to resize"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={cn(
          'absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize touch-none',
          'after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-transparent after:transition-colors hover:after:bg-primary/50',
          docked ? 'md:block' : 'sm:block',
        )}
      />
      {children}
    </aside>
  );
}

/** What is in the pane: the file, a reason it cannot be shown, or a spinner. */
function FileBody({ target, onClose }: { target: FileTarget; onClose: () => void }) {
  const [doc, setDoc] = useState<Document | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const label = 'path' in target && target.path ? target.path : 'File';

  useEffect(() => {
    let cancelled = false;
    const load: Promise<Document | null> =
      'documentId' in target
        ? documentsService.get(target.documentId)
        : resolvePath(target.path).then((r) => r.doc);
    load
      .then((d) => {
        if (cancelled) return;
        if (d) setDoc(d);
        else setProblem(`${label} is not in your files. It may have been moved or deleted.`);
      })
      .catch(() => {
        // The API answers 404 for a deleted file and for someone else's alike,
        // so the message cannot say which, and should not try.
        if (!cancelled) setProblem('This file is no longer available. It may have been deleted.');
      });
    return () => {
      cancelled = true;
    };
  }, [target, label]);

  if (doc) {
    return (
      <PreviewFrame doc={doc} onClose={onClose}>
        <FilePreview key={doc.id} doc={doc} className="min-h-0 flex-1 overflow-auto" />
      </PreviewFrame>
    );
  }
  if (problem) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
        <FileWarning className="h-6 w-6" />
        {problem}
        <button
          type="button"
          onClick={onClose}
          className="mt-2 rounded-md border border-border/60 px-3 py-1.5 text-[13px] hover:bg-muted"
        >
          Close
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      Opening…
    </div>
  );
}
