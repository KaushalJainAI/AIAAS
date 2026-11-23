/**
 * The browser tab's title shows what the chat is doing.
 *
 * While a turn runs the title starts "● "; with a plan it reads "● (2/5) ".
 * When the turn ends while the tab is hidden it starts "✓ " until the tab is
 * seen again, so a finished answer is visible from the tab strip. The
 * original title is restored when the chat unmounts.
 *
 * Title writes go straight to `document.title`; nothing here is state, so a
 * change of progress never re-renders the chat (H-095).
 */
import { useCallback, useEffect, useRef } from 'react';

export interface TitleProgressState {
  running: boolean;
  /** Plan items done so far in the live turn. */
  done: number;
  /** Plan items in the live turn. Zero means there is no plan. */
  total: number;
  /** The turn ended while the tab was hidden and nobody has looked yet. */
  finishedUnseen: boolean;
}

/** The title for a state. Pure, so the rules can be tested without a DOM. */
export function progressTitle(base: string, state: TitleProgressState): string {
  if (state.running) {
    const plan = state.total > 0 ? `(${state.done}/${state.total}) ` : '';
    return `● ${plan}${base}`;
  }
  if (state.finishedUnseen) return `✓ ${base}`;
  return base;
}

interface Input {
  running: boolean;
  done: number;
  total: number;
}

export function useTitleProgress({ running, done, total }: Input): void {
  // The title we found before we started writing, and the last value we wrote.
  // If the page title changes under us, the new one becomes the base.
  const baseRef = useRef<string | null>(null);
  const writtenRef = useRef<string | null>(null);
  const wasRunningRef = useRef(false);
  const unseenRef = useRef(false);
  const latestRef = useRef<Input>({ running, done, total });

  // Reads and writes refs only, so it is stable for the life of the chat.
  const write = useCallback(() => {
    const current = document.title;
    if (baseRef.current === null || current !== writtenRef.current) {
      baseRef.current = current;
    }
    const next = progressTitle(baseRef.current, {
      ...latestRef.current,
      finishedUnseen: unseenRef.current,
    });
    writtenRef.current = next;
    if (document.title !== next) document.title = next;
  }, []);

  useEffect(() => {
    const wasRunning = wasRunningRef.current;
    wasRunningRef.current = running;
    if (running) unseenRef.current = false;
    else if (wasRunning && document.hidden) unseenRef.current = true;

    latestRef.current = { running, done, total };
    write();
  }, [running, done, total, write]);

  useEffect(() => {
    // Seen again: the "finished" mark goes, and the title falls back to the
    // plain progress (or the base) without waiting for the next render.
    const onVisibility = () => {
      if (document.hidden) return;
      unseenRef.current = false;
      write();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (baseRef.current !== null) document.title = baseRef.current;
      baseRef.current = null;
      writtenRef.current = null;
    };
  }, [write]);
}
