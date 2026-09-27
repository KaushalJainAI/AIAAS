/**
 * How a file link asks to be previewed in place.
 *
 * A surface that can show a file beside itself (the chat, the runs page) puts
 * a `FilePreviewProvider` around its content. Anything inside — a path link in
 * `MarkdownMessage`, a `FileCard` — calls `useFilePreview()` and gets a
 * function that opens the drawer. Outside a provider it gets null and falls
 * back to navigating to the Documents page, so the same markdown renderer works
 * on every page without knowing which one it is on.
 *
 * Kept apart from the provider component so that file exports only a
 * component, which is what lets fast refresh preserve state across edits.
 */

import { createContext, useContext } from 'react';

/** A file by id (what a tool result carries) or by path (what prose carries). */
export type FileTarget = { documentId: number; path?: string } | { path: string };

export const FilePreviewContext = createContext<((target: FileTarget) => void) | null>(null);

export function useFilePreview(): ((target: FileTarget) => void) | null {
  return useContext(FilePreviewContext);
}
