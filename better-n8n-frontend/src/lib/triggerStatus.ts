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

/**
 * How the run a firing started actually ended.
 *
 * `last_outcome` is the sweep's word and stops at "fired" — true the moment
 * the run starts and never again, so a run that finished eleven days ago still
 * read "Started". When the run's own status is known, that is the answer.
 */
const RUN_STATUS_COPY: Record<string, { label: string; tone: string }> = {
  completed: { label: 'Succeeded', tone: 'text-success' },
  failed: { label: 'Failed', tone: 'text-destructive' },
  timeout: { label: 'Timed out', tone: 'text-destructive' },
  cancelled: { label: 'Cancelled', tone: 'text-muted-foreground' },
  paused: { label: 'Waiting for you', tone: 'text-warning' },
  running: { label: 'Running', tone: 'text-agent' },
  pending: { label: 'Queued', tone: 'text-muted-foreground' },
};

export function lastRunCopy(
  outcome: string, runStatus: string | null | undefined,
): { label: string; tone: string } | null {
  if (outcome !== 'fired' || !runStatus) return null;
  return RUN_STATUS_COPY[runStatus] ?? null;
}
