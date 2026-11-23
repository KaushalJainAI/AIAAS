import { describe, expect, it } from 'vitest';
import { AUTO_OPEN_MIN_WIDTH, shouldAutoOpen, type AutoOpenInput } from '../autoOpen';

const ok: AutoOpenInput = {
  width: 1440,
  userClosed: false,
  setting: true,
  qualifies: true,
};

describe('shouldAutoOpen', () => {
  it('opens the turn\'s first qualifying item on a desktop when everything allows it', () => {
    expect(shouldAutoOpen(ok)).toBe(true);
  });

  it('never opens below the md breakpoint, and opens exactly at it', () => {
    expect(AUTO_OPEN_MIN_WIDTH).toBe(768);
    expect(shouldAutoOpen({ ...ok, width: 767 })).toBe(false);
    expect(shouldAutoOpen({ ...ok, width: 390 })).toBe(false);
    expect(shouldAutoOpen({ ...ok, width: 768 })).toBe(true);
  });

  it('stays shut once the user has closed the pane during this turn', () => {
    expect(shouldAutoOpen({ ...ok, userClosed: true })).toBe(false);
  });

  it('follows the Chat settings switch', () => {
    expect(shouldAutoOpen({ ...ok, setting: false })).toBe(false);
  });

  it('opens only the first qualifying item of the turn (a created file, or the first browser update)', () => {
    expect(shouldAutoOpen({ ...ok, qualifies: false })).toBe(false);
  });
});
