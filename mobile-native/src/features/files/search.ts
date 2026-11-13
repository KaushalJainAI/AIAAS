/**
 * Turns the server's search answer into two lists of rows: exact matches, and
 * close matches. The two stay apart, because a near-miss shown among the hits
 * reads as a hit. Mirrors `better-n8n-frontend/src/lib/documentSearch.ts`.
 */
import type { Document, DocumentSearchResult, Folder, FolderSearchHit } from './types';
import type { Entry } from './sort';

export interface SearchSections {
  exact: Entry[];
  fuzzy: Entry[];
  /** Entry key -> a muted line under the name: a content snippet, or where a folder is. */
  subtitles: Map<string, string>;
}

function folderEntry(hit: FolderSearchHit): Entry {
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

function fileEntry(doc: Document): Entry {
  return { kind: 'file', doc };
}

export function searchSections(result: DocumentSearchResult | undefined): SearchSections {
  const subtitles = new Map<string, string>();
  if (!result) return { exact: [], fuzzy: [], subtitles };
  for (const f of result.folders) {
    subtitles.set(`folder:${f.id}`, `in ${f.location === '/' ? 'Home' : f.location}`);
  }
  for (const d of [...result.exact, ...result.fuzzy]) {
    if (d.snippet) subtitles.set(`file:${d.id}`, d.snippet);
  }
  return {
    exact: [
      ...result.folders.filter((f) => f.matched_in === 'name').map(folderEntry),
      ...result.exact.map(fileEntry),
    ],
    fuzzy: [
      ...result.folders.filter((f) => f.matched_in === 'fuzzy').map(folderEntry),
      ...result.fuzzy.map(fileEntry),
    ],
    subtitles,
  };
}
