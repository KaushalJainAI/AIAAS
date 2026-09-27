/**
 * Plan-panel state: the lead's plan, one live lane per worker, locks & changes.
 *
 * Pure reducer beside `useChatStream` (which owns the turn's own state): the
 * panel reads `task_update` / `lease_update` / `code_change` frames, and on
 * reload it replays `output_data.tasks` from `/runs`. Whole-list replacement,
 * like `todos_update` — a client applying deltas would reconstruct a state
 * the server never sent.
 *
 * `done` keeps the last snapshot rather than clearing it: the panel is the
 * record of what the team did, and a reload reads the same state from the
 * persisted run.
 */

export interface PlanTask {
  task_id: string;
  handle: string;
  label: string;
  agent: string;
  title: string;
  status: string;
  execution_id: string;
  claims: string[];
  tokens: number;
  started_at_ms?: number;
}

export interface PlanLease {
  pattern: string;
  holder_label: string;
  task_id: string;
}

export interface PlanChange {
  path: string;
  change_id: number | null;
  by_label: string;
}

export interface PlanStreamState {
  tasks: PlanTask[];
  leases: PlanLease[];
  changes: PlanChange[];
}

export const EMPTY_PLAN: PlanStreamState = { tasks: [], leases: [], changes: [] };

export type PlanStreamEvent = { type: string } & Record<string, unknown>;

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const arr = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

function taskFrom(event: PlanStreamEvent): PlanTask {
  const started = event.started_at_ms;
  return {
    task_id: str(event.task_id),
    handle: str(event.handle) || str(event.task_id),
    label: str(event.label),
    agent: str(event.agent),
    title: str(event.title),
    status: str(event.status) || 'running',
    execution_id: str(event.execution_id),
    claims: arr<string>(event.claims).filter((c): c is string => typeof c === 'string'),
    tokens: num(event.tokens) ?? 0,
    ...(typeof started === 'number' && Number.isFinite(started) ? { started_at_ms: started } : {}),
  };
}

export function reducePlanEvent(state: PlanStreamState, event: PlanStreamEvent): PlanStreamState {
  switch (event.type) {
    case 'task_update': {
      // One lane per handle, replaced wholesale: the server sends the full
      // snapshot because that is what it has, and merging would invent state.
      const next = taskFrom(event);
      const i = state.tasks.findIndex((t) => t.handle === next.handle);
      if (i < 0) return { ...state, tasks: [...state.tasks, next] };
      const tasks = state.tasks.slice();
      tasks[i] = next;
      return { ...state, tasks };
    }
    case 'lease_update': {
      // Whole lock list, replaced: a released lock simply stops being sent.
      const leases = arr<Record<string, unknown>>(event.leases).map((l) => ({
        pattern: str(l.pattern),
        holder_label: str(l.holder_label),
        task_id: str(l.task_id),
      }));
      return { ...state, leases };
    }
    case 'code_change': {
      const change: PlanChange = {
        path: str(event.path),
        change_id: num(event.change_id) ?? null,
        by_label: str(event.by_label),
      };
      if (!change.path) return state;
      // Newest first, capped: the list is a flash of what just landed, not a
      // ledger of the whole run (that is what `CodeChange` rows are).
      return { ...state, changes: [change, ...state.changes].slice(0, 30) };
    }
    case 'done':
      // The lanes stay: the panel is the record, and a reload replays the
      // same state from `output_data.tasks`.
      return state;
    case 'reset':
      return EMPTY_PLAN;
    default:
      return state;
  }
}

/** Seed panel state from a finished run's `output_data` (`/runs` replay). */
export function planFromOutput(output: unknown): PlanStreamState {
  if (!output || typeof output !== 'object') return EMPTY_PLAN;
  const tasks = arr<Record<string, unknown>>(
    (output as Record<string, unknown>).tasks,
  );
  if (tasks.length === 0) return EMPTY_PLAN;
  return {
    tasks: tasks.map((t) =>
      taskFrom({ type: 'task_update', ...t } as PlanStreamEvent),
    ),
    leases: [],
    changes: [],
  };
}

/** "4/9 · 2 running": the progress pill for the mobile sheet and the transcript. */
export function planProgress(tasks: PlanTask[]): { done: number; total: number; running: number } {
  const done = tasks.filter((t) => t.status === 'done').length;
  const running = tasks.filter((t) => t.status === 'running' || t.status === 'paused').length;
  return { done, total: tasks.length, running };
}
