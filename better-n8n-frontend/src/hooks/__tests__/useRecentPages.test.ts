// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { RECENT_PAGES_KEY, readRecentPages } from '../../lib/recentPages';
import { VISIT_MS, useRecentPagesTracker } from '../useRecentPages';

function track(pathname: string, search = '', enabled = true) {
  return renderHook(({ p, s, on }) => useRecentPagesTracker(p, s, on), {
    initialProps: { p: pathname, s: search, on: enabled },
  });
}

function mainWith(button = true): HTMLElement {
  const main = document.createElement('main');
  if (button) main.appendChild(document.createElement('button'));
  document.body.appendChild(main);
  return main;
}

describe('useRecentPagesTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    document.body.innerHTML = '';
    document.title = 'AIAAS';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records a page after three seconds on it', () => {
    track('/agents/12');
    act(() => vi.advanceTimersByTime(VISIT_MS - 1));
    expect(readRecentPages()).toEqual([]);
    act(() => vi.advanceTimersByTime(1));
    expect(readRecentPages().map((p) => p.path)).toEqual(['/agents/12']);
  });

  it('uses the tab title with the app name removed', () => {
    document.title = 'Sales digest — AIAAS';
    track('/agents/12');
    act(() => vi.advanceTimersByTime(VISIT_MS));
    expect(readRecentPages()[0].title).toBe('Sales digest');
  });

  it('a route change before three seconds records nothing for the old page', () => {
    const { rerender } = track('/agents/12');
    act(() => vi.advanceTimersByTime(1000));
    rerender({ p: '/runs', s: '', on: true });
    act(() => vi.advanceTimersByTime(VISIT_MS - 1));
    expect(readRecentPages()).toEqual([]);
    act(() => vi.advanceTimersByTime(1));
    expect(readRecentPages().map((p) => p.path)).toEqual(['/runs']);
  });

  it('a keypress inside main records at once', () => {
    track('/agents/12');
    const main = mainWith();
    act(() => {
      main.querySelector('button')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    });
    expect(readRecentPages().map((p) => p.path)).toEqual(['/agents/12']);
  });

  it('a press inside main records at once, before the timer', () => {
    track('/apps');
    const main = mainWith();
    act(() => {
      main.querySelector('button')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(readRecentPages().map((p) => p.path)).toEqual(['/apps']);
  });

  it('a keypress outside main does not count the visit early', () => {
    track('/agents/12');
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    act(() => {
      outside.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    });
    expect(readRecentPages()).toEqual([]);
    act(() => vi.advanceTimersByTime(VISIT_MS));
    expect(readRecentPages()).toHaveLength(1);
  });

  it('a modifier key alone does not count as an action', () => {
    track('/agents/12');
    const main = mainWith();
    act(() => {
      main.querySelector('button')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));
    });
    expect(readRecentPages()).toEqual([]);
  });

  it('counts a visit once, even with more presses after it', () => {
    track('/agents/12');
    const main = mainWith();
    const button = main.querySelector('button')!;
    act(() => {
      button.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      button.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
      vi.advanceTimersByTime(VISIT_MS);
    });
    expect(readRecentPages()).toHaveLength(1);
  });

  it('records nothing for an excluded path, even after three seconds', () => {
    track('/login');
    act(() => vi.advanceTimersByTime(VISIT_MS * 2));
    expect(localStorage.getItem(RECENT_PAGES_KEY)).toBeNull();
  });

  it('records nothing when disabled (guests, signed-out)', () => {
    track('/agents/12', '', false);
    act(() => vi.advanceTimersByTime(VISIT_MS * 2));
    expect(readRecentPages()).toEqual([]);
  });
});
