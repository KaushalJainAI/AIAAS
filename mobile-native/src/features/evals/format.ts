/**
 * Evals wording and the small pure helpers the screens share. Copied from
 * better-n8n-frontend/src/pages/Evals.tsx and components/evals/*, so the same
 * sentences appear on the phone as on the web.
 *
 * The one rule: a score is provisional until a person has been asked. A run in
 * `awaiting_review` has `passed === null`, and it is shown as provisional, never as
 * a failure and never as a blank.
 */
import type { SupervisionPolicy, EvalRun, RunStatus, EvalCase } from './types';

/** Why each policy exists, in the terms the backend documents them in. */
export const SUPERVISION_HELP: Record<SupervisionPolicy, string> = {
  none: 'Trust the graders. Nothing is queued for review.',
  failures: 'Queue every result the graders failed. A failing case is always worth a human minute.',
  disagreement:
    'Queue only the results where the judge and the exact checks disagree, or the judge was uncertain. The default, and the only policy whose review cost does not grow with the suite.',
  sampled: 'Queue a random percentage of results.',
  all: 'Queue every result. Thorough, and the most expensive in your time.',
};

export const SUPERVISION_ORDER: SupervisionPolicy[] = ['none', 'failures', 'disagreement', 'sampled', 'all'];

export const RUN_STATUS_LABEL: Record<string, string> = {
  pending: 'Queued',
  queued: 'Queued',
  running: 'Running',
  awaiting_review: 'Awaiting review',
  completed: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export const CATEGORY_LABELS: Record<string, string> = {
  normal: 'Normal task',
  ambiguous: 'Should ask',
  impossible: 'Should give up',
  gated: 'Needs approval',
  trap: 'Trap',
  'from-run': 'From a real run',
};

/** A case's category, from the tag the generator wrote. Plain cases are normal tasks. */
export function caseCategory(c: Pick<EvalCase, 'tags'>): string {
  if (c.tags.includes('from-run')) return 'from-run';
  const hit = c.tags.find((t) => t in CATEGORY_LABELS);
  return hit ?? 'normal';
}

/** A score that can still move is shown as provisional. */
export function scoreText(run: Pick<EvalRun, 'score' | 'passed' | 'status' | 'pending_review_count'>): {
  text: string;
  provisional: boolean;
  passed: boolean | null;
} {
  const pct = run.score === null ? null : Math.round(run.score * 100);
  if (run.status === 'awaiting_review' || run.passed === null) {
    const base = pct === null ? '—' : `${pct}%`;
    const queue = run.pending_review_count > 0 ? ` · ${run.pending_review_count} to review` : '';
    return { text: `${base} provisional${queue}`, provisional: true, passed: null };
  }
  if (pct === null) return { text: '—', provisional: false, passed: null };
  return { text: `${pct}% ${run.passed ? 'pass' : 'fail'}`, provisional: false, passed: run.passed };
}

/** A sentence for a suite's cases count. */
export function casesWord(n: number): string {
  return `${n} case${n === 1 ? '' : 's'}`;
}

/** The lines the "what changed" panel shows for one result's world changes. */
export function changedLines(changes?: Record<string, unknown>): string[] {
  if (!changes || typeof changes !== 'object') return [];
  const lines: string[] = [];
  const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
  const files = strList(changes.files_written);
  if (files.length > 0) {
    lines.push(`wrote ${files.slice(0, 3).join(', ')}${files.length > 3 ? ` +${files.length - 3} more` : ''}`);
  }
  const removed = strList(changes.files_removed);
  if (removed.length > 0) lines.push(`removed ${removed.slice(0, 3).join(', ')}`);
  const mail = changes.mail as Record<string, unknown> | undefined;
  if (mail && typeof mail === 'object') {
    const sent = mail.sent as { to?: string }[] | undefined;
    if (Array.isArray(sent) && sent.length > 0) {
      lines.push(
        `sent ${sent.length} email${sent.length === 1 ? '' : 's'} (${sent
          .slice(0, 2)
          .map((x) => x?.to ?? '')
          .filter(Boolean)
          .join(', ')})`,
      );
    }
    const drafts = mail.drafts as unknown[] | undefined;
    if (Array.isArray(drafts) && drafts.length > 0) lines.push(`${drafts.length} draft${drafts.length === 1 ? '' : 's'}`);
  }
  const cal = changes.calendar as Record<string, unknown> | undefined;
  if (cal && typeof cal === 'object') {
    for (const [key, label] of [
      ['events_created', 'created'],
      ['events_updated', 'updated'],
      ['events_deleted', 'deleted'],
    ] as const) {
      const items = cal[key] as unknown[] | undefined;
      if (Array.isArray(items) && items.length > 0) lines.push(`${label} ${items.length} event${items.length === 1 ? '' : 's'}`);
    }
  }
  const drive = changes.drive as Record<string, unknown> | undefined;
  if (drive && typeof drive === 'object') {
    const cells = drive.cells_updated as unknown[] | undefined;
    if (Array.isArray(cells) && cells.length > 0) lines.push(`updated ${cells.length} sheet range${cells.length === 1 ? '' : 's'}`);
    const created = drive.files_created as unknown[] | undefined;
    if (Array.isArray(created) && created.length > 0) lines.push(`created ${created.length} drive file${created.length === 1 ? '' : 's'}`);
  }
  const web = changes.web as Record<string, unknown> | undefined;
  if (web && typeof web === 'object') {
    const searches = web.searches as unknown[] | undefined;
    const reads = web.reads as unknown[] | undefined;
    const bits = [
      Array.isArray(searches) && searches.length > 0 ? `${searches.length} search${searches.length === 1 ? '' : 'es'}` : '',
      Array.isArray(reads) && reads.length > 0 ? `${reads.length} read${reads.length === 1 ? '' : 's'}` : '',
    ].filter(Boolean);
    if (bits.length > 0) lines.push(`web: ${bits.join(', ')}`);
  }
  return lines;
}

/** Whether a sweep can still change, so it must not be deleted and is re-read while on screen. */
export function isLiveRun(status: RunStatus): boolean {
  return status === 'pending' || status === 'queued' || status === 'running';
}

