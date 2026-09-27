/**
 * Who can save the open file: the editor registers its `save()` (see
 * `useSave.ts`), and the app bar (save status) and the unsaved-changes
 * dialog (Save / Don't save / Cancel) call it without knowing which editor
 * is mounted.
 *
 * One file is open at a time, so one registration is enough — a newly mounted
 * editor replaces the previous one.
 */
import { useCallback, useMemo, useRef, useState } from 'react';

import { SaveContext, type SaveState } from './useSave';

export function SaveProvider({ children }: { children: React.ReactNode }) {
  const saveRef = useRef<(() => Promise<boolean>) | null>(null);
  const [state, setState] = useState<SaveState>({ dirty: false, saving: false });

  const register = useCallback((save: (() => Promise<boolean>) | null, next: SaveState) => {
    saveRef.current = save;
    setState((prev) => (prev.dirty === next.dirty && prev.saving === next.saving ? prev : next));
  }, []);

  const report = useCallback((next: SaveState) => {
    setState((prev) => (prev.dirty === next.dirty && prev.saving === next.saving ? prev : next));
  }, []);

  const save = useCallback(async () => {
    if (!saveRef.current) return true;
    return saveRef.current();
  }, []);

  const value = useMemo(
    () => ({ ...state, register, report, save }),
    [state, register, report, save],
  );
  return <SaveContext.Provider value={value}>{children}</SaveContext.Provider>;
}
