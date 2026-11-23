import { describe, expect, it } from 'vitest';

import { approvalBorderClass, approvalSelectClass } from '../approvalTone';
import { CHAT_MODES } from '../chatMode';

describe('approval level colours', () => {
  it('plan is neutral, auto is a warning, and full (never asks) is destructive', () => {
    expect(approvalBorderClass('plan')).toBe('border-border');
    expect(approvalBorderClass('auto')).toContain('border-warning');
    expect(approvalBorderClass('full')).toContain('border-destructive');
    expect(approvalSelectClass('full')).toContain('text-destructive');
    expect(approvalSelectClass('auto')).toContain('text-warning');
  });

  it('every level a chat can be in has a border and a select colour', () => {
    for (const mode of CHAT_MODES) {
      expect(approvalBorderClass(mode)).toMatch(/^border-/);
      expect(approvalSelectClass(mode)).toMatch(/border-/);
    }
  });
});
