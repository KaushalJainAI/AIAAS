/**
 * Turn a file path an assistant mentions into a place in the Documents page.
 *
 * The agent file tools (`inference/vfs.py`) speak POSIX-shaped paths over the
 * user's own folders — `/Chat/evals/harness.py` — and the model repeats those
 * paths in its answer. Without this they were inert text: the user was told a
 * file exists and then had to click through the tree to find it.
 *
 * Two decisions worth keeping:
 *
 * **Resolution walks, it never matches.** The API is id-addressed and no route
 * accepts a path as a locator (see `inference/filesystem.py`). So a path is
 * resolved here the way `vfs._folder_at` resolves it on the server: one
 * `foldersService.list(parent)` hop per segment, matching a child by exact
 * name. Every hop is an ownership-checked request, and an unknown segment
 * simply ends the walk — the same guarantee, no new route.
 *
 * **Only the platform's own homes are linked.** `/Chat/` is where chat writes
 * and `/Agents/<name>/` is where agents do, so a path under either is almost
 * certainly a file the tools produced. Linking *every* slash-led code span
 * would turn `/api/users/` or `/etc/hosts` in an ordinary coding answer into a
 * link that leads nowhere, which teaches people to ignore the links that work.
 */

import { documentsService, foldersService, type Document } from '../api/documents';

/** Top-level folders whose paths get linked; see the module note. */
const LINKED_ROOTS = new Set(['Chat', 'Agents']);

/** How many document pages a lookup reads before giving up on one folder. */
const MAX_DOCUMENT_PAGES = 10;

/**
 * Split a path the way `vfs.segments` does: `.` drops, `..` pops (clamped at
 * the root), backslashes are separators. Kept identical so a path resolves in
 * the browser exactly as it resolved for the tool that printed it.
 */
export function segments(path: string): string[] {
  const out: string[] = [];
  for (const raw of path.replace(/\\/g, '/').split('/')) {
    const seg = raw.trim();
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out;
}

/**
 * The path in a code span, if it is one worth linking; otherwise null.
 *
 * Models often double-wrap (`` `/Chat/a.md` ``), which reaches the renderer as
 * a code span whose text still carries backticks, so those are stripped first.
 */
export function linkablePath(text: string): string | null {
  const t = text.trim().replace(/^[`'"]+|[`'"]+$/g, '').trim();
  if (!t.startsWith('/') || t.includes('\n') || t.includes('://')) return null;
  const parts = segments(t);
  if (parts.length < 2 || !LINKED_ROOTS.has(parts[0])) return null;
  return '/' + parts.join('/') + (t.endsWith('/') ? '/' : '');
}

/** The Documents-page URL that opens `path`. */
export function documentsHrefFor(path: string): string {
  return `/documents?path=${encodeURIComponent(path)}`;
}

export interface ResolvedPath {
  /** Deepest folder the walk reached; `null` is the user's root. */
  folderId: number | null;
  /** The file, when the path names one that exists. */
  doc: Document | null;
  /** True when every segment resolved (to a folder, or a final file). */
  found: boolean;
}

async function findDocument(folderId: number | null, name: string): Promise<Document | null> {
  let cursor: string | null = null;
  for (let page = 0; page < MAX_DOCUMENT_PAGES; page++) {
    const res = await documentsService.list({
      scope: 'personal',
      folder_id: folderId ?? 'root',
      limit: 100,
      cursor,
    });
    const hit = res.my_documents.find((d) => d.filename === name);
    if (hit) return hit;
    if (!res.my_has_more || !res.my_next_cursor) return null;
    cursor = res.my_next_cursor;
  }
  return null;
}

/**
 * Walk `path` from the user's root.
 *
 * The last segment is tried as a file first, then as a folder — a path the
 * model printed is far more often a file, and a file and folder sharing a name
 * in one directory is rare enough that preferring the file is the right guess.
 */
export async function resolvePath(path: string): Promise<ResolvedPath> {
  const parts = segments(path);
  let folderId: number | null = null;

  for (let i = 0; i < parts.length; i++) {
    const isLast = i === parts.length - 1;
    if (isLast && !path.endsWith('/')) {
      const doc = await findDocument(folderId, parts[i]);
      if (doc) return { folderId, doc, found: true };
    }
    const page = await foldersService.list(folderId);
    const child = page.folders.find((f) => f.name === parts[i]);
    if (!child) return { folderId, doc: null, found: false };
    folderId = child.id;
  }
  return { folderId, doc: null, found: true };
}
