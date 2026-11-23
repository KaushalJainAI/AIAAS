import { describe, expect, it } from 'vitest';
import type { Credential, CredentialType } from '@/api/credentials';
import type { MCPServer } from '@/api/mcp';
import { hasConnectedAccount, hasLiveAgent, setupFinished, setupSteps } from '../setupSteps';

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

const type = (id: number, slug: string): CredentialType => ({ id, slug }) as CredentialType;
const cred = (credential_type: number): Credential => ({ id: credential_type * 10, credential_type }) as Credential;

const GOOGLE = type(7, 'google');
const NOTHING_HELD = { credentials: [] as Credential[], types: [GOOGLE] };

describe('setupSteps', () => {
  it('lists the three steps in order with their links', () => {
    const steps = setupSteps({ hasConversation: false, hasConnection: false, hasAgent: false });
    expect(steps.map((s) => s.id)).toEqual(['ask', 'connect', 'agent']);
    expect(steps[0].to).toBeUndefined();
    expect(steps[1].to).toBe('/connections');
    expect(steps[2].to).toBe('/templates');
  });

  it('marks each step done from its own fact only', () => {
    const steps = setupSteps({ hasConversation: true, hasConnection: false, hasAgent: true });
    expect(steps.map((s) => s.done)).toEqual([true, false, true]);
  });
});

describe('setupFinished', () => {
  it('is true only when every step is done', () => {
    expect(setupFinished(setupSteps({ hasConversation: true, hasConnection: true, hasAgent: true }))).toBe(true);
    expect(setupFinished(setupSteps({ hasConversation: true, hasConnection: true, hasAgent: false }))).toBe(false);
  });
});

describe('hasLiveAgent', () => {
  it('is false for an empty list', () => {
    expect(hasLiveAgent([])).toBe(false);
  });
  it('ignores archived agents', () => {
    expect(hasLiveAgent([{ status: 'archived' }])).toBe(false);
    expect(hasLiveAgent([{ status: 'archived' }, { status: 'active' }])).toBe(true);
  });
});

describe('hasConnectedAccount', () => {
  it('is false with no servers', () => {
    expect(hasConnectedAccount({ servers: [], ...NOTHING_HELD })).toBe(false);
  });

  it('is true when the needed credential is held and no check has run', () => {
    expect(hasConnectedAccount({ servers: [server()], credentials: [cred(7)], types: [GOOGLE] })).toBe(true);
  });

  it('is false when the needed credential is missing', () => {
    expect(hasConnectedAccount({ servers: [server()], ...NOTHING_HELD })).toBe(false);
  });

  it('does not count a connector that needs no account', () => {
    const free = server({ required_credential_types: [], credential_env_map: {}, credential_header_map: {} });
    expect(hasConnectedAccount({ servers: [free], credentials: [], types: [] })).toBe(false);
  });

  it('does not count a server switched off for this person', () => {
    const off = server({ effective_enabled: false });
    expect(hasConnectedAccount({ servers: [off], credentials: [cred(7)], types: [GOOGLE] })).toBe(false);
  });

  it('does not count a platform connector that is switched off', () => {
    const platformOff = server({ is_system: true, enabled: false });
    expect(hasConnectedAccount({ servers: [platformOff], credentials: [cred(7)], types: [GOOGLE] })).toBe(false);
  });

  it('trusts the Connections check over the row when it has run', () => {
    const s = server();
    const held = { servers: [s], credentials: [cred(7)], types: [GOOGLE] };
    expect(hasConnectedAccount({ ...held, validation: new Map([[s.id, { ok: false }]]) })).toBe(false);
    expect(hasConnectedAccount({ ...held, validation: new Map([[s.id, { ok: true }]]) })).toBe(true);
  });

  it('does not count a passing check on a connector that needs no credentials', () => {
    const free = server({ required_credential_types: [] });
    expect(hasConnectedAccount({ servers: [free], credentials: [], types: [], validation: new Map([[1, { ok: true }]]) })).toBe(false);
  });

  it('requires every required credential, not just the first', () => {
    const both = server({ required_credential_types: ['google', 'slack'] });
    const types = [GOOGLE, type(8, 'slack')];
    expect(hasConnectedAccount({ servers: [both], credentials: [cred(7)], types })).toBe(false);
    expect(hasConnectedAccount({ servers: [both], credentials: [cred(7), cred(8)], types })).toBe(true);
  });
});
