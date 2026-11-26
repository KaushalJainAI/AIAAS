import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { hubFor } from '../../lib/navigation';
import { cn } from '../../lib/utils';

/* The section strip under a hub's page (Agents, Library, Connect). Shown only
 * on the hub's own pages: `hubFor` returns nothing for detail routes such as
 * /agents/12, so those pages keep the full height. Phones: a 44 px row that
 * scrolls sideways inside itself. Desktop: 36 px with an underline.
 *
 * Mounted once in the shell (App.tsx), above the routed page, so each page
 * still owns its own scroller. */
export default function HubTabs() {
  const { pathname } = useLocation();
  const hub = hubFor(pathname);
  const stripRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);
  const current = hub?.current;

  // Bring the lit tab into view on a phone. Set scrollLeft directly rather
  // than scrollIntoView: that would also scroll the overflow-hidden shell.
  useEffect(() => {
    const strip = stripRef.current;
    const active = activeRef.current;
    if (!strip || !active) return;
    strip.scrollLeft = active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2;
  }, [current]);

  if (!hub) return null;

  return (
    <nav
      aria-label={`${hub.label} sections`}
      className="relative shrink-0 border-b border-border bg-background"
    >
      <div ref={stripRef} className="scrollbar-none relative flex overflow-x-auto px-1 md:px-3">
        {hub.tabs.map((tab) => {
          const active = tab.path === hub.current;
          return (
            <Link
              key={tab.path}
              ref={active ? activeRef : undefined}
              to={tab.path}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-2 px-3 text-sm transition-colors md:h-9 md:min-h-0 md:px-3 md:text-[13px]',
                active
                  ? 'border-primary font-semibold text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
