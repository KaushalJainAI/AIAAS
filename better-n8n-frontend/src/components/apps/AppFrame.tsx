/**
 * The full-screen frame for `/apps/:appId`.
 *
 * A document app is an application, not a page in the admin panel: it keeps
 * the per-user sockets (`useHITLReminders`, `useWebPush`), the error boundary
 * and the imagine tracker, and drops the Topbar, Sidebar and MobileBottomNav
 * — the document gets the whole screen, on desktop and on phones.
 */
import { useParams } from 'react-router-dom';

import { useAuth } from '../../contexts/authState';
import { useHITLReminders } from '../../hooks/useHITLReminders';
import { useWebPush } from '../../hooks/useWebPush';
import { ErrorBoundary } from '../ErrorBoundary';
import { ImagineGlobalTracker } from '../imagine/ImagineGlobalTracker';
import AppWorkspace from '../../pages/AppWorkspace';
import { SaveProvider } from './SaveContext';

export default function AppFrame() {
  const { isAuthenticated } = useAuth();
  useHITLReminders(isAuthenticated);
  useWebPush(isAuthenticated);
  const { appId } = useParams();

  return (
    <div className="flex h-viewport w-full flex-col overflow-hidden bg-background text-foreground">
      <ErrorBoundary>
        <SaveProvider>
          <AppWorkspace key={appId} />
        </SaveProvider>
      </ErrorBoundary>
      <ImagineGlobalTracker />
    </div>
  );
}
