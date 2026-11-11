import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import SidebarMenuButton from './SidebarMenuButton';

interface PageHeaderProps {
  title: string;
  subtitle: string;
  /** Accepted for every existing caller; the compact row no longer draws it. */
  icon: LucideIcon;
  iconClassName?: string;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/* The page title row: 44px tall, title and a short muted subtitle inline,
 * actions on the right, a bottom border. The mobile menu button sits in-flow at
 * the start (desktop never sees it, the sidebar is always there). Children
 * render beneath the row, for a page's own tabs or filters. */
export default function PageHeader({
  title,
  subtitle,
  actions,
  children,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("sticky top-0 z-20 bg-card", className)}>
      <div className="flex h-11 items-center gap-3 border-b border-border px-3 md:px-4">
        <SidebarMenuButton />
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          {/* On phones the 52px top bar already names the page, so the title is
              kept for screen readers only there; the subtitle and actions stay. */}
          <h1 className="sr-only md:not-sr-only md:max-w-[60%] md:shrink-0 md:truncate md:text-[15px] md:font-semibold md:text-foreground">
            {title}
          </h1>
          {subtitle && (
            <p className="min-w-0 truncate text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2">
            {actions}
          </div>
        )}
      </div>

      {children}
    </div>
  );
}
