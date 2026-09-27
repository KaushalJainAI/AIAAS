/**
 * The file browser's server search, decided without rendering: when to ask
 * the server, what to ask it for, and how its answer becomes rows.
 *
 * The answer comes in two tiers (`inference/search.py`): exact matches, and
 * close matches by name. They stay two lists all the way to the screen — a
 * near-miss shown among the hits reads as a hit.
 */
import type { DocumentSearchHit, DocumentSearchResult, Folder, FolderSearchHit } from '../api/documents';
import type { Item, Location } from './explorer';

/** Under this many characters the server answers nothing, so we do not ask. */
export const MIN_SEARCH_CHARS = 2;
export const SEARCH_DEBOUNCE_MS = 250;

export const isSearchable = (q: string): boolean => q.trim().length >= MIN_SEARCH_CHARS;

export interface SearchParams {
  q: string;
  folder_id?: number;
  scope: 'personal' | 'public';
}

/**
 * What to search, given where the user is standing.
 *
 * In a folder: that folder and everything beneath it, or the whole library
 * when `everywhere` is on. Home is the whole library either way — every file
 * is beneath it. Recent searches the whole library; the public library is
 * searched flat.
 */
export function searchParamsFor(loc: Location, everywhere: boolean, q: string): SearchParams {
  const query = q.trim();
  if (loc.kind === 'public') return { q: query, scope: 'public' };
  if (loc.kind === 'folder' && loc.id !== null && !everywhere) {
    return { q: query, scope: 'personal', folder_id: loc.id };
  }
  return { q: query, scope: 'personal' };
}

/** Whether "this folder only" differs from "all files" here — the toggle is pointless otherwise. */
export const canNarrow = (loc: Location): boolean => loc.kind === 'folder' && loc.id !== null;

/** A folder hit as a row. It carries only what a row renders and navigation needs. */
function folderItem(hit: FolderSearchHit): Item {
  const folder: Folder = {
    id: hit.id,
    name: hit.name,
    parent_id: hit.parent_id,
    path: '',
    depth: 0,
    child_count: 0,
    document_count: 0,
    created_at: hit.updated_at,
    updated_at: hit.updated_at,
  };
  return { kind: 'folder', folder };
}

const docItem = (doc: DocumentSearchHit): Item => ({ kind: 'doc', doc });

export interface SearchSections {
  exact: Item[];
  fuzzy: Item[];
  /** Row key → a muted line under the name: a content snippet, or where a folder is. */
  subtitles: Map<string, string>;
}

/** The server's answer as two sections of rows, folders first in each, relevance order kept. */
export function resultSections(result: DocumentSearchResult | undefined): SearchSections {
  const subtitles = new Map<string, string>();
  if (!result) return { exact: [], fuzzy: [], subtitles };
  for (const f of result.folders) {
    subtitles.set(`f:${f.id}`, `in ${f.location === '/' ? 'Home' : f.location}`);
  }
  for (const d of [...result.exact, ...result.fuzzy]) {
    if (d.snippet) subtitles.set(`d:${d.id}`, d.snippet);
  }
  return {
    exact: [
      ...result.folders.filter((f) => f.matched_in === 'name').map(folderItem),
      ...result.exact.map(docItem),
    ],
    fuzzy: [
      ...result.folders.filter((f) => f.matched_in === 'fuzzy').map(folderItem),
      ...result.fuzzy.map(docItem),
    ],
    subtitles,
  };
}
