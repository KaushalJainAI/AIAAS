/**
 * Read one document without leaving the Documents page.
 *
 * The frame is `components/files/PreviewFrame.tsx` — the same header every
 * preview carries — portalled to the body so the backdrop covers the whole
 * screen, site bars included, at a fixed size rather than one that follows
 * the content. What is inside is `components/files/FilePreview.tsx`, shared
 * with the chat's file drawer so a file looks the same wherever it is
 * opened. Editing is the apps' job (`/apps/<id>?file=`): the button here
 * hands the file to the one that suits it, rather than keeping a second,
 * weaker editor in a modal.
 */

import { useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

import type { Document } from '../../api/documents';
import FilePreview from '../files/FilePreview';
import PreviewFrame from '../files/PreviewFrame';

interface Props {
  doc: Document;
  onClose: () => void;
}

export function DocumentPreviewModal({ doc, onClose }: Props) {
  // Escape closes, matching every other modal on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-sm animate-in fade-in duration-300 sm:p-6"
      onClick={handleBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${doc.filename}`}
    >
      <div className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border/60 bg-card shadow-lg entrance-modal">
        <PreviewFrame doc={doc} onClose={onClose}>
          <FilePreview doc={doc} className="min-h-0 flex-1 overflow-auto" />
        </PreviewFrame>
      </div>
    </div>,
    document.body,
  );
}
