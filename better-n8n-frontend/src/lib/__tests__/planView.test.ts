import { describe, expect, it } from 'vitest';
import type { TodoItem } from '../../api/chat';
import {
  actionLabel,
  actionsByStep,
  actionsFrom,
  appendRevision,
  buildPlanView,
  describeRevision,
  historyFrom,
  planCounts,
} from '../planView';

const t = (text: string, status: TodoItem['status'] = 'open', note?: string): TodoItem =>
  ({ text, status, ...(note ? { note } : {}) });

describe('buildPlanView', () => {
  it('is empty for no history', () => {
    expect(buildPlanView([]).items).toEqual([]);
  });

  it('a single revision has no change tags', () => {
    const view = buildPlanView([[t('a', 'doing'), t('b')]]);
    expect(view.items.map(i => i.change)).toEqual([undefined, undefined]);
    expect(view.current).toBe('a');
    expect(view.total).toBe(2);
  });

  it('shows an unfinished step removed later as dropped, after the live list', () => {
    const view = buildPlanView([
      [t('compare 5 vendors', 'doing'), t('write summary')],
      [t('write summary', 'doing')],
    ]);
    expect(view.items.map(i => [i.text, i.change])).toEqual([
      ['write summary', undefined],
      ['compare 5 vendors', 'dropped'],
    ]);
    expect(view.dropped).toBe(1);
    expect(view.total).toBe(1);
  });

  it('a done step removed is "removed", not "dropped"', () => {
    const view = buildPlanView([[t('a', 'done'), t('b')], [t('b')]]);
    expect(view.items.find(i => i.text === 'a')?.change).toBe('removed');
    expect(view.dropped).toBe(0);
  });

  it('tags steps not in the original plan as added', () => {
    const view = buildPlanView([[t('a')], [t('a'), t('b')]]);
    expect(view.items.find(i => i.text === 'b')?.change).toBe('added');
  });

  it('a reworded step reads as one dropped and one added', () => {
    const view = buildPlanView([[t('compare 5 vendors')], [t('compare 2 vendors')]]);
    expect(view.items.map(i => i.change)).toEqual(['added', 'dropped']);
  });

  it('matches across case and spacing, and a re-added step is no longer dropped', () => {
    const view = buildPlanView([
      [t('Check  pricing')], [t('other')], [t('check pricing', 'done'), t('other')],
    ]);
    expect(view.items.map(i => i.change)).toEqual([undefined, 'added']);
    expect(view.dropped).toBe(0);
  });

  it('records what each revision changed', () => {
    const view = buildPlanView([
      [t('a', 'doing'), t('b')],
      [t('a', 'done'), t('c', 'doing')],
    ]);
    const rev = view.revisions[1];
    expect(rev.added).toEqual(['c']);
    expect(rev.dropped).toEqual(['b']);
    expect(rev.finished).toEqual(['a']);
    expect(rev.started).toEqual(['c']);
    expect(describeRevision(rev)).toBe('added “c”; dropped “b”; finished “a”; started “c”');
    expect(describeRevision(view.revisions[0])).toBe('Plan made with 2 steps');
  });
});

describe('appendRevision', () => {
  it('skips an identical resend and empty lists', () => {
    const one = appendRevision([], [t('a')]);
    expect(appendRevision(one, [t('a')])).toBe(one);
    expect(appendRevision(one, [])).toBe(one);
    expect(appendRevision(one, [t('a', 'done')])).toHaveLength(2);
    expect(appendRevision(one, [t('a', 'open', 'why')])).toHaveLength(2);
  });
});

describe('historyFrom', () => {
  it('reads stored revisions', () => {
    expect(historyFrom([{ n: 1, todos: [t('a')] }, { n: 2, todos: [t('b')] }], [t('b')]))
      .toEqual([[t('a')], [t('b')]]);
  });
  it('falls back to the final list for replies saved before history existed', () => {
    expect(historyFrom(undefined, [t('a')])).toEqual([[t('a')]]);
    expect(historyFrom(undefined, undefined)).toEqual([]);
  });
  it('ignores junk', () => {
    expect(historyFrom([null, { todos: 'x' }, { todos: [{ nope: 1 }] }], null)).toEqual([]);
  });
});

describe('step actions', () => {
  it('keeps only calls filed under a step and groups them by the step key', () => {
    const actions = actionsFrom([
      { tool: 'web_search', args: { query: 'x' }, step: 'Check Pricing' },
      { tool: 'read_file', step: '' },
      { tool: 'read_url', args: { url: 'u' }, step: 'check pricing' },
      'junk',
    ]);
    expect(actions).toHaveLength(2);
    expect(actionsByStep(actions).get('check pricing')).toHaveLength(2);
  });

  it('labels a call by its most telling argument', () => {
    expect(actionLabel({ tool: 'web_search', args: { query: 'vendor  pricing' } }))
      .toBe('web_search: vendor pricing');
    expect(actionLabel({ tool: 'mcp__7__send_email_ab12cd34' })).toBe('send_email');
    expect(actionLabel({ tool: 'read_url', args: { url: 'x'.repeat(200) } })).toHaveLength(90);
  });
});

it('planCounts lists only what is non-zero', () => {
  expect(planCounts({ done: 2, total: 5, blocked: 0, dropped: 1 })).toBe('2/5 done · 1 dropped');
});
