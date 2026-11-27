/**
 * The one line a person reads about an OpenRouter key's balance. Same wording
 * as better-n8n-frontend/src/lib/credentialBalance.ts, so the phone and the
 * website say the same thing. Formatting is done by hand: Intl currency
 * output is not reliable on every Android JS engine.
 */
import type { CredentialBalance } from './types';

/** "$9.53", "$1,234.50". A small positive amount that would round to nothing reads "<$0.01". */
export function formatDollars(amount: number): string {
  const safe = Math.max(0, amount);
  if (safe > 0 && safe < 0.005) return '<$0.01';
  const [whole, cents] = safe.toFixed(2).split('.');
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
}

/** The balance as one line of text. A failed check reads as the backend's reason. */
export function formatBalanceLine(balance: CredentialBalance): string {
  if (!balance.available) return balance.reason;

  const today = balance.usage_daily != null ? ` · ${formatDollars(balance.usage_daily)} today` : '';

  if (balance.limit != null) {
    const remaining = balance.limit_remaining ?? balance.limit - (balance.usage ?? 0);
    return `${formatDollars(remaining)} left of ${formatDollars(balance.limit)}${today}`;
  }
  if (balance.usage != null) {
    return `${formatDollars(balance.usage)} used · no limit${today}`;
  }
  return 'No spending limit';
}
