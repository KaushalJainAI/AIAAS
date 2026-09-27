import { Menu } from 'lucide-react';
import { cn } from '../../lib/utils';
import { openSidebar } from './sidebarBus';

interface SidebarMenuButtonProps {
  className?: string;
}

/* The one mobile menu button. Rendered at the start of every title bar
   (PageHeader plus the custom headers), `md:hidden` so desktop — where the
   sidebar is always on screen — never sees it. Fixed 40px slot, ghost style,
   vertically centred by the parent row: identical in every header, which is
   what standardises the title bar across pages. */
export default function SidebarMenuButton({ className }: SidebarMenuButtonProps) {
  return (
    <button
      type="button"
      onClick={openSidebar}
      aria-label="Open menu"
      className={cn(
        'md:hidden -ml-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
        'text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
        className,
      )}
    >
      <Menu className="h-5 w-5" />
    </button>
  );
}
