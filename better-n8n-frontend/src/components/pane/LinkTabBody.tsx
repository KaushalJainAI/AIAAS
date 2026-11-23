/**
 * A link previewed in the pane: the page's title, a picture of it, and the
 * start of its text, with "Open in new tab" for the rest.
 *
 * The preview is read on the server (`POST /api/browser/preview/`), one
 * browser minute each, so the answer is kept per URL for the session. Switching
 * tabs does not ask again, and a failed preview is not kept, so a retry works.
 */
import { useEffect, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';

import { browserService, type BrowserPreview } from '@/api/browser';
import { apiErrorMessage } from '@/lib/apiError';
import { previewFailure } from '@/lib/browserPreview';
import { hostOf } from '@/lib/browserView';
import { isSafeExternalUrl } from '@/lib/safeUrl';
import BodyHeader from './BodyHeader';
import BrowserPicture from './BrowserPicture';

/** Previews kept for the session. Oldest out first. */
const MAX_KEPT = 20;
const kept = new Map<string, Promise<BrowserPreview>>();

function previewOnce(url: string): Promise<BrowserPreview> {
  const existing = kept.get(url);
  if (existing) return existing;
  const request = browserService.preview(url);
  kept.set(url, request);
  request.catch(() => {
    if (kept.get(url) === request) kept.delete(url);
  });
  if (kept.size > MAX_KEPT) {
    const oldest = kept.keys().next().value;
    if (oldest !== undefined) kept.delete(oldest);
  }
  return request;
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; data: BrowserPreview }
  | { status: 'error'; message: string };

function statusOf(err: unknown): number | undefined {
  return (err as { response?: { status?: number } } | null)?.response?.status;
}

export default function LinkTabBody({ url, onHide }: { url: string; onHide: () => void }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    previewOnce(url).then(
      (data) => {
        if (alive) setState({ status: 'ready', data });
      },
      (err: unknown) => {
        if (alive) {
          setState({
            status: 'error',
            message: previewFailure(statusOf(err), apiErrorMessage(err, '')),
          });
        }
      },
    );
    return () => {
      alive = false;
    };
  }, [url]);

  const host = hostOf(url);
  const ready = state.status === 'ready' ? state.data : null;
  const title = ready?.title || host;
  // The page's own final address when the server gave one, else the link as sent.
  const openUrl = ready && isSafeExternalUrl(ready.url) ? ready.url : url;
  const openable = isSafeExternalUrl(openUrl);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card">
      <BodyHeader
        title={title}
        onHide={onHide}
        actions={
          openable ? (
            <a
              href={openUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open in new tab"
              title="Open in new tab"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground md:h-8 md:w-8"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : null
        }
      />

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden p-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-foreground">{host}</div>
          <div className="truncate font-mono text-[11px] text-muted-foreground" title={openUrl}>
            {openUrl}
          </div>
        </div>

        {state.status === 'loading' && (
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Opening the page…
          </div>
        )}

        {state.status === 'error' && (
          <p role="alert" className="text-[13px] text-destructive">
            {state.message}
          </p>
        )}

        {ready && (
          <>
            <BrowserPicture
              frameId={ready.frame_id}
              alt={`Picture of ${host}`}
              missingText="No picture was kept for this page."
            />
            {ready.text_excerpt ? (
              <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground/80">
                {ready.text_excerpt}
              </p>
            ) : (
              <p className="text-[13px] text-muted-foreground">The page has no readable text.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
