/**
 * The one line a person reads about an OpenRouter key's balance. Pure, so the
 * wording and the rounding are pinned by tests rather than by eye.
 *
 * Examples: "$9.53 left of $10.00 · $0.01 today", or "$4.78 used · no limit".
 */
import type { CredentialBalance } from '../api/credentials';

const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** "$9.53". A small positive amount that would round to nothing reads "<$0.01". */
export function formatDollars(amount: number): string {
  const safe = Math.max(0, amount);
  if (safe > 0 && safe < 0.005) return '<$0.01';
  return dollars.format(safe);
}

/** The balance as one line of text. A failed check reads as the backend's reason. */
export function formatBalanceLine(balance: CredentialBalance): string {
  if (!balance.available) return balance.reason;

  const today =
    balance.usage_daily != null ? ` · ${formatDollars(balance.usage_daily)} today` : '';

  if (balance.limit != null) {
    const remaining = balance.limit_remaining ?? balance.limit - (balance.usage ?? 0);
    return `${formatDollars(remaining)} left of ${formatDollars(balance.limit)}${today}`;
  }
  if (balance.usage != null) {
    return `${formatDollars(balance.usage)} used · no limit${today}`;
  }
  return 'No spending limit';
}
