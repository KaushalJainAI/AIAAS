import { describe as group, expect, it } from 'vitest';
import { lastRunCopy, statusTone } from '../triggerStatus';
import type { TriggerStatus } from '../../api/triggers';

group('statusTone', () => {
  it('is green only when there is nothing to do', () => {
    expect(statusTone('ok')).toBe('ok');
  });

  it('is amber when it needs attention but is not broken', () => {
    const warn: TriggerStatus[] = ['overdue', 'failing', 'not_started', 'agent_paused'];
    for (const status of warn) {
      expect(statusTone(status)).toBe('warn');
    }
  });

  it('is red when it will not fire until something changes', () => {
    const bad: TriggerStatus[] = [
      'scheduler_down',
      'needs_permission',
      'self_disabled',
      'ended',
      'paused',
    ];
    for (const status of bad) {
      expect(statusTone(status)).toBe('bad');
    }
  });
});

group('lastRunCopy', () => {
  it('reports how a fired run ended, not that it started', () => {
    expect(lastRunCopy('fired', 'completed')?.label).toBe('Succeeded');
    expect(lastRunCopy('fired', 'failed')?.label).toBe('Failed');
    expect(lastRunCopy('fired', 'running')?.label).toBe('Running');
  });

  it('leaves every other outcome, and an unknown run, to the sweep wording', () => {
    expect(lastRunCopy('late', 'completed')).toBeNull();
    expect(lastRunCopy('fired', null)).toBeNull();
    expect(lastRunCopy('fired', 'something-new')).toBeNull();
  });
});
