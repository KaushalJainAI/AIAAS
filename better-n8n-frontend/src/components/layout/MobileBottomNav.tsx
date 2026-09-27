import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Activity, Bot, Menu, MessageCircle, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { isNavActive } from '../../lib/navigation';
import { useAuth } from '../../contexts/authState';
import { useHitlPending } from '../../hooks/useHitlPending';
import { useLiveCount } from '../../hooks/useActivityLive';
import { openSidebar } from './sidebarBus';

/* Phone bottom tab bar — the reference site's Home / Shop / Chat / Offers /
 * Orders row, mapped onto this app: Ask / Automations / New / Activity /
 * More. The centre slot is the primary action (New chat), raised like their
 * floating Chat button. "More" opens the drawer, which stays the full
 * catalogue — the bar carries the daily loop, never the whole app.
 *
 * `fixed` + safe-area padding; the shell compensates with bottom padding on
 * <main> so content never slides underneath. Badges reuse the shared query
 * keys, same as the topbar and sidebar.
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

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="grid grid-cols-5 items-stretch px-1 pt-1">
        {/* Ask */}
        <Link
          to="/ai-chat"
          aria-current={askActive ? 'page' : undefined}
          className={cn(
            'flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] transition-colors',
            askActive
              ? 'font-semibold text-primary'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <MessageCircle className="h-5 w-5" />
          Ask
        </Link>
        {/* Automations */}
        <Link
          to="/agents"
          onClick={guardGuest('Automations')}
          aria-current={agentsActive ? 'page' : undefined}
          className={cn(
            'flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] transition-colors',
            agentsActive
              ? 'font-semibold text-primary'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Bot className="h-5 w-5" />
          Agents
        </Link>
        {/* Centre action — New chat */}
        <div className="flex items-start justify-center">
          <button
            type="button"
            aria-label="New chat"
            onClick={() => navigate(isGuest ? '/' : '/ai-chat', { state: { newChat: true } })}
            className="flex h-12 w-12 -translate-y-2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-colors hover:bg-primary/90"
          >
            <Plus className="h-6 w-6" />
          </button>
        </div>
        {/* Activity */}
        <Link
          to="/runs"
          onClick={guardGuest('Activity')}
          aria-current={activityActive ? 'page' : undefined}
          className={cn(
            'relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] transition-colors',
            activityActive ? 'font-semibold text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <span className="relative">
            <Activity className="h-5 w-5" />
            {!isGuest && runningCount > 0 && (
              <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-agent animate-agent-pulse" />
            )}
            {!isGuest && pendingCount > 0 && (
              <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
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
          className="flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <Menu className="h-5 w-5" />
          More
        </button>
      </div>
    </nav>
  );
}
