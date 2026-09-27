/**
 * Hooks over `SaveContext`: reading the save state, and registering an
 * editor's `save()`.
 *
 * Kept in its own file (rather than beside `SaveProvider`) so the module
 * exports hooks only — mixing components and hooks breaks fast refresh.
 */
import { createContext, useCallback, useContext, useEffect, useRef } from 'react';

export interface SaveState {
  dirty: boolean;
  saving: boolean;
}

export interface SaveContextValue extends SaveState {
  register: (save: (() => Promise<boolean>) | null, state: SaveState) => void;
  report: (state: SaveState) => void;
  save: () => Promise<boolean>;
}

export const SaveContext = createContext<SaveContextValue>({
  dirty: false,
  saving: false,
  register: () => {},
  report: () => {},
  save: async () => true,
});

export function useSave() {
  return useContext(SaveContext);
}

/**
 * An editor's registration: its `save()` plus its live dirty/saving state.
 *
 * Pass `null` when there is nothing to save (a read-only file) — the state
 * is still reported so the bar never shows a stale dot. Unmounting clears
 * the registration, so a closed editor cannot be saved by mistake.
 *
 * The function identity is deliberately *not* a dependency: the latest `save`
 * is always called through a ref, so an editor re-rendering for any reason
 * does not re-register.
 */
export function useRegisterSave(
  save: (() => Promise<boolean>) | null,
  dirty: boolean,
  saving: boolean,
) {
  const { register, report } = useSave();
  const ref = useRef(save);
  useEffect(() => {
    ref.current = save;
  });
  const stable = useCallback(() => ref.current!(), []);
  const hasSave = save !== null;

  useEffect(() => {
    if (hasSave) register(stable, { dirty, saving });
    else report({ dirty, saving });
  }, [register, report, stable, hasSave, dirty, saving]);

  useEffect(() => () => register(null, { dirty: false, saving: false }), [register]);
}
