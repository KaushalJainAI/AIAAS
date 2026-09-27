/**
 * The plan as the person watching should see it: not just the latest list,
 * but what each revision changed.
 *
 * `update_todos` replaces the whole list every time, so the latest list alone
 * cannot show what a revision *removed* — a step the model quietly dropped
 * looks exactly like progress. The backend keeps every revision
 * (`chat/turn/todos.py::record_revision`); this module compares them.
 *
 * Items have no ids (by design — the model would address the wrong one), so
 * they are matched on their text, trimmed, lower-cased and with runs of
 * whitespace collapsed. A reworded step therefore reads as one dropped and
 * one added, which is honest: the plan did change.
 *
 * Pure and framework-free; `__tests__/planView.test.ts` pins it.
 */
import type { TodoItem } from '../api/chat';

export type PlanItemChange = 'added' | 'dropped' | 'removed';

export interface PlanItemView extends TodoItem {
  key: string;
  /**
   * `added` — not in the original plan. `dropped` — removed while unfinished.
   * `removed` — removed after it was done (tidying, not a loss).
   */
  change?: PlanItemChange;
}

export interface PlanRevision {
  n: number;
  added: string[];
  dropped: string[];
  removed: string[];
  finished: string[];
  blocked: string[];
  started: string[];
}

export interface PlanViewModel {
  items: PlanItemView[];
  revisions: PlanRevision[];
  done: number;
  total: number;
  blocked: number;
  dropped: number;
  /** The step in progress, or '' when none is. */
  current: string;
}

/** One stored revision, as it arrives in `metadata.todo_history`. */
export interface StoredRevision {
  n?: number;
  todos?: TodoItem[];
}

