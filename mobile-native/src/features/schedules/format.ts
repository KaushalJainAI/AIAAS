/**
 * Schedule wording and times, copied from better-n8n-frontend/src/pages/Schedules.tsx
 * and src/lib/triggerStatus.ts so a schedule reads the same on the phone.
 *
 * Times are formatted by hand rather than with `toLocaleString(options)`: Hermes
 * on Android and iOS do not agree on those options, and the two platforms must
 * print the same string.
 */
import type { FireOutcome, TriggerStatus } from './types';

export type Tone = 'ok' | 'warn' | 'bad';

export type CopyTone = 'success' | 'danger' | 'warning' | 'muted';

export const OUTCOME_COPY: Record<FireOutcome, { label: string; hint: string; tone: CopyTone }> = {
  fired: { label: 'Started', hint: 'The run has started.', tone: 'success' },
  queued: {
    label: 'Waiting its turn',
    hint: "Another run is in progress. This one will start when it's done.",
    tone: 'muted',
  },
  dropped: {
    label: 'Dropped — waited too long',
    hint: 'Queued for over 6 hours without the agent freeing up, so it was abandoned rather than delivered late.',
    tone: 'warning',
  },
  busy: {
    label: 'Skipped — already running',
    hint: 'It was skipped because another run was in progress and a previous run is still going.',
    tone: 'muted',
  },
  late: {
    label: 'Skipped — too late',
    hint: 'More than an hour past due, so it was re-armed for the next slot instead.',
    tone: 'muted',
  },
  waiting: {
    label: 'Not started yet',
    hint: 'Its start date is in the future. Nothing is wrong; it is simply not live.',
    tone: 'muted',
  },
  paused: {
    label: 'Skipped — agent paused',
    hint: 'The agent is paused, so this slot was skipped. Set the agent back to active to resume; the schedule itself is untouched.',
    tone: 'muted',
  },
  expired: {
    label: 'Ended',
    hint: 'Past its end date, so it switched itself off rather than staying armed for a run that will never come.',
    tone: 'muted',
  },
  stopped: {
    label: 'Stopped — no next run',
    hint: 'This schedule has no future dates. Check the days and months.',
    tone: 'danger',
  },
  skipped: {
    label: 'Nothing to ask',
    hint: 'No instructions — add a goal to this schedule or a description to the agent.',
    tone: 'warning',
  },
  refused: {
    label: 'Blocked',
    hint: "Usually the spend cap, or automatic runs aren't allowed.",
    tone: 'danger',
  },
  failed: {
    label: 'Failed to start',
    hint: 'something went wrong before it could begin.',
    tone: 'danger',
  },
};

/** The run's own status, once a firing has started one. `last_outcome` alone stops at "Started". */
const RUN_STATUS_COPY: Record<string, { label: string; tone: CopyTone | 'info' }> = {
  completed: { label: 'Succeeded', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  timeout: { label: 'Timed out', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
  paused: { label: 'Waiting for you', tone: 'warning' },
  running: { label: 'Running', tone: 'info' },
  pending: { label: 'Queued', tone: 'muted' },
};

export function lastRunCopy(
  outcome: string,
  runStatus: string | null | undefined,
): { label: string; tone: CopyTone | 'info' } | null {
  if (outcome !== 'fired' || !runStatus) return null;
  return RUN_STATUS_COPY[runStatus] ?? null;
}

/** ok shows nothing; warn needs attention but is not broken; bad will not fire until something changes. */
export function statusTone(status: TriggerStatus): Tone {
  if (status === 'ok') return 'ok';
  if (status === 'overdue' || status === 'failing' || status === 'not_started' || status === 'agent_paused') {
    return 'warn';
  }
  return 'bad';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Relative time, past or future, in the coarsest unit still useful. Mirrors the web's `relative`. */
export function relative(iso: string | null, now: number = Date.now()): string {
  if (!iso) return '—';
  const ms = new Date(iso).getTime() - now;
  if (Number.isNaN(ms)) return '—';
  const future = ms > 0;
  const abs = Math.abs(ms);
  const mins = Math.round(abs / 60_000);
  if (mins < 1) return future ? 'in under a minute' : 'just now';
  if (mins < 60) return future ? `in ${mins}m` : `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return future ? `in ${hrs}h` : `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return future ? `in ${days}d` : `${days}d ago`;
}

/** "Mon 14 Nov, 09:30" in the reader's own clock. */
export function absolute(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "YYYY-MM-DD HH:MM" from an ISO time, in the reader's clock. Empty for null. */
export function toLocalText(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * An ISO time from "YYYY-MM-DD HH:MM" in the reader's clock. `undefined` means
 * the text is not a date (the form refuses to save it); `null` means empty.
 */
export function fromLocalText(text: string): string | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(trimmed);
  if (!match) return undefined;
  const [y, mo, da, h, mi] = match.slice(1).map(Number);
  const d = new Date(y, mo - 1, da, h, mi);
  if (Number.isNaN(d.getTime()) || d.getMonth() !== mo - 1) return undefined;
  return d.toISOString();
}
