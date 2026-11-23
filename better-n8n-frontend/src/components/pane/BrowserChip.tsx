/**
 * "Browser · <host>": the chip under an answer (or a run) that used the
 * agent's browser. A click opens that run's Browser tab in the side pane.
 *
 * It draws nothing when there is no pane to open it in, so it never shows a
 * control that does nothing.
 */
import { Globe2 } from 'lucide-react';

import type { BrowserView } from '@/api/browser';
import { browserLabel } from '@/lib/browserView';
import { usePane } from './paneState';

export default function BrowserChip({ runKey, views }: { runKey: string; views: BrowserView[] }) {
  const pane = usePane();
  if (!pane || views.length === 0) return null;

  const label = browserLabel(views);
  return (
    <button
      type="button"
      onClick={() => pane.openTab({ kind: 'browser', runKey, title: label, views, running: false })}
      title="Open the browser in the side pane"
      className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-border bg-secondary px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:min-h-[28px] md:py-1"
    >
      <Globe2 className="h-3.5 w-3.5" aria-hidden />
      <span className="max-w-[60vw] truncate">{label}</span>
    </button>
  );
}
