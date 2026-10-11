import { describe, expect, it } from 'vitest';
import { nextChatMode, toChatMode } from '../chatMode';

describe('chatMode', () => {
  it('cycles Ask → Auto → Plan → Ask', () => {
    expect(nextChatMode('ask')).toBe('auto');
    expect(nextChatMode('auto')).toBe('plan');
    expect(nextChatMode('plan')).toBe('ask');
    // Full auto is picked on purpose, never reached by cycling.
    expect(nextChatMode('full')).toBe('ask');
    expect((['ask', 'auto', 'plan'] as const).map(nextChatMode)).not.toContain('full');
  });

  it('normalises unknown values to ask, never to a looser mode', () => {
    expect(toChatMode(undefined)).toBe('ask');
    expect(toChatMode('')).toBe('ask');
    expect(toChatMode('full')).toBe('full');
    expect(toChatMode('yolo')).toBe('ask');
    expect(toChatMode('AUTO')).toBe('auto');
    expect(toChatMode('plan')).toBe('plan');
  });
});
