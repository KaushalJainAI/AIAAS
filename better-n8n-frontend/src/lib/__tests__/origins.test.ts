// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { API_ORIGIN, SITE_ORIGIN, oauthCallbackUrl, parseOrigin, siteUrl, socketBaseFor } from '../origins';

describe('parseOrigin', () => {
  it('accepts a bare http(s) origin and drops a trailing slash', () => {
    expect(parseOrigin('https://aiaas.example.com')).toBe('https://aiaas.example.com');
    expect(parseOrigin('https://aiaas.example.com/')).toBe('https://aiaas.example.com');
    expect(parseOrigin('  http://10.0.2.2:8000  ')).toBe('http://10.0.2.2:8000');
  });

  it('treats unset or blank as same origin, never a guess', () => {
    expect(parseOrigin(undefined)).toBeNull();
    expect(parseOrigin('')).toBeNull();
    expect(parseOrigin('   ')).toBeNull();
  });

  it('refuses anything that would be glued into every URL', () => {
    expect(parseOrigin('https://x.com/api')).toBeNull();
    expect(parseOrigin('https://x.com?a=1')).toBeNull();
    expect(parseOrigin('https://user@x.com')).toBeNull();
    expect(parseOrigin('javascript:alert(1)')).toBeNull();
    expect(parseOrigin('x.com')).toBeNull();
  });
});

describe('socketBaseFor', () => {
  it('maps https to wss and http to ws, keeping the port', () => {
    expect(socketBaseFor('https://x.com')).toBe('wss://x.com/ws');
    expect(socketBaseFor('http://10.0.2.2:8000')).toBe('ws://10.0.2.2:8000/ws');
  });
});

describe('the web build', () => {
  // No VITE_PUBLIC_SITE_URL / VITE_API_ORIGIN in the test env, as in the image.
  it('stays on its own origin', () => {
    expect(API_ORIGIN).toBe('');
    expect(SITE_ORIGIN).toBe(window.location.origin);
    expect(siteUrl('/p/abc')).toBe(`${window.location.origin}/p/abc`);
    expect(siteUrl('p/abc')).toBe(`${window.location.origin}/p/abc`);
    expect(oauthCallbackUrl()).toBe(`${window.location.origin}/oauth/callback`);
  });
});
