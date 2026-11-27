// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RECENT_PAGES_CAP,
  RECENT_PAGES_CHANGED_EVENT,
  RECENT_PAGES_KEY,
  labelForPath,
  normalisePath,
  pageTitle,
  readRecentPages,
  record,
  timeAgo,
  writeRecentPages,
  type RecentPage,
} from '../recentPages';

const page = (path: string, at = 1, title = path): RecentPage => ({ path, title, at });

describe('normalisePath', () => {
  it('drops a trailing slash', () => {
    expect(normalisePath('/agents/12/')).toBe('/agents/12');
  });

  it('keeps tab and session, drops every other query parameter', () => {
    expect(normalisePath('/runs', '?tab=history')).toBe('/runs?tab=history');
    expect(normalisePath('/ai-chat', '?session=abc')).toBe('/ai-chat?session=abc');
    expect(normalisePath('/documents', '?q=invoice&sort=name&page=3')).toBe('/documents');
    expect(normalisePath('/ai-chat', '?session=a%20b&scroll=9')).toBe('/ai-chat?session=a%20b');
  });

  it('keeps a tab that is the only thing in the query', () => {
    expect(normalisePath('/settings', '?tab=memory&x=1')).toBe('/settings?tab=memory');
  });

  it('never records sign-in, sign-up, OAuth, public pages or the landing page', () => {
    for (const path of [
      '/',
      '/login',
      '/signup',
      '/forgot-password',
      '/auth/google/callback',
      '/oauth/callback',
      '/terms',
      '/privacy',
      '/a/some-agent',
      '/p/some-page',
    ]) {
      expect(normalisePath(path), path).toBeNull();
    }
  });

  it('matches whole path segments only', () => {
    expect(normalisePath('/apps')).toBe('/apps');
    expect(normalisePath('/loginx')).toBe('/loginx');
    expect(normalisePath('/a')).toBeNull();
  });
});

describe('record', () => {
  it('puts a new place at the front, newest first', () => {
    const list = record([page('/runs', 1)], { path: '/agents/1', title: 'Digest' }, 5);
    expect(list.map((p) => p.path)).toEqual(['/agents/1', '/runs']);
    expect(list[0]).toEqual({ path: '/agents/1', title: 'Digest', at: 5 });
  });

  it('dedupes by path: a visit again moves it to the top with the new title and time', () => {
    const before = [page('/runs', 1), page('/agents/1', 2, 'Old name'), page('/apps', 3)];
    const list = record(before, { path: '/agents/1', title: 'New name' }, 9);
    expect(list.map((p) => p.path)).toEqual(['/agents/1', '/runs', '/apps']);
    expect(list[0]).toEqual({ path: '/agents/1', title: 'New name', at: 9 });
  });

  it('caps the list and drops the oldest entries', () => {
    let list: RecentPage[] = [];
    for (let i = 0; i < RECENT_PAGES_CAP + 5; i++) {
      list = record(list, { path: `/agents/${i}`, title: `A${i}` }, i);
    }
    expect(list).toHaveLength(RECENT_PAGES_CAP);
    expect(list[0].path).toBe(`/agents/${RECENT_PAGES_CAP + 4}`);
    expect(list.at(-1)?.path).toBe('/agents/5');
  });

  it('leaves the list alone for an excluded path', () => {
    const before = [page('/runs', 1)];
    expect(record(before, { path: '/login', title: 'Sign in' }, 2)).toEqual(before);
  });

  it('keeps the query only as normalisePath would', () => {
    const list = record([], { path: '/documents?q=x&tab=files', title: 'Files' }, 1);
    expect(list[0].path).toBe('/documents?tab=files');
  });

  it('falls back to a label from the path when the title is empty', () => {
    const list = record([], { path: '/runs?tab=history', title: '   ' }, 1);
    expect(list[0].title).toBe('Activity · History');
  });

  it('trims a very long title', () => {
    const list = record([], { path: '/apps', title: 'x'.repeat(500) }, 1);
    expect(list[0].title).toHaveLength(120);
  });
});

describe('storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips and fires the changed event on write', () => {
    const heard = vi.fn();
    window.addEventListener(RECENT_PAGES_CHANGED_EVENT, heard);
    const list = [page('/runs', 1, 'Runs')];
    writeRecentPages(list);
    window.removeEventListener(RECENT_PAGES_CHANGED_EVENT, heard);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(readRecentPages()).toEqual(list);
    expect(localStorage.getItem(RECENT_PAGES_KEY)).not.toBeNull();
  });

  it('reads nothing when the key is absent', () => {
    expect(readRecentPages()).toEqual([]);
  });

  it('reads bad JSON as an empty list', () => {
    localStorage.setItem(RECENT_PAGES_KEY, '{not json');
    expect(readRecentPages()).toEqual([]);
  });

  it('reads a value that is not an array as an empty list', () => {
    localStorage.setItem(RECENT_PAGES_KEY, JSON.stringify({ path: '/runs' }));
    expect(readRecentPages()).toEqual([]);
  });

  it('drops entries of the wrong shape and keeps the good ones', () => {
    localStorage.setItem(
      RECENT_PAGES_KEY,
      JSON.stringify([
        { path: '/runs', title: 'Runs', at: 1 },
        { path: 'runs', title: 'No slash', at: 2 },
        { path: '/apps', title: 3, at: 3 },
        { path: '/apps', title: 'Apps' },
        null,
        'text',
      ]),
    );
    expect(readRecentPages()).toEqual([{ path: '/runs', title: 'Runs', at: 1 }]);
  });

  it('caps what it reads', () => {
    const many = Array.from({ length: RECENT_PAGES_CAP + 3 }, (_, i) => page(`/agents/${i}`, i));
    localStorage.setItem(RECENT_PAGES_KEY, JSON.stringify(many));
    expect(readRecentPages()).toHaveLength(RECENT_PAGES_CAP);
  });
});

describe('labels', () => {
  it('names a known hub from the nav', () => {
    expect(labelForPath('/agents/12')).toBe('Agents');
    expect(labelForPath('/documents')).toBe('Library');
    expect(labelForPath('/runs')).toBe('Activity');
  });

  it('adds a hub sub-page tab to the hub label', () => {
    expect(labelForPath('/apps')).toBe('Library · Apps');
    expect(labelForPath('/agents/12/history')).toBe('Agents');
  });

  it('names a tab query from the path when the path is not a nav entry', () => {
    expect(labelForPath('/runs?tab=history')).toBe('Activity · History');
    expect(labelForPath('/settings?tab=memory')).toBe('Settings · Memory');
  });

  it('uses the page title, without the app name or progress marks', () => {
    expect(pageTitle('/ai-chat', 'Sales digest — AIAAS')).toBe('Sales digest');
    expect(pageTitle('/ai-chat', '● (2/5) Chat — AIAAS')).toBe('Chat');
  });

  it('falls back to the path label when the title is only the app name', () => {
    expect(pageTitle('/connections', 'AIAAS')).toBe('Connect');
    expect(pageTitle('/connections', '')).toBe('Connect');
  });
});

describe('timeAgo', () => {
  const now = 10 * 3_600_000;
  it('reads minutes, hours and days', () => {
    expect(timeAgo(now - 20_000, now)).toBe('just now');
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(timeAgo(now - 24 * 3_600_000, now)).toBe('1 day ago');
    expect(timeAgo(now - 3 * 24 * 3_600_000, now)).toBe('3 days ago');
  });

  it('a time in the future reads as just now', () => {
    expect(timeAgo(now + 60_000, now)).toBe('just now');
  });
});
