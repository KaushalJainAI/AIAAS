/**
 * Keeps an expandable panel mounted long enough to animate closed.
 *
 * `open && <Panel/>` gives an element no chance to play an exit animation:
 * React drops the subtree on the same frame the flag flips, so every panel in
 * the chat opened smoothly and then vanished. This holds the subtree for the
 * length of the exit and releases it after — a closed panel still costs
 * nothing, which matters because the ones being wrapped hold whole tool traces
 * and code-execution logs.
 *
 * Motion on the way *in* stays with the panel itself, which already carries its
 * own `animate-in` classes; this wrapper is transparent while open and only
 * takes over for the close.
 */
import { useEffect, useState, type ReactNode } from 'react';

/** Matches the `duration-150` on the exit classes below — keep them in step. */
const EXIT_MS = 150;

interface CollapsiblePanelProps {
  open: boolean;
  children: ReactNode;
}

export function CollapsiblePanel({ open, children }: CollapsiblePanelProps) {
  // The close is detected by comparing against the previous prop during render
  // rather than in an effect, so the exit frame is never preceded by a frame
  // that already dropped the content.
  const [closing, setClosing] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);

  if (open !== wasOpen) {
    setWasOpen(open);
    setClosing(wasOpen);
  }

  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(() => setClosing(false), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [closing]);

  // A panel that was never opened mounts nothing and schedules no timer.
  if (!open && !closing) return null;

  return (
    <div
      className={
        open
          ? undefined
          : 'animate-out fade-out slide-out-to-top-2 duration-150 ease-in fill-mode-forwards'
      }
    >
      {children}
    </div>
  );
}
