/**
 * Rules for the agent's browser calls (`BrowserView`), as pure functions.
 *
 * No React and no network here, so vitest can test every rule. The same
 * parser reads a live `browser_update` frame, a saved message's
 * `metadata.browser` and a run's `output_data.browser`, so all three agree on
 * what a valid call is.
 */
import type { BrowserStep, BrowserView } from '@/api/browser';
import { isSafeExternalUrl } from '@/lib/safeUrl';

/** The backend keeps at most this many calls, newest last. */
export const MAX_BROWSER_VIEWS = 10;
/** Steps a call may carry (the backend's cap). */
export const MAX_BROWSER_STEPS = 15;

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

function parseStep(value: unknown): BrowserStep | null {
  if (!value || typeof value !== 'object') return null;
  const s = value as Record<string, unknown>;
  return { action: str(s.action), selector: str(s.selector), ok: s.ok === true };
}

function parseView(value: unknown): BrowserView | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const steps = Array.isArray(v.steps)
    ? v.steps.map(parseStep).filter((s): s is BrowserStep => s !== null).slice(0, MAX_BROWSER_STEPS)
    : [];
  return {
    frame_id: str(v.frame_id),
    url: str(v.url),
    title: str(v.title),
    session: str(v.session),
    live_url: str(v.live_url),
    steps,
    needs_user: typeof v.needs_user === 'string' && v.needs_user.trim() ? v.needs_user : null,
  };
}

/**
 * The calls from a frame or a stored record, newest last, capped. Anything
 * that is not a call is dropped rather than shown half-built.
 */
export function parseBrowserViews(value: unknown): BrowserView[] {
  if (!Array.isArray(value)) return [];
  const views = value.map(parseView).filter((v): v is BrowserView => v !== null);
  return views.slice(-MAX_BROWSER_VIEWS);
}

/** The host of a page, for the chip and the address row. The URL itself when it has no host. */
export function hostOf(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host || url;
  } catch {
    return url || 'page';
  }
}

/** The distinct hosts the calls visited, in the order first seen. */
export function hostsOf(views: BrowserView[]): string[] {
  const seen: string[] = [];
  for (const v of views) {
    const host = hostOf(v.url);
    if (host && !seen.includes(host)) seen.push(host);
  }
  return seen;
}

/** "Browser · example.com", plus "+2" when the calls went to more sites. */
export function browserLabel(views: BrowserView[]): string {
  const hosts = hostsOf(views);
  if (hosts.length === 0) return 'Browser';
  const more = hosts.length > 1 ? ` +${hosts.length - 1}` : '';
  return `Browser · ${hosts[0]}${more}`;
}

/** The newest call that is waiting for the person, or null. */
export function awaitingUser(views: BrowserView[]): BrowserView | null {
  for (let i = views.length - 1; i >= 0; i -= 1) {
    if (views[i].needs_user) return views[i];
  }
  return null;
}

/** The newest live view that is safe to open in a new tab, or null. */
export function liveViewOf(views: BrowserView[]): string | null {
  for (let i = views.length - 1; i >= 0; i -= 1) {
    const url = views[i].live_url;
    if (url && isSafeExternalUrl(url)) return url;
  }
  return null;
}

/** The text the "I'm done" button sends. The model knows to call the same session again. */
export function doneMessage(host: string): string {
  return `Done on ${host}. Continue.`;
}
