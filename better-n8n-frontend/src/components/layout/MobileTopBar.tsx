import { Link, useLocation } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { isNavActive, navGroups } from '../../lib/navigation';
import { useAuth } from '../../contexts/authState';
import { useHitlPending } from '../../hooks/useHitlPending';
import { useLiveCount } from '../../hooks/useActivityLive';

/* Phone top bar — one 52px row: where you are, what waits for you, and the
 * account. No logo row: the bottom bar carries navigation and the brand lives
 * in the drawer. The title is the current destination's name (the same lookup
 * the desktop top bar used); a route outside the catalogue falls back to the
 * instance name.
 *
 * Every page header still owns the one `Open menu` button (the mobile e2e pins
 * exactly one), so there is no menu button here. The pending pill deep-links
 * to Activity so an approval is one tap away.
 */
export default function MobileTopBar() {
  const location = useLocation();
  const { user, isAuthenticated } = useAuth();
  const customName = user?.instance_name?.trim();
  const brand = customName && customName !== 'AIAAS Instance' ? customName : 'AIAAS';

  const { data: pending = [] } = useHitlPending(isAuthenticated);
  const pendingCount = pending.length;
  const runningCount = useLiveCount(isAuthenticated);

  const current = navGroups
    .flatMap((g) => g.items)
    .find((item) => isNavActive(location.pathname, item));
  const title = current?.label ?? brand;
  // Activity is the one destination whose state is worth a line under its name.
  const subtitle =
    current?.path === '/runs' && isAuthenticated
      ? `${pendingCount} need${pendingCount === 1 ? 's' : ''} you · ${runningCount} live`
      : null;

  const initials = (() => {
    if (user?.name) {
      const parts = user.name.split(' ');
      if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      return user.name.slice(0, 2).toUpperCase();
    }
    if (user?.email) return user.email.slice(0, 2).toUpperCase();
    return '??';
  })();

  return (
    <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border bg-background px-4 md:hidden">
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <h1 className="truncate text-[15px] font-semibold leading-tight text-foreground" title={title}>
          {title}
        </h1>
        {subtitle && (
          <p className="truncate text-[11px] leading-tight text-muted-foreground">{subtitle}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {isAuthenticated && (pendingCount > 0 || runningCount > 0) && (
          <Link
            to="/runs"
            aria-label={`${pendingCount} approvals waiting`}
            className={cn(
              'flex h-10 min-w-10 items-center justify-center gap-1.5 rounded px-2.5 text-[13px] font-semibold',
              pendingCount > 0
                ? 'bg-warning-subtle text-warning'
                : 'bg-agent-subtle text-agent',
            )}
          >
            {pendingCount > 0 && <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden />}
            {pendingCount > 0 ? pendingCount : runningCount}
          </Link>
        )}
        {isAuthenticated ? (
          <Link
            to="/profile"
            aria-label="Profile and settings"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-muted text-xs font-semibold text-muted-foreground"
          >
            {initials}
          </Link>
        ) : (
          <Link
            to="/login"
            className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
          >
            Log in
          </Link>
        )}
      </div>
    </header>
  );
}
