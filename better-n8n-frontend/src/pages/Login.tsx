import { useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Mail, Lock, ArrowRight, GitGraph } from 'lucide-react';
import { useAuth } from '../contexts/authState';
import { googleAuthAvailable, googleAuthorizeUrl } from '../lib/googleAuth';
import { nextFrom } from '../lib/nextPath';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { IconTile } from '../components/ui/IconTile';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Submit state for *this form*. `isLoading` from useAuth is the loading flag
  // of the `authProfile` query, not of the login request -- so the button's
  // disabled binding read false for the whole time a login was in flight and
  // the button stayed clickable. Five rapid clicks sent five POSTs, burning the 5/minute login
  // throttle on one user action. A ref alongside the state because React
  // batches state updates: two clicks in the same tick would both observe
  // `submitting === false` and both get through.
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const { login, isLoading, error, clearError } = useAuth();
  const navigate = useNavigate();
  /* Where this visitor was heading. A public agent link sends people here
     with `?next=`, and landing them on the dashboard instead loses the page
     they came for. `nextFrom` refuses anything that is not an in-app path,
     so the parameter cannot become an open redirect. */
  const { search } = useLocation();
  const landing = nextFrom(search);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    clearError();

    try {
      await login(email, password);
      navigate(landing);
    } catch {
      // Error is handled by AuthContext
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  const busy = submitting || isLoading;

  const handleGoogleLogin = () => {
    window.location.href = googleAuthorizeUrl();
  };

  return (


    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 relative overflow-hidden">
      
      <div className="w-full max-w-md space-y-8 relative z-10 animate-slide-up">
        <div className="text-center">
          <div className="inline-flex mb-6">
            <IconTile size="lg">
              <GitGraph className="w-6 h-6" />
            </IconTile>
          </div>
          <h1 className="text-3xl font-bold mb-2">Welcome back</h1>
          <p className="mt-2 text-muted-foreground">
            Enter your credentials to access your workspace
          </p>
        </div>

        <div className="glass rounded-lg p-8">
          {error && (
            <div className="mb-4">
              <Alert tone="error">{error}</Alert>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70" htmlFor="email">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                <input
                  id="email"
                  type="email"
                  placeholder="name@example.com"
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 pl-10 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary/50 transition-colors duration-150"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium leading-none" htmlFor="password">
                  Password
                </label>
                <Link to="/forgot-password" className="text-sm font-medium text-primary hover:text-primary/80 transition-colors">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                <input
                  id="password"
                  type="password"
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 pl-10 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary/50 transition-colors duration-150"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            <Button
              type="submit"
              loading={busy}
              className="w-full"
            >
              {!busy && (
                <>
                  Sign in
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
              {busy && <>Signing in...</>}
            </Button>
          </form>

          {/* Hidden where the built redirect URI does not match this origin —
              Google would reject it and strand the user on an error page. */}
          {googleAuthAvailable() && <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border/60" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-card px-3 text-muted-foreground">
                  Or continue with
                </span>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-3">
              <button 
                type="button"
                onClick={handleGoogleLogin}
                className="inline-flex items-center justify-center rounded-lg text-sm font-medium border border-border bg-background hover:bg-secondary hover:text-foreground h-11 px-4 py-2 transition-colors duration-150"
              >
                <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
                Google
              </button>
            </div>
          </div>}
        </div>

        <p className="text-center text-sm text-muted-foreground">
          Don't have an account?{' '}
          <Link to="/signup" className="font-semibold text-primary hover:text-primary/80 transition-colors">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
