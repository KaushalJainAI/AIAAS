// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { claimAccountData, forgetAccountData } from '../accountData';

const TRANSCRIPT = 'aiaas_ui:chat.transcript.abc';
const LAST = 'aiaas_ui:chat.lastSessionId';
const DRAFT = 'aiaas_ui:chat.draft:auth:abc';
const GUEST_DRAFT = 'aiaas_ui:chat.draft:guest:new';
const PREF = 'aiaas_ui:chat.autoOpenPane';
const PANE = 'pane:abc';

function seed() {
  localStorage.setItem(TRANSCRIPT, '{"messages":[]}');
  localStorage.setItem(LAST, '"abc"');
  localStorage.setItem(DRAFT, '"half a sentence"');
  localStorage.setItem(GUEST_DRAFT, '"guest text"');
  localStorage.setItem(PREF, 'true');
  sessionStorage.setItem(PANE, '{}');
}

describe('accountData', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('sign-out forgets the transcript, the last conversation, drafts and pane tabs', () => {
    seed();
    forgetAccountData();
    expect(localStorage.getItem(TRANSCRIPT)).toBeNull();
    expect(localStorage.getItem(LAST)).toBeNull();
    expect(localStorage.getItem(DRAFT)).toBeNull();
    expect(sessionStorage.getItem(PANE)).toBeNull();
  });

  it('keeps preferences and guest drafts', () => {
    seed();
    forgetAccountData();
    expect(localStorage.getItem(PREF)).toBe('true');
    expect(localStorage.getItem(GUEST_DRAFT)).toBe('"guest text"');
  });

  it('a different account signing in finds nothing of the previous one', () => {
    claimAccountData(1);
    seed();
    claimAccountData(2);
    expect(localStorage.getItem(TRANSCRIPT)).toBeNull();
    expect(localStorage.getItem(LAST)).toBeNull();
    expect(sessionStorage.getItem(PANE)).toBeNull();
  });

  it('the same account signing in again keeps its own data', () => {
    claimAccountData(1);
    seed();
    claimAccountData(1);
    expect(localStorage.getItem(TRANSCRIPT)).not.toBeNull();
    expect(localStorage.getItem(LAST)).toBe('"abc"');
  });

  it('data written before ownership was recorded is treated as someone else\'s', () => {
    seed();
    claimAccountData(1);
    expect(localStorage.getItem(TRANSCRIPT)).toBeNull();
  });
});
