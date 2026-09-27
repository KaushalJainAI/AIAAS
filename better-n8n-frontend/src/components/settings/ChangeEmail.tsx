/**
 * Change the sign-in address, with a code sent to the new one.
 *
 * The email used to be a plain input saved with the rest of the Account tab,
 * straight into the address sign-in and password reset look accounts up by. A
 * typo there locked the owner out. Now the server refuses that save, and this
 * is the way to change it: the current password (where the account has one),
 * then a code sent to the new address, which proves it is theirs.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { authService } from '../../api/auth';

function detail(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { detail?: string } } }).response?.data;
  return data?.detail ?? fallback;
}

export default function ChangeEmail({ current, onChanged }: {
  current: string;
  onChanged: () => Promise<void> | void;
}) {
  const [step, setStep] = useState<'idle' | 'request' | 'confirm'>('idle');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setStep('idle'); setEmail(''); setPassword(''); setCode(''); setError(null);
  };

  const send = async () => {
    setBusy(true); setError(null);
    try {
      const result = await authService.requestEmailChange(email.trim(), password);
      toast.success(result.detail);
      setStep('confirm');
    } catch (err) {
      setError(detail(err, 'Could not send a code.'));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true); setError(null);
    try {
      const result = await authService.confirmEmailChange(code.trim());
      toast.success(`Your email is now ${result.email}`);
      reset();
      await onChanged();
    } catch (err) {
      setError(detail(err, 'That code did not work.'));
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-full px-3 py-2 border border-input rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/50';

  return (
    <div>
      <label className="block text-sm font-medium mb-2">Email address</label>
      <div className="flex items-center gap-2">
        <input type="email" value={current} readOnly aria-readonly
          className={`${input} text-muted-foreground`} />
        {step === 'idle' && (
          <button type="button" onClick={() => setStep('request')}
            className="px-3 py-2 border border-border rounded-lg hover:bg-muted text-sm whitespace-nowrap">
            Change
          </button>
        )}
      </div>

      {step === 'request' && (
        <div className="mt-3 p-3 rounded-lg border border-border space-y-2">
          <input type="email" placeholder="New email address" value={email}
            onChange={(e) => setEmail(e.target.value)} className={input} autoFocus />
          <input type="password" placeholder="Current password (leave blank if you sign in with Google)"
            value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
          <p className="text-xs text-muted-foreground">
            We send a code to the new address. Your email changes once you enter it.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={send} disabled={busy || !email.trim()}
              className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm disabled:opacity-50">
              {busy ? 'Sending…' : 'Send code'}
            </button>
            <button type="button" onClick={reset}
              className="px-3 py-1.5 rounded-lg border border-border text-sm">Cancel</button>
          </div>
        </div>
      )}

      {step === 'confirm' && (
        <div className="mt-3 p-3 rounded-lg border border-border space-y-2">
          <input inputMode="numeric" placeholder={`Code sent to ${email}`} value={code}
            onChange={(e) => setCode(e.target.value)} className={input} autoFocus />
          <div className="flex gap-2">
            <button type="button" onClick={confirm} disabled={busy || !code.trim()}
              className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm disabled:opacity-50">
              {busy ? 'Checking…' : 'Confirm'}
            </button>
            <button type="button" onClick={reset}
              className="px-3 py-1.5 rounded-lg border border-border text-sm">Cancel</button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
