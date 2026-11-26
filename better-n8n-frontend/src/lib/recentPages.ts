/* Recent pages: the places a signed-in person actually used, newest first.
 *
 * Pure rules here (paths, dedupe, cap, labels) and the storage door. The
 * storage is per browser and per account: `lib/accountData.ts` forgets the key
 * on sign-out. Only a path and a title are kept, never page content.
 * Plan: Backend/docs/RECENT_PAGES_PLAN.md (R1).
 */
import { navGroups } from './navigation';

export interface RecentPage {
  path: string;
  title: string;
  /** When the visit counted, in epoch ms. */
  at: number;
}

export const RECENT_PAGES_KEY = 'aiaas_ui:recentPages';
/** Window event fired after the list is written, so open views re-read it. */
export const RECENT_PAGES_CHANGED_EVENT = 'aiaas:recent-pages-changed';
export const RECENT_PAGES_CAP = 12;

const TITLE_MAX = 120;
/** The only query parameters that name a different place. Others only scroll or filter. */
const KEPT_PARAMS = ['session', 'tab'] as const;
/** Sign-in, sign-up, OAuth, public pages and the landing page are never recorded. */
const EXCLUDED = ['/login', '/signup', '/forgot-password', '/auth', '/oauth', '/terms', '/privacy', '/a', '/p'];
const APP_NAME = 'AIAAS';

function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * The stored form of a visited path: no trailing slash, only `session` and
 * `tab` kept from the query. Null when the page is never recorded.
 */
export function normalisePath(pathname: string, search = ''): string | null {
  if (!pathname.startsWith('/')) return null;
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/' || EXCLUDED.some((prefix) => isUnder(path, prefix))) return null;

  const params = new URLSearchParams(search);
  const kept: string[] = [];
  for (const key of KEPT_PARAMS) {
    const value = params.get(key);
    if (value) kept.push(`${key}=${encodeURIComponent(value)}`);
  }
  return kept.length > 0 ? `${path}?${kept.join('&')}` : path;
}

/**
 * The list with one visit added. A place already in the list moves to the
 * front with its new title and time. Excluded paths leave the list as it was.
 */
export function record(
  list: readonly RecentPage[],
  entry: { path: string; title: string },
  now: number,
): RecentPage[] {
  const [pathname, search = ''] = entry.path.split('?');
  const path = normalisePath(pathname, search);
  if (path === null) return list.slice(0, RECENT_PAGES_CAP);

  const title = (entry.title.trim() || labelForPath(path)).slice(0, TITLE_MAX);
  const rest = list.filter((page) => page.path !== path);
  return [{ path, title, at: now }, ...rest].slice(0, RECENT_PAGES_CAP);
}

function isRecentPage(value: unknown): value is RecentPage {
  if (typeof value !== 'object' || value === null) return false;
  const page = value as Record<string, unknown>;
  return (
    typeof page.path === 'string' &&
    page.path.startsWith('/') &&
    typeof page.title === 'string' &&
    typeof page.at === 'number' &&
    Number.isFinite(page.at)
  );
}

/** What is stored, or [] when storage is blocked, empty, or not the shape we wrote. */
export function readRecentPages(): RecentPage[] {
  try {
    const raw = window.localStorage.getItem(RECENT_PAGES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentPage).slice(0, RECENT_PAGES_CAP);
  } catch {
    return [];
  }
}

export function writeRecentPages(list: readonly RecentPage[]): void {
  try {
    window.localStorage.setItem(RECENT_PAGES_KEY, JSON.stringify(list.slice(0, RECENT_PAGES_CAP)));
  } catch {
    // Storage blocked or full: the list is simply not kept.
  }
  try {
    window.dispatchEvent(new Event(RECENT_PAGES_CHANGED_EVENT));
  } catch {
    // No window (tests without a DOM): nobody is listening.
  }
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function timeAgo(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (!(minutes >= 1)) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

function humanise(word: string): string {
  const spaced = word.replace(/[-_]+/g, ' ').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : '';
}

/**
 * A label from the nav when the path is one we know ("Activity", "Library ·
 * Files"), else a word from the path itself. Used when a page sets no title.
 */
export function labelForPath(path: string): string {
  const [pathname, search = ''] = path.split('?');
  const first = pathname.split('/')[1] ?? '';
  const items = navGroups.flatMap((group) => group.items);
  const hub =
    items.find((item) => item.path === pathname) ??
    items.find((item) => item.path === `/${first}` || item.match?.includes(`/${first}`));
  const hubLabel = hub?.label ?? humanise(first);
  const tab = new URLSearchParams(search).get('tab');
  // A hub's first tab shares the hub's own path, so it adds nothing to the label.
  const ownTab = hub?.tabs?.find((t) => t.path === pathname && t.path !== hub.path);
  const sub = ownTab?.label ?? (tab ? humanise(tab) : undefined);
  const label = sub ? `${hubLabel} · ${sub}` : hubLabel;
  return label || 'Page';
}

/**
 * The browser tab's title, cleaned of the app name and the chat's progress
 * marks ("● (2/5) Chat — AIAAS" is "Chat"). Falls back to the path's label.
 */
export function pageTitle(path: string, documentTitle: string): string {
  const cleaned = documentTitle
    .replace(/^[●✓]\s*(\(\d+\/\d+\)\s*)?/u, '')
    .replace(/\s+[—–-]\s*AIAAS$/u, '')
    .trim();
  if (!cleaned || cleaned === APP_NAME) return labelForPath(path);
  return cleaned;
}
