/**
 * Animates a number from what is on screen to a new value.
 *
 * Used for money (a reply's cost, a conversation's cost), so a figure that
 * grows after a turn visibly grows instead of jumping. It runs for 400 ms
 * with `requestAnimationFrame`, and under `prefers-reduced-motion` it jumps
 * straight to the new value.
 *
 * It is a hook, not a component, so the caller decides how far a re-render
 * reaches. Put it in a small leaf component: each frame re-renders only that
 * leaf, never the transcript above it (H-095).
 *
 * The first value is shown at once, so a figure that is already there when the
 * page loads does not count up from zero. Pass `startAt` to count up from a
 * value on the first render (a message that has just arrived uses 0).
 */
import { useEffect, useRef, useState } from 'react';

export const COUNT_UP_MS = 400;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Fast start, soft landing: the number moves most where the eye is looking. */
function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

export function useCountUp(
  target: number,
  options: { durationMs?: number; startAt?: number } = {},
): number {
  const { durationMs = COUNT_UP_MS, startAt } = options;
  const [shown, setShown] = useState(() => startAt ?? target);
  // The value on screen right now, so a new target starts from where the
  // number actually is, even when it changes again mid-animation.
  const shownRef = useRef(shown);

  useEffect(() => {
    const from = shownRef.current;
    if (from === target) return;
    if (prefersReducedMotion()) {
      shownRef.current = target;
      return;
    }

    const start = performance.now();
    let frame = 0;
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / durationMs);
      const value = t >= 1 ? target : from + (target - from) * easeOutCubic(t);
      shownRef.current = value;
      setShown(value);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);

  // Under reduced motion the effect above only records the value, so answer
  // with the target itself rather than waiting for a state update.
  return prefersReducedMotion() ? target : shown;
}
