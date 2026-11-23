// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { progressTitle, useTitleProgress } from '../useTitleProgress';

/** `document.hidden` is read-only in jsdom; this moves the tab between hidden and seen. */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

const idle = { running: false, done: 0, total: 0, finishedUnseen: false };

describe('progressTitle', () => {
  it('leaves the base title alone when nothing is happening', () => {
    expect(progressTitle('Chat', idle)).toBe('Chat');
  });

  it('marks a running turn with a dot', () => {
    expect(progressTitle('Chat', { ...idle, running: true })).toBe('● Chat');
  });

  it('adds the plan count while a plan exists', () => {
    expect(progressTitle('Chat', { ...idle, running: true, done: 2, total: 5 }))
      .toBe('● (2/5) Chat');
  });

  it('shows the finished mark only when the turn ended unseen', () => {
    expect(progressTitle('Chat', { ...idle, finishedUnseen: true })).toBe('✓ Chat');
  });
});

describe('useTitleProgress', () => {
  const BASE = 'Chat — AIAAS';

  beforeEach(() => {
    document.title = BASE;
    setHidden(false);
  });

  afterEach(() => {
    setHidden(false);
    document.title = '';
  });

  it('shows progress while running and restores the title on unmount', () => {
    const { rerender, unmount } = renderHook(
      (p: { running: boolean; done: number; total: number }) => useTitleProgress(p),
      { initialProps: { running: true, done: 1, total: 4 } },
    );
    expect(document.title).toBe('● (1/4) Chat — AIAAS');

    rerender({ running: true, done: 2, total: 4 });
    expect(document.title).toBe('● (2/4) Chat — AIAAS');

    unmount();
    expect(document.title).toBe(BASE);
  });

  it('marks a turn that ended while the tab was hidden, until it is seen', () => {
    const { rerender } = renderHook(
      (p: { running: boolean }) => useTitleProgress({ ...p, done: 0, total: 0 }),
      { initialProps: { running: true } },
    );

    act(() => setHidden(true));
    rerender({ running: false });
    expect(document.title).toBe('✓ Chat — AIAAS');

    act(() => setHidden(false));
    expect(document.title).toBe(BASE);
  });

  it('does not mark a turn that ended while the tab was visible', () => {
    const { rerender } = renderHook(
      (p: { running: boolean }) => useTitleProgress({ ...p, done: 0, total: 0 }),
      { initialProps: { running: true } },
    );
    rerender({ running: false });
    expect(document.title).toBe(BASE);
  });
});
