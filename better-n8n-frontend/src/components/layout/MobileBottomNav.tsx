import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Activity, Bot, Menu, MessageCircle, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { isNavActive } from '../../lib/navigation';
import { useAuth } from '../../contexts/authState';
import { useHitlPending } from '../../hooks/useHitlPending';
import { useLiveCount } from '../../hooks/useActivityLive';
import { openSidebar } from './sidebarBus';

/* Phone bottom tab bar, 60px tall: Ask / Agents / New / Activity / More.
 * New chat is a plain item like the others (plus icon, "New" label), not a
 * raised round button. "More" opens the drawer, which stays the full
 * catalogue — the bar carries the daily loop, never the whole app.
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

  const askActive = location.pathname.startsWith('/ai-chat');
  const agentsActive = location.pathname.startsWith('/agents') || location.pathname.startsWith('/workflow');

  const activityActive = isNavActive(location.pathname, { icon: Activity, label: 'Activity', path: '/runs' });

  const itemClass = (active: boolean) =>
    cn(
      'relative flex h-full min-h-10 flex-col items-center justify-center gap-0.5 rounded text-[11px] transition-colors',
      active ? 'font-semibold text-primary' : 'text-muted-foreground hover:text-foreground',
    );

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="grid h-[60px] grid-cols-5 items-stretch px-1 py-1">
        {/* Ask */}
        <Link
          to="/ai-chat"
          aria-current={askActive ? 'page' : undefined}
          className={itemClass(askActive)}
        >
          <MessageCircle className="h-5 w-5" />
          Ask
        </Link>
        {/* Automations */}
        <Link
          to="/agents"
          onClick={guardGuest('Automations')}
          aria-current={agentsActive ? 'page' : undefined}
          className={itemClass(agentsActive)}
        >
          <Bot className="h-5 w-5" />
          Agents
        </Link>
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
        {/* Activity */}
        <Link
          to="/runs"
          onClick={guardGuest('Activity')}
          aria-current={activityActive ? 'page' : undefined}
          className={itemClass(activityActive)}
        >
          <span className="relative">
            <Activity className="h-5 w-5" />
            {!isGuest && runningCount > 0 && (
              <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-agent animate-agent-pulse" />
            )}
            {!isGuest && pendingCount > 0 && (
              <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded bg-warning px-1 text-[9px] font-bold text-background">
                {pendingCount > 9 ? '9+' : pendingCount}
              </span>
            )}
          </span>
          Activity
        </Link>
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
