/**
 * The hand-off card: the agent stopped at a page and needs the person (a code,
 * a login, a CAPTCHA). Shown in the Browser tab and under the answer in the chat.
 *
 * It only draws and calls back. "Open the live page" calls `window.open`
 * directly in the click handler: a popup opened after an `await` is blocked on
 * phones, and the live page is never framed (we do not control that site).
 */
import { ExternalLink, Hand } from 'lucide-react';

import { cn } from '@/lib/utils';

interface Props {
  /** The page's host, in the sentence and on the button's label. */
  host: string;
  /** What the page needs, as the tool reported it. */
  what: string;
  /** A live view that is safe to open, or null when the provider gave none. */
  liveUrl: string | null;
  /** "I'm done". Absent where there is no chat to send to (the runs page): no button. */
  onDone?: () => void;
  className?: string;
}

const button =
  'inline-flex h-11 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-medium md:h-9';

export default function NeedsUserCard({ host, what, liveUrl, onDone, className }: Props) {
  return (
    <div
      role="group"
      aria-label="The assistant needs you"
      className={cn('rounded-md border border-warning/40 bg-warning-subtle p-3 text-[13px]', className)}
    >
      <p className="flex items-start gap-2 font-medium text-foreground">
        <Hand className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
        <span className="min-w-0 break-words">
          The assistant needs you on <span className="font-semibold">{host}</span>: {what}
        </span>
      </p>

      {liveUrl ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => window.open(liveUrl, '_blank', 'noopener')}
            className={cn(button, 'border border-primary-line bg-card text-primary hover:bg-primary-subtle')}
          >
            <ExternalLink className="h-4 w-4" aria-hidden />
            Open the live page
          </button>
          {onDone && (
            <button
              type="button"
              onClick={onDone}
              className={cn(button, 'bg-primary text-primary-foreground hover:opacity-90')}
            >
              I'm done
            </button>
          )}
        </div>
      ) : (
        <>
          <p className="mt-2 text-muted-foreground">
            There is no live page for this session. Type the code into the chat instead.
          </p>
          {onDone && (
            <div className="mt-3">
              <button
                type="button"
                onClick={onDone}
                className={cn(button, 'bg-primary text-primary-foreground hover:opacity-90')}
              >
                I'm done
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
