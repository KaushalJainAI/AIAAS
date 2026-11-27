// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_AGENT, type AgentConfig } from '../../types/agentConfig';
import {
  BUILDER_VIEW_KEY,
  changedAdvancedFields,
  isEssentialField,
  readBuilderView,
  writeBuilderView,
} from '../agentAdvanced';

const withChanges = (changes: Partial<AgentConfig>): AgentConfig => ({
  ...DEFAULT_AGENT,
  ...changes,
});

describe('changedAdvancedFields', () => {
  it('reports nothing when no hidden field differs from the defaults', () => {
    expect(changedAdvancedFields(DEFAULT_AGENT, DEFAULT_AGENT)).toEqual([]);
  });

  it('reports a hidden field that was changed', () => {
    expect(changedAdvancedFields(withChanges({ temperature: 0.9 }), DEFAULT_AGENT))
      .toEqual(['temperature']);
  });

  it('ignores essential fields, however they differ', () => {
    expect(changedAdvancedFields(
      withChanges({ name: 'Finance', brief: 'Chases invoices', autonomy: 'auto' }),
      DEFAULT_AGENT,
    )).toEqual([]);
  });

  it('ignores fields no view shows (schedules live elsewhere)', () => {
    expect(changedAdvancedFields(
      withChanges({ schedule: '0 9 * * *', scheduleTimezone: 'Asia/Kolkata' }),
      DEFAULT_AGENT,
    )).toEqual([]);
  });

  it('compares object and array values by content, not identity', () => {
    const same = changedAdvancedFields(
      withChanges({ toolPermissions: { write_file: 'ask' } }),
      withChanges({ toolPermissions: { write_file: 'ask' } }),
    );
    expect(same).toEqual([]);
    expect(changedAdvancedFields(
      withChanges({ toolPermissions: { write_file: 'deny' } }),
      DEFAULT_AGENT,
    )).toEqual(['toolPermissions']);
    expect(changedAdvancedFields(
      withChanges({ tags: ['finance'] }),
      DEFAULT_AGENT,
    )).toEqual(['tags']);
  });

  it('lists every changed hidden field once', () => {
    const changed = changedAdvancedFields(
      withChanges({ effort: 'high', maxIterations: 80, status: 'active' }),
      DEFAULT_AGENT,
    );
    expect([...changed].sort()).toEqual(['effort', 'maxIterations', 'status']);
  });
});

describe('isEssentialField', () => {
  it('knows the five essentials and nothing else', () => {
    expect(isEssentialField('name')).toBe(true);
    expect(isEssentialField('autonomy')).toBe(true);
    expect(isEssentialField('spendCapRupees')).toBe(true);
    // Essentials draws the Skills picker; without this the builder's default
    // view had no way to attach a skill.
    expect(isEssentialField('skills')).toBe(true);
    expect(isEssentialField('temperature')).toBe(false);
    expect(isEssentialField('effort')).toBe(false);
  });
});

describe('builder view preference', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to Essentials when nothing is stored', () => {
    expect(readBuilderView()).toBe('essentials');
  });

  it('remembers All settings across reads', () => {
    writeBuilderView('all');
    expect(window.localStorage.getItem(BUILDER_VIEW_KEY)).toBe('all');
    expect(readBuilderView()).toBe('all');
  });

  it('falls back to Essentials for a value it does not recognise', () => {
    window.localStorage.setItem(BUILDER_VIEW_KEY, 'maybe');
    expect(readBuilderView()).toBe('essentials');
  });

  it('does not throw when storage is unavailable', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('storage blocked');
      },
    });
    try {
      expect(readBuilderView()).toBe('essentials');
      expect(() => writeBuilderView('all')).not.toThrow();
    } finally {
      if (descriptor) Object.defineProperty(window, 'localStorage', descriptor);
    }
  });
});
