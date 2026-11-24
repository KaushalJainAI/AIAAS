// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { messagingService, type HoldRow } from '@/api/messaging';
import { usePendingSends } from '../usePendingSends';

vi.mock('@/api/messaging', () => ({
  messagingService: {
    listHolds: vi.fn(),
    cancelHold: vi.fn(),
    sendHoldNow: vi.fn(),
  },
}));

const listHolds = vi.mocked(messagingService.listHolds);

const row = (overrides: Partial<HoldRow> = {}): HoldRow => ({
  id: 1,
  tool: 'message_send',
  label: 'Slack #general',
  status: 'held',
  send_at: '2026-11-24T10:02:00Z',
  error: '',
  seconds_left: 120,
  ...overrides,
});

/** Lets the pending promise from a read settle inside fake time. */
const flush = () => act(async () => {
  await vi.advanceTimersByTimeAsync(0);
});

const advance = (ms: number) => act(async () => {
  await vi.advanceTimersByTimeAsync(ms);
});

describe('usePendingSends', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-11-24T10:00:00Z'));
    listHolds.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('makes no request when it has neither a session nor a run', () => {
    renderHook(() => usePendingSends({}));
    expect(listHolds).not.toHaveBeenCalled();
  });

  it('reads once, then stops polling when nothing is pending', async () => {
    listHolds.mockResolvedValue({ holds: [row({ status: 'sent' })], truncated: false });

    renderHook(() => usePendingSends({ sessionId: 's1' }));
    await flush();
    expect(listHolds).toHaveBeenCalledTimes(1);
    expect(listHolds).toHaveBeenCalledWith({ sessionId: 's1', executionId: undefined });

    await advance(20_000);
    expect(listHolds).toHaveBeenCalledTimes(1);
  });

  it('polls every two seconds while a row is held, and stops once none are', async () => {
    listHolds
      .mockResolvedValueOnce({ holds: [row({ status: 'held' })], truncated: false })
      .mockResolvedValueOnce({ holds: [row({ status: 'held' })], truncated: false })
      .mockResolvedValue({ holds: [row({ status: 'sent' })], truncated: false });

    const { result } = renderHook(() => usePendingSends({ executionId: 'run-1' }));
    await flush();
    expect(listHolds).toHaveBeenCalledTimes(1);
    expect(result.current.holds[0]?.status).toBe('held');

    await advance(2000);
    expect(listHolds).toHaveBeenCalledTimes(2);

    await advance(2000);
    expect(listHolds).toHaveBeenCalledTimes(3);
    expect(result.current.holds[0]?.status).toBe('sent');

    await advance(30_000);
    expect(listHolds).toHaveBeenCalledTimes(3);
  });

  it('re-reads when the nudge changes', async () => {
    listHolds.mockResolvedValue({ holds: [], truncated: false });

    const { rerender } = renderHook(
      ({ nudge }) => usePendingSends({ sessionId: 's1', nudge }),
      { initialProps: { nudge: 0 } },
    );
    await flush();
    expect(listHolds).toHaveBeenCalledTimes(1);

    rerender({ nudge: 1 });
    await flush();
    expect(listHolds).toHaveBeenCalledTimes(2);

    // The row is written a moment after the trace frame, so one more read follows.
    await advance(2000);
    expect(listHolds).toHaveBeenCalledTimes(3);
  });

  it('cancels its timers on unmount', async () => {
    listHolds.mockResolvedValue({ holds: [row({ status: 'held' })], truncated: false });

    const { unmount } = renderHook(() => usePendingSends({ sessionId: 's1' }));
    await flush();
    unmount();
    await advance(10_000);
    expect(listHolds).toHaveBeenCalledTimes(1);
  });
});
