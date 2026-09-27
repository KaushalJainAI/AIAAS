import { describe, expect, it } from 'vitest';

import type { Document, Folder } from '../../api/documents';
import { clickSelect, emptySelection, nextSort, sortItems, stemLength, stepSelect, type Item } from '../explorer';
import { formatDate, locationOf, typeName } from '../fileDisplay';

const folder = (id: number, name: string): Item => ({
  kind: 'folder',
  folder: { id, name, parent_id: null, path: `/${id}/`, depth: 0, child_count: 0, document_count: 0, created_at: '', updated_at: `2026-01-0${id}T00:00:00Z` } as Folder,
});
const doc = (id: number, filename: string, file_type: string, file_size: number, updated_at: string): Item => ({
  kind: 'doc',
  doc: { id, filename, title: filename, file_type, file_size, updated_at } as Document,
});

const items: Item[] = [
  doc(1, 'b.txt', 'txt', 10, '2026-02-01T00:00:00Z'),
  folder(2, 'Zeta'),
  doc(3, 'A10.md', 'md', 300, '2026-03-01T00:00:00Z'),
  doc(4, 'A9.md', 'md', 20, '2026-01-01T00:00:00Z'),
  folder(5, 'alpha'),
];
const names = (list: Item[]) => list.map((i) => (i.kind === 'folder' ? i.folder.name : i.doc.filename));

describe('sorting', () => {
  it('puts folders first and sorts names naturally', () => {
    expect(names(sortItems(items, { key: 'name', dir: 'asc' }))).toEqual(['alpha', 'Zeta', 'A9.md', 'A10.md', 'b.txt']);
  });

  it('keeps folders first when reversed', () => {
    expect(names(sortItems(items, { key: 'name', dir: 'desc' })).slice(0, 2)).toEqual(['Zeta', 'alpha']);
  });

  it('sorts by size and date', () => {
    expect(names(sortItems(items, { key: 'size', dir: 'desc' })).slice(2)).toEqual(['A10.md', 'A9.md', 'b.txt']);
    expect(names(sortItems(items, { key: 'modified', dir: 'desc' })).slice(2)).toEqual(['A10.md', 'b.txt', 'A9.md']);
  });

  it('a new sort key starts in its natural direction', () => {
    expect(nextSort({ key: 'name', dir: 'asc' }, 'modified')).toEqual({ key: 'modified', dir: 'desc' });
    expect(nextSort({ key: 'name', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'desc' });
  });
});

describe('selection', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];

  it('a plain click selects one', () => {
    const s = clickSelect(emptySelection(), order, 'c', { ctrl: false, shift: false });
    expect([...s.keys]).toEqual(['c']);
  });

  it('ctrl toggles, shift extends from the anchor', () => {
    let s = clickSelect(emptySelection(), order, 'b', { ctrl: false, shift: false });
    s = clickSelect(s, order, 'd', { ctrl: true, shift: false });
    expect([...s.keys].sort()).toEqual(['b', 'd']);
    s = clickSelect(s, order, 'b', { ctrl: true, shift: false });
    expect([...s.keys]).toEqual(['d']);
    s = clickSelect({ keys: new Set(['b']), anchor: 'b' }, order, 'e', { ctrl: false, shift: true });
    expect([...s.keys]).toEqual(['b', 'c', 'd', 'e']);
  });

  it('arrows move, shift-arrows extend', () => {
    let s = stepSelect(emptySelection(), order, 1, false);
    expect([...s.keys]).toEqual(['a']);
    s = stepSelect(s, order, 1, true);
    expect([...s.keys]).toEqual(['a', 'b']);
    s = stepSelect({ keys: new Set(['e']), anchor: 'e' }, order, 1, false);
    expect([...s.keys]).toEqual(['e']);
  });
});

describe('display', () => {
  it('names types the way a desktop does', () => {
    expect(typeName({ filename: 'run.py', file_type: 'txt' })).toBe('PY file');
    expect(typeName({ filename: 'deck.pptx', file_type: 'pptx' })).toBe('PowerPoint presentation');
    expect(typeName({ filename: 'a.png', file_type: 'image' })).toBe('PNG image');
  });

  it('the root reads as Home', () => {
    expect(locationOf({ folder_path: '/' })).toBe('Home');
    expect(locationOf({ folder_path: '/Chat/reports' })).toBe('/Chat/reports');
  });

  it('today shows a time, older shows a date', () => {
    const now = new Date('2026-09-24T12:00:00');
    expect(formatDate('2026-09-24T09:30:00', now)).toMatch(/9/);
    expect(formatDate('2025-01-02T09:30:00', now)).toMatch(/2025/);
    expect(formatDate(null, now)).toBe('');
  });

  it('rename selects the stem', () => {
    expect(stemLength('report.final.docx')).toBe('report.final'.length);
    expect(stemLength('.env')).toBe(4);
    expect(stemLength('Makefile')).toBe(8);
  });
});
