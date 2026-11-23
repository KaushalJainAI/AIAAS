/**
 * The Browser tab: what the agent's browser did in one run, and what it looks
 * like now. Props only. The views come from the pane's tab (`browserState`
 * keeps them current while the turn runs), and every action is a callback.
 *
 * Top to bottom: the address row (host in bold, the URL, copy, open the site),
 * the hand-off card when the agent is waiting for the person, "Watch live /
 * take over" when there is a live view, the latest picture (or the picture of
 * the call tapped), and the calls, newest first, each with its steps.
 */
import { useState } from 'react';
import { Check, Copy, ExternalLink, Globe, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

import type { BrowserView } from '@/api/browser';
import { copyText } from '@/lib/clipboard';
import { isSafeExternalUrl } from '@/lib/safeUrl';
import {
  awaitingUser,
  browserLabel,
  doneMessage,
  hostOf,
  liveViewOf,
} from '@/lib/browserView';
import { cn } from '@/lib/utils';
import BodyHeader from './BodyHeader';
import BrowserPicture from './BrowserPicture';
import NeedsUserCard from './NeedsUserCard';

interface Props {
  views: BrowserView[];
  /** The agent is still at the browser this turn. */
  running: boolean;
  onHide: () => void;
  /** Sends a chat message ("I'm done"). Absent where there is no chat. */
  onSendText?: (text: string) => void;
}

/**
 * Which call's picture is shown. A tap records the call's position, how many
 * calls there were, and its frame id. A new call changes the count, so the
 * view jumps to the newest picture, which is what a live run should show.
 */
interface Picked {
  index: number;
  length: number;
  frameId: string;
}

function shownIndex(views: BrowserView[], picked: Picked | null): number {
  const newest = views.length - 1;
  if (!picked || picked.length !== views.length) return newest;
  const view = views[picked.index];
  return view && view.frame_id === picked.frameId ? picked.index : newest;
}

const iconButton =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground md:h-8 md:w-8';

export default function BrowserTabBody({ views, running, onHide, onSendText }: Props) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [zoomed, setZoomed] = useState(false);

  const index = shownIndex(views, picked);
  const shown = index >= 0 ? views[index] : null;

  const host = shown ? hostOf(shown.url) : '';
  const safeUrl = shown && isSafeExternalUrl(shown.url) ? shown.url : null;
  const live = liveViewOf(views);
  const waiting = awaitingUser(views);

  const copyUrl = async () => {
    if (!shown) return;
    const ok = await copyText(shown.url);
    if (ok) toast.success('Link copied');
    else toast.error('Could not copy the link');
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card">
      <BodyHeader title={views.length > 0 ? browserLabel(views) : 'Browser'} onHide={onHide} />

      {shown && (
        <div className="flex min-w-0 shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
          <Globe className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-foreground">{host}</div>
            <div className="truncate font-mono text-[11px] text-muted-foreground" title={shown.url}>
              {shown.url}
            </div>
          </div>
          <button type="button" onClick={copyUrl} aria-label="Copy URL" title="Copy URL" className={iconButton}>
            <Copy className="h-4 w-4" />
          </button>
          {safeUrl && (
            <a
              href={safeUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open site"
              title="Open site"
              className={iconButton}
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {waiting && (
          <div className="p-3">
            <NeedsUserCard
              host={hostOf(waiting.url)}
              what={waiting.needs_user ?? ''}
              liveUrl={live}
              onDone={onSendText ? () => onSendText(doneMessage(hostOf(waiting.url))) : undefined}
            />
          </div>
        )}

        {/* While the agent waits for the person, the hand-off card carries the live button. */}
        {live && !waiting && (
          <div className="px-3 pt-3">
            {/* window.open is called directly in the click, never after an await: phones block a popup opened later. */}
            <button
              type="button"
              onClick={() => window.open(live, '_blank', 'noopener')}
              className="inline-flex h-11 items-center gap-1.5 rounded-md border border-primary-line bg-card px-3 text-[13px] font-medium text-primary hover:bg-primary-subtle md:h-9"
            >
              <ExternalLink className="h-4 w-4" aria-hidden />
              Watch live / take over
            </button>
          </div>
        )}

        {running && (
          <div className="flex items-center gap-2 px-3 pt-3 text-[13px] text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            The assistant is using this page
          </div>
        )}

        <div className="p-3">
          {!shown && !running && (
            <p className="text-[13px] text-muted-foreground">The assistant has not used the browser yet.</p>
          )}
          {shown && (
            <BrowserPicture
              frameId={shown.frame_id || null}
              alt={`Picture of ${host}`}
              zoomed={zoomed}
              onToggleZoom={() => setZoomed((z) => !z)}
            />
          )}
        </div>

        {views.length > 0 && (
          <div className="px-3 pb-4">
            <div className="mb-2 font-mono text-[11px] text-muted-foreground">Calls · newest first</div>
            <ol className="space-y-2">
              {views
                .map((view, i) => ({ view, i }))
                .reverse()
                .map(({ view, i }) => {
                  const selected = i === index;
                  return (
                    <li key={`${i}-${view.frame_id}-${view.url}`}>
                      <button
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setPicked({ index: i, length: views.length, frameId: view.frame_id })}
                        className={cn(
                          'flex min-h-[44px] w-full flex-col items-start gap-1 rounded-md border px-3 py-2 text-left md:min-h-0',
                          selected ? 'border-primary-line bg-primary-subtle' : 'border-border/60 hover:bg-muted',
                        )}
                      >
                        <span className="flex w-full min-w-0 items-center gap-2 text-[13px]">
                          <span className="font-mono text-[11px] text-muted-foreground">{i + 1}</span>
                          <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                            {view.title || hostOf(view.url)}
                          </span>
                        </span>
                        {view.steps.length > 0 && (
                          <ul className="w-full space-y-0.5 pl-6">
                            {view.steps.map((step, s) => (
                              <li key={s} className="flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground">
                                {step.ok ? (
                                  <Check className="h-3.5 w-3.5 shrink-0 text-success" aria-label="Step worked" />
                                ) : (
                                  <X className="h-3.5 w-3.5 shrink-0 text-destructive" aria-label="Step failed" />
                                )}
                                <span className="shrink-0 font-mono">{step.action}</span>
                                {step.selector && (
                                  <span className="min-w-0 truncate font-mono text-foreground/60">{step.selector}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </button>
                    </li>
                  );
                })}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
