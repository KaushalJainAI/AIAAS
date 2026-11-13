import { describe, expect, it } from 'vitest';
import { decisionModelLabel, type DecisionModel } from '../decisions';

const base: DecisionModel = {
  id: 'typesafe/jev-1.14',
  name: 'TypeSafe: Jev 1.14',
  created: 1,
  input_price_per_million: 0.042,
  is_free: false,
  context_length: 262144,
  input_modalities: ['text', 'image'],
  is_router: false,
  expires: '',
};

describe('decisionModelLabel', () => {
  it('names the vendor and the input price', () => {
    expect(decisionModelLabel(base)).toBe('TypeSafe Jev 1.14 · $0.042/M in');
  });

  it('says free rather than $0', () => {
    expect(decisionModelLabel({ ...base, name: 'Respan: Span-01 Lite', is_free: true, input_price_per_million: 0 }))
      .toBe('Respan Span-01 Lite · free');
  });

  it('omits an unknown price instead of inventing one', () => {
    expect(decisionModelLabel({ ...base, name: '~typesafe/jev-latest', input_price_per_million: null }))
      .toBe('~typesafe/jev-latest');
  });

  it('keeps prices of a dollar or more readable', () => {
    expect(decisionModelLabel({ ...base, input_price_per_million: 1.5 })).toBe('TypeSafe Jev 1.14 · $1.5/M in');
  });
});
