import { API_ORIGIN } from '../../config';
import type { DefaultAutonomy, OrgRole, ThemePreference } from './types';

/** The web's words for the three modes a new chat can start in. `full` is per chat only. */
export const AUTONOMY_OPTIONS: { value: DefaultAutonomy; label: string; detail: string }[] = [
  { value: 'plan', label: 'Plan only', detail: 'Plan only reads.' },
  { value: 'ask', label: 'Ask before changes', detail: 'Asks before anything with side effects.' },
  { value: 'auto', label: 'Ask before irreversible', detail: 'Lets reversible work through without asking.' },
];

export const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

export const ROLE_LABEL: Record<OrgRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  curator: 'Curator',
  member: 'Member',
};

/** What a curator can and cannot do, shown wherever the role is picked (the web's words). */
export const CURATOR_HELP = 'Approves and edits team solutions; cannot manage people.';

/** A stored avatar may be a relative path on the server; the app needs an absolute URL. */
export function resolveAvatarUrl(url: string | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_ORIGIN}${url.startsWith('/') ? '' : '/'}${url}`;
}

/** Two letters for a picture-less avatar: the name's initials, else the email's first letters. */
export function initialsOf(name: string | undefined, email: string | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (email ?? '??').slice(0, 2).toUpperCase();
}

export function formatDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

const IMAGE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** The picture's MIME type: the picker's own, else from the file extension. */
export function imageMimeType(uri: string, reported: string | undefined): string {
  if (reported && reported.startsWith('image/')) return reported;
  const ext = uri.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_TYPES[ext] ?? 'image/jpeg';
}
