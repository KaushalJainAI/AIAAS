import { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { useThemeContext } from './contexts/themeState';
import { AuthProvider } from './contexts/AuthContext';
import ThemeSync from './components/layout/ThemeSync';
import { useAuth } from './contexts/authState';
import Sidebar from './components/layout/Sidebar';
import Topbar from './components/layout/Topbar';
import MobileTopBar from './components/layout/MobileTopBar';
import MobileBottomNav from './components/layout/MobileBottomNav';
import { useHITLReminders } from './hooks/useHITLReminders';
import { useWebPush } from './hooks/useWebPush';
import { ImagineProvider } from './contexts/ImagineContext';
import { ImagineGlobalTracker } from './components/imagine/ImagineGlobalTracker';

import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import Signup from './pages/Signup';
import GoogleCallback from './pages/GoogleCallback';

import { Toaster } from 'sonner';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AssistantProvider } from './contexts/AssistantContext';
import RouteTransition from './components/layout/RouteTransition';
import { AppLoader } from './components/ui/Loading';

// Route-level code splitting.
//
// Everything below is reached by navigation, not by first paint, and some of
// it is expensive: the chat surfaces pull in the markdown stack. Loaded
// eagerly they all landed in one bundle behind a login screen that needs none
// of them. The auth pages stay static imports because they *are* the first
// paint.
// `ComponentType` (props default to `{}`) rather than `ComponentType<any>`:
// every page here is routed and takes no props, so this is the narrowest
// constraint that still accepts them all. `never` is too narrow — `React.lazy`
// itself is declared against `ComponentType<any>`.
const lazyPage = <T extends { default: React.ComponentType }>(
  load: () => Promise<T>,
) => lazy(load);

const AIChat = lazyPage(() => import('./pages/AIChat'));
const Apps = lazyPage(() => import('./pages/Apps'));
const AppFrame = lazyPage(() => import('./components/apps/AppFrame'));
const Dashboards = lazyPage(() => import('./pages/Dashboards'));
const Legal = lazy(() => import('./pages/Legal'));
const AgentBuilder = lazyPage(() => import('./pages/AgentBuilder'));
const AgentCreateWizard = lazyPage(() => import('./pages/AgentCreateWizard'));
const AgentHistory = lazyPage(() => import('./pages/AgentHistory'));
const Agents = lazyPage(() => import('./pages/Agents'));
const Connections = lazyPage(() => import('./pages/Connections'));
const Credentials = lazyPage(() => import('./pages/Credentials'));
const Documents = lazyPage(() => import('./pages/Documents'));
const Imagine = lazyPage(() => import('./pages/Imagine'));
const OAuthCallback = lazyPage(() => import('./pages/OAuthCallback'));
const Profile = lazyPage(() => import('./pages/Profile'));
const Runs = lazyPage(() => import('./pages/Runs'));
const Schedules = lazyPage(() => import('./pages/Schedules'));
const Settings = lazyPage(() => import('./pages/Settings'));
const Skills = lazyPage(() => import('./pages/Skills'));
const Evals = lazyPage(() => import('./pages/Evals'));
const PublicAgent = lazyPage(() => import('./pages/PublicAgent'));
const PublishedPageView = lazyPage(() => import('./pages/PublishedPageView'));
const Pages = lazyPage(() => import('./pages/Pages'));
const Templates = lazyPage(() => import('./pages/Templates'));
const Tools = lazyPage(() => import('./pages/Tools'));

