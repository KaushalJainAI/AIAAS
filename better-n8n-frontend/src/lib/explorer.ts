/**
 * The file browser's rules, decided without rendering: what an item is, how a
 * listing sorts, and what a click does to the selection. Kept out of the page
 * so the Windows-Explorer behaviours people rely on without thinking —
 * folders first, Ctrl-click toggles, Shift-click extends from the anchor —
 * are pinned by tests rather than by whoever last edited the component.
 */
import type { Document, Folder } from '../api/documents';
import { typeName } from './fileDisplay';

/** Where the file browser is standing: a folder (null = Home) or a place that is not one. */
export type Location =
  | { kind: 'folder'; id: number | null }
  | { kind: 'recent' }
  | { kind: 'public' }
  | { kind: 'extraction' }
  | { kind: 'trash' };

export function sameLocation(a: Location, b: Location): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== 'folder' || a.id === (b as { id: number | null }).id;
}

export type Item = { kind: 'folder'; folder: Folder } | { kind: 'doc'; doc: Document };
export type SortKey = 'name' | 'modified' | 'type' | 'size';
export interface Sort {
  key: SortKey;
  dir: 'asc' | 'desc';
}

export const keyOf = (item: Item): string => (item.kind === 'folder' ? `f:${item.folder.id}` : `d:${item.doc.id}`);
export const nameOf = (item: Item): string => (item.kind === 'folder' ? item.folder.name : item.doc.filename);
export const modifiedOf = (item: Item): string => (item.kind === 'folder' ? item.folder.updated_at : item.doc.updated_at);

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Folders always come first, whichever way the files are sorted. */
export function sortItems(items: Item[], sort: Sort): Item[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const compare = (a: Item, b: Item): number => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    let c: number;
    switch (sort.key) {
      case 'modified':
        c = modifiedOf(a).localeCompare(modifiedOf(b));
        break;
      case 'size':
        c = (a.kind === 'doc' ? a.doc.file_size : 0) - (b.kind === 'doc' ? b.doc.file_size : 0);
        break;
      case 'type':
        c = a.kind === 'doc' && b.kind === 'doc' ? collator.compare(typeName(a.doc), typeName(b.doc)) : 0;
        break;
      default:
        c = 0;
    }
    if (c === 0) c = collator.compare(nameOf(a), nameOf(b));
    return c * sign;
  };
  return [...items].sort(compare);
}

/** Clicking a header sorts by it; clicking it again reverses. Dates start newest-first. */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: key === 'modified' || key === 'size' ? 'desc' : 'asc' };
}

export interface Selection {
  keys: Set<string>;
  /** Where a Shift-click extends from. */
  anchor: string | null;
}

export const emptySelection = (): Selection => ({ keys: new Set(), anchor: null });

/** A click on `key` in the ordered list `order`, as a desktop file browser treats it. */
export function clickSelect(
  sel: Selection,
  order: string[],
  key: string,
  { ctrl, shift }: { ctrl: boolean; shift: boolean },
): Selection {
  if (shift && sel.anchor && order.includes(sel.anchor)) {
    const a = order.indexOf(sel.anchor);
    const b = order.indexOf(key);
    const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
    const keys = ctrl ? new Set([...sel.keys, ...range]) : new Set(range);
    return { keys, anchor: sel.anchor };
  }
  if (ctrl) {
    const keys = new Set(sel.keys);
    if (keys.has(key)) keys.delete(key);
    else keys.add(key);
    return { keys, anchor: key };
  }
  return { keys: new Set([key]), anchor: key };
}

/** Arrow-key movement: the next item becomes the selection (Shift extends it). */
export function stepSelect(sel: Selection, order: string[], delta: number, shift: boolean): Selection {
  if (!order.length) return sel;
  const focus = [...sel.keys].pop() ?? null;
  const from = focus && order.includes(focus) ? order.indexOf(focus) : delta > 0 ? -1 : order.length;
  const to = Math.max(0, Math.min(order.length - 1, from + delta));
  const key = order[to];
  if (shift) return clickSelect(sel.anchor ? sel : { ...sel, anchor: key }, order, key, { ctrl: false, shift: true });
  return { keys: new Set([key]), anchor: key };
}

/** The stem of a filename — what rename pre-selects, and what "Copy" names build on. */
export function stemLength(name: string): number {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? dot : name.length;
}
