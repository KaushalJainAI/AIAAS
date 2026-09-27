// @vitest-environment jsdom
import { describe as group, expect, it, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  session: vi.fn(),
  saveSession: vi.fn(),
}));
vi.mock('../../api/recents', () => ({ recentsService: api }));

import { useAppTabs } from '../useAppTabs';

/**
 * Open files as tabs: the active `?file=` is always listed, renames follow,
 * closing drops the tab, and a second app keeps its own list.
 */
group('useAppTabs', () => {
  beforeEach(() => {
    sessionStorage.clear();
    api.session.mockReset().mockResolvedValue({ app: 'docs', tabs: [], active: null, updated_at: null });
    api.saveSession.mockReset().mockResolvedValue({});
  });

  it('starts empty and lists the active file', () => {
    const { result } = renderHook(() => useAppTabs('docs', { id: 7, name: 'a.md' }));
    expect(result.current.tabs).toEqual([{ id: 7, name: 'a.md' }]);
  });

  it('adds newly opened files to the front without duplicates', () => {
    const { result, rerender } = renderHook(
      ({ active }) => useAppTabs('docs', active),
      { initialProps: { active: { id: 7, name: 'a.md' } } },
    );
    rerender({ active: { id: 9, name: 'b.md' } });
    rerender({ active: { id: 7, name: 'a.md' } });
    expect(result.current.tabs.map((t) => t.id)).toEqual([7, 9]);
  });

  it('follows renames without duplicating the tab', () => {
    const { result, rerender } = renderHook(
      ({ active }) => useAppTabs('docs', active),
      { initialProps: { active: { id: 7, name: 'a.md' } } },
    );
    rerender({ active: { id: 7, name: 'renamed.md' } });
    expect(result.current.tabs).toEqual([{ id: 7, name: 'renamed.md' }]);
  });

  it('closes a tab and survives a remount from storage', () => {
    const { result, rerender } = renderHook(
      ({ active }) => useAppTabs('docs', active),
      { initialProps: { active: { id: 7, name: 'a.md' } } },
    );
    rerender({ active: { id: 9, name: 'b.md' } });
    act(() => {
      result.current.close(9);
    });
    expect(result.current.tabs.map((t) => t.id)).toEqual([7]);
    const second = renderHook(() => useAppTabs('docs', null));
    expect(second.result.current.tabs.map((t) => t.id)).toEqual([7]);
  });

  it('keeps one list per app', () => {
    renderHook(() => useAppTabs('docs', { id: 7, name: 'a.md' }));
    const sheets = renderHook(() => useAppTabs('sheets', { id: 3, name: 'b.xlsx' }));
    expect(sheets.result.current.tabs).toEqual([{ id: 3, name: 'b.xlsx' }]);
    expect(JSON.parse(sessionStorage.getItem('app-tabs:docs')!)).toEqual([
      { id: 7, name: 'a.md' },
    ]);
  });

  it('restores saved tabs from the server when this browser tab has none', async () => {
    api.session.mockResolvedValue({
      app: 'docs',
      tabs: [{ id: 4, name: 'kept.md', file_type: 'md' }, { id: 5, name: 'also.md', file_type: 'md' }],
      active: 5,
      updated_at: '2026-09-26T00:00:00Z',
    });
    const { result } = renderHook(() => useAppTabs('docs', null));
    await waitFor(() => expect(result.current.tabs.map((t) => t.id)).toEqual([4, 5]));
    expect(result.current.restoredActive).toBe(5);
    expect(JSON.parse(sessionStorage.getItem('app-tabs:docs')!)).toHaveLength(2);
  });

  it('does not ask the server when this browser tab already has a list', () => {
    sessionStorage.setItem('app-tabs:docs', JSON.stringify([{ id: 1, name: 'x.md' }]));
    const { result } = renderHook(() => useAppTabs('docs', null));
    expect(api.session).not.toHaveBeenCalled();
    expect(result.current.tabs).toEqual([{ id: 1, name: 'x.md' }]);
  });

  it('saves changes to the server, and never an empty list before the restore', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let resolve!: (v: unknown) => void;
      api.session.mockReturnValue(new Promise((r) => { resolve = r; }));
      const { rerender } = renderHook(({ active }) => useAppTabs('docs', active), {
        initialProps: { active: null as { id: number; name: string } | null },
      });
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(api.saveSession).not.toHaveBeenCalled();
      await act(async () => {
        resolve({ app: 'docs', tabs: [], active: null, updated_at: null });
      });
      rerender({ active: { id: 9, name: 'b.md' } });
      await act(async () => {
        vi.advanceTimersByTime(1500);
      });
      expect(api.saveSession).toHaveBeenCalledWith('docs', [9], 9);
    } finally {
      vi.useRealTimers();
    }
  });
});
