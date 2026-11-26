import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { hubFor, type Hub } from '../../lib/navigation';
import { cn } from '../../lib/utils';
import { useHubTabsClaimed } from '../../lib/hubHeader';

/* The section tabs of a hub (Agents, Library, Connect).
 *
 * Normally drawn inside the page's own header (PageHeader), so the tabs and the
 * page's buttons share one row. The standalone strip below is the fallback for
 * hub pages that have no PageHeader (Files, Studio): it hides itself while a
 * header has claimed the tabs (`hubHeader.tsx`). `hubFor` returns nothing for
 * detail routes such as /agents/12, so those pages keep the full height. */
export default function HubTabs() {
  const { pathname } = useLocation();
  const hub = hubFor(pathname);
  const claimed = useHubTabsClaimed();
  if (!hub || claimed) return null;

  return (
    <nav
      aria-label={`${hub.label} sections`}
      className="relative flex h-11 shrink-0 border-b border-border bg-card px-4 md:h-14 md:px-6"
    >
      <HubTabLinks hub={hub} />
    </nav>
  );
}

/* The tab links themselves, shared by the standalone strip and PageHeader.
 * Full height of whatever row holds them, so the active underline sits on that
 * row's bottom border. Phones: the row scrolls sideways inside itself and the
 * lit tab is brought into view. */
export function HubTabLinks({ hub, className }: { hub: Hub; className?: string }) {
  const stripRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);
  const current = hub.current;

  // Set scrollLeft directly rather than scrollIntoView: that would also
  // scroll the overflow-hidden shell.
  useEffect(() => {
    const strip = stripRef.current;
    const active = activeRef.current;
    if (!strip || !active) return;
    strip.scrollLeft = active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2;
  }, [current]);

  return (
    <div
      ref={stripRef}
      className={cn('scrollbar-none -mb-px flex min-w-0 gap-6 self-stretch overflow-x-auto', className)}
    >
      {hub.tabs.map((tab) => {
        const active = tab.path === current;
        return (
          <Link
            key={tab.path}
            ref={active ? activeRef : undefined}
            to={tab.path}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-w-11 shrink-0 items-center justify-center whitespace-nowrap border-b-2 text-sm transition-colors md:text-[14px]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40',
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
  );
}
