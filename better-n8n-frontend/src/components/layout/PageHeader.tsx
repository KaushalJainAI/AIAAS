import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import SidebarMenuButton from './SidebarMenuButton';

interface PageHeaderProps {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  iconClassName?: string;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export default function PageHeader({ 
  title, 
  subtitle, 
  icon: Icon,
  iconClassName,
  actions,
  children,
  className 
}: PageHeaderProps) {
  return (
    <div className={cn("px-4 py-6 md:px-8 md:py-8 border-b border-border bg-card sticky top-0 z-20", className)}>
      <div className={cn("flex flex-col md:flex-row md:items-center justify-between gap-4 md:gap-6", children && "mb-6 md:mb-8")}>
        {/* Menu button is in-flow at the row start (md:hidden), so the title
            never needs clearance padding and the 40px slot is identical on
            every page — that slot is what standardises the title bar. */}
        <div className="flex items-center gap-3 md:gap-4 min-w-0">
          <SidebarMenuButton />
          <div className="p-2.5 md:p-3 bg-primary/10 rounded-lg shrink-0">
            <Icon className={cn("w-5 h-5 md:w-6 md:h-6 text-primary", iconClassName)} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl md:text-2xl font-bold truncate">{title}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {subtitle}
            </p>
          </div>
        </div>
        
        {actions && (
          <div className="flex flex-wrap items-center gap-2 md:gap-3">
            {actions}
          </div>
        )}
      </div>
      
      {children}
    </div>
  );
}
