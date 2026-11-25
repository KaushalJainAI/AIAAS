import { describe, expect, it } from 'vitest';
import { hasSetupGuide } from '../setupGuide';
import type { SetupGuide } from '@/api/mcp';

const guide = (over: Partial<SetupGuide> = {}): SetupGuide => ({
  you_need: [],
  admin_needed: null,
  cost: '',
  time: '',
  steps: [{ text: 'Sign in' }],
  limits: [],
  ...over,
});

describe('hasSetupGuide', () => {
  it('is false for the empty object the backend sends for "no guide"', () => {
    expect(hasSetupGuide({})).toBe(false);
  });

  it('is false when the guide has no steps', () => {
    expect(hasSetupGuide(guide({ steps: [] }))).toBe(false);
  });

  it('is false when there is no value at all', () => {
    expect(hasSetupGuide(undefined)).toBe(false);
    expect(hasSetupGuide(null)).toBe(false);
  });

  it('is true for a guide with one step', () => {
    expect(hasSetupGuide(guide())).toBe(true);
  });
});
