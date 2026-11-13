import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/authState';
import { Loader2 } from 'lucide-react';
import { toast } from '../lib/toastStore';
import { appReturnUrl } from '../lib/appHandoff';

export default function GoogleCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { googleLogin } = useAuth();
  const processedRef = useRef(false);
  // Set when the sign-in started in the native app: the result goes back to the app, not here.
  const [appLink, setAppLink] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const state = searchParams.get('state');

    if (processedRef.current) return;
    processedRef.current = true;

    // An app-started sign-in is returned to the app, which exchanges the code itself.
    // Nothing is exchanged here, and this tab keeps no session from it.
    const toApp = appReturnUrl('auth', { code, state, error });
    if (toApp) {
      setAppLink(toApp);
      window.location.replace(toApp);
      return;
    }

    if (error) {
      toast.error('Google login failed');
      navigate('/login');
      return;
    }

    if (!code) {
      navigate('/login');
      return;
    }

    const handleLogin = async () => {
      try {
        await googleLogin(code);
        toast.success('Successfully logged in with Google');
        navigate('/ai-chat', { replace: true });
      } catch (err) {
        console.error('Login error:', err);
        toast.error('Failed to log in with Google');
        navigate('/login');
      }
    };

    handleLogin();
  }, [searchParams, googleLogin, navigate]);

  if (appLink) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background px-6 text-center">
        <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Returning to the app…</p>
        <a href={appLink} className="mt-6 text-sm underline text-primary">
          Open the app
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background">
      <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
      <p className="text-muted-foreground">Authenticating with Google...</p>
    </div>
  );
}
