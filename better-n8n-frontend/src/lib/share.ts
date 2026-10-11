/**
 * Sharing a file: the words and links the Share dialog shows.
 *
 * A share is a published snapshot (`api/pages.ts`), so the three audiences
 * here are the server's three visibilities, narrowest first. The dialog
 * starts on the narrowest: sending a file to one colleague must not be the
 * same click as putting it on the open internet.
 *
 * Pure, so the copy and the links are covered by `__tests__/share.test.ts`.
 */
import type { PageVisibility } from '../api/pages';

export interface Audience {
  value: PageVisibility;
  label: string;
  detail: string;
}

export const AUDIENCES: readonly Audience[] = [
  {
    value: 'link',
    label: 'People I send the link to',
    detail: 'They need an account here. The file is not listed anywhere.',
  },
  {
    value: 'platform',
    label: 'Everyone signed in',
    detail: 'Also listed under Pages for every signed-in user.',
  },
  {
    value: 'public',
    label: 'Anyone on the internet',
    detail: 'No account needed. Anyone who gets the link can open it.',
  },
];

export const DEFAULT_AUDIENCE: PageVisibility = 'link';

export function audienceLabel(visibility: PageVisibility | undefined): string {
  return AUDIENCES.find((a) => a.value === visibility)?.label ?? 'People I send the link to';
}

/** The address a published page is read at. */
export function pageUrl(slug: string, origin: string): string {
  return `${origin.replace(/\/+$/, '')}/p/${encodeURIComponent(slug)}`;
}

/** A page title from a file name: the name without its extension. */
export function shareTitle(filename: string): string {
  const dot = filename.lastIndexOf('.');
  const stem = (dot > 0 ? filename.slice(0, dot) : filename).trim();
  return (stem || filename || 'Shared file').slice(0, 200);
}

/** An email draft carrying the link, for the user's own mail app. */
export function mailtoLink(filename: string, url: string): string {
  const subject = encodeURIComponent(filename);
  const body = encodeURIComponent(`Here is ${filename}:\n\n${url}\n`);
  return `mailto:?subject=${subject}&body=${body}`;
}

/** The path a chat prompt names a file by, as the file tools read it. */
export function filePathFor(doc: { filename: string; folder_path?: string | null }): string {
  const folder = (doc.folder_path ?? '').replace(/\/+$/, '');
  return `${folder && folder !== '/' ? folder : ''}/${doc.filename}`;
}
