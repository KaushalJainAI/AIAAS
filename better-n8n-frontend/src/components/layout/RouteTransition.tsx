/**
 * Replays a short entrance animation whenever the route changes.
 *
 * The wrapper is keyed on the pathname, so React discards the previous
 * subtree and mounts a fresh one — which is what restarts the CSS animation.
 * There is no exit animation: keeping the outgoing page alive to fade it out
 * would mean two pages mounted at once, and pages here own websockets, polling
 * and streams that must not be duplicated for the sake of a crossfade.
 *
 * The search string is excluded from the key: filters and tabs written to the
 * query string are a change of content, not of page, and would otherwise flash
 * the whole route on every keystroke.
 */

import { useLocation } from 'react-router-dom';

export default function RouteTransition({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();

  return (
    <div key={pathname} className="page-enter h-full w-full">
      {children}
    </div>
  );
}
