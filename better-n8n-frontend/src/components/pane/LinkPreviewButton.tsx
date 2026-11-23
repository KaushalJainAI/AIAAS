/**
 * The small "Preview" button beside an external link in an answer. It opens a
 * `link` tab in the side pane, which reads the page on the server.
 *
 * It draws nothing unless all four hold: there is a pane to open it in, the
 * screen is desktop-sized, the link is an external http(s) address, and the
 * server has a browser. Otherwise the link stands alone, as it always did.
 * Clicking the link itself still opens a new tab.
 *
 * The server check is only made once the first three hold, so a phone, a
 * guest or a page with no pane never asks.
 */
import { Eye } from 'lucide-react';

import { useBrowserAvailable } from '@/hooks/useBrowserAvailable';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { hostOf } from '@/lib/browserView';
import { isOwnOrigin } from '@/lib/ownOrigin';
import type { PaneTabSpec } from '@/lib/paneTabs';
import { isSafeExternalUrl } from '@/lib/safeUrl';
import { usePane } from './paneState';

export default function LinkPreviewButton({ href }: { href: string }) {
  const pane = usePane();
  const desktop = useIsDesktop();

  if (!pane || !desktop) return null;
  if (!isSafeExternalUrl(href) || isOwnOrigin(href)) return null;
  return <ServerPreviewButton href={href} openTab={pane.openTab} />;
}

function ServerPreviewButton({ href, openTab }: { href: string; openTab: (tab: PaneTabSpec) => void }) {
  const available = useBrowserAvailable();
  if (!available) return null;

  const host = hostOf(href);
  return (
    <button
      type="button"
      onClick={() => openTab({ kind: 'link', title: host, url: href })}
      aria-label={`Preview ${host}`}
      title="Preview in the side pane"
      className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-md align-middle text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <Eye className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}
