import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '../../lib/utils';

type Tone = 'error' | 'success';

/**
 * Form banners (login error, profile saved, OTP sent).
 *
 * Was 4+ copies of `p-3 bg-destructive/10 border-destructive/20 rounded-lg`
 * plus a light-only `bg-red-50 text-red-600 border-red-200` in
 * CredentialModal that broke dark mode. Tone decides icon + tokens.
 */
export function Alert({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: ReactNode;
  className?: string;
}) {
  const Icon = tone === 'error' ? AlertCircle : CheckCircle2;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'p-3 rounded-lg border flex items-center gap-2 text-sm entrance-modal',
        tone === 'error'
          ? 'bg-destructive-subtle border-border text-destructive'
          : 'bg-success-subtle border-border text-success',
        className,
      )}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
