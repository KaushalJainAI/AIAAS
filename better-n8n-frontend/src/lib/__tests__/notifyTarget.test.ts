/**
 * A nudge is for someone who is not looking. These pin the three outcomes:
 * already on the target means silence, elsewhere in the app means an in-app
 * toast only, and nowhere means the OS ping too. The hostile-URL cases matter
 * most: a stored `action_url` that fails validation must never count as
 * "viewing" (which would silently swallow the nudge) nor become a navigation.
 */
// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import {
  decideSurface,
  isViewingTarget,
  peerOnPlatform,
  peerViewingTarget,
  reportPresence,
  safeTarget,
} from '../notifyTarget';

describe('safeTarget', () => {
  it('keeps an in-app path with a query', () => {
    expect(safeTarget('/runs?request=abc')).toBe('/runs?request=abc');
  });

  it('refuses absolute, protocol-relative and scheme URLs', () => {
    expect(safeTarget('https://evil.example/inbox')).toBeNull();
    expect(safeTarget('//evil.example/inbox')).toBeNull();
    expect(safeTarget('javascript:alert(1)')).toBeNull();
    expect(safeTarget('/\\evil.example')).toBeNull();
  });

  it('refuses non-strings and empties', () => {
    expect(safeTarget(undefined)).toBeNull();
    expect(safeTarget(null)).toBeNull();
    expect(safeTarget('')).toBeNull();
    expect(safeTarget(42)).toBeNull();
  });
});

describe('isViewingTarget', () => {
  it('matches the queue top while on the queue', () => {
    expect(isViewingTarget('/runs', '', '/runs')).toBe(true);
  });

  it('matches the same request deep link', () => {
    expect(isViewingTarget('/runs', '?request=abc', '/runs?request=abc')).toBe(true);
  });

  it('does not match a different request on the same page', () => {
    expect(isViewingTarget('/runs', '?request=xyz', '/runs?request=abc')).toBe(false);
  });

  it('does not match the bare queue for a request-specific nudge', () => {
    expect(isViewingTarget('/runs', '', '/runs?request=abc')).toBe(false);
  });

  it('does not match another page', () => {
    expect(isViewingTarget('/agents', '', '/runs?request=abc')).toBe(false);
  });

  it('matches the waiting chat session', () => {
    expect(isViewingTarget('/ai-chat', '?session=s1', '/ai-chat?session=s1')).toBe(true);
    expect(isViewingTarget('/ai-chat', '?session=s2', '/ai-chat?session=s1')).toBe(false);
  });

  it('never treats a hostile URL as viewed', () => {
    expect(isViewingTarget('/runs', '', 'https://evil.example/runs')).toBe(false);
    expect(isViewingTarget('/runs', '', '//evil.example/runs')).toBe(false);
  });
});

describe('decideSurface', () => {
  it('stays silent when looking here or a sibling is', () => {
    expect(
      decideSurface({ selfVisible: true, selfViewing: true, peerViewing: false, peerVisible: false }),
    ).toBe('silent');
    expect(
      decideSurface({ selfVisible: false, selfViewing: false, peerViewing: true, peerVisible: true }),
    ).toBe('silent');
  });

  it('toasts without the OS ping when in the app but elsewhere', () => {
    expect(
      decideSurface({ selfVisible: true, selfViewing: false, peerViewing: false, peerVisible: false }),
    ).toBe('toast');
    expect(
      decideSurface({ selfVisible: false, selfViewing: false, peerViewing: false, peerVisible: true }),
    ).toBe('toast');
  });

  it('goes loud only when nobody is looking', () => {
    expect(
      decideSurface({ selfVisible: false, selfViewing: false, peerViewing: false, peerVisible: false }),
    ).toBe('loud');
  });
});

describe('presence heartbeat', () => {
  beforeEach(() => localStorage.clear());

  it('a visible sibling on the target suppresses this hidden tab', () => {
    reportPresence('/runs', '?request=abc', true);
    expect(peerViewingTarget('/runs?request=abc')).toBe(true);
    expect(peerViewingTarget('/runs?request=other')).toBe(false);
    expect(peerOnPlatform()).toBe(true);
  });

  it('a hidden sibling suppresses nothing', () => {
    reportPresence('/runs', '?request=abc', false);
    expect(peerViewingTarget('/runs?request=abc')).toBe(false);
    expect(peerOnPlatform()).toBe(false);
  });

  it('a stale sighting expires', () => {
    reportPresence('/runs', '', true);
    const expired = Date.now() + 60_000;
    expect(peerViewingTarget('/runs', expired)).toBe(false);
    expect(peerOnPlatform(expired)).toBe(false);
  });
});
