import { describe, expect, it } from 'vitest';

import { displayTitle, filterByTitle, groupByDay, UNTITLED_LABEL } from '../historyGroups';

// Local time on purpose: the buckets are the user's calendar days.
const NOW = new Date(2026, 10, 19, 15, 30); // 19 Nov 2026, 15:30 local

const at = (y: number, m: number, d: number, h = 0, min = 0, s = 0, ms = 0) =>
  new Date(y, m, d, h, min, s, ms).toISOString();

const item = (id: string, updated_at: string | null | undefined) => ({ id, updated_at });

describe('groupByDay', () => {
  it('returns no groups for an empty list', () => {
    expect(groupByDay([], NOW)).toEqual([]);
  });

  it('puts a conversation at local midnight today in Today', () => {
    const groups = groupByDay([item('a', at(2026, 10, 19, 0, 0, 0, 0))], NOW);
    expect(groups).toEqual([{ label: 'Today', items: [item('a', at(2026, 10, 19, 0, 0, 0, 0))] }]);
  });

  it('a minute before midnight is Yesterday, and yesterday midnight is Yesterday', () => {
    const before = item('before', at(2026, 10, 18, 23, 59, 59, 999));
    const midnight = item('midnight', at(2026, 10, 18, 0, 0, 0, 0));
    const groups = groupByDay([before, midnight], NOW);
    expect(groups).toEqual([{ label: 'Yesterday', items: [before, midnight] }]);
  });

  it('the day before yesterday starts "Previous 7 days", and the week edge is inclusive', () => {
    const justBeforeYesterday = item('x', at(2026, 10, 17, 23, 59, 59, 999));
    const weekEdge = item('y', at(2026, 10, 12, 0, 0, 0, 0));
    const groups = groupByDay([justBeforeYesterday, weekEdge], NOW);
    expect(groups).toEqual([{ label: 'Previous 7 days', items: [justBeforeYesterday, weekEdge] }]);
  });

  it('a moment before the week edge is Older', () => {
    const older = item('old', at(2026, 10, 11, 23, 59, 59, 999));
    expect(groupByDay([older], NOW)).toEqual([{ label: 'Older', items: [older] }]);
  });

  it('a conversation updated later today (after NOW) is still Today', () => {
    const later = item('later', at(2026, 10, 19, 23, 59));
    expect(groupByDay([later], NOW)).toEqual([{ label: 'Today', items: [later] }]);
  });

  it('keeps the order given inside a bucket and leaves empty buckets out', () => {
    const a = item('a', at(2026, 10, 19, 9));
    const b = item('b', at(2025, 0, 1));
    const c = item('c', at(2026, 10, 19, 8));
    const groups = groupByDay([a, b, c], NOW);
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Older']);
    expect(groups[0].items).toEqual([a, c]);
    expect(groups[1].items).toEqual([b]);
  });

  it('a missing or unreadable date goes to Older, not Today', () => {
    const none = item('none', null);
    const bad = item('bad', 'not a date');
    expect(groupByDay([none, bad], NOW)).toEqual([{ label: 'Older', items: [none, bad] }]);
  });
});

describe('displayTitle', () => {
  it('shows the saved title, trimmed', () => {
    expect(displayTitle({ title: '  Trip plan  ' })).toBe('Trip plan');
  });

  it('falls back to "Untitled conversation" for a missing, empty or blank title', () => {
    expect(displayTitle({ title: undefined })).toBe(UNTITLED_LABEL);
    expect(displayTitle({ title: null })).toBe(UNTITLED_LABEL);
    expect(displayTitle({ title: '   ' })).toBe(UNTITLED_LABEL);
    expect(UNTITLED_LABEL).toBe('Untitled conversation');
  });
});

describe('filterByTitle', () => {
  const rows = [
    { id: '1', title: 'Trip to Goa' },
    { id: '2', title: 'Invoice review' },
    { id: '3', title: null },
  ];

  it('keeps everything for an empty or blank query', () => {
    expect(filterByTitle(rows, '')).toEqual(rows);
    expect(filterByTitle(rows, '   ')).toEqual(rows);
  });

  it('matches case-insensitively on the title', () => {
    expect(filterByTitle(rows, 'GOA').map((r) => r.id)).toEqual(['1']);
  });

  it('searches the fallback title too, so an untitled chat can be found by its label', () => {
    expect(filterByTitle(rows, 'untitled').map((r) => r.id)).toEqual(['3']);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterByTitle(rows, 'zzz')).toEqual([]);
  });
});
