/**
 * The Team knowledge page's URL rules, kept out of the component so they can be
 * tested without a DOM: `?tab=`, `?org=`, `?id=`, `?attention=`, `?tag=`, `?mine=`.
 *
 * The page is served at `/team` and, for old links, `/solutions`. Notifications
 * and the server write these parameters, so every reader here is forgiving:
 * an unknown value falls back to the default instead of failing the page.
 */

export const TEAM_TABS = ['library', 'drafts', 'queue', 'insights', 'team'] as const;
export type TeamTab = (typeof TEAM_TABS)[number];

/** Old `?tab=` values, kept so saved links still open the right place. */
const LEGACY_TABS = new Map<string, TeamTab>([
  ['solutions', 'library'],
  ['organisation', 'team'],
]);

/** The server's cap on a tag filter (`solutions/views.py` cuts it to 40 characters). */
const TAG_LIMIT = 40;

/** `?tab=` → a tab. Unknown or missing values open the library. */
export function teamTabOf(param: string | null): TeamTab {
  if (param && (TEAM_TABS as readonly string[]).includes(param)) return param as TeamTab;
  if (param && LEGACY_TABS.has(param)) return LEGACY_TABS.get(param) as TeamTab;
  return 'library';
}

/** The queue and the insights are for curators of the organisation only. */
export function isCuratorTab(tab: TeamTab): boolean {
  return tab === 'queue' || tab === 'insights';
}

/** The tabs a viewer is shown, in order. */
export function visibleTabs(canCurate: boolean): TeamTab[] {
  return TEAM_TABS.filter((tab) => canCurate || !isCuratorTab(tab));
}

/**
 * `?org=` → the scope it names: an organisation id, `null` for `personal`, or
 * `undefined` when the parameter is absent or not a valid id (the caller then
 * uses the organisation the viewer has active).
 */
export function scopeOfParam(param: string | null): number | null | undefined {
  if (param === 'personal') return null;
  if (param && /^[1-9]\d*$/.test(param)) return Number(param);
  return undefined;
}

/** The scope as it is written into `?org=`. */
export function paramOfScope(scope: number | null): string {
  return scope == null ? 'personal' : String(scope);
}

/** `?id=` → a solution id, or null. */
export function openIdOf(param: string | null): number | null {
  if (param && /^[1-9]\d*$/.test(param)) return Number(param);
  return null;
}

/** A switch in the URL: `1` or `true` are on, anything else is off. */
export function flagOn(param: string | null): boolean {
  return param === '1' || param === 'true';
}

/** A tag as the list filter takes it: trimmed, lower-cased and bounded. */
export function cleanTag(param: string | null): string {
  return (param ?? '').trim().toLowerCase().slice(0, TAG_LIMIT);
}

/** The reasons the server gives for "Needs attention" (`solutions/attention.py`). */
export type AttentionReason = 'needs_check' | 'doubtful' | 'claims_stale';

/** A plain-language badge for one attention reason. Unknown reasons still read as attention. */
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

/**
 * A logged search, written as the problem a "Write the answer" form starts
 * from. The server stores queries lower-cased; the first letter is put back.
 */
export function problemFromQuery(query: string): string {
  const text = query.trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

/**
 * The share of searches that found something, as a whole percentage. With no
 * searches there is nothing to take a share of, so the answer is a dash.
 */
export function answeredPercent(answered: number, searches: number): string {
  if (!searches || searches <= 0) return '—';
  return `${Math.round((answered / searches) * 100)}%`;
}
