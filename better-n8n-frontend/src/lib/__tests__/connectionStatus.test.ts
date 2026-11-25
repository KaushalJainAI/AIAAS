import { describe, expect, it } from 'vitest';
import type { Credential, CredentialType } from '@/api/credentials';
import type { MCPServer } from '@/api/mcp';
import { anyConnected, connectionStatus, missingCredentialTypes } from '../connectionStatus';

const server = (over: Partial<MCPServer> = {}): MCPServer =>
  ({
    id: 1,
    name: 'gmail',
    label: 'Gmail',
    is_system: true,
    enabled: true,
    effective_enabled: true,
    required_credential_types: ['google'],
    credential_env_map: {},
    credential_header_map: {},
    ...over,
  }) as MCPServer;

const GOOGLE = { id: 7, slug: 'google' } as CredentialType;
const held = (id: number) => ({ id: id * 10, credential_type: id }) as Credential;
const NONE = { credentials: [] as Credential[], types: [GOOGLE] };
const HELD = { credentials: [held(7)], types: [GOOGLE] };

describe('connectionStatus', () => {
  it('reports the platform switch before anything the user did', () => {
    expect(connectionStatus(server({ enabled: false, coming_soon: true }), HELD)).toBe('coming_soon');
    expect(connectionStatus(server({ enabled: false }), HELD)).toBe('unavailable');
  });

  it('is off when the user turned it off', () => {
    expect(connectionStatus(server({ effective_enabled: false }), HELD)).toBe('off');
  });

  it('falls back to credential rows until the check lands', () => {
    expect(connectionStatus(server(), NONE)).toBe('needs_auth');
    expect(connectionStatus(server(), HELD)).toBe('connected');
    expect(connectionStatus(server({ required_credential_types: [] }), NONE)).toBe('always');
  });

  it('trusts the credential check over the rows once it has run', () => {
    expect(connectionStatus(server(), { ...HELD, validation: new Map([[1, { ok: false }]]) })).toBe('needs_auth');
    expect(connectionStatus(server(), { ...NONE, validation: new Map([[1, { ok: true }]]) })).toBe('connected');
    const free = server({ required_credential_types: [] });
    expect(connectionStatus(free, { ...NONE, validation: new Map([[1, { ok: true }]]) })).toBe('always');
  });

  it('needs the card link as well as the credential for an API card', () => {
    const api = (over: Partial<MCPServer> = {}) => server({ kind: 'api', card_connected: false, ...over });
    // A saved credential alone is not enough: the card's fields are still missing.
    expect(connectionStatus(api(), HELD)).toBe('needs_auth');
    expect(connectionStatus(api({ card_connected: true }), HELD)).toBe('connected');
    // The credential itself still decides first.
    expect(connectionStatus(api({ card_connected: true }), NONE)).toBe('needs_auth');
    expect(connectionStatus(api({ card_connected: true }), { ...HELD, validation: new Map([[1, { ok: false }]]) })).toBe('needs_auth');
    // With no credential at all, the card link is the only thing left to check.
    const free = { kind: 'api', required_credential_types: [], card_connected: false } as Partial<MCPServer>;
    expect(connectionStatus(server(free), NONE)).toBe('needs_auth');
    expect(connectionStatus(server({ ...free, card_connected: true }), NONE)).toBe('always');
  });

  it('keeps the coming-soon and off checks ahead of the card link', () => {
    const soon = server({ kind: 'api', card_connected: false, enabled: false, is_system: true, coming_soon: true });
    expect(connectionStatus(soon, HELD)).toBe('coming_soon');
    expect(connectionStatus(server({ kind: 'api', card_connected: false, effective_enabled: false }), HELD)).toBe('off');
  });

  it('does not read the card link for a connector that is not an API card', () => {
    expect(connectionStatus(server({ kind: 'mcp', card_connected: false }), HELD)).toBe('connected');
    expect(connectionStatus(server({ kind: 'native', card_connected: false }), HELD)).toBe('connected');
  });

  it('lists every missing credential, not just the first', () => {
    const SLACK = { id: 8, slug: 'slack' } as CredentialType;
    const both = server({ required_credential_types: ['google', 'slack'] });
    expect(missingCredentialTypes(both, { credentials: [held(7)], types: [GOOGLE, SLACK] })).toEqual([SLACK]);
  });
});

describe('anyConnected', () => {
  it('counts only connections the user made', () => {
    expect(anyConnected([], HELD)).toBe(false);
    expect(anyConnected([server({ required_credential_types: [] })], NONE)).toBe(false);
    expect(anyConnected([server({ id: 2, required_credential_types: [] }), server()], HELD)).toBe(true);
  });

  it('does not count an API card whose link is missing', () => {
    expect(anyConnected([server({ kind: 'api', card_connected: false })], HELD)).toBe(false);
    expect(anyConnected([server({ kind: 'api', card_connected: true })], HELD)).toBe(true);
  });
});
