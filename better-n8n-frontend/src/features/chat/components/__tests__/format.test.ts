import { describe, expect, it } from 'vitest';

import { badgeInitials, formatElapsed, formatSteps } from '../format';

describe('formatElapsed', () => {
  it('reads seconds, then minutes', () => {
    expect(formatElapsed(4200)).toBe('4s');
    expect(formatElapsed(72000)).toBe('1m 12s');
  });

  it('is empty when the server sent no figure', () => {
    expect(formatElapsed(undefined)).toBe('');
    expect(formatElapsed(null)).toBe('');
    expect(formatElapsed(-5)).toBe('');
  });
});

describe('badgeInitials', () => {
  it('takes two letters from the name', () => {
    expect(badgeInitials('Lead Domain')).toBe('LD');
    expect(badgeInitials('reviewer')).toBe('RE');
  });

  it('falls back when there is no name', () => {
    expect(badgeInitials(null)).toBe('AG');
  });
});

describe('formatSteps', () => {
  it('uses the singular for one step', () => {
    expect(formatSteps(1)).toBe('1 step');
    expect(formatSteps(3)).toBe('3 steps');
  });
});
