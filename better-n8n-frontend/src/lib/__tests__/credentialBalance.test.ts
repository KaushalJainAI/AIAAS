import { describe, expect, it } from 'vitest';

import type { CredentialBalance } from '../../api/credentials';
import { formatBalanceLine, formatDollars } from '../credentialBalance';

const limited = (over: Partial<Extract<CredentialBalance, { available: true }>> = {}): CredentialBalance => ({
  available: true,
  usage: 0.47,
  limit: 10,
  limit_remaining: 9.53,
  usage_daily: 0.01,
  usage_monthly: 0.47,
  is_free_tier: false,
  account_credits_remaining: null,
  ...over,
});

describe('formatDollars', () => {
  it('shows two decimals and thousands separators', () => {
    expect(formatDollars(9.53)).toBe('$9.53');
    expect(formatDollars(0)).toBe('$0.00');
    expect(formatDollars(1234.5)).toBe('$1,234.50');
  });

  it('reads a tiny positive amount as under a cent, not as zero', () => {
    expect(formatDollars(0.004)).toBe('<$0.01');
    expect(formatDollars(0.01)).toBe('$0.01');
  });

  it('never shows a negative amount (an overspent key reads as nothing left)', () => {
    expect(formatDollars(-2)).toBe('$0.00');
  });
});

describe('formatBalanceLine', () => {
  it('says what is left of the limit, and today\'s spend', () => {
    expect(formatBalanceLine(limited())).toBe('$9.53 left of $10.00 · $0.01 today');
  });

  it('leaves out today when OpenRouter did not report it', () => {
    expect(formatBalanceLine(limited({ usage_daily: null }))).toBe('$9.53 left of $10.00');
  });

  it('works out what is left from the limit when remaining is missing', () => {
    expect(formatBalanceLine(limited({ limit_remaining: null, usage: 4 }))).toBe(
      '$6.00 left of $10.00 · $0.01 today',
    );
  });

  it('says what has been used when the key has no limit', () => {
    expect(
      formatBalanceLine(
        limited({ limit: null, limit_remaining: null, usage: 4.78, usage_daily: null }),
      ),
    ).toBe('$4.78 used · no limit');
  });

  it('keeps today on an unlimited key too', () => {
    expect(formatBalanceLine(limited({ limit: null, limit_remaining: null, usage: 4.78 }))).toBe(
      '$4.78 used · no limit · $0.01 today',
    );
  });

  it('reads a key with neither a limit nor a usage figure plainly', () => {
    expect(
      formatBalanceLine(limited({ limit: null, limit_remaining: null, usage: null, usage_daily: null })),
    ).toBe('No spending limit');
  });

  it('shows the reason a check failed, as the backend gave it', () => {
    expect(formatBalanceLine({ available: false, reason: 'OpenRouter rejected this key.' })).toBe(
      'OpenRouter rejected this key.',
    );
  });
});
