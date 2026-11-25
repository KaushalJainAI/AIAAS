import { describe, expect, it } from 'vitest';

import type { RevertResult } from '@/api/changes';
import { summariseRevert } from '../changeSummary';

const result = (over: Partial<RevertResult>): RevertResult => ({
  status: 'reverted',
  outcomes: [],
  reverted: 0,
  skipped: 0,
  failed: 0,
  not_revertible: 0,
  already_reverted: 0,
  ...over,
});

describe('summariseRevert', () => {
  it('names only the counts that are not zero', () => {
    expect(summariseRevert(result({ reverted: 6 }))).toBe('6 undone');
    expect(summariseRevert(result({ reverted: 6, skipped: 1 }))).toBe('6 undone, 1 skipped');
    expect(summariseRevert(result({ reverted: 2, skipped: 1, failed: 1 }))).toBe(
      '2 undone, 1 skipped, 1 failed',
    );
  });
});
