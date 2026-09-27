import { describe, expect, it } from 'vitest';

import type { EvalCase } from '../../api/evals';
import { firstError, formatParam, parseParam, toForm, toGraders, toPayload } from '../evalCase';

describe('parseParam', () => {
  it('reads booleans, numbers and JSON by shape', () => {
    expect(parseParam('true')).toBe(true);
    expect(parseParam('false')).toBe(false);
    expect(parseParam('42')).toBe(42);
    expect(parseParam('-1.5')).toBe(-1.5);
    expect(parseParam('["a", "b"]')).toEqual(['a', 'b']);
    expect(parseParam('{"k": 1}')).toEqual({ k: 1 });
  });

  it('keeps everything else as the text typed', () => {
    expect(parseParam('refund policy')).toBe('refund policy');
    expect(parseParam('[not json')).toBe('[not json');
    expect(parseParam(' spaced ')).toBe(' spaced ');
  });

  it('round-trips through formatParam', () => {
    for (const v of [true, 3, 'text', ['x'], { a: 1 }]) {
      expect(parseParam(formatParam(v))).toEqual(v);
    }
  });
});

describe('graders', () => {
  it('drops empty parameters so optional ones keep their default', () => {
    expect(toGraders([{ type: 'contains', params: { value: 'refund', ignore_case: '' } }]))
      .toEqual([{ type: 'contains', value: 'refund' }]);
  });

  it('a stored case survives form -> payload unchanged', () => {
    const stored = {
      id: 1, suite: 1, name: 'Refunds', order: 0, goal: 'What is the refund window?',
      input_data: {}, reference: '30 days',
      graders: [{ type: 'contains', value: '30', ignore_case: true }, { type: 'max_length', value: 400 }],
      weight: 2, tags: [], is_active: false, world_version: null, created_at: '', updated_at: '',
    } satisfies EvalCase;
    expect(toPayload(toForm(stored))).toEqual({
      name: 'Refunds', goal: 'What is the refund window?', reference: '30 days',
      graders: stored.graders, weight: 2, is_active: false,
    });
  });
});

describe('firstError', () => {
  it('names the field for a field error and not for a plain one', () => {
    expect(firstError({ graders: ['a case with only an LLM judge proves nothing'] }))
      .toBe('graders: a case with only an LLM judge proves nothing');
    expect(firstError({ error: 'A suite holds at most 200 cases.' })).toBe('A suite holds at most 200 cases.');
    expect(firstError(undefined)).toBeNull();
  });
});
