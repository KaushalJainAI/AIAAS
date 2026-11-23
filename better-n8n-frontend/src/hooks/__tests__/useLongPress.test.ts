// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import { useLongPress } from '../useLongPress';

/** Only the fields the hook reads; a real React event has many more. */
function pointer(pointerType: string, clientX: number, clientY: number) {
  return { pointerType, clientX, clientY } as unknown as ReactPointerEvent<Element>;
}

describe('useLongPress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires after 500 ms with the press point, for a touch', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));

    act(() => result.current.onPointerDown(pointer('touch', 120, 340)));
    act(() => vi.advanceTimersByTime(499));
    expect(onLongPress).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onLongPress).toHaveBeenCalledWith(120, 340);
  });

  it('uses the ms argument when one is given', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress, 800));

    act(() => result.current.onPointerDown(pointer('touch', 0, 0)));
    act(() => vi.advanceTimersByTime(500));
    expect(onLongPress).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(300));
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire when the finger moves 20 px', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));

    act(() => result.current.onPointerDown(pointer('touch', 50, 50)));
    act(() => result.current.onPointerMove(pointer('touch', 70, 50)));
    act(() => vi.advanceTimersByTime(1000));
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('keeps the timer for a small wobble under 10 px', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));

    act(() => result.current.onPointerDown(pointer('touch', 50, 50)));
    act(() => result.current.onPointerMove(pointer('touch', 55, 54)));
    act(() => vi.advanceTimersByTime(500));
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire for a mouse', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));

    act(() => result.current.onPointerDown(pointer('mouse', 10, 10)));
    act(() => vi.advanceTimersByTime(1000));
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('does not fire when the finger lifts early', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));

    act(() => result.current.onPointerDown(pointer('touch', 10, 10)));
    act(() => vi.advanceTimersByTime(200));
    act(() => result.current.onPointerUp(pointer('touch', 10, 10)));
    act(() => vi.advanceTimersByTime(1000));
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('does not fire when the browser cancels the pointer', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));

    act(() => result.current.onPointerDown(pointer('touch', 10, 10)));
    act(() => result.current.onPointerCancel(pointer('touch', 10, 10)));
    act(() => vi.advanceTimersByTime(1000));
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('does not fire after unmount', () => {
    const onLongPress = vi.fn();
    const { result, unmount } = renderHook(() => useLongPress(onLongPress));

    act(() => result.current.onPointerDown(pointer('touch', 10, 10)));
    unmount();
    act(() => vi.advanceTimersByTime(1000));
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('a second touch restarts the timer rather than firing twice', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));

    act(() => result.current.onPointerDown(pointer('touch', 10, 10)));
    act(() => vi.advanceTimersByTime(400));
    act(() => result.current.onPointerDown(pointer('touch', 30, 30)));
    act(() => vi.advanceTimersByTime(400));
    expect(onLongPress).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(100));
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onLongPress).toHaveBeenCalledWith(30, 30);
  });
});
