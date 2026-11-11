import { describe, expect, it } from 'vitest';

import type { Solution } from '../../api/solutions';
import {
  CLAIM_KINDS,
  LIMITS,
  SAVED_CLAIM_KINDS,
  detailOf,
  emptyValues,
  hasErrors,
  parseTags,
  toDraft,
  validate,
  valuesFromSolution,
  type FormValues,
} from '../solutionForm';

const filled = (over: Partial<FormValues> = {}): FormValues => ({
  ...emptyValues(),
  problem: 'Build fails on Windows',
  resolution: 'Clear the cache folder',
  ...over,
});

describe('claim kinds', () => {
  it('lists the six kinds of freshness.py, each with plain help text', () => {
    expect(CLAIM_KINDS.map((k) => k.value).sort()).toEqual(
      ['config', 'ephemeral', 'principle', 'procedure', 'time_sensitive', 'versioned'],
    );
    for (const kind of CLAIM_KINDS) expect(kind.help.length).toBeGreaterThan(20);
  });

  it('does not offer ephemeral claims, because the server drops them on save', () => {
    expect(SAVED_CLAIM_KINDS.map((k) => k.value)).not.toContain('ephemeral');
    expect(SAVED_CLAIM_KINDS).toHaveLength(5);
  });
});

describe('validate', () => {
  it('needs a problem and a fix', () => {
    const errors = validate(emptyValues());
    expect(errors.problem).toBeTruthy();
    expect(errors.resolution).toBeTruthy();
    expect(hasErrors(validate(filled()))).toBe(false);
  });

  it('treats whitespace as empty', () => {
    expect(validate(filled({ problem: '   ' })).problem).toBeTruthy();
  });

  it('caps the problem at 500 characters and the long fields at 8,000', () => {
    expect(validate(filled({ problem: 'x'.repeat(LIMITS.problem + 1) })).problem).toBeTruthy();
    expect(validate(filled({ problem: 'x'.repeat(LIMITS.problem) })).problem).toBeUndefined();
    expect(validate(filled({ symptoms: 'x'.repeat(LIMITS.text + 1) })).symptoms).toBeTruthy();
    expect(validate(filled({ root_cause: 'x'.repeat(LIMITS.text + 1) })).root_cause).toBeTruthy();
  });

  it('allows at most eight distinct tags', () => {
    const nine = Array.from({ length: 9 }, (_, i) => `t${i}`).join(', ');
    const eight = Array.from({ length: 8 }, (_, i) => `t${i}`).join(', ');
    expect(validate(filled({ tags: nine })).tags).toBeTruthy();
    expect(validate(filled({ tags: eight })).tags).toBeUndefined();
    // Repeats do not count against the limit.
    expect(validate(filled({ tags: 'a, a, a' })).tags).toBeUndefined();
  });

  it('refuses an environment value with no name, and a name with no value', () => {
    expect(validate(filled({ environment: [{ key: '', value: 'Windows 11' }] })).environment).toBeTruthy();
    expect(validate(filled({ environment: [{ key: 'os', value: '' }] })).environment).toBeTruthy();
    expect(validate(filled({ environment: [{ key: 'os', value: 'Windows 11' }] })).environment).toBeUndefined();
  });

  it('caps the claims at twelve and each claim at 400 characters', () => {
    const many = Array.from({ length: LIMITS.claims + 1 }, () => ({ text: 'a', kind: 'procedure' as const }));
    expect(validate(filled({ claims: many })).claims).toBeTruthy();
    expect(
      validate(filled({ claims: [{ text: 'x'.repeat(LIMITS.claimText + 1), kind: 'config' }] })).claims,
    ).toBeTruthy();
  });
});

describe('toDraft', () => {
  it('trims text, splits tags, and drops empty rows and claims', () => {
    const draft = toDraft(filled({
      problem: '  Build fails  ',
      tags: ' ci, windows ,, ci ',
      environment: [{ key: ' os ', value: ' Windows 11 ' }, { key: '', value: '' }],
      claims: [{ text: ' Cache lives in AppData ', kind: 'config' }, { text: '  ', kind: 'principle' }],
    }));
    expect(draft.problem).toBe('Build fails');
    expect(draft.tags).toEqual(['ci', 'windows']);
    expect(draft.environment).toEqual({ os: 'Windows 11' });
    expect(draft.claims).toEqual([{ text: 'Cache lives in AppData', kind: 'config' }]);
  });

  it('sends no claims when none were written, so the server makes its default one', () => {
    expect(toDraft(filled()).claims).toEqual([]);
  });
});

describe('valuesFromSolution', () => {
  it('turns a solution back into form values, round-tripping through toDraft', () => {
    const solution = {
      id: 1,
      problem: 'Build fails',
      symptoms: 'Exit code 1',
      root_cause: 'Stale cache',
      resolution: 'Clear it',
      environment: { os: 'Windows 11' },
      claims: [{ text: 'Cache path', kind: 'config', state: 'fresh' }],
      tags: ['ci'],
    } as unknown as Solution;
    const values = valuesFromSolution(solution);
    expect(values.environment).toEqual([{ key: 'os', value: 'Windows 11' }]);
    expect(values.tags).toBe('ci');
    const draft = toDraft(values);
    expect(draft).toEqual({
      problem: 'Build fails',
      symptoms: 'Exit code 1',
      root_cause: 'Stale cache',
      resolution: 'Clear it',
      environment: { os: 'Windows 11' },
      claims: [{ text: 'Cache path', kind: 'config' }],
      tags: ['ci'],
    });
  });
});

describe('parseTags', () => {
  it('ignores empty entries and keeps first-seen order', () => {
    expect(parseTags('b, a, , b')).toEqual(['b', 'a']);
  });
});

describe('detailOf', () => {
  it('reads the server detail a refusal carries, or falls back', () => {
    const refusal = { response: { data: { detail: 'Only a curator can approve a solution.' } } };
    expect(detailOf(refusal, 'Could not approve it.')).toBe('Only a curator can approve a solution.');
    expect(detailOf(new Error('network'), 'Could not approve it.')).toBe('Could not approve it.');
    expect(detailOf({ response: { data: {} } }, 'fallback')).toBe('fallback');
  });
});
