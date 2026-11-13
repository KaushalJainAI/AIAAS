/**
 * Listing order for the file browser. Mirrors `better-n8n-frontend/src/lib/explorer.ts`:
 * folders always come first, whichever way the files are sorted.
 */
import { typeName } from './display';
import type { Document, Folder } from './types';

export type Entry = { kind: 'folder'; folder: Folder } | { kind: 'file'; doc: Document };
export type SortKey = 'name' | 'modified' | 'size' | 'type';
export interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

export const DEFAULT_SORT: SortState = { key: 'name', dir: 'asc' };

/** The web's wording for each sort. */
export const SORT_LABEL: Record<SortKey, string> = {
  name: 'Name',
  modified: 'Date modified',
  size: 'Size',
  type: 'Type',
};

export function entryKey(entry: Entry): string {
  return entry.kind === 'folder' ? `folder:${entry.folder.id}` : `file:${entry.doc.id}`;
}

export function entryName(entry: Entry): string {
  return entry.kind === 'folder' ? entry.folder.name : entry.doc.filename;
}

function entryModified(entry: Entry): string {
  return entry.kind === 'folder' ? entry.folder.updated_at : entry.doc.updated_at;
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export function sortEntries(entries: Entry[], sort: SortState): Entry[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    let c = 0;
    switch (sort.key) {
      case 'modified':
        c = entryModified(a).localeCompare(entryModified(b));
        break;
      case 'size':
        c = (a.kind === 'file' ? a.doc.file_size : 0) - (b.kind === 'file' ? b.doc.file_size : 0);
        break;
      case 'type':
        if (a.kind === 'file' && b.kind === 'file') c = compareText(typeName(a.doc), typeName(b.doc));
        break;
      default:
        break;
    }
    if (c === 0) c = compareText(entryName(a), entryName(b));
    return c * sign;
  });
}

/** Picking a sort key sorts by it; picking the same key again reverses it. Dates and sizes start newest or largest first. */
export function nextSort(current: SortState, key: SortKey): SortState {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: key === 'modified' || key === 'size' ? 'desc' : 'asc' };
}
