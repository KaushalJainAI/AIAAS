import { describe, expect, it } from 'vitest';
import { nextChatMode, toChatMode } from '../chatMode';

describe('chatMode', () => {
  it('cycles Ask → Auto → Plan → Ask', () => {
    expect(nextChatMode('ask')).toBe('auto');
    expect(nextChatMode('auto')).toBe('plan');
    expect(nextChatMode('plan')).toBe('ask');
  });

  it('normalises unknown values to ask, never to a looser mode', () => {
    expect(toChatMode(undefined)).toBe('ask');
    expect(toChatMode('')).toBe('ask');
    expect(toChatMode('full')).toBe('ask');
    expect(toChatMode('AUTO')).toBe('auto');
    expect(toChatMode('plan')).toBe('plan');
  });
});
