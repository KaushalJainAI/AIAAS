/**
 * Activity helpers: which buttons a live row gets, and what it is called.
 *
 * Pure and vitest-covered. The server is the authority on what a row *may*
 * do (`LiveItem.actions`); this module only orders and labels those verbs so
 * every surface renders the same row the same way. An unknown verb is dropped
 * rather than rendered — a button that 409s is worse than none.
 */

import type { LiveItem } from '../api/activity';

export type LiveAction = 'stop' | 'steer' | 'open' | 'mark_failed';

const ORDER: LiveAction[] = ['stop', 'steer', 'mark_failed', 'open'];

const LABELS: Record<LiveAction, string> = {
  stop: 'Stop',
  steer: 'Steer',
  open: 'Open',
  mark_failed: 'Mark as failed',
};

/** Server verbs, ordered and labelled for buttons. Unknown verbs dropped. */
export function visibleActions(item: LiveItem): { id: LiveAction; label: string }[] {
  const verbs = new Set(item.actions ?? []);
  return ORDER.filter((id) => verbs.has(id)).map((id) => ({ id, label: LABELS[id] }));
}

const KIND_LABELS: Record<string, string> = {
  agent_run: 'Run',
  code_task: 'Code task',
  eval_sweep: 'Eval sweep',
  eval_world: 'Eval world',
  chat_turn: 'Chat',
};

/** Short kind chip text for a live row. */
export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

/** Live rows worth polling for: while non-empty, refetch. */
export function hasLiveItems(items: LiveItem[] | undefined): boolean {
  return (items ?? []).length > 0;
}
