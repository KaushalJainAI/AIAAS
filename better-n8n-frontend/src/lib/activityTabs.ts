/**
 * The Activity page's tabs, and how one is read from the URL.
 *
 * Grouped by the question a person brings to the page:
 *   now      — does anything need me, and what is running? (the default)
 *   planned  — what will run: missions and schedules
 *   history  — what already ran: recent outcomes and the run history
 *   files    — what changed in files and workspaces
 *
 * `?tab=` makes each one linkable. An unknown or missing value lands on `now`,
 * never on an empty page, so an old link is never a dead end.
 */
export const ACTIVITY_TABS = ['now', 'planned', 'history', 'files'] as const;
export type ActivityTab = (typeof ACTIVITY_TABS)[number];

export const ACTIVITY_TAB_LABELS: Record<ActivityTab, string> = {
  now: 'Now',
  planned: 'Planned',
  history: 'History',
  files: 'Files',
};

export function parseActivityTab(value: string | null | undefined): ActivityTab {
  return (ACTIVITY_TABS as readonly string[]).includes(value ?? '')
    ? (value as ActivityTab)
    : 'now';
}
