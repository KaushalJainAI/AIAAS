import { afterEach, beforeEach, describe as group, expect, it, vi } from 'vitest';
import { until, when } from '../bits';

const NOW = new Date('2026-10-13T09:00:00Z').getTime();
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

group('when', () => {
  it('has nothing to say about a missing time', () => {
    expect(when(null)).toBe('—');
  });

  it('reads a past time as an age', () => {
    expect(when(at(-20 * SECOND))).toBe('just now');
    expect(when(at(-5 * MINUTE))).toBe('5m ago');
    expect(when(at(-3 * HOUR))).toBe('3h ago');
  });

  it('reads a time still to come as a wait', () => {
    expect(when(at(5 * MINUTE))).toBe('in 5m');
    expect(when(at(3 * HOUR))).toBe('in 3h');
    expect(when(at(48 * HOUR))).toBe('in 2d');
  });

  // The server's clock can be a second ahead of the browser's, so a run that
  // just started arrives with a timestamp slightly in the future.
  it('does not call an event that just happened a future one', () => {
    expect(when(at(500))).toBe('just now');
    expect(when(at(2 * SECOND))).toBe('just now');
    expect(when(at(59 * SECOND))).toBe('just now');
  });
});

group('until', () => {
  it('says a slot under a minute away is close, not past', () => {
    expect(until(at(20 * SECOND))).toBe('in <1m');
  });

  it('agrees with when everywhere else', () => {
    expect(until(null)).toBe('—');
    expect(until(at(5 * MINUTE))).toBe('in 5m');
    expect(until(at(-5 * MINUTE))).toBe('5m ago');
  });
});
