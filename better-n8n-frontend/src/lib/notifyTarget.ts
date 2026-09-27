/**
 * Where a notification wants to send you, and whether this tab should say
 * anything about it at all.
 *
 * The complaint this answers: every nudge fired a toast *and* an OS-level
 * ping in every open tab, even while the user was staring at the exact page
 * the nudge was about. A notification is for someone who is not looking —
 * someone looking at the approval queue does not need a popup saying there
 * is an approval queue.
 *
 * Three outcomes, not two: `silent` (already looking — refresh lists/badges
 * only), `toast` (in the app but elsewhere — in-app notice, no OS ping),
 * `loud` (not looking at the app at all — toast plus the OS notification).
 *
 * URL safety follows `lib/nextPath.ts::safeNext`: only same-origin paths are
 * ever treated as targets. Anything else is not a target, so it can never
 * suppress a nudge nor become a navigation.
 */

/** How loudly this tab should surface one incoming nudge. */
export type Surface = 'silent' | 'toast' | 'loud';

/** The identity-carrying query keys writers use (`?request=`, `?run=`, `?session=`). */
const IDENTITY_KEYS = ['request', 'run', 'session'] as const;

/**
 * A same-origin in-app path, or null. Same rule as `safeNext` but nullable:
 * a refused value means "no target", never a fallback page — falling back to
 * a default here would mark the user as viewing something they are not.
 */
export function safeTarget(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null;
  return raw;
}

function splitTarget(target: string): { base: string; params: URLSearchParams } {
  const q = target.indexOf('?');
  if (q < 0) return { base: target, params: new URLSearchParams() };
  return { base: target.slice(0, q), params: new URLSearchParams(target.slice(q + 1)) };
}

/**
 * Whether the tab showing `pathname + search` is already looking at what
 * `actionUrl` points to. Same base route, and when the link names a specific
 * request / run / session, the same one — being on `/runs` while the nudge is
 * about request B is being elsewhere, not being there.
 */
export function isViewingTarget(pathname: string, search: string, actionUrl: string): boolean {
  const target = safeTarget(actionUrl);
  if (!target) return false;
  const want = splitTarget(target);
  if (want.base !== pathname) return false;
  const here = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  for (const key of IDENTITY_KEYS) {
    const id = want.params.get(key);
    if (id !== null && here.get(key) !== id) return false;
  }
  return true;
}

export interface Presence {
  route: string;
  visible: boolean;
  ts: number;
}

const PRESENCE_KEY = 'aiaas.presence';
/** How long another tab's sighting counts as "still looking". */
export const PRESENCE_TTL_MS = 20_000;

/** Announce what this tab is showing. Cheap: called on navigation + visibility flips, not per render. */
export function reportPresence(pathname: string, search: string, visible: boolean): void {
  try {
    const presence: Presence = { route: `${pathname}${search}`, visible, ts: Date.now() };
    localStorage.setItem(PRESENCE_KEY, JSON.stringify(presence));
  } catch {
    // Private mode / denied storage: presence is an optimisation, never load-bearing.
  }
}

function readPresence(): Presence | null {
  try {
    const raw = localStorage.getItem(PRESENCE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Presence>;
    if (typeof parsed.route !== 'string' || typeof parsed.ts !== 'number') return null;
    return { route: parsed.route, visible: parsed.visible === true, ts: parsed.ts };
  } catch {
    return null;
  }
}

/**
 * Whether *another* context is visibly on the notification's target. The
 * writer's own tab evaluates `isViewingTarget` itself; this covers the sibling
 * tab that is showing the queue while this one sits hidden.
 */
export function peerViewingTarget(actionUrl: string, now: number = Date.now()): boolean {
  const target = safeTarget(actionUrl);
  if (!target) return false;
  const peer = readPresence();
  if (!peer || !peer.visible || now - peer.ts > PRESENCE_TTL_MS) return false;
  const q = peer.route.indexOf('?');
  const pathname = q < 0 ? peer.route : peer.route.slice(0, q);
  const search = q < 0 ? '' : peer.route.slice(q);
  return isViewingTarget(pathname, search, target);
}

/** Whether any tab (this one excepted by the caller) recently reported being visible. */
export function peerOnPlatform(now: number = Date.now()): boolean {
  const peer = readPresence();
  return !!peer && peer.visible && now - peer.ts <= PRESENCE_TTL_MS;
}

/**
 * The whole rule in one place so the hook stays thin and the matrix is testable:
 *
 * - looking at the target here, or a sibling tab is → `silent`
 * - this tab visible but elsewhere → `toast`
 * - a sibling tab visible but elsewhere → `toast` (its tab toasts; no OS ping from here)
 * - nobody looking → `loud`
 */
export function decideSurface(args: {
  selfVisible: boolean;
  selfViewing: boolean;
  peerViewing: boolean;
  peerVisible: boolean;
}): Surface {
  if (args.selfViewing || args.peerViewing) return 'silent';
  if (args.selfVisible || args.peerVisible) return 'toast';
  return 'loud';
}
