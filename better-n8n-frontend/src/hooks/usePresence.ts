/**
 * Keeps an element mounted while it animates out.
 *
 * React removes a component the moment its parent stops rendering it, so a
 * dialog or row that is taken away cannot play an exit on its own. This hook
 * answers "should this still be on screen?": it stays `present` for `exitMs`
 * after `open` turns false, and `state` says which way to animate.
 *
 * Under `prefers-reduced-motion` the exit time is 0. The element leaves on the
 * same render, so nothing waits on a motion the user asked not to see.
 */
import { useEffect, useState } from 'react';

export type PresenceState = 'enter' | 'exit';

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function usePresence(
  open: boolean,
  exitMs: number,
): { present: boolean; state: PresenceState } {
  // "Store the previous prop in state" rather than an effect: a reopen must be
  // in the DOM on the same render, not one commit later.
  const [prevOpen, setPrevOpen] = useState(open);
  const [gone, setGone] = useState(!open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setGone(false);
  }

  const ms = prefersReducedMotion() ? 0 : exitMs;

  useEffect(() => {
    if (open || gone) return;
    const timer = window.setTimeout(() => setGone(true), ms);
    return () => window.clearTimeout(timer);
  }, [open, gone, ms]);

  // With no exit time the element is gone at once, without waiting for the timer.
  const present = open || (!gone && ms > 0);
  return { present, state: open ? 'enter' : 'exit' };
}
