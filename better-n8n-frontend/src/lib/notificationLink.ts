import type { Notification } from '../api/notifications';

/**
 * Where tapping a notification should go, or `null` when it should not go anywhere.
 *
 * The backend writes one navigable key: `data.action_url`, an in-app path such
 * as `/runs?request=<id>`, `/ai-chat?session=<id>` or `/team?org=<id>&tab=queue`.
 * The other keys in `data` (`request_id`, `execution_id`, `session_id`,
 * `request_ids`, `pending_count`, `stage`, `kind`) are identifiers for the
 * server, not links, so they are ignored here. Rendering them as a route would
 * guess at URLs the app may not have.
 *
 * Refusing is the default. A value only becomes a link when it is:
 *   - a single-slash path on this origin (no `//host`, no `/\host`, no
 *     whitespace or tabs, which browsers strip before parsing), and
 *   - under a route the app actually serves.
 * Anything else returns `null`, and the tap only marks the row read.
 */

/** The first segment of every route a notification is allowed to open. */
const IN_APP_ROUTES = new Set<string>([
  '/agents',
  '/ai-chat',
  '/apps',
  '/billing',
  '/connections',
  '/credentials',
  '/dashboards',
  '/documents',
  '/evals',
  '/imagine',
  '/inbox',
  '/insights',
  '/missions',
  '/pages',
  '/profile',
  '/runs',
  '/schedules',
  '/settings',
  '/skills',
  '/solutions',
  '/team',
  '/templates',
  '/tools',
  '/workflow',
]);

export function notificationLink(
  n: Pick<Notification, 'data'> | null | undefined,
): string | null {
  const raw = n?.data?.action_url;
  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  if (/[\s\\]/.test(raw)) return null;
  // Up to the first `/`, `?` or `#`: `/agents/12` and `/runs?request=x` have
  // bases `/agents` and `/runs`.
  const base = `/${raw.slice(1).split(/[/?#]/)[0]}`;
  return IN_APP_ROUTES.has(base) ? raw : null;
}
