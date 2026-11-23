import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { isNavActive, primaryNav, type NavItem } from '../../lib/navigation';
import { useAuth } from '../../contexts/authState';
import { useHitlPending } from '../../hooks/useHitlPending';
import { useLiveCount } from '../../hooks/useActivityLive';
import { openSidebar } from './sidebarBus';

/* Phone bottom tab bar, 60px tall: Ask / Agents / New / Activity / More.
 * The three tabs come from `primaryNav` in lib/navigation, so the bar and the
 * destinations cannot drift apart. New chat is a plain item like the others
 * (plus icon, "New" label), not a raised round button. "More" opens the
 * drawer, which stays the full catalogue — the bar carries the daily loop,
 * never the whole app.
 *
 * `fixed` + safe-area padding; the shell compensates with bottom padding on
 * <main> so content never slides underneath. Badges reuse the shared query
 * keys, same as the sidebar.
 */
export default function MobileBottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const isGuest = !isAuthenticated;

  const { data: pending = [] } = useHitlPending(isAuthenticated);
  const pendingCount = pending.length;
  const runningCount = useLiveCount(isAuthenticated);

  const guardGuest = (label: string) => (e: React.MouseEvent) => {
    if (isGuest) {
      e.preventDefault();
      toast.info(`Log in to use ${label}`);
      navigate('/login');
    }
  };

  const itemClass = (active: boolean) =>
    cn(
      'relative flex h-full min-h-10 flex-col items-center justify-center gap-0.5 rounded text-[11px] transition-colors',
      active ? 'font-semibold text-primary' : 'text-muted-foreground hover:text-foreground',
    );

  // One tab from `primaryNav`. The `agent` and `pending` flags say which tab
  // carries the running dot and the waiting count.
  const renderTab = (item: NavItem) => {
    const active = isNavActive(location.pathname, item);
    return (
      <Link
        key={item.path}
        to={item.path}
        onClick={item.guestOk ? undefined : guardGuest(item.label)}
        aria-current={active ? 'page' : undefined}
        className={itemClass(active)}
      >
        <span className="relative flex">
          <item.icon className="h-5 w-5" />
          {item.agent && !isGuest && runningCount > 0 && (
            <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-agent animate-agent-pulse" />
          )}
          {item.pending && !isGuest && pendingCount > 0 && (
            <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded bg-warning px-1 text-[9px] font-bold text-background">
              {pendingCount > 9 ? '9+' : pendingCount}
            </span>
          )}
        </span>
        {item.label}
      </Link>
    );
  };

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="grid h-[60px] grid-cols-5 items-stretch px-1 py-1">
        {primaryNav.slice(0, 2).map(renderTab)}
        {/* New chat — a plain item like its neighbours */}
        <button
          type="button"
          aria-label="New chat"
          onClick={() => navigate(isGuest ? '/' : '/ai-chat', { state: { newChat: true } })}
          className="flex h-full min-h-10 flex-col items-center justify-center gap-0.5 rounded text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <Plus className="h-5 w-5" />
          New
        </button>
        {primaryNav.slice(2).map(renderTab)}
        {/* More — opens the full drawer */}
        <button
          type="button"
          aria-label="More destinations"
          onClick={openSidebar}
          className="flex h-full min-h-10 flex-col items-center justify-center gap-0.5 rounded text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <Menu className="h-5 w-5" />
          More
        </button>
      </div>
    </nav>
  );
}
