/**
 * Plain helpers for the undo screen: flatten the tree into groups, decide which
 * rows start ticked, and word each outcome. No React, so the screen and any
 * other caller say the same things. Mirrors the web's `ChangesSheet.tsx` and
 * `src/lib/changeSummary.ts`, which are the reference.
 */
import type { ChangeRow, ChangeSetNode, RevertResult } from './api';

/** One change with the name of the set (the run, or a worker) it belongs to. */
export interface Entry {
  row: ChangeRow;
  worker: string;
}

/** Entries under one worker name, in the order the tree gave them. */
export interface WorkerGroup {
  worker: string;
  items: Entry[];
}

export interface OutcomeLine {
  text: string;
  tone: 'success' | 'muted' | 'danger';
}

/** The set's own name: the run's changes read as "This run", a chat answer's as "This answer". */
export function rootName(set: ChangeSetNode): string {
  return set.owner_kind === 'run' ? 'This run' : 'This answer';
}

/** Flatten the tree: the set's own changes first, then each worker's, in order. */
export function collect(node: ChangeSetNode, worker: string, out: Entry[] = []): Entry[] {
  for (const row of node.changes) out.push({ row, worker });
  node.children.forEach((kid, i) => {
    const name = worker.startsWith('Worker') ? `${worker} · ${i + 1}` : `Worker ${i + 1}`;
    collect(kid, name, out);
  });
  return out;
}

/** Any set in the tree left some changes out of the list. */
export function anyIncomplete(node: ChangeSetNode): boolean {
  return node.incomplete || node.children.some(anyIncomplete);
}

/** Ticked unless it was already tried: a retry of a skipped row is one tick away. */
export function defaultTicked(row: ChangeRow): boolean {
  return row.revertible && row.outcome === '';
}

/** Consecutive entries with the same worker name form one group. */
export function groupByWorker(entries: Entry[]): WorkerGroup[] {
  const groups: WorkerGroup[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.worker === entry.worker) last.items.push(entry);
    else groups.push({ worker: entry.worker, items: [entry] });
  }
  return groups;
}

/** The words under a row: this revert's answer first, then what the row already stored. */
export function outcomeFor(row: ChangeRow, result: RevertResult | null): OutcomeLine | null {
  const fromRun = result?.outcomes.find((o) => o.change_id === row.id);
  if (fromRun) {
    switch (fromRun.outcome) {
      case 'reverted':
        return { text: 'Undone', tone: 'success' };
      case 'skipped':
        return { text: `Skipped: ${fromRun.note}`, tone: 'muted' };
      case 'failed':
        return { text: `Failed: ${fromRun.note}`, tone: 'danger' };
      case 'not_revertible':
        return null; // the reason is already drawn under the row
    }
  }
  if (row.outcome === 'reverted') return { text: 'Undone', tone: 'success' };
  if (row.outcome === 'skipped') return { text: `Skipped: ${row.outcome_note}`, tone: 'muted' };
  if (row.outcome === 'failed') return { text: `Failed: ${row.outcome_note}`, tone: 'danger' };
  return null;
}

/** The one-line summary of a revert: "6 undone, 1 skipped". */
export function summariseRevert(result: RevertResult): string {
  const parts = [`${result.reverted} undone`];
  if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
  if (result.failed > 0) parts.push(`${result.failed} failed`);
  return parts.join(', ');
}
