import type { AgentStatus, AgentTurn, Autonomy, CostSource, ExecutionDetail, TodoItem } from './types';

/** Labels copied from better-n8n-frontend/src/types/agentConfig.ts. */
export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  paused: 'Paused',
  archived: 'Archived',
};

export const AUTONOMY_LABEL: Record<Autonomy, string> = {
  plan: 'Plan only',
  review: 'Review every step',
  ask: 'Ask before changes',
  auto: 'Ask before irreversible',
  full: 'Never ask',
};

export const DECISION_LABEL: Record<AgentTurn['decision'], string> = {
  tools: 'Used tools',
  answer: 'Answered',
  paused: 'Waited for you',
  error: 'Error',
};

export const TODO_LABEL: Record<TodoItem['status'], string> = {
  open: 'To do',
  doing: 'Doing',
  done: 'Done',
  blocked: 'Blocked',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** "14 Nov, 09:30", with the year added when it is not this one. */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const year = d.getFullYear() === new Date().getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "5 min ago", "3 h ago", and a plain date once it is more than a week old. */
export function formatRelative(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return formatWhen(iso);
}

/** Mirrors the web's duration text: "850ms", "4.2s", "3m 07s". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}m ${pad(whole % 60)}s`;
}

/** Elapsed time since a run started, for a run that has not ended yet. */
export function elapsedMs(startedAt: string | null, createdAt: string, now: number = Date.now()): number {
  const start = new Date(startedAt ?? createdAt).getTime();
  return Number.isNaN(start) ? 0 : Math.max(0, now - start);
}

/**
 * A cost, with its provenance. `unpriced` is never shown as $0: the server has
 * no price on record, which is a different fact from a free run.
 */
export function formatCost(costUsd: string | null | undefined, source: CostSource | null | undefined): string {
  if (source === 'unpriced' || costUsd == null) return 'Not priced';
  return source === 'estimated' ? `$${costUsd} (estimated)` : `$${costUsd}`;
}

/** The last answer the run gave, or null while it has not given one. */
export function finalAnswer(detail: ExecutionDetail): string | null {
  for (let i = detail.turns.length - 1; i >= 0; i -= 1) {
    const turn = detail.turns[i];
    if (turn.decision === 'answer' && turn.content.trim()) return turn.content;
  }
  return null;
}

/** `output_data.todos` if the run kept a plan, else an empty list. */
export function planOf(output: Record<string, unknown> | null | undefined): TodoItem[] {
  const todos = output?.todos;
  return Array.isArray(todos) ? (todos as TodoItem[]) : [];
}

/** The message from a thrown error, or a fallback when there is none to show. */
export function messageOf(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
}
