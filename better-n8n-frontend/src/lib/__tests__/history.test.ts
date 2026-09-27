// @vitest-environment jsdom
import { describe as group, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useHistory } from '../history';

/**
 * Session undo/redo: record-before-change, step back and forward, bursts
 * coalesce, and a new change drops the redo branch.
 */
group('useHistory', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const hook = renderHook(() => useHistory());
    const edit = (prev: string) => {
      act(() => {
        hook.result.current.record(prev);
      });
    };
    return { hook, edit };
  }

  it('undoes back through recorded states and redoes forward', () => {
    const { hook, edit } = setup();
    edit('one');
    vi.advanceTimersByTime(1000);
    edit('one two');
    expect(hook.result.current.canUndo).toBe(true);

    let back: string | null = null;
    act(() => {
      back = hook.result.current.undo('one two three');
    });
    expect(back).toBe('one two');

    act(() => {
      back = hook.result.current.undo('one two');
    });
    expect(back).toBe('one');
    expect(hook.result.current.canUndo).toBe(false);

    let forward: string | null = null;
    act(() => {
      forward = hook.result.current.redo('one');
    });
    expect(forward).toBe('one two');
    expect(hook.result.current.canRedo).toBe(true);
  });

  it('coalesces a burst so one undo jumps it', () => {
    const { hook, edit } = setup();
    edit('a');
    edit('ab');
    edit('abc');
    let back: string | null = null;
    act(() => {
      back = hook.result.current.undo('abcd');
    });
    expect(back).toBe('a');
    expect(hook.result.current.canUndo).toBe(false);
  });

  it('drops the redo branch on a new change', () => {
    const { hook, edit } = setup();
    edit('a');
    vi.advanceTimersByTime(1000);
    edit('ab');
    act(() => {
      hook.result.current.undo('abc');
    });
    expect(hook.result.current.canRedo).toBe(true);
    edit('ab!');
    vi.advanceTimersByTime(1000);
    expect(hook.result.current.canRedo).toBe(false);
  });

  it('returns null when a stack is empty', () => {
    const { hook } = setup();
    let out: string | null = 'unset';
    act(() => {
      out = hook.result.current.undo('x');
    });
    expect(out).toBeNull();
    act(() => {
      out = hook.result.current.redo('x');
    });
    expect(out).toBeNull();
  });

  it('resets both stacks', () => {
    const { hook, edit } = setup();
    edit('a');
    act(() => {
      hook.result.current.reset();
    });
    expect(hook.result.current.canUndo).toBe(false);
    expect(hook.result.current.canRedo).toBe(false);
  });
});
