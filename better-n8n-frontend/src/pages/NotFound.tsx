/**
 * The page for an address that matches no route.
 *
 * Without a catch-all, `<Routes>` rendered nothing: a mistyped or outdated
 * link was a blank screen with no way back. Rendered inside the app shell for
 * a signed-in user (the sidebar is the way back) and bare for a guest.
 */
import { Link, useLocation } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { useAuth } from '../contexts/authState';

export default function NotFound() {
  const { pathname } = useLocation();
  const { isAuthenticated } = useAuth();

  return (
    <div className="h-full min-h-[60vh] flex items-center justify-center p-8 bg-background text-foreground">
      <div className="text-center max-w-md">
        <div className="w-14 h-14 mx-auto mb-5 bg-secondary rounded-full flex items-center justify-center">
          <Compass className="w-7 h-7 text-muted-foreground" />
        </div>
        <h1 className="text-xl font-bold mb-2">Page not found</h1>
        <p className="text-sm text-muted-foreground mb-6 break-words">
          There is nothing at <span className="font-mono">{pathname}</span>. The
          link may be old, or the address mistyped.
        </p>
        <div className="flex gap-3 justify-center">
          <Link
            to={isAuthenticated ? '/ai-chat' : '/'}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90"
          >
            Go to chat
          </Link>
          {isAuthenticated && (
            <Link
              to="/agents"
              className="px-4 py-2 rounded-lg border border-border text-sm font-semibold hover:bg-secondary"
            >
              Your agents
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
