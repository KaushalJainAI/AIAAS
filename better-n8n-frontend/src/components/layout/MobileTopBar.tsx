import { Link, useNavigate } from 'react-router-dom';
import { GitGraph, Plus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../contexts/authState';
import { useHitlPending } from '../../hooks/useHitlPending';
import { useLiveCount } from '../../hooks/useActivityLive';

/* Phone top bar — brand + actions.
 *
 * The reference site condenses its desktop header on phones to logo + icons
 * and moves navigation to the bottom tabs; this does the same. There is
 * deliberately no menu button here: every page header already owns the one
 * `Open menu` button (the mobile e2e pins exactly one), and the bottom bar's
 * "More" opens the same drawer. The pending pill deep-links to Activity so
 * an approval is one tap away.
 */
export default function MobileTopBar() {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const customName = user?.instance_name?.trim();
  const brand = customName && customName !== 'AIAAS Instance' ? customName : 'AIAAS';

  const { data: pending = [] } = useHitlPending(isAuthenticated);
  const pendingCount = pending.length;
  const runningCount = useLiveCount(isAuthenticated);

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
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-3 md:hidden">
      <Link to={isAuthenticated ? '/ai-chat' : '/'} className="flex min-w-0 items-center gap-2" aria-label={`${brand} home`}>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10">
          <GitGraph className="h-3.5 w-3.5 text-primary" />
        </span>
        <span className="truncate text-base font-bold tracking-tight" title={brand}>
          {brand}
        </span>
      </Link>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {isAuthenticated && (pendingCount > 0 || runningCount > 0) && (
          <Link
            to="/runs"
            aria-label={`${pendingCount} approvals waiting`}
            className={cn(
              'flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-semibold',
              pendingCount > 0
                ? 'bg-primary text-primary-foreground'
                : 'bg-agent-subtle text-agent border border-agent-line',
            )}
          >
            {pendingCount > 0 ? pendingCount : runningCount}
          </Link>
        )}
        <button
          type="button"
          aria-label="New chat"
          onClick={() => navigate(isAuthenticated ? '/ai-chat' : '/', { state: { newChat: true } })}
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          <Plus className="h-5 w-5" />
        </button>
        {isAuthenticated ? (
          <Link
            to="/profile"
            aria-label="Profile and settings"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-muted text-xs font-semibold text-muted-foreground"
          >
            {initials}
          </Link>
        ) : (
          <Link
            to="/login"
            className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
          >
            Log in
          </Link>
        )}
      </div>
    </header>
  );
}
