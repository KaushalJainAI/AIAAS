/**
 * `?next=` is attacker-controllable — it travels in a URL anyone can compose
 * and send — so these are the cases that matter: not "does a good path work"
 * but "is every hostile shape discarded". An open redirect on a sign-in screen
 * is a credential-phishing primitive: the victim really did sign in to the
 * real site, and the site really did send them onward.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_LANDING, nextFrom, safeNext, withNext } from '../nextPath';

describe('safeNext', () => {
  it('keeps an ordinary in-app path', () => {
    expect(safeNext('/templates/my-agent')).toBe('/templates/my-agent');
  });

  it('keeps a path with a query and a hash', () => {
    expect(safeNext('/templates/x?a=1#b')).toBe('/templates/x?a=1#b');
  });

  it('falls back when nothing was asked for', () => {
    expect(safeNext(null)).toBe(DEFAULT_LANDING);
    expect(safeNext(undefined)).toBe(DEFAULT_LANDING);
    expect(safeNext('')).toBe(DEFAULT_LANDING);
  });

  it('refuses an absolute URL to another origin', () => {
    expect(safeNext('https://evil.example/steal')).toBe(DEFAULT_LANDING);
    expect(safeNext('http://evil.example')).toBe(DEFAULT_LANDING);
  });

  it('refuses a protocol-relative URL', () => {
    // Browsers resolve `//evil.example` against the current scheme, so this is
    // an absolute URL wearing a path's clothes.
    expect(safeNext('//evil.example')).toBe(DEFAULT_LANDING);
  });

  it('refuses a backslash-prefixed path', () => {
    // Some browsers normalise `/\evil.example` to `//evil.example`.
    expect(safeNext('/\\evil.example')).toBe(DEFAULT_LANDING);
  });

  it('refuses a scheme that is not a path at all', () => {
    expect(safeNext('javascript:alert(1)')).toBe(DEFAULT_LANDING);
    expect(safeNext('data:text/html,x')).toBe(DEFAULT_LANDING);
  });

  it('refuses a bare relative path, which would resolve unpredictably', () => {
    expect(safeNext('templates/x')).toBe(DEFAULT_LANDING);
  });
});

describe('nextFrom', () => {
  it('reads the parameter out of a query string', () => {
    expect(nextFrom('?next=%2Ftemplates%2Fx')).toBe('/templates/x');
  });

  it('falls back when the parameter is absent or hostile', () => {
    expect(nextFrom('')).toBe(DEFAULT_LANDING);
    expect(nextFrom('?next=https%3A%2F%2Fevil.example')).toBe(DEFAULT_LANDING);
  });
});

describe('withNext', () => {
  it('round-trips through nextFrom', () => {
    const url = withNext('/login', '/templates/my-agent?x=1');
    expect(nextFrom(url.slice(url.indexOf('?')))).toBe('/templates/my-agent?x=1');
  });
});
