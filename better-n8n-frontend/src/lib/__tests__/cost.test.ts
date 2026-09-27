import { describe, it, expect } from 'vitest';

import {
  costQualifier, describeConversationCost, describeCost, formatCost, formatCostUsd,
  UNPRICED_LABEL,
} from '../cost';

describe('formatCost', () => {
  it('never renders an unpriced run as a number', () => {
    // The property this module exists for: no price on record is not zero,
    // and printing ₹0.00 there claims a run was free when we do not know.
    expect(formatCost('0', 'unpriced')).toBe(UNPRICED_LABEL);
    expect(formatCost('1.50', 'unpriced')).toBe(UNPRICED_LABEL);
  });

  it('renders a genuinely free run as zero', () => {
    expect(formatCost('0', 'estimated')).toBe('₹0');
  });

  it('keeps sub-paisa amounts visible rather than rounding them away', () => {
    // A cheap turn really does cost a fraction of a paisa. A column of ₹0.00
    // that nonetheless sums to something is worse than small numbers.
    expect(formatCost('0.00005', 'estimated')).toBe('₹0.004');
  });

  it('converts dollars to rupees at the documented rate', () => {
    expect(formatCost('1.00', 'billed')).toBe('₹88.00');
  });

  it('drops decimals once the figure is large enough not to need them', () => {
    expect(formatCost('100', 'estimated')).toBe('₹8,800');
  });

  it('treats a malformed cost as zero rather than NaN', () => {
    expect(formatCost('not-a-number', 'estimated')).toBe('₹0');
    expect(formatCost(null, 'estimated')).toBe('₹0');
    expect(formatCost(undefined, 'billed')).toBe('₹0');
  });
});

describe('formatCostUsd', () => {
  it('shows enough places for a cost that would otherwise read as zero', () => {
    expect(formatCostUsd('0.000031')).toBe('$0.000031');
    expect(formatCostUsd('1.5')).toBe('$1.5000');
  });
});

describe('describeCost', () => {
  it('says a cost is unknown rather than describing a zero', () => {
    expect(describeCost('0', 'unpriced')).toMatch(/unknown, not zero/);
  });

  it('distinguishes what the provider charged from what we estimated', () => {
    expect(describeCost('0.01', 'billed')).toMatch(/^Charged by the provider/);
    expect(describeCost('0.01', 'estimated')).toMatch(/^Estimated/);
  });

  it('breaks the tokens out, calling the cached ones out separately', () => {
    const text = describeCost('0.01', 'estimated', {
      input_tokens: 200,
      output_tokens: 100,
      cached_read_tokens: 800,
      cached_write_tokens: 0,
    });
    expect(text).toContain('200 in + 800 cached');
    expect(text).toContain('100 out');
  });

  it('omits the cache clause when nothing was cached', () => {
    const text = describeCost('0.01', 'estimated', {
      input_tokens: 200,
      output_tokens: 100,
      cached_read_tokens: 0,
      cached_write_tokens: 0,
    });
    expect(text).toContain('200 in ');
    expect(text).not.toContain('cached');
  });
});

describe('costQualifier', () => {
  // A bare `₹1.02` in the chat header read as "you were charged ₹1.02"
  // whatever the figure actually was.
  it('never leaves a priced figure bare', () => {
    expect(costQualifier('billed')).toBe('charged');
    expect(costQualifier('estimated')).toBe('est.');
  });

  it('adds nothing where there is no figure to qualify', () => {
    expect(costQualifier('unpriced')).toBe('');
    expect(costQualifier('')).toBe('');
    expect(costQualifier(undefined)).toBe('');
  });
});

describe('describeConversationCost', () => {
  it('says whose money it is, not only how much', () => {
    const text = describeConversationCost('0.0116', 'billed', 42_000);
    expect(text).toContain('Charged by the provider');
    expect(text).toContain('42,000 tokens');
    expect(text).toContain('credits');
  });
});

describe('describeConversationCost with a known payer', () => {
  it('names the payer instead of explaining both cases', () => {
    const own = describeConversationCost('0.01', 'billed', 10, 'own_key');
    expect(own).toContain('your own API key');
    expect(own).not.toContain('credits');

    const platform = describeConversationCost('0.01', 'estimated', 10, 'platform');
    expect(platform).toContain('charged credits');
  });

  it('a free model says no credits are used', () => {
    expect(describeConversationCost('0', 'billed', 10, 'free')).toContain('no credits');
  });
});
