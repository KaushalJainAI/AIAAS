/**
 * The tone of a schedule's server-computed status (`Trigger.status`).
 *
 * Pure and vitest-covered, so the card renders it without branching: green
 * means nothing to do, amber means it needs attention but is not broken, red
 * means it will not fire until something changes. The mapping mirrors the
 * backend's table (`agents/views/triggers.py::trigger_status`) — `ok` shows
 * nothing else, and `needs_permission` is red, not amber, because a schedule
 * that has never been allowed to run is not "close to working".
 */
import type { TriggerStatus } from '../api/triggers';

export type StatusTone = 'ok' | 'warn' | 'bad';

export function statusTone(status: TriggerStatus): StatusTone {
  if (status === 'ok') return 'ok';
  if (
    status === 'overdue'
    || status === 'failing'
    || status === 'not_started'
    || status === 'agent_paused'
  ) {
    return 'warn';
  }
  return 'bad';
}
