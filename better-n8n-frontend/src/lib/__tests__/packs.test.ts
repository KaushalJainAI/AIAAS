import { describe, expect, it } from 'vitest';
import { isUnavailable, packAvailability } from '../packs';

describe('isUnavailable', () => {
  it('reads an absent flag as available (older servers predate it)', () => {
    expect(isUnavailable({})).toBe(false);
  });

  it('reads an explicit false as unavailable', () => {
    expect(isUnavailable({ available: false })).toBe(true);
    expect(isUnavailable({ available: true })).toBe(false);
  });
});

describe('packAvailability', () => {
  const ok = { slug: 'analyst', available: true };
  const blocked = (slug: string, reason: string) => ({
    slug,
    available: false,
    unavailable_reason: reason,
  });

  it('is available when nothing is blocked', () => {
    expect(packAvailability([ok, { slug: 'slides', available: true }])).toEqual({
      available: true,
      reasons: [],
    });
  });

  it('stays available when only some members are blocked', () => {
    /* The web pack without its browser scout: mostly installable, so the
       pack button stays live and the scout is skipped with its reason. */
    const result = packAvailability([
      ok,
      blocked('browser-scout', 'Requires browser: no browser configured.'),
    ]);
    expect(result.available).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('is unavailable when every member is blocked, with distinct reasons', () => {
    const reason = 'Requires shell: no workspace engine configured.';
    const result = packAvailability([
      blocked('repo-assistant', reason),
      blocked('coding-lead', reason),
      { slug: 'legacy', available: false },
    ]);
    expect(result.available).toBe(false);
    expect(result.reasons).toEqual([reason, 'legacy cannot run on this server.']);
  });

  it('an empty pack is available', () => {
    expect(packAvailability([])).toEqual({ available: true, reasons: [] });
  });
});
