import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Bell, GitGraph, Plus } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { isNavActive, navGroups } from '../../lib/navigation';
import { useAuth } from '../../contexts/authState';
import { useHitlPending } from '../../hooks/useHitlPending';
import { useLiveCount } from '../../hooks/useActivityLive';
import { notificationsService } from '../../api';

/* Desktop topbar — the primary navigation surface.
 *
 * Brand and the current section left, account actions right. Navigation
 * lives in the Sidebar alone — the topbar used to repeat every link (tabs
 * plus "More"), and the sidebar repeated the brand, New chat and profile,
 * so each surface now owns one job. A thin
 * status strip above it (the analogue of their "FREE shipping over ₹499"
 * announcement bar) appears only when something needs you — approvals
 * waiting or runs active — and deep-links to Activity.
 *
 * Rendered `hidden md:flex` by the shell; phones get MobileTopBar instead.
 * Badge queries reuse the sidebar's keys (['hitl-pending'], ['nav','running'],
 * ['notifications']) so the two surfaces share one poll, not two.
 */
export default function Topbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const isGuest = !isAuthenticated;
  const customName = user?.instance_name?.trim();
  const brand = customName && customName !== 'AIAAS Instance' ? customName : 'AIAAS';

  const { data: pending = [] } = useHitlPending(isAuthenticated);
  const pendingCount = pending.length;
  const runningCount = useLiveCount(isAuthenticated);
  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    enabled: isAuthenticated,
    refetchInterval: 30_000,
    queryFn: notificationsService.getNotifications,
  });
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const current = navGroups
    .flatMap((g) => g.items)
    .find((item) => isNavActive(location.pathname, item));

  const initials = (() => {
    if (user?.name) {
      const parts = user.name.split(' ');
      if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      return user.name.slice(0, 2).toUpperCase();
    }
    if (user?.email) return user.email.slice(0, 2).toUpperCase();
    return '??';
  })();

  const showStrip = isAuthenticated && (pendingCount > 0 || runningCount > 0);

  return (
    <header className="hidden md:block border-b bg-card" style={{ borderColor: 'hsl(var(--sidebar-border))' }}>
      {/* Status strip — announcement-bar analogue. Rendered only when there is
          something to say, so it never becomes decoration. */}
      {showStrip && (
        <Link
          to="/runs"
          className="flex h-8 items-center justify-center gap-2 bg-primary-subtle px-4 text-xs font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
        >
          {pendingCount > 0 && <span>{pendingCount} approval{pendingCount === 1 ? '' : 's'} waiting</span>}
          {pendingCount > 0 && runningCount > 0 && <span aria-hidden>·</span>}
          {runningCount > 0 && <span>{runningCount} run{runningCount === 1 ? '' : 's'} active</span>}
        </Link>
      )}
      <div className="flex h-14 items-center gap-4 px-4">
        {/* Brand — left, like the reference logo slot. */}
        <Link to={isGuest ? '/' : '/ai-chat'} className="flex shrink-0 items-center gap-2.5" aria-label={`${brand} home`}>
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 shadow-sm">
            <GitGraph className="h-4 w-4 text-primary" />
          </span>
          <span className="max-w-[10rem] truncate text-lg font-bold tracking-tight" title={brand}>
            {brand}
          </span>
        </Link>

        {/* Where you are — the sidebar owns navigation, so the topbar names
            the current section instead of repeating the links. */}
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted-foreground">
          {current && (
            <>
              <span aria-hidden className="text-border">/</span>
              <current.icon className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate font-medium text-foreground">{current.label}</span>
            </>
          )}
        </div>

        {/* Actions — right, like the reference language / wishlist / account / cart icons. */}
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(isGuest ? '/' : '/ai-chat', { state: { newChat: true } })}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            New chat
          </button>
          {isAuthenticated ? (
            <>
              <Link
                to="/settings"
                aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : 'Notifications'}
                className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <Bell className="h-[18px] w-[18px]" />
                {unreadCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full border border-background bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </Link>
              <Link
                to="/profile"
                aria-label="Profile and settings"
                title={user?.email ?? 'Profile'}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-muted text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
              >
                {initials}
              </Link>
            </>
          ) : (
            <Link
              to="/login"
              className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Log in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
