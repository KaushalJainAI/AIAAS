import { describe, expect, it } from 'vitest';

import type { DocumentSearchHit, DocumentSearchResult } from '../../api/documents';
import { canNarrow, isSearchable, resultSections, searchParamsFor } from '../documentSearch';
import { keyOf } from '../explorer';

const hit = (id: number, filename: string, matched_in: DocumentSearchHit['matched_in'], snippet: string | null = null) =>
  ({ id, filename, matched_in, snippet, updated_at: '2026-09-01T00:00:00Z' }) as DocumentSearchHit;

const result = (over: Partial<DocumentSearchResult> = {}): DocumentSearchResult => ({
  query: 'q',
  exact: [],
  fuzzy: [],
  folders: [],
  count: 0,
  truncated: false,
  note: null,
  ...over,
});

describe('isSearchable', () => {
  it('needs two characters after trimming', () => {
    expect(isSearchable('a')).toBe(false);
    expect(isSearchable(' a ')).toBe(false);
    expect(isSearchable('ab')).toBe(true);
  });
});

describe('searchParamsFor', () => {
  it('narrows to the folder when not searching everywhere', () => {
    expect(searchParamsFor({ kind: 'folder', id: 4 }, false, ' rep ')).toEqual({ q: 'rep', scope: 'personal', folder_id: 4 });
  });

  it('searches the whole library when everywhere is on', () => {
    expect(searchParamsFor({ kind: 'folder', id: 4 }, true, 'rep')).toEqual({ q: 'rep', scope: 'personal' });
  });

  it('treats Home and Recent as the whole library', () => {
    expect(searchParamsFor({ kind: 'folder', id: null }, false, 'rep')).toEqual({ q: 'rep', scope: 'personal' });
    expect(searchParamsFor({ kind: 'recent' }, false, 'rep')).toEqual({ q: 'rep', scope: 'personal' });
  });

  it('searches the public library flat', () => {
    expect(searchParamsFor({ kind: 'public' }, false, 'rep')).toEqual({ q: 'rep', scope: 'public' });
  });

  it('only offers the toggle inside a real folder', () => {
    expect(canNarrow({ kind: 'folder', id: 3 })).toBe(true);
    expect(canNarrow({ kind: 'folder', id: null })).toBe(false);
    expect(canNarrow({ kind: 'recent' })).toBe(false);
  });
});

describe('resultSections', () => {
  it('is empty with no answer yet', () => {
    const s = resultSections(undefined);
    expect(s.exact).toEqual([]);
    expect(s.fuzzy).toEqual([]);
  });

  it('keeps the tiers apart, folders first, relevance order kept', () => {
    const s = resultSections(result({
      exact: [hit(2, 'b.md', 'name'), hit(1, 'a.md', 'content', '…an invoice…')],
      fuzzy: [hit(3, 'Quarterly.xlsx', 'fuzzy')],
      folders: [
        { id: 9, name: 'Reports', parent_id: null, location: '/', updated_at: '', matched_in: 'name' },
        { id: 8, name: 'Reprots', parent_id: 9, location: '/Reports', updated_at: '', matched_in: 'fuzzy' },
      ],
    }));
    expect(s.exact.map(keyOf)).toEqual(['f:9', 'd:2', 'd:1']);
    expect(s.fuzzy.map(keyOf)).toEqual(['f:8', 'd:3']);
  });

  it('carries snippets and folder locations as subtitles', () => {
    const s = resultSections(result({
      exact: [hit(1, 'a.md', 'content', '…an invoice…'), hit(2, 'b.md', 'name')],
      folders: [{ id: 9, name: 'Reports', parent_id: null, location: '/', updated_at: '', matched_in: 'name' }],
    }));
    expect(s.subtitles.get('d:1')).toBe('…an invoice…');
    expect(s.subtitles.has('d:2')).toBe(false);
    expect(s.subtitles.get('f:9')).toBe('in Home');
  });
});
