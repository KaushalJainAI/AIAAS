/**
 * Where a notification's `data.action_url` leads on the phone. The web writes
 * web paths (`/runs`, `/ai-chat?session=4`, `/documents?doc=9`); this maps the
 * ones the app has a screen for to native routes, and sends anything else to
 * the embedded web app with the same path. A value that is not a same-origin
 * in-app path is refused (null), so a stored link can never become an open
 * redirect. Same rule as the web's `safeTarget`.
 */
import { safePath } from '../../lib/paths';

export type NotificationTarget =
  | { kind: 'native'; pathname: string; params?: Record<string, string> }
  | { kind: 'web'; path: string; title: string };

const DIGITS = /^\d+$/;

/** The native route for an action path, or the web app when there is none. Null for an unsafe value. */
export function targetFor(actionUrl: unknown): NotificationTarget | null {
  const path = safePath(actionUrl);
  if (!path) return null;

  const q = path.indexOf('?');
  const base = q < 0 ? path : path.slice(0, q);
  const query = new URLSearchParams(q < 0 ? '' : path.slice(q + 1));
  const segments = base.split('/').filter(Boolean);

  switch (segments[0]) {
    case 'runs':
    case 'overview':
      return { kind: 'native', pathname: '/more/runs' };
    case 'schedules':
      return { kind: 'native', pathname: '/more/schedules' };
    case 'team':
    case 'solutions':
      return { kind: 'native', pathname: '/more/team' };
    case 'inbox':
      return { kind: 'native', pathname: '/inbox' };
    case 'documents':
      // The Files tab; the document id is the one thing a card needs, and the web view opens it.
      return query.get('doc') && DIGITS.test(query.get('doc') ?? '')
        ? { kind: 'web', path: `/documents?doc=${query.get('doc')}`, title: 'Files' }
        : { kind: 'native', pathname: '/files' };
    case 'ai-chat':
    case 'chat': {
      const session = query.get('session') ?? '';
      return DIGITS.test(session)
        ? { kind: 'native', pathname: '/chat/[id]', params: { id: session } }
        : { kind: 'native', pathname: '/chat' };
    }
    case 'agents': {
      const id = segments[1] ?? '';
      if (DIGITS.test(id)) return { kind: 'native', pathname: '/agents/[id]', params: { id } };
      return { kind: 'native', pathname: '/agents' };
    }
    default:
      return { kind: 'web', path, title: 'Web' };
  }
}
