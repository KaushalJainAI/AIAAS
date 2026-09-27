/**
 * The Imagine context object and the hooks that read it.
 *
 * Split from `ImagineContext.tsx` so that file exports the provider alone — a
 * module exporting both a component and plain functions opts out of fast
 * refresh, so editing the provider would remount it and lose track of
 * generations already in flight. Same reasoning as BrowserOS's `osState.ts`.
 */
import { createContext, useContext } from 'react';

import type { Generation } from '../api/imagine';

export interface ImagineContextValue {
  active: Generation[];
  activeCount: number;
  isGenerating: boolean;
  refresh: () => Promise<void>;
}

export const ImagineContext = createContext<ImagineContextValue | undefined>(undefined);

export function useImagine(): ImagineContextValue {
  const ctx = useContext(ImagineContext);
  if (!ctx) throw new Error('useImagine must be used within ImagineProvider');
  return ctx;
}

/** For call sites that render with or without the provider above them. */
export function useImagineOptional(): ImagineContextValue | null {
  return useContext(ImagineContext) ?? null;
}
