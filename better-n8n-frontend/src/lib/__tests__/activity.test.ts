/**
 * The live row shows only what the backend supports: server verbs, ordered
 * and labelled here. Unknown verbs are dropped, never rendered as dead
 * buttons.
 */
import { describe, expect, it } from 'vitest';
import { hasLiveItems, kindLabel, visibleActions } from '../activity';
import type { LiveItem } from '../../api/activity';

function item(actions: string[], kind = 'agent_run'): LiveItem {
  return {
    kind: kind as LiveItem['kind'],
    id: 'x',
    title: 't',
    status: 'running',
    started_at: null,
    elapsed_s: null,
    spend_rupees: null,
    actions,
    href: '/runs',
  };
}

describe('visibleActions', () => {
  it('orders stop, steer, mark_failed, open whatever the server order', () => {
    expect(visibleActions(item(['open', 'mark_failed', 'stop'])).map((a) => a.id))
      .toEqual(['stop', 'mark_failed', 'open']);
  });

  it('drops unknown verbs instead of rendering dead buttons', () => {
    expect(visibleActions(item(['pause', 'resume', 'open'])).map((a) => a.id))
      .toEqual(['open']);
  });

  it('labels the failure action for stuck runs', () => {
    expect(visibleActions(item(['stop', 'mark_failed', 'open'])))
      .toContainEqual({ id: 'mark_failed', label: 'Mark as failed' });
  });

  it('a world with open-only stays open-only', () => {
    expect(visibleActions(item(['open'], 'eval_world')).map((a) => a.id))
      .toEqual(['open']);
  });
});

describe('kindLabel', () => {
  it('names every live kind', () => {
    expect(kindLabel('agent_run')).toBe('Run');
    expect(kindLabel('code_task')).toBe('Code task');
    expect(kindLabel('eval_sweep')).toBe('Eval sweep');
    expect(kindLabel('eval_world')).toBe('Eval world');
    expect(kindLabel('chat_turn')).toBe('Chat');
  });
});

describe('hasLiveItems', () => {
  it('is false for empty and undefined lists', () => {
    expect(hasLiveItems([])).toBe(false);
    expect(hasLiveItems(undefined)).toBe(false);
    expect(hasLiveItems([item(['open'])])).toBe(true);
  });
});
