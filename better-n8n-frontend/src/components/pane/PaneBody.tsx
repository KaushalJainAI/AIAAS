/**
 * What is in the pane for the active tab. Only the active tab's body is
 * mounted: an inactive tab keeps its title and target in state, not a live
 * component, so a PDF in a hidden tab holds no pdf.js worker.
 *
 * `file` tabs re-read their file when reopened, and `PdfJsViewer` reopens at
 * the saved page. `html` tabs hold the frame document the chat built. `media`
 * tabs hold an own-origin picture or video. `browser` and `link` tabs show the
 * agent's browser and a previewed link (`BrowserTabBody`, `LinkTabBody`).
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { ExternalLink, FileWarning, Loader2 } from 'lucide-react';

import { documentsService, type Document } from '@/api/documents';
import { resolvePath } from '@/lib/vfsPath';
import type { FileTarget } from '@/components/files/filePreviewState';
import PreviewFrame from '@/components/files/PreviewFrame';
import FilePreview from '@/components/files/FilePreview';
import type { PaneTab } from '@/lib/paneTabs';
import BodyHeader from './BodyHeader';
import BrowserTabBody from './BrowserTabBody';
import LinkTabBody from './LinkTabBody';

interface Props {
  tab: PaneTab | null;
  /** The header ×: hide the pane, keep the tabs. */
  onHide: () => void;
  onCloseTab: (id: string) => void;
  onRetitle: (id: string, title: string) => void;
  /** Sends a chat message (the "I'm done" button of a browser hand-off). Absent outside the chat. */
  onSendText?: (text: string) => void;
}

export default function PaneBody({ tab, onHide, onCloseTab, onRetitle, onSendText }: Props) {
  if (!tab) return null;
  switch (tab.kind) {
    case 'file':
      return (
        <div className="flex min-h-0 flex-1 flex-col pb-[env(safe-area-inset-bottom)] md:pb-0">
          <FileBody
            key={`${tab.id}:${tab.nonce}`}
            tabId={tab.id}
            target={tab.target}
            onHide={onHide}
            onCloseTab={onCloseTab}
            onRetitle={onRetitle}
          />
        </div>
      );
    case 'html':
      return <HtmlBody title={tab.title} srcDoc={tab.srcDoc} onHide={onHide} />;
    case 'media':
      return <MediaBody title={tab.title} mediaType={tab.mediaType} src={tab.src} onHide={onHide} />;
    case 'browser':
      // Keyed by tab: a picked call or a zoom belongs to one run, not to whichever tab comes next.
      return (
        <BrowserTabBody
          key={tab.id}
          views={tab.views}
          running={tab.running}
          onHide={onHide}
          onSendText={onSendText}
        />
      );
    case 'link':
      return <LinkTabBody key={tab.id} url={tab.url} onHide={onHide} />;
  }
}

/**
 * An HTML artifact in the pane. Same sandbox as the chat's own frame: scripts
 * run, and the frame gets no `allow-same-origin`, so it cannot reach our
 * storage, cookies or DOM, and it has no network access of its own.
 */
export function HtmlBody({ title, srcDoc, onHide }: { title: string; srcDoc: string; onHide: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card">
      <BodyHeader title={title} onHide={onHide} />
      <iframe
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        title={title}
        className="min-h-0 flex-1 border-0 bg-transparent"
      />
    </div>
  );
}

/**
 * A picture or video at full size. `touch-action: pinch-zoom` on the picture
 * lets the browser pinch-zoom it on a phone, and the page does not scroll
 * under the gesture.
 */
export function MediaBody({
  title,
  mediaType,
  src,
  onHide,
}: {
  title: string;
  mediaType: 'image' | 'video';
  src: string;
  onHide: () => void;
}) {
  const original = (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      title="Open original"
      aria-label="Open original"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground md:h-8 md:w-8"
    >
      <ExternalLink className="h-4 w-4" />
    </a>
  );
  const pinch: CSSProperties = { touchAction: 'pinch-zoom' };
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card">
      <BodyHeader title={title} onHide={onHide} actions={original} />
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/30 p-2">
        {mediaType === 'video' ? (
          <video src={src} controls playsInline className="max-h-full max-w-full" />
        ) : (
          <img src={src} alt={title} style={pinch} className="max-h-full max-w-full object-contain" />
        )}
      </div>
    </div>
  );
}

/** The file, a reason it cannot be shown, or a spinner. */
function FileBody({
  tabId,
  target,
  onHide,
  onCloseTab,
  onRetitle,
}: {
  tabId: string;
  target: FileTarget;
  onHide: () => void;
  onCloseTab: (id: string) => void;
  onRetitle: (id: string, title: string) => void;
}) {
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
        if (d) {
          setDoc(d);
          onRetitle(tabId, d.filename);
        } else setProblem(`${label} is not in your files. It may have been moved or deleted.`);
      })
      .catch(() => {
        // The API answers 404 for a deleted file and for someone else's alike,
        // so the message cannot say which, and should not try.
        if (!cancelled) setProblem('This file is no longer available. It may have been deleted.');
      });
    return () => {
      cancelled = true;
    };
  }, [target, label, tabId, onRetitle]);

  if (doc) {
    // Pop out is for the side pane only: the Documents page is where it leads.
    return (
      <PreviewFrame doc={doc} onClose={onHide} popOut>
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
          onClick={() => onCloseTab(tabId)}
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
