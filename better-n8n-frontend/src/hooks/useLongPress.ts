/**
 * A long press with a finger, as a shortcut to something that is also visible.
 *
 * Touch only: a mouse or pen never starts the timer, because a right-click
 * already opens the same menu. A finger that moves more than 10 px has
 * scrolled or dragged, not pressed, so the timer is cancelled. Lifting the
 * finger or a browser cancel also cancels. The callback gets the press point.
 *
 * Long press is never the only way to reach anything: every use must sit
 * beside a visible control (the "More actions" button on phones).
 */
import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/** How far a finger may drift before it counts as a scroll or drag. */
export const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

export interface LongPressHandlers {
  onPointerDown: (e: ReactPointerEvent<Element>) => void;
  onPointerUp: (e: ReactPointerEvent<Element>) => void;
  onPointerCancel: (e: ReactPointerEvent<Element>) => void;
  onPointerMove: (e: ReactPointerEvent<Element>) => void;
}

export function useLongPress(
  onLongPress: (x: number, y: number) => void,
  ms = 500,
): LongPressHandlers {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  // Read the latest callback when the timer fires, without re-creating the handlers.
  const callback = useRef(onLongPress);
  useEffect(() => {
    callback.current = onLongPress;
  }, [onLongPress]);

  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);

  // A row that unmounts mid-press must not fire later.
  useEffect(() => cancel, [cancel]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<Element>) => {
      if (e.pointerType !== 'touch') return;
      cancel();
      const x = e.clientX;
      const y = e.clientY;
      start.current = { x, y };
      timer.current = setTimeout(() => {
        timer.current = null;
        start.current = null;
        callback.current(x, y);
      }, ms);
    },
    [cancel, ms],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<Element>) => {
      const from = start.current;
      if (!from || e.pointerType !== 'touch') return;
      if (Math.hypot(e.clientX - from.x, e.clientY - from.y) > LONG_PRESS_MOVE_TOLERANCE_PX) cancel();
    },
    [cancel],
  );

  return { onPointerDown, onPointerUp: cancel, onPointerCancel: cancel, onPointerMove };
}
