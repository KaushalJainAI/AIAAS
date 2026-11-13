import { describe, expect, it } from 'vitest';

import { appReturnUrl, isAppState, orphanConnectReturnUrl } from '../appHandoff';

const APP_STATE = 'app.4f9c1e2a8b7d6e5f4a3b2c1d0e9f8a7b';

describe('isAppState', () => {
  it('accepts a state the app started', () => {
    expect(isAppState(APP_STATE)).toBe(true);
  });

  it('rejects web states and anything that is not the app prefix', () => {
    expect(isAppState(null)).toBe(false);
    expect(isAppState(undefined)).toBe(false);
    expect(isAppState('')).toBe(false);
    // A signed backend state (the connect flow) never carries the prefix.
    expect(isAppState('eyJ1c2VyX2lkIjogMX0:1h8:abc')).toBe(false);
    expect(isAppState('4f9c1e2a8b7d6e5f4a3b2c1d0e9f8a7b')).toBe(false);
    expect(isAppState('web.4f9c1e2a8b7d6e5f4a3b2c1d0e9f8a7b')).toBe(false);
    expect(isAppState('APP.4f9c1e2a8b7d6e5f4a3b2c1d0e9f8a7b')).toBe(false);
  });

  it('rejects a short, overlong or malformed random part', () => {
    expect(isAppState('app.short')).toBe(false);
    expect(isAppState(`app.${'a'.repeat(129)}`)).toBe(false);
    expect(isAppState('app.has spaces in it here')).toBe(false);
    expect(isAppState('app.has/slash/in/it/here/xx')).toBe(false);
  });
});

describe('appReturnUrl', () => {
  it('builds the sign-in return with code and state', () => {
    expect(appReturnUrl('auth', { code: '4/0AbC-def', state: APP_STATE })).toBe(
      `aiaas://auth?code=4%2F0AbC-def&state=${APP_STATE}`,
    );
  });

  it('builds the connect return on the oauth route', () => {
    expect(appReturnUrl('oauth', { code: 'c0de', state: APP_STATE })).toBe(
      `aiaas://oauth?code=c0de&state=${APP_STATE}`,
    );
  });

  it('URL-encodes codes that contain reserved characters', () => {
    const url = appReturnUrl('auth', { code: 'a&b=c d/+e?f#g', state: APP_STATE });
    expect(url).toBe(`aiaas://auth?code=a%26b%3Dc%20d%2F%2Be%3Ff%23g&state=${APP_STATE}`);
    // The app reads the values back with a URL parser; they must round-trip exactly.
    const parsed = new URL(url as string);
    expect(parsed.searchParams.get('code')).toBe('a&b=c d/+e?f#g');
    expect(parsed.searchParams.get('state')).toBe(APP_STATE);
  });

  it('forwards an error with the state so the app can say the sign-in was declined', () => {
    expect(appReturnUrl('auth', { error: 'access_denied', state: APP_STATE })).toBe(
      `aiaas://auth?error=access_denied&state=${APP_STATE}`,
    );
  });

  it('returns null for a web state, so a web user is never sent to the app', () => {
    expect(appReturnUrl('auth', { code: 'c0de', state: 'plain-web-state' })).toBeNull();
    expect(appReturnUrl('oauth', { code: 'c0de', state: null })).toBeNull();
  });

  it('returns null when there is nothing to hand back', () => {
    expect(appReturnUrl('auth', { state: APP_STATE })).toBeNull();
  });

  it('forwards only code, state and error, ignoring any other parameter', () => {
    // The helper takes a typed object, so unknown keys cannot reach the URL at all.
    const params = { code: 'c0de', state: APP_STATE, extra: 'injected' } as unknown as Parameters<
      typeof appReturnUrl
    >[1];
    const url = appReturnUrl('auth', params) as string;
    expect(url).not.toContain('extra');
    expect(new URL(url).searchParams.has('extra')).toBe(false);
  });
});

describe('orphanConnectReturnUrl', () => {
  it('hands a code and the server state to the app', () => {
    expect(orphanConnectReturnUrl({ code: 'c 1', state: 'signed:abc' })).toBe('aiaas://oauth?code=c%201&state=signed%3Aabc');
  });
  it('needs a state and a code or an error', () => {
    expect(orphanConnectReturnUrl({ code: 'c' })).toBeNull();
    expect(orphanConnectReturnUrl({ state: 's' })).toBeNull();
  });
});
