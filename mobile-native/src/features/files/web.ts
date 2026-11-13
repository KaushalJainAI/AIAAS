/**
 * Route helpers shared by the file, app, page and dashboard screens.
 */
import type { Href } from 'expo-router';

/**
 * A web screen in the in-app web view. `path` must start with one slash;
 * `app/web.tsx` refuses anything else.
 */
export function webHref(path: string, title: string): Href {
  return { pathname: '/web', params: { path, title } };
}
