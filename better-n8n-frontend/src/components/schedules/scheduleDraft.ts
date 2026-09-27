/**
 * The shape a schedule is edited in, kept out of `ScheduleEditor.tsx`.
 *
 * Not a stylistic split: exporting a function alongside a component defeats
 * fast refresh for the whole module, so editing the editor would lose the
 * modal's in-progress draft on every keystroke-triggered reload. The same
 * reason `OSContext.tsx` in BrowserOS holds its provider alone.
 */
import type { OverlapPolicy } from '../../api';
import { DEFAULT_SPEC, localZone, toCron } from '../../lib/cron';

export interface ScheduleDraft {
  cron: string;
  timezone: string;
  name: string;
  goal: string;
  overlap: OverlapPolicy;
  /** ISO, or null for "from now" / "for ever". */
  startsAt: string | null;
  endsAt: string | null;
}

/** A new schedule: every day at 09:00, in the viewer's own zone. */
export function emptyDraft(): ScheduleDraft {
  return {
    cron: toCron(DEFAULT_SPEC),
    timezone: localZone(),
    name: '',
    goal: '',
    overlap: 'skip',
    startsAt: null,
    endsAt: null,
  };
}