// Protected route wrapper
function ProtectedRoute({ children }: { children?: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <AppLoader label="Checking your session" />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children ? <>{children}</> : <Outlet />;
}

// App shell — three navigation surfaces sharing lib/navigation.
// Desktop: Topbar (brand left, primary tabs centre, actions right) + the
// sidebar as the full catalogue beside it. Phones: MobileTopBar on top,
// MobileBottomNav fixed at the bottom (Ask / Agents / New / Activity / More,
// after nidhigrahudyog.com's Home / Shop / Chat / Offers / Orders row), and
// the sidebar as a drawer for everything else. <main> carries bottom padding
// below `md` so page content never slides under the fixed bar.
const Layout = () => {
  const { isAuthenticated } = useAuth();

  // One per-user HITL socket for the whole authenticated shell: raises OS
  // notifications for escalation/hourly/digest nudges and keeps the ['hitl']
  // cache (Sidebar badge, Activity) fresh.
  useHITLReminders(isAuthenticated);
  // Registers the Web Push service worker so subscribed browsers get OS
  // notifications with every tab closed. Subscription itself is opt-in in
  // Settings (ReminderPreferences) — this only registers the worker.
  useWebPush(isAuthenticated);

  return (
    <div className="flex h-viewport w-full flex-col bg-background text-foreground overflow-hidden">
      <Topbar />
      <MobileTopBar />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex min-h-0 overflow-hidden relative">
          <main className="flex-1 min-h-0 overflow-hidden relative pb-[68px] md:pb-0">
            <ErrorBoundary>
              <RouteTransition>
                <Outlet />
              </RouteTransition>
            </ErrorBoundary>
          </main>
        </div>
      </div>
      <MobileBottomNav />
      <ImagineGlobalTracker />
    </div>
  );
};

// Renders the polished StandaloneChat UI on the public landing path.
// - Authenticated visitors are forwarded to /ai-chat (full Layout with canvas-agent etc.)
// - Guests get the same StandaloneChat UI wrapped in a minimal public shell
//   (sidebar visible; auth-only nav items show "Log in" toasts on click).
const LandingRoute = () => {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) {
    return <AppLoader label="Checking your session" />;
  }
  if (isAuthenticated) return <Navigate to="/ai-chat" replace />;
  return (
    <div className="flex h-viewport w-full flex-col bg-background text-foreground overflow-hidden">
      <Topbar />
      <MobileTopBar />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex min-h-0 overflow-hidden relative">
          <main className="flex-1 min-h-0 overflow-hidden relative pb-[68px] md:pb-0">
            <ErrorBoundary>
              <AIChat />
            </ErrorBoundary>
          </main>
        </div>
      </div>
      <MobileBottomNav />
    </div>
  );
};