export function planKey(text: string): string {
  return (text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isTodo(value: unknown): value is TodoItem {
  return !!value && typeof value === 'object'
    && typeof (value as TodoItem).text === 'string';
}

/** A list of revisions from whatever a message or run stored. */
export function historyFrom(stored: unknown, current: unknown): TodoItem[][] {
  const out: TodoItem[][] = [];
  if (Array.isArray(stored)) {
    for (const rev of stored as StoredRevision[]) {
      const todos = Array.isArray(rev?.todos) ? rev.todos.filter(isTodo) : [];
      if (todos.length) out.push(todos);
    }
  }
  const latest = Array.isArray(current) ? (current as unknown[]).filter(isTodo) : [];
  // A message saved before history existed carries only the final list.
  if (!out.length && latest.length) out.push(latest);
  return out;
}

function sameList(a: TodoItem[], b: TodoItem[]): boolean {
  return a.length === b.length && a.every((t, i) =>
    t.text === b[i].text && t.status === b[i].status && (t.note ?? '') === (b[i].note ?? ''));
}

/** `history` plus `todos`, unless `todos` is an identical resend. */
export function appendRevision(history: TodoItem[][], todos: TodoItem[]): TodoItem[][] {
  if (!todos.length) return history;
  const last = history[history.length - 1];
  if (last && sameList(last, todos)) return history;
  return [...history, todos];
}

export function buildPlanView(history: TodoItem[][]): PlanViewModel {
  const empty: PlanViewModel = {
    items: [], revisions: [], done: 0, total: 0, blocked: 0, dropped: 0, current: '',
  };
  if (!history.length) return empty;

  const original = new Set(history[0].map(t => planKey(t.text)));
  // Keyed so a step dropped and later re-added stops being shown as dropped.
  const gone = new Map<string, PlanItemView>();
  const revisions: PlanRevision[] = [{
    n: 1, added: history[0].map(t => t.text), dropped: [], removed: [],
    finished: history[0].filter(t => t.status === 'done').map(t => t.text),
    blocked: history[0].filter(t => t.status === 'blocked').map(t => t.text),
    started: history[0].filter(t => t.status === 'doing').map(t => t.text),
  }];

  for (let i = 1; i < history.length; i++) {
    const prev = new Map(history[i - 1].map(t => [planKey(t.text), t]));
    const next = new Map(history[i].map(t => [planKey(t.text), t]));
    const rev: PlanRevision = {
      n: i + 1, added: [], dropped: [], removed: [], finished: [], blocked: [], started: [],
    };
    for (const [key, item] of next) {
      const before = prev.get(key);
      gone.delete(key);
      if (!before) rev.added.push(item.text);
      if (item.status !== before?.status) {
        if (item.status === 'done') rev.finished.push(item.text);
        else if (item.status === 'blocked') rev.blocked.push(item.text);
        else if (item.status === 'doing') rev.started.push(item.text);
      }
    }
    for (const [key, item] of prev) {
      if (next.has(key)) continue;
      const change: PlanItemChange = item.status === 'done' ? 'removed' : 'dropped';
      (change === 'removed' ? rev.removed : rev.dropped).push(item.text);
      gone.set(key, { ...item, key, change });
    }
    revisions.push(rev);
  }

  const latest = history[history.length - 1];
  const items: PlanItemView[] = latest.map(t => {
    const key = planKey(t.text);
    return {
      ...t, key,
      ...(history.length > 1 && !original.has(key) ? { change: 'added' as const } : {}),
    };
  });
  const goneItems = [...gone.values()];

  return {
    items: [...items, ...goneItems],
    revisions,
    done: latest.filter(t => t.status === 'done').length,
    total: latest.length,
    blocked: latest.filter(t => t.status === 'blocked').length,
    dropped: goneItems.filter(t => t.change === 'dropped').length,
    current: latest.find(t => t.status === 'doing')?.text ?? '',
  };
}

/** One tool call, as far as the plan cares. */
export interface StepAction {
  tool: string;
  args?: Record<string, unknown>;
  step?: string;
}

/** Tool calls grouped under the plan step each was made for. */
export function actionsByStep(actions: StepAction[]): Map<string, StepAction[]> {
  const out = new Map<string, StepAction[]>();
  for (const action of actions) {
    if (!action.step || !action.tool) continue;
    const key = planKey(action.step);
    const list = out.get(key);
    if (list) list.push(action);
    else out.set(key, [action]);
  }
  return out;
}

const DETAIL_KEYS = ['query', 'path', 'url', 'name', 'agent', 'task', 'to'];

/** "web_search: vendor pricing" — the tool and its most telling argument. */
export function actionLabel(action: StepAction): string {
  const tool = action.tool.replace(/^mcp__\d+__/, '').replace(/_[0-9a-f]{8}$/, '');
  for (const key of DETAIL_KEYS) {
    const value = action.args?.[key];
    if (typeof value === 'string' && value.trim()) {
      const text = value.trim().replace(/\s+/g, ' ');
      return `${tool}: ${text.length > 80 ? `${text.slice(0, 79)}…` : text}`;
    }
  }
  return tool;
}

/** A revision in one line, for the history list. */
export function describeRevision(rev: PlanRevision): string {
  if (rev.n === 1) return `Plan made with ${rev.added.length} step${rev.added.length === 1 ? '' : 's'}`;
  const parts: string[] = [];
  const list = (verb: string, items: string[]) => {
    if (items.length) parts.push(`${verb} ${items.map(t => `“${t}”`).join(', ')}`);
  };
  list('added', rev.added);
  list('dropped', rev.dropped);
  list('finished', rev.finished);
  list('blocked', rev.blocked);
  list('started', rev.started);
  list('tidied away', rev.removed);
  return parts.length ? parts.join('; ') : 'No visible change';
}

/** "3/7 done · 1 blocked · 2 dropped" — the counts every plan surface shows. */
export function planCounts(view: { done: number; total: number; blocked: number; dropped: number }): string {
  return [
    `${view.done}/${view.total} done`,
    view.blocked ? `${view.blocked} blocked` : '',
    view.dropped ? `${view.dropped} dropped` : '',
  ].filter(Boolean).join(' · ');
}

/** Tool calls from a stored trace or live activity, keeping only what the plan needs. */
export function actionsFrom(entries: unknown): StepAction[] {
  if (!Array.isArray(entries)) return [];
  const out: StepAction[] = [];
  for (const e of entries as Record<string, unknown>[]) {
    if (!e || typeof e.tool !== 'string' || typeof e.step !== 'string' || !e.step) continue;
    const args = e.args && typeof e.args === 'object' ? e.args as Record<string, unknown> : undefined;
    out.push({ tool: e.tool, step: e.step, ...(args ? { args } : {}) });
  }
  return out;
}
