/**
 * Insights colors are a promise: emerald passed, red failed, amber waits.
 * These pin the two lies the old page told — a failed day drawn in the
 * success color, and every rate printed in the same gray — so neither can
 * come back as a "cleanup" that unifies the palette.
 */
import { describe, expect, it } from 'vitest';
import {
  dayFailed,
  dayRate,
  parseCost,
  rateBand,
  rateTextClass,
  statusBarClass,
} from '../insights';

describe('rateBand', () => {
  it('bands, never gradients', () => {
    expect(rateBand(100)).toBe('good');
    expect(rateBand(95)).toBe('good');
    expect(rateBand(94.9)).toBe('warn');
    expect(rateBand(80)).toBe('warn');
    expect(rateBand(79.9)).toBe('bad');
    expect(rateBand(0)).toBe('bad');
  });

  it('unknown rates warn rather than accuse', () => {
    expect(rateBand(null)).toBe('warn');
    expect(rateBand(undefined)).toBe('warn');
    expect(rateBand(NaN)).toBe('warn');
  });

  it('paints the number, not the furniture', () => {
    expect(rateTextClass(99)).toContain('emerald');
    expect(rateTextClass(85)).toContain('amber');
    expect(rateTextClass(41)).toContain('red');
  });
});

describe('dayFailed / dayRate', () => {
  it('failed is everything not completed', () => {
    expect(dayFailed({ count: 10, success: 7 })).toBe(3);
    expect(dayFailed({ count: 0, success: 0 })).toBe(0);
  });

  it('an empty day is a gap, not a zero', () => {
    expect(dayRate({ count: 0, success: 0 })).toBeNull();
    expect(dayRate({ count: 4, success: 3 })).toBe(75);
  });
});

describe('parseCost', () => {
  it('reads decimal strings and survives garbage', () => {
    expect(parseCost('1.234567')).toBeCloseTo(1.234567);
    expect(parseCost('0.000000')).toBe(0);
    expect(parseCost(null)).toBe(0);
    expect(parseCost('n/a')).toBe(0);
  });
});

describe('statusBarClass', () => {
  it('completed is the only green', () => {
    expect(statusBarClass('completed')).toContain('emerald');
    expect(statusBarClass('failed')).toContain('red');
    expect(statusBarClass('paused')).toContain('amber');
  });

  it('unknown statuses stay muted, never green', () => {
    expect(statusBarClass('mystery')).toContain('muted');
    expect(statusBarClass('mystery')).not.toContain('emerald');
  });
});
