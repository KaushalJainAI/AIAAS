import { describe, expect, it } from 'vitest';
import {
  GUEST_STARTERS,
  MEMBER_STARTERS,
  NO_CONNECTION_STARTERS,
  pickStarters,
} from '../starters';

describe('pickStarters', () => {
  it('gives guests their own set, whatever the connection flag says', () => {
    expect(pickStarters(true, false)).toBe(GUEST_STARTERS);
    expect(pickStarters(true, true)).toBe(GUEST_STARTERS);
  });

  it('gives a connected member the set that uses their accounts', () => {
    expect(pickStarters(false, true)).toBe(MEMBER_STARTERS);
  });

  it('gives a member with no connection starters that need none', () => {
    expect(pickStarters(false, false)).toBe(NO_CONNECTION_STARTERS);
  });
});

describe('NO_CONNECTION_STARTERS', () => {
  it('never asks for a connected account in its prompts', () => {
    const service = /gmail|drive|calendar|slack|notion|sheets|email inbox|my inbox/i;
    for (const starter of NO_CONNECTION_STARTERS) {
      expect(starter.prompt, starter.label).not.toMatch(service);
    }
  });

  it('has unique labels', () => {
    const labels = NO_CONNECTION_STARTERS.map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('keeps the four examples from the plan', () => {
    expect(NO_CONNECTION_STARTERS.map((s) => s.label)).toEqual([
      'Summarise a PDF',
      'Plan my week',
      'Draft an email',
      'Make a chart',
    ]);
  });
});
