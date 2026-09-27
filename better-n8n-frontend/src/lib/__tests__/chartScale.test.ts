/**
 * The y axis has to be right about the numbers before it can look right.
 *
 * These are the failures a screenshot is worst at catching: a tick that does
 * not bracket the data (so the top bar is clipped), a label naming a value the
 * chart never reaches, or a flat series collapsing onto a single line. Each one
 * renders as a chart that looks fine and is wrong.
 */
import { describe, expect, it } from 'vitest';

import { formatValue, ticksFor } from '../chartScale';

/** The invariant every case below shares: the axis contains the data. */
function brackets(min: number, max: number): boolean {
  const t = ticksFor(min, max);
  return t[0] <= min && t[t.length - 1] >= max;
}

describe('ticksFor', () => {
  it('brackets the data for ordinary ranges', () => {
    for (const [lo, hi] of [[0, 100], [0, 48210], [12, 19], [0, 3], [0, 7_400_000]]) {
      expect(brackets(lo, hi), `[${lo}, ${hi}]`).toBe(true);
    }
  });

  it('brackets data that crosses zero', () => {
    expect(brackets(-420, 900)).toBe(true);
    const t = ticksFor(-420, 900);
    // Zero has to be an actual tick when the data spans it, because the
    // baseline is where the eye reads sign from.
    expect(t).toContain(0);
  });

  it('gives a flat series a scale with height', () => {
    // Without the pad, min === max makes every mark land on one line and the
    // chart says nothing at all.
    const t = ticksFor(50, 50);
    expect(t.length).toBeGreaterThan(1);
    expect(t[0]).toBeLessThan(50);
    expect(t[t.length - 1]).toBeGreaterThan(50);
  });

  it('handles an all-zero series without collapsing', () => {
    const t = ticksFor(0, 0);
    expect(t.length).toBeGreaterThan(1);
    expect(new Set(t).size).toBe(t.length);
  });

  it('returns round numbers, never raw data values', () => {
    // 48210/5 would be 9642 per step. Nobody reads an axis labelled 9642.
    expect(ticksFor(0, 48210)).toEqual([0, 10000, 20000, 30000, 40000, 50000]);
  });

  it('never returns duplicate or unordered ticks', () => {
    for (const [lo, hi] of [[0, 1], [0, 0.4], [-1, 1], [999, 1001]]) {
      const t = ticksFor(lo, hi);
      expect(new Set(t).size, `[${lo}, ${hi}] had duplicates`).toBe(t.length);
      expect([...t].sort((a, b) => a - b), `[${lo}, ${hi}] out of order`).toEqual(t);
    }
  });

  it('degrades to a usable range rather than throwing on bad input', () => {
    // The backend drops NaN and infinities, but a chart must not blank out if
    // one ever reaches here.
    expect(ticksFor(NaN, 10)).toEqual([0, 1]);
    expect(ticksFor(0, Infinity)).toEqual([0, 1]);
  });
});

describe('formatValue', () => {
  it('compacts large numbers so axis labels do not collide', () => {
    expect(formatValue(7_400_000)).toBe('7.4M');
    expect(formatValue(48_210)).toBe('48.2k');
    expect(formatValue(2_000_000_000)).toBe('2.0B');
  });

  it('leaves small integers alone', () => {
    expect(formatValue(0)).toBe('0');
    expect(formatValue(42)).toBe('42');
    expect(formatValue(-7)).toBe('-7');
  });

  it('keeps two decimals for fractions', () => {
    expect(formatValue(0.5)).toBe('0.50');
    expect(formatValue(3.14159)).toBe('3.14');
  });

  it('compacts negatives by magnitude, not by sign', () => {
    expect(formatValue(-48_210)).toBe('-48.2k');
  });
});
