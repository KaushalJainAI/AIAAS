/**
 * Team knowledge helpers ported from better-n8n-frontend/src/lib/solutionsPage.ts:
 * the reasons a fix needs attention, the tag rule, paging, and the insight numbers.
 */
import type { OrgScope, SolutionListStatus } from './types';

/** The server's cap on a tag filter (`solutions/views.py` cuts it to 40 characters). */
const TAG_LIMIT = 40;

/** A tag as the list filter takes it: trimmed, lower-cased and bounded. */
export function cleanTag(raw: string | undefined): string {
  return (raw ?? '').trim().toLowerCase().slice(0, TAG_LIMIT);
}

/** A plain-language label for one attention reason. Unknown reasons still read as attention. */
export function attentionLabel(reason: string): string {
  switch (reason) {
    case 'needs_check':
      return 'Needs check';
    case 'doubtful':
      return 'Doubtful';
    case 'claims_stale':
      return 'Claims may be out of date';
    default:
      return 'Needs attention';
  }
}

/** The offset of the next page, or undefined when the list has no more. */
export function nextPageParam(page: { next_offset?: number | null }): number | undefined {
  return typeof page.next_offset === 'number' ? page.next_offset : undefined;
}

/** A logged search, written as the problem a "Write the answer" form starts from. */
export function problemFromQuery(query: string): string {
  const text = query.trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

/** The share of searches that found something, as a whole percentage. No searches gives a dash. */
export function answeredPercent(answered: number, searches: number): string {
  if (!searches || searches <= 0) return '—';
  return `${Math.round((answered / searches) * 100)}%`;
}

/** The org id as the screen params carry it: `personal` or the id. */
export function scopeParam(org: OrgScope): string {
  return org == null ? 'personal' : String(org);
}

/** A screen param back to a scope. Anything unknown is the personal library. */
export function scopeOfParam(raw: string | undefined): OrgScope {
  if (raw && /^[1-9]\d*$/.test(raw)) return Number(raw);
  return null;
}

/** The status a tab lists, or undefined for the library. */
export function statusForTab(tab: 'library' | 'drafts' | 'queue'): SolutionListStatus | undefined {
  if (tab === 'drafts') return 'draft';
  if (tab === 'queue') return 'pending_review';
  return undefined;
}
