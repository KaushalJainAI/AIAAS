import { describe, expect, it } from 'vitest';

import { PENDING_OAUTH_TTL_MS, decodePending, encodePending, type PendingOAuth } from '../oauthFlow';

const NOW = 1_800_000_000_000;

const google: PendingOAuth = {
  kind: 'google',
  mode: 'redirect',
  returnTo: '/connections?open=gmail',
  label: 'Gmail',
  startedAt: NOW - 1000,
};

describe('decodePending', () => {
  it('round-trips a Google flow and an MCP flow', () => {
    expect(decodePending(encodePending(google), NOW)).toEqual(google);
    const mcp: PendingOAuth = { ...google, kind: 'mcp', serverId: 7, mode: 'popup' };
    expect(decodePending(encodePending(mcp), NOW)).toEqual(mcp);
  });

  it('ignores a missing, malformed or stale record', () => {
    expect(decodePending(null, NOW)).toBeNull();
    expect(decodePending('not json', NOW)).toBeNull();
    expect(decodePending('"a string"', NOW)).toBeNull();
    const stale = { ...google, startedAt: NOW - PENDING_OAUTH_TTL_MS - 1 };
    expect(decodePending(encodePending(stale), NOW)).toBeNull();
    const future = { ...google, startedAt: NOW + 60_000 };
    expect(decodePending(encodePending(future), NOW)).toBeNull();
  });

  it('refuses a record that names no valid exchange', () => {
    expect(decodePending(JSON.stringify({ ...google, kind: 'other' }), NOW)).toBeNull();
    expect(decodePending(JSON.stringify({ ...google, kind: 'mcp' }), NOW)).toBeNull();
    expect(decodePending(JSON.stringify({ ...google, kind: 'mcp', serverId: '7' }), NOW)).toBeNull();
    expect(decodePending(JSON.stringify({ ...google, kind: 'mcp', serverId: -1 }), NOW)).toBeNull();
    expect(decodePending(JSON.stringify({ ...google, mode: 'window' }), NOW)).toBeNull();
  });

  it('never returns to another site', () => {
    for (const returnTo of ['https://evil.example', '//evil.example', '/\\evil.example', 42]) {
      const decoded = decodePending(JSON.stringify({ ...google, returnTo }), NOW);
      expect(decoded?.returnTo).toBe('/ai-chat');
    }
  });

  it('falls back to a plain label', () => {
    expect(decodePending(JSON.stringify({ ...google, label: '' }), NOW)?.label).toBe('Account');
  });
});
