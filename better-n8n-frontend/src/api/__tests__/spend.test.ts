import { describe, expect, it } from 'vitest';
import { monthSpendLabel } from '../spend';

/* The sidebar's spend line. A figure that is missing or not a real number must
 * hide the line rather than print a made-up value. */
describe('monthSpendLabel', () => {
  it('formats the month total in rupees, rounded to the whole rupee', () => {
    expect(monthSpendLabel({ month_rupees: 68 })).toBe('₹68 this month');
    expect(monthSpendLabel({ month_rupees: 68.4 })).toBe('₹68 this month');
    expect(monthSpendLabel({ month_rupees: 112400 })).toBe('₹1,12,400 this month');
  });

  it('shows zero as zero: a month with no spend is a real answer', () => {
    expect(monthSpendLabel({ month_rupees: 0 })).toBe('₹0 this month');
  });

  it('hides the line when the response is empty or malformed', () => {
    expect(monthSpendLabel(undefined)).toBeNull();
    expect(monthSpendLabel(null)).toBeNull();
    expect(monthSpendLabel({})).toBeNull();
    expect(monthSpendLabel({ month_rupees: '68' })).toBeNull();
    expect(monthSpendLabel({ month_rupees: Number.NaN })).toBeNull();
    expect(monthSpendLabel({ month_rupees: -4 })).toBeNull();
    expect(monthSpendLabel('68')).toBeNull();
  });
});
