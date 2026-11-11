/**
 * Presentation of a stored credential's health. Pure, so the copy and the
 * tones are pinned by tests rather than by eye.
 */
import type { Credential } from '../api/credentials';

/**
 * What a credential's health reads as, one line. The server's `health` is the
 * source; rows from before that field existed (or a server that does not send
 * it) fall back to the old verified / needs-verification reading, so nothing
 * goes blank. Colour is only ever the status dot and this line.
 */
function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
}

export function healthView(c: Credential): { dot: string; tone: string; text: string } {
  switch (c.health) {
    case 'ok':
      return { dot: 'bg-success', tone: 'text-success', text: 'Working' };
    case 'expiring': {
      const days = daysUntil(c.token_expires_at);
      if (days === null) return { dot: 'bg-warning', tone: 'text-warning', text: 'Expires soon' };
      if (days <= 0) return { dot: 'bg-warning', tone: 'text-warning', text: 'Expired' };
      return { dot: 'bg-warning', tone: 'text-warning', text: `Expires in ${days} day${days === 1 ? '' : 's'}` };
    }
    case 'failed':
      return { dot: 'bg-destructive', tone: 'text-destructive', text: 'Rejected last time — check the key' };
    case 'unverified':
      return { dot: 'bg-muted-foreground/50', tone: 'text-muted-foreground', text: 'Not checked yet' };
    default:
      return c.is_verified
        ? { dot: 'bg-success', tone: 'text-success', text: 'Verified' }
        : { dot: 'bg-warning', tone: 'text-warning', text: 'Needs verification' };
  }
}

/**
 * The secret, as the server already masked it (`********wxyz`). Only the
 * secret-typed field is shown: a plain value such as a region is not a key.
 * Nothing is unmasked here, and nothing is shown when the server sent none.
 */
export function maskedKey(c: Credential): string | null {
  const secret = (c.fields ?? []).find((f) => ['password', 'secret', 'token'].includes(f.type) && f.value);
  return secret ? secret.value : null;
}
