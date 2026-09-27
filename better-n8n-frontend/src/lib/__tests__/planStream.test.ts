import { describe as group, expect, it } from 'vitest';
import {
  EMPTY_PLAN,
  planFromOutput,
  planProgress,
  reducePlanEvent,
} from '../planStream';

const task = (over: Record<string, unknown> = {}) => ({
  type: 'task_update',
  task_id: 't1',
  handle: 't1',
  label: 'Implementer #1',
  agent: 'Code implementer',
  title: 'Add retry',
  status: 'running',
  execution_id: 'exec-1',
  claims: ['src/api/**'],
  tokens: 0,
  ...over,
});

group('reducePlanEvent', () => {
  it('adds a lane per handle and replaces it wholesale on update', () => {
    let state = reducePlanEvent(EMPTY_PLAN, task());
    expect(state.tasks).toHaveLength(1);
    state = reducePlanEvent(state, task({ status: 'done', tokens: 42 }));
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].status).toBe('done');
    expect(state.tasks[0].tokens).toBe(42);
  });

  it('keeps lanes for different handles apart', () => {
    let state = reducePlanEvent(EMPTY_PLAN, task());
    state = reducePlanEvent(state, task({ handle: 't2', task_id: 't2' }));
    expect(state.tasks.map((t) => t.handle)).toEqual(['t1', 't2']);
  });

  it('replaces the lock list, so a released lock clears', () => {
    let state = reducePlanEvent(EMPTY_PLAN, {
      type: 'lease_update',
      leases: [{ pattern: 'src/a.ts', holder_label: 'Impl #1', task_id: 't1' }],
    });
    expect(state.leases).toHaveLength(1);
    state = reducePlanEvent(state, { type: 'lease_update', leases: [] });
    expect(state.leases).toHaveLength(0);
  });

  it('prepends changes newest-first and caps the flash list', () => {
    let state = EMPTY_PLAN;
    for (let i = 0; i < 40; i += 1) {
      state = reducePlanEvent(state, {
        type: 'code_change', path: `src/f${i}.ts`, change_id: i, by_label: 'Impl #1',
      });
    }
    expect(state.changes).toHaveLength(30);
    expect(state.changes[0].path).toBe('src/f39.ts');
  });

  it('ignores unknown frames and keeps lanes on done', () => {
    const state = reducePlanEvent(EMPTY_PLAN, task());
    expect(reducePlanEvent(state, { type: 'agent_trace' })).toBe(state);
    expect(reducePlanEvent(state, { type: 'done' })).toBe(state);
  });
});

group('planFromOutput', () => {
  it('replays a finished run onto the panel', () => {
    const state = planFromOutput({
      tasks: [{ task_id: 't1', handle: 't1', status: 'done', title: 'Add retry' }],
    });
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].status).toBe('done');
  });

  it('answers empty for runs that never dispatched', () => {
    expect(planFromOutput(null)).toEqual(EMPTY_PLAN);
    expect(planFromOutput({})).toEqual(EMPTY_PLAN);
  });
});

group('planProgress', () => {
  it('counts done, total and running for the pill', () => {
    const state = reducePlanEvent(EMPTY_PLAN, task());
    const two = reducePlanEvent(state, task({ handle: 't2', task_id: 't2', status: 'done' }));
    expect(planProgress(two.tasks)).toEqual({ done: 1, total: 2, running: 1 });
  });
});
