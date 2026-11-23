// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useCountUp } from '../useCountUp';

/**
 * A hand-cranked clock and frame queue: each `frame(ms)` moves the clock to
 * `ms` and runs the callbacks requested since the last frame, the way the
 * browser would.
 */
let clock = 0;
let queue: Map<number, FrameRequestCallback> = new Map();
let nextId = 1;

function frame(ms: number) {
  clock = ms;
  const pending = [...queue.values()];
  queue = new Map();
  pending.forEach((cb) => cb(ms));
}

function setReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('useCountUp', () => {
  beforeEach(() => {
    clock = 0;
    queue = new Map();
    nextId = 1;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = nextId++;
      queue.set(id, cb);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      queue.delete(id);
    });
    setReducedMotion(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows the first value at once, with nothing to animate', () => {
    const { result } = renderHook(() => useCountUp(1.25));
    expect(result.current).toBe(1.25);
    expect(queue.size).toBe(0);
  });

  it('counts up from the start value to the target over 400 ms', () => {
    const { result } = renderHook(({ v }) => useCountUp(v, { startAt: 0 }), {
      initialProps: { v: 2 },
    });
    expect(result.current).toBe(0);

    act(() => frame(0));
    act(() => frame(200));
    const midway = result.current;
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(2);

    act(() => frame(400));
    expect(result.current).toBe(2);
    expect(queue.size).toBe(0);
  });

  it('animates from the value on screen when the target changes', () => {
    const { result, rerender } = renderHook(({ v }) => useCountUp(v), {
      initialProps: { v: 0 },
    });
    rerender({ v: 10 });
    act(() => frame(0));
    act(() => frame(400));
    expect(result.current).toBe(10);

    rerender({ v: 20 });
    act(() => frame(400));
    act(() => frame(600));
    const midway = result.current;
    expect(midway).toBeGreaterThan(10);
    expect(midway).toBeLessThan(20);
  });

  it('retargets mid-flight without jumping back to the old start', () => {
    const { result, rerender } = renderHook(({ v }) => useCountUp(v, { startAt: 0 }), {
      initialProps: { v: 100 },
    });
    act(() => frame(0));
    act(() => frame(200));
    const beforeRetarget = result.current;

    rerender({ v: 0 });
    act(() => frame(200));
    // The first frame after the retarget starts from where the number was.
    expect(result.current).toBeLessThanOrEqual(beforeRetarget);
    expect(result.current).toBeGreaterThan(0);
  });

  it('jumps straight to the value under reduced motion', () => {
    setReducedMotion(true);
    const { result, rerender } = renderHook(({ v }) => useCountUp(v), {
      initialProps: { v: 1 },
    });
    rerender({ v: 5 });
    expect(result.current).toBe(5);
    expect(queue.size).toBe(0);
  });

  it('cancels the pending frame on unmount', () => {
    const { unmount, rerender } = renderHook(({ v }) => useCountUp(v), {
      initialProps: { v: 0 },
    });
    rerender({ v: 3 });
    expect(queue.size).toBe(1);
    unmount();
    expect(queue.size).toBe(0);
  });
});
