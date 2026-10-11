/**
 * Continue with ChatGPT, inside the model picker.
 *
 * Shown while the ChatGPT plan provider is selected. Signed out, it is the
 * one button that signs in; signed in, it says whose plan is paying and links
 * to where that usage is managed. The wording is OpenAI's own ("Continue with
 * ChatGPT", "Using ChatGPT plan", "Manage usage").
 *
 * The sign-in runs in a popup that OpenAI sends to the *backend* (a loopback
 * address), so this window is never handed a code or a token. It finds out by
 * asking `status` every couple of seconds while the popup is open — polling,
 * not `postMessage`, because the popup ends on another origin.
 *
 * Its own component for the reason `EffortPicker` is: the timer here must not
 * re-render the chat transcript.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import chatgptPlanService, { type ChatGPTPlanStatus } from '../../api/chatgptPlan';
import {
  planErrorMessage, planView, SIGN_IN_POLL_MS, SIGN_IN_WAIT_MS,
} from '../../lib/chatgptPlan';

interface Props {
  /** Called when the sign-in state changes, so the model list is re-read. */
  onChanged: () => void;
}

export function ChatGPTPlanPanel({ onChanged }: Props) {
  const [status, setStatus] = useState<ChatGPTPlanStatus | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [justConnected, setJustConnected] = useState(false);
  const [signInUrl, setSignInUrl] = useState('');
  const timer = useRef<number | null>(null);
  const alive = useRef(true);

  const stopWaiting = useCallback(() => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
    setWaiting(false);
  }, []);

  useEffect(() => {
    alive.current = true;
    chatgptPlanService.status()
      .then((next) => { if (alive.current) setStatus(next); })
      // No answer means nothing to draw; the provider simply stays empty.
      .catch(() => undefined);
    return () => {
      alive.current = false;
      if (timer.current !== null) window.clearInterval(timer.current);
    };
  }, []);

  const connect = useCallback(async () => {
    let url: string;
    try {
      url = await chatgptPlanService.start();
    } catch (error) {
      toast.error(planErrorMessage(error));
      return;
    }
    // A blocked popup is not a failure: the link below does the same thing.
    const popup = window.open(url, 'chatgpt-sign-in', 'width=520,height=720');
    setSignInUrl(popup ? '' : url);
    setWaiting(true);

    const startedAt = Date.now();
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = window.setInterval(async () => {
      if (!alive.current || Date.now() - startedAt > SIGN_IN_WAIT_MS) {
        stopWaiting();
        return;
      }
      try {
        const next = await chatgptPlanService.status();
        if (!alive.current) return;
        if (next.connected) {
          setStatus(next);
          setJustConnected(true);
          stopWaiting();
          onChanged();
        }
      } catch {
        // One failed poll is not the end of the sign-in.
      }
    }, SIGN_IN_POLL_MS);
  }, [onChanged, stopWaiting]);

  const signOut = useCallback(async () => {
    try {
      await chatgptPlanService.disconnect();
      const next = await chatgptPlanService.status();
      if (!alive.current) return;
      setStatus(next);
      setJustConnected(false);
      onChanged();
    } catch {
      toast.error('Could not sign out of ChatGPT. Try again.');
    }
  }, [onChanged]);

  const view = planView(status, waiting);
  if (view === 'hidden' || !status) return null;

  if (view === 'connected') {
    return (
      <div className="px-3 pb-2 space-y-1.5">
        {justConnected && (
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
            <p className="text-[12px] font-semibold text-foreground">
              You're using your ChatGPT plan
            </p>
            <p className="text-[11px] text-muted-foreground">
              Eligible usage in this app uses your ChatGPT plan. Pick a model above.
            </p>
          </div>
        )}
        <div className="flex items-center justify-between gap-2 px-1 text-[11px]">
          <span className="min-w-0 truncate text-muted-foreground">
            Using ChatGPT plan{status.email ? ` · ${status.email}` : ''}
          </span>
          <span className="flex shrink-0 items-center gap-3">
            <a
              href={status.manage_usage_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              Manage usage <ExternalLink size={11} />
            </a>
            <button
              type="button"
              onClick={signOut}
              className="text-muted-foreground hover:text-foreground hover:underline"
            >
              Sign out
            </button>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 pb-2 space-y-1.5">
      <button
        type="button"
        onClick={connect}
        disabled={view === 'waiting'}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-foreground px-3 py-2 text-[12px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {view === 'waiting' && <Loader2 size={13} className="animate-spin" />}
        {view === 'waiting' ? 'Finish signing in in the other window…' : 'Continue with ChatGPT'}
      </button>
      <p className="px-1 text-[10px] text-muted-foreground">
        {view === 'reconnect'
          ? 'Your ChatGPT sign-in has ended. Sign in again to keep using your plan.'
          : 'Use the usage included in your own ChatGPT plan. Nothing is billed here.'}
      </p>
      {view === 'waiting' && signInUrl && (
        <a
          href={signInUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block px-1 text-[11px] font-medium text-primary hover:underline"
        >
          The sign-in window was blocked. Open it here.
        </a>
      )}
    </div>
  );
}
