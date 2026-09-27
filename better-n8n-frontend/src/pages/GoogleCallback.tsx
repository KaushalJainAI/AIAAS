import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/authState';
import { Loader2 } from 'lucide-react';
import { toast } from '../lib/toastStore';

export default function GoogleCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { googleLogin } = useAuth();
  const processedRef = useRef(false);

  useEffect(() => {
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    if (processedRef.current) return;
    processedRef.current = true;

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

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background">
      <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
      <p className="text-muted-foreground">Authenticating with Google...</p>
    </div>
  );
}
