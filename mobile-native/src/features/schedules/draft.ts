/**
 * The schedule form's state, and how it converts to and from the wire.
 *
 * Cron is the storage; the builder's spec is a view of it (see ./cron.ts). A
 * draft keeps the typed start and end as text so a half-typed date does not
 * vanish while the user is still typing it.
 */
import { DEFAULT_SPEC, fromCron, localZone, toCron, type ScheduleSpec } from './cron';
import { fromLocalText, toLocalText } from './format';
import type { OverlapPolicy, Trigger } from './types';

export interface ScheduleDraft {
  spec: ScheduleSpec;
  timezone: string;
  name: string;
  goal: string;
  overlap: OverlapPolicy;
  /** "YYYY-MM-DD HH:MM" in the reader's clock, or '' for none. */
  startsText: string;
  endsText: string;
}

export function emptyDraft(): ScheduleDraft {
  return {
    spec: { ...DEFAULT_SPEC },
    timezone: localZone(),
    name: '',
    goal: '',
    overlap: 'skip',
    startsText: '',
    endsText: '',
  };
}

export function draftFromTrigger(t: Trigger): ScheduleDraft {
  return {
    spec: fromCron(t.schedule_cron || t.config?.cron || ''),
    timezone: t.timezone || 'UTC',
    name: t.name || '',
    goal: t.goal || '',
    overlap: t.overlap,
    startsText: toLocalText(t.starts_at),
    endsText: toLocalText(t.ends_at),
  };
}

/** Whether both dates parse (or are empty), so the form can save. */
export function datesValid(draft: ScheduleDraft): boolean {
  return fromLocalText(draft.startsText) !== undefined && fromLocalText(draft.endsText) !== undefined;
}

export function cronOf(draft: ScheduleDraft): string {
  return toCron(draft.spec);
}
