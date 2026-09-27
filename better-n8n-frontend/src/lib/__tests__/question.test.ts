import { describe, expect, it } from 'vitest';

import { answerProblem, toQuestionSpec } from '../question';

describe('toQuestionSpec', () => {
  it('reads an ask_question frame', () => {
    const spec = toQuestionSpec({
      type: 'ask_question', call_id: 'q-1', question: 'Which report?',
      kind: 'choice', options: ['Weekly', 'Monthly'], assumption: 'Weekly',
    });
    expect(spec?.call_id).toBe('q-1');
    expect(spec?.options).toEqual(['Weekly', 'Monthly']);
  });

  it('refuses what it cannot draw', () => {
    expect(toQuestionSpec(null)).toBeNull();
    expect(toQuestionSpec({ question: '' })).toBeNull();
    expect(toQuestionSpec({ question: 'Q?', kind: 'choice', options: ['only'] })).toBeNull();
  });

  it('falls back to a text question for an unknown kind', () => {
    expect(toQuestionSpec({ question: 'Why?', kind: 'essay' })?.kind).toBe('text');
  });
});

describe('answerProblem mirrors the server check', () => {
  const choice = toQuestionSpec({ question: 'Q?', kind: 'choice', options: ['A', 'B'] })!;

  it('takes one of the options', () => {
    expect(answerProblem(choice, 'A')).toBeNull();
    expect(answerProblem(choice, 'C')).not.toBeNull();
    expect(answerProblem(choice, '')).not.toBeNull();
    expect(answerProblem({ ...choice, allow_other: true }, 'C')).toBeNull();
  });

  it('takes several for a multi choice', () => {
    const multi = { ...choice, kind: 'multi_choice' as const };
    expect(answerProblem(multi, ['A', 'B'])).toBeNull();
    expect(answerProblem(multi, [])).not.toBeNull();
  });

  it('keeps a number inside its bounds', () => {
    const budget = toQuestionSpec({ question: 'Budget?', kind: 'number', min: 0, max: 5000 })!;
    expect(answerProblem(budget, 1200)).toBeNull();
    expect(answerProblem(budget, 9000)).toMatch(/at most 5000/);
    expect(answerProblem(budget, -1)).toMatch(/at least 0/);
    expect(answerProblem(budget, null)).not.toBeNull();
  });

  it('needs words for a text question', () => {
    const text = toQuestionSpec({ question: 'Why?', kind: 'text' })!;
    expect(answerProblem(text, '   ')).not.toBeNull();
    expect(answerProblem(text, 'because')).toBeNull();
  });
});