const AppContent = () => {
  const { resolvedTheme } = useThemeContext();
  
  return (
    <>
      <Router>
        <Suspense fallback={<AppLoader />}>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/auth/google/callback" element={<GoogleCallback />} />
          <Route path="/terms" element={<Legal doc="terms" />} />
          <Route path="/privacy" element={<Legal doc="privacy" />} />

          {/* Landing — guests get a dedicated minimal page; authed users go to /ai-chat */}
          {/* A publicly shared agent. Outside ProtectedRoute on purpose: it is
              the page a link posted off-platform lands on, and bouncing a
              visitor with no account to a login screen is exactly what
              choosing "public" was meant to avoid. */}
          <Route path="/a/:slug" element={<PublicAgent />} />
          <Route path="/p/:slug" element={<PublishedPageView />} />
          <Route path="/" element={<LandingRoute />} />

          {/* Credential OAuth popup. Protected because it completes the exchange
              as the signed-in user, but deliberately outside <Layout /> — it is a
              600px window that reports back to its opener and closes. Distinct
              from /auth/google/callback, which logs a user in. */}
          <Route element={<ProtectedRoute />}>
            <Route path="/oauth/callback" element={<OAuthCallback />} />
          </Route>

          {/* Protected routes */}
          <Route element={<ProtectedRoute />}>
            {/* Document apps run full-screen in AppFrame, outside <Layout />:
                the document gets the whole screen instead of two-thirds of
                it. The launcher (/apps) stays a normal page. */}
            <Route path="/apps/:appId" element={<AppFrame />} />
            <Route element={<Layout />}>
              <Route path="/ai-chat" element={<AIChat />} />
              {/* The workflow *list* is retired: automations are listed on
                  /agents, and a workflow canvas is opened from an agent, a
                  template or a run — never browsed as its own catalogue. The
                  editor routes stay so every existing deep link still opens. */}
              <Route path="/workflows" element={<Navigate to="/agents" replace />} />
              {/* The DAG editor is gone (AGENT_BLOCKS_PLAN.md §6). Old links land on agents. */}
              <Route path="/workflow/:id" element={<Navigate to="/agents" replace />} />
              <Route path="/workflows/new" element={<Navigate to="/agents" replace />} />
              <Route path="/documents" element={<Documents />} />
              <Route path="/pages" element={<Pages />} />
              <Route path="/dashboards" element={<Dashboards />} />
              <Route path="/apps" element={<Apps />} />
              {/* Connections merges the former "Data sources" (/connectors) and
                  "Tools" (/mcp-servers), which were two views of the same two
                  tables. Both paths redirect so existing links keep working. */}
              <Route path="/connections" element={<Connections />} />
              <Route path="/connectors" element={<Navigate to="/connections" replace />} />
              <Route path="/mcp-servers" element={<Navigate to="/connections" replace />} />
              <Route path="/credentials" element={<Credentials />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/billing" element={<Navigate to="/settings" replace />} />
              {/* Insights lives only in Settings now: one way in, not two.
                  The old top-level path lands on its tab so saved links keep
                  working. */}
              <Route path="/insights" element={<Navigate to="/settings?tab=insights" replace />} />
              {/* Activity (/runs) is the single surface: approvals first, then
                  runs. /overview, /inbox and /orchestrator redirect here so
                  deep links and saved notification links keep working. */}
              <Route path="/overview" element={<Navigate to="/runs" replace />} />
              {/* The live monitor is superseded by Activity (approvals first,
                  then runs). /inbox is kept as redirect. */}
              <Route path="/orchestrator" element={<Navigate to="/runs" replace />} />
              <Route path="/skills" element={<Skills />} />
              <Route path="/evals" element={<Evals />} />
              <Route path="/imagine" element={<Imagine />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/tools" element={<Tools />} />
              {/* Work — Activity absorbs Inbox: keep /inbox as redirect so deep links stay valid */}
              <Route path="/inbox" element={<Navigate to="/runs" replace />} />
              <Route path="/runs" element={<Runs />} />
              {/* Missions live inside Activity now (goals above their runs);
                  keep /missions as a redirect so saved links keep working. */}
              <Route path="/missions" element={<Navigate to="/runs" replace />} />
              <Route path="/schedules" element={<Schedules />} />
              {/* Build — creation is the orchestrator wizard; the builder is edit-only */}
              <Route path="/agents" element={<Agents />} />
              <Route path="/agents/new" element={<AgentCreateWizard />} />
              {/* Templates sit beside the agent list rather than inside it:
                  installing one is how most people get their first agent, so
                  it needs a link you can send someone. */}
              <Route path="/templates" element={<Templates />} />
              {/* A deep link to one entry, which is what "anyone with the
                  link" shares. It opens the same install dialog, so a
                  pasted link and a click from the grid land identically. */}
              <Route path="/templates/:slug" element={<Templates />} />
              <Route path="/agents/:id" element={<AgentBuilder />} />
              {/* The configuration timeline grows for the life of the agent, so
                  it is a page rather than a section of the builder, which shows
                  only the newest few and links here. */}
              <Route path="/agents/:id/history" element={<AgentHistory />} />
              {/* The agent canvas was retired 2026-08-24: a run is read on
                  /runs, not projected onto a graph. */}
              <Route path="/agents/:id/canvas" element={<Navigate to="/agents" replace />} />
              {/* Extraction lives inside Documents now (schema admin) and Inbox
                  (the review queue); /extract routes were removed 2026-08-18. */}
              <Route path="/extract/*" element={<Navigate to="/documents" replace />} />
              {/* Runs replaced the old dead-end redirect. */}
              <Route path="/executions" element={<Navigate to="/runs" replace />} />
            </Route>
          </Route>
        </Routes>
        </Suspense>
      </Router>
      <Toaster richColors position="bottom-left" theme={resolvedTheme} duration={1500} />
    </>
  );
};

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ThemeSync />
        <AssistantProvider>
          <ImagineProvider>
            <AppContent />
          </ImagineProvider>
        </AssistantProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
