/**
 * Session undo/redo for the editors that own their state as text.
 *
 * Text, spec JSON and sheet grids are all strings by the time they are
 * comparable, so one small stack serves all three: the caller records the
 * state *before* each change and asks for the previous (or next) one back on
 * Ctrl+Z / Ctrl+Y. Rapid typing coalesces — one undo jumps the whole burst —
 * and the stack is capped so a long session cannot grow it without bound.
 * After a reload, versions are the undo; this covers the session.
 */
import { useCallback, useRef, useState } from 'react';

const CAP = 50;
const COALESCE_MS = 800;

export function useHistory() {
  const past = useRef<string[]>([]);
  const future = useRef<string[]>([]);
  const lastPush = useRef(0);
  const [depth, setDepth] = useState({ undo: 0, redo: 0 });

  const sync = useCallback(() => {
    setDepth({ undo: past.current.length, redo: future.current.length });
  }, []);

  /** Record the state a change is about to replace. */
  const record = useCallback(
    (prev: string) => {
      if (past.current[past.current.length - 1] === prev) {
        // Re-setting the same state starts a new redo branch from here.
        if (future.current.length > 0) {
          future.current = [];
          sync();
        }
        return;
      }
      if (Date.now() - lastPush.current < COALESCE_MS && past.current.length > 0) {
        // Inside a burst: keep the earlier state and drop the intermediate,
        // so one undo jumps the whole burst. The redo branch still resets.
        future.current = [];
        sync();
        return;
      }
      past.current.push(prev);
      if (past.current.length > CAP) past.current.shift();
      lastPush.current = Date.now();
      future.current = [];
      sync();
    },
    [sync],
  );

  const undo = useCallback(
    (current: string): string | null => {
      const prev = past.current.pop();
      if (prev === undefined) return null;
      future.current.push(current);
      lastPush.current = 0;
      sync();
      return prev;
    },
    [sync],
  );

  const redo = useCallback(
    (current: string): string | null => {
      const next = future.current.pop();
      if (next === undefined) return null;
      past.current.push(current);
      lastPush.current = Date.now();
      sync();
      return next;
    },
    [sync],
  );

  const reset = useCallback(() => {
    past.current = [];
    future.current = [];
    lastPush.current = 0;
    sync();
  }, [sync]);

  return {
    record,
    undo,
    redo,
    reset,
    canUndo: depth.undo > 0,
    canRedo: depth.redo > 0,
  };
}
