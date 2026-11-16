import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMITS, PRESETS, RANGES, clamp, describeDuration, isDefault,
  limitsFromProfile, presetFor, toPayload, tokensForRupees,
} from '../orchestratorLimits';

describe('orchestrator limits', () => {
  it('fills every field from defaults for an account that never set them', () => {
    expect(limitsFromProfile(undefined)).toEqual(DEFAULT_LIMITS);
    expect(limitsFromProfile({})).toEqual(DEFAULT_LIMITS);
  });

  it('keeps 0 as a real spend cap (no cap), not the default', () => {
    expect(limitsFromProfile({ chat_spend_cap_rupees: 0 }).spendCapRupees).toBe(0);
  });

  it('round-trips through the API payload', () => {
    const limits = { maxSteps: 100, timeLimitSeconds: 7200, spendCapRupees: 1500, summariseLongTurns: true };
    const payload = toPayload(limits);
    expect(limitsFromProfile(payload)).toEqual(limits);
  });

  it('clamps into the server ranges', () => {
    expect(clamp(500, RANGES.steps.min, RANGES.steps.max, 36)).toBe(200);
    expect(clamp(1, RANGES.steps.min, RANGES.steps.max, 36)).toBe(3);
    expect(clamp(Number.NaN, 1, 10, 7)).toBe(7);
  });

  it('recognises a preset and the default', () => {
    expect(presetFor({ ...DEFAULT_LIMITS })).toBe('standard');
    expect(isDefault({ ...DEFAULT_LIMITS })).toBe(true);
    const long = PRESETS.find((p) => p.id === 'long')!;
    expect(presetFor({ maxSteps: long.steps, timeLimitSeconds: long.minutes * 60,
      spendCapRupees: long.rupees, summariseLongTurns: false })).toBe('long');
    expect(presetFor({ ...DEFAULT_LIMITS, maxSteps: 37 })).toBeNull();
  });

  it('says what a cap and a duration mean in plain words', () => {
    expect(tokensForRupees(500)).toBe('about 5.9 million tokens');
    expect(tokensForRupees(0)).toBe('no limit');
    expect(describeDuration(1800)).toBe('30 minutes');
    expect(describeDuration(5400)).toBe('1 hour 30 minutes');
    expect(describeDuration(7200)).toBe('2 hours');
  });

  it('presets stay inside the ranges the server accepts', () => {
    for (const p of PRESETS) {
      expect(p.steps).toBeGreaterThanOrEqual(RANGES.steps.min);
      expect(p.steps).toBeLessThanOrEqual(RANGES.steps.max);
      expect(p.minutes).toBeLessThanOrEqual(RANGES.minutes.max);
    }
  });
});
