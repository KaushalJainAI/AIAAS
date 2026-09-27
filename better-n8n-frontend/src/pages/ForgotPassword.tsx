import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Mail, ShieldCheck } from 'lucide-react';
import authService from '../api/auth';
import { Button } from '../components/ui/Button';
import { Alert } from '../components/ui/Alert';
import { IconTile } from '../components/ui/IconTile';

type Step = 'email' | 'otp' | 'password';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const submitEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setIsLoading(true);
    try {
      const response = await authService.requestPasswordReset(email);
      setSuccess(response.detail);
      setStep('otp');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send OTP.');
    } finally {
      setIsLoading(false);
    }
  };

  const submitOTP = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setIsLoading(true);
    try {
      const response = await authService.verifyPasswordResetOTP(email, otpCode);
      setVerificationToken(response.verification_token);
      setSuccess(response.detail);
      setStep('password');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid or expired OTP.');
    } finally {
      setIsLoading(false);
    }
  };

  const submitPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setIsLoading(true);
    try {
      const response = await authService.confirmPasswordReset({
        email,
        verification_token: verificationToken,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      setSuccess(response.detail);
      setTimeout(() => navigate('/login'), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8 animate-slide-up">
        <div>
          <Link to="/login" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6">
            <ArrowLeft className="w-4 h-4" />
            Back to login
          </Link>
          <div className="text-center">
            <div className="inline-flex mb-6">
              <IconTile size="lg">
                <ShieldCheck className="w-6 h-6" />
              </IconTile>
            </div>
            <h1 className="text-3xl font-bold mb-2">Reset password</h1>
            <p className="text-muted-foreground">Verify your email with a 6-digit OTP.</p>
          </div>
        </div>

        <div className="glass rounded-lg p-8">
          {error && (
            <div className="mb-4">
              <Alert tone="error">{error}</Alert>
            </div>
          )}
          {success && (
            <div className="mb-4">
              <Alert tone="success">{success}</Alert>
            </div>
          )}

          {step === 'email' && (
            <form onSubmit={submitEmail} className="space-y-6">
              <label className="block text-sm font-medium" htmlFor="email">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="flex h-10 w-full rounded-lg border border-input bg-background px-3 pl-10 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="name@example.com" />
              </div>
              <Button loading={isLoading} className="w-full">
                {!isLoading && <>Send OTP</>}
                {isLoading && <>Sending...</>}
              </Button>
            </form>
          )}

          {step === 'otp' && (
            <form onSubmit={submitOTP} className="space-y-6">
              <label className="block text-sm font-medium" htmlFor="otp">6-digit OTP</label>
              <input id="otp" inputMode="numeric" maxLength={6} required value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))} className="flex h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-center text-lg tracking-[0.4em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="000000" />
              <Button loading={isLoading} disabled={otpCode.length !== 6} className="w-full">
                {!isLoading && <>Verify OTP</>}
                {isLoading && <>Verifying...</>}
              </Button>
            </form>
          )}

          {step === 'password' && (
            <form onSubmit={submitPassword} className="space-y-5">
              <input type="password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="New password" />
              <input type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="Confirm new password" />
              <Button loading={isLoading} className="w-full">
                {!isLoading && <>Reset Password</>}
                {isLoading && <>Resetting...</>}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
