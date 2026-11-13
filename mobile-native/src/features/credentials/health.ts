/**
 * How a stored credential reads, in one line and one tone. Copied from
 * better-n8n-frontend/src/lib/credentialHealth.ts so the words match the web.
 */

import type { Credential } from './types';

export type HealthTone = 'success' | 'warning' | 'danger' | 'muted';

export interface HealthView {
  text: string;
  tone: HealthTone;
}

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
}

/** The server's `health` is the source. Rows without it fall back to the verified flag, so nothing goes blank. */
export function healthView(c: Credential): HealthView {
  switch (c.health) {
    case 'ok':
      return { text: 'Working', tone: 'success' };
    case 'expiring': {
      const days = daysUntil(c.token_expires_at);
      if (days === null) return { text: 'Expires soon', tone: 'warning' };
      if (days <= 0) return { text: 'Expired', tone: 'warning' };
      return { text: `Expires in ${days} day${days === 1 ? '' : 's'}`, tone: 'warning' };
    }
    case 'failed':
      return { text: 'Rejected last time — check the key', tone: 'danger' };
    case 'unverified':
      return { text: 'Not checked yet', tone: 'muted' };
    default:
      return c.is_verified
        ? { text: 'Verified', tone: 'success' }
        : { text: 'Needs verification', tone: 'warning' };
  }
}

/** The secret, as the server already masked it. Only a secret-typed field counts; a region is not a key. */
export function maskedKey(c: Credential): string | null {
  const secret = (c.fields ?? []).find((f) => ['password', 'secret', 'token'].includes(f.type) && f.value);
  return secret ? secret.value : null;
}
