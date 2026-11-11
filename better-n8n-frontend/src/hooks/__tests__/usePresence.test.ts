// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { usePresence } from '../usePresence';

function setReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe('usePresence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setReducedMotion(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    // jsdom has no matchMedia; leave it absent for other suites in this file's worker.
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  it('is present and entering while open', () => {
    const { result } = renderHook(({ open }) => usePresence(open, 150), { initialProps: { open: true } });
    expect(result.current).toEqual({ present: true, state: 'enter' });
  });

  it('is absent from the start when opened closed', () => {
    const { result } = renderHook(() => usePresence(false, 150));
    expect(result.current.present).toBe(false);
  });

  it('stays mounted in the exit state for exitMs after closing, then leaves', () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 150), { initialProps: { open: true } });
    rerender({ open: false });
    expect(result.current).toEqual({ present: true, state: 'exit' });

    act(() => { vi.advanceTimersByTime(149); });
    expect(result.current.present).toBe(true);

    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toEqual({ present: false, state: 'exit' });
  });

  it('reopening during the exit returns to enter without unmounting', () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 150), { initialProps: { open: true } });
    rerender({ open: false });
    act(() => { vi.advanceTimersByTime(50); });
    rerender({ open: true });
    expect(result.current).toEqual({ present: true, state: 'enter' });

    // The old exit timer must not remove it later.
    act(() => { vi.advanceTimersByTime(500); });
    expect(result.current).toEqual({ present: true, state: 'enter' });
  });

  it('removes at once when the user prefers reduced motion', () => {
    setReducedMotion(true);
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 150), { initialProps: { open: true } });
    rerender({ open: false });
    expect(result.current.present).toBe(false);
  });
});
