/**
 * Where a tapped notification opens in the app.
 *
 * The backend sends `data.action_url` as a website path (e.g. `/runs`,
 * `/agents/12`, `/ai-chat?session=5`). This maps the paths the app has a
 * screen for to those screens. Anything else is opened in the embedded web
 * app, so no notification reaches a dead end. Only a path that starts with a
 * single `/` is followed.
 */
import type { Href } from 'expo-router';

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The app route for an `action_url`, or null when it is not an in-app path. */
export function routeForActionUrl(actionUrl: unknown): Href | null {
  if (typeof actionUrl !== 'string') return null;
  const value = actionUrl.trim();
  // A single leading slash only. `//host` (a protocol-relative link) and backslashes are refused.
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;

  const queryAt = value.indexOf('?');
  const path = (queryAt < 0 ? value : value.slice(0, queryAt)).replace(/\/+$/, '') || '/';
  const query = queryAt < 0 ? '' : value.slice(queryAt + 1);

  if (path === '/runs') return '/more/runs';
  if (path === '/inbox') return '/inbox';
  if (path === '/team') return '/more/team';
  if (path === '/schedules') return '/more/schedules';
  if (path === '/agents') return '/agents';

  const agent = /^\/agents\/([^/]+)$/.exec(path);
  if (agent && SAFE_ID.test(agent[1])) return `/agents/${agent[1]}`;

  if (path === '/ai-chat') {
    const session = sessionFrom(query);
    return session ? `/chat/${session}` : '/chat';
  }

  return { pathname: '/web', params: { path: value, title: 'AIAAS' } };
}

/** The route for a tapped notification's data, or null when it has no `action_url`. */
export function hrefFromNotificationData(data: unknown): Href | null {
  if (!data || typeof data !== 'object') return null;
  return routeForActionUrl((data as Record<string, unknown>).action_url);
}

function sessionFrom(query: string): string | null {
  for (const pair of query.split('&')) {
    const eq = pair.indexOf('=');
    if (eq < 0 || pair.slice(0, eq) !== 'session') continue;
    const id = pair.slice(eq + 1);
    return SAFE_ID.test(id) ? id : null;
  }
  return null;
}
