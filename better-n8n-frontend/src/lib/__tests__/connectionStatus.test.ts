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
});
