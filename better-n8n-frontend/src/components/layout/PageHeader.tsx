import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useInRouterContext, useLocation } from 'react-router-dom';
import { hubFor, type Hub } from '../../lib/navigation';
import { cn } from '../../lib/utils';
import { useClaimHubTabs } from '../../lib/hubHeader';
import { HubTabLinks } from './HubTabs';
import SidebarMenuButton from './SidebarMenuButton';

interface PageHeaderProps {
  title: string;
  /** Accepted for every existing caller; the row no longer draws it. Counts
   * and one-line descriptions read as noise in a header, and the page body
   * already says what the page holds. */
  subtitle: string;
  /** Accepted for every existing caller; the compact row no longer draws it. */
  icon: LucideIcon;
  iconClassName?: string;
  actions?: ReactNode;
  /** A page's own tabs (e.g. Activity's), drawn in the row where the title
   * would be, like a hub's tabs. Pass `<PageTabs inline … />`. */
  tabs?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/* The one header row of a page: 44px on phones, 56px on desktop, 24px in from
 * the edge, actions on the right, a bottom border.
 *
 * On a hub page (Agents, Library, Connect) the hub's tabs take the title's
 * place, so tabs and buttons share this single row instead of stacking two
 * bars; the title stays for screen readers. Elsewhere the row shows the title.
 * The mobile menu button sits in-flow at the start (desktop never sees it).
 * Children render beneath the row in a padded strip, for a page's own tabs or
 * filters. */
export default function PageHeader(props: PageHeaderProps) {
  // Rendered outside a router in isolated tests: no route, so no hub.
  return useInRouterContext() ? <RoutedHeader {...props} /> : <HeaderRow {...props} hub={null} />;
}

function RoutedHeader(props: PageHeaderProps) {
  const hub = hubFor(useLocation().pathname);
  useClaimHubTabs(hub !== null);
  return <HeaderRow {...props} hub={hub} />;
}

function HeaderRow({
  title,
  actions,
  tabs,
  children,
  className,
  hub,
}: PageHeaderProps & { hub: Hub | null }) {
  return (
    <div className={cn('sticky top-0 z-20 bg-card', className)}>
      <div className="flex h-11 items-center gap-4 border-b border-border px-4 md:h-14 md:px-6">
        <SidebarMenuButton />
        {hub ? (
          <>
            <h1 className="sr-only">{title}</h1>
            <nav aria-label={`${hub.label} sections`} className="flex min-w-0 flex-1 self-stretch">
              <HubTabLinks hub={hub} />
            </nav>
          </>
        ) : tabs ? (
          <>
            <h1 className="sr-only">{title}</h1>
            <div className="flex min-w-0 flex-1 self-stretch">{tabs}</div>
          </>
        ) : (
          <div className="flex min-w-0 flex-1 items-center">
            {/* On phones the 52px top bar already names the page, so the title
                is kept for screen readers only there. */}
            <h1 className="sr-only md:not-sr-only md:truncate md:text-[15px] md:font-semibold md:text-foreground">
              {title}
            </h1>
          </div>
        )}
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>

      {/* Padded like the row above so a page's filters line up with it (24px
          in on desktop). */}
      {children && <div className="border-b border-border px-4 py-2.5 md:px-6">{children}</div>}
    </div>
  );
}
