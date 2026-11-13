/**
 * Pages API: publish, read, list, withdraw and download published pages.
 *
 * Mirrors: better-n8n-frontend/src/api/pages.ts (pagesService)
 * Backend reference: Backend/docs/API.md, rows for /api/inference/pages/ and
 * /api/inference/public/pages/.
 *
 * `publicGet` and the public download pass `auth: false`: those routes answer
 * without an account, and a bearer token must not be sent to them.
 */
import { api } from '../../api/client';
import { fetchFile } from '../files/transfer';
import type { PageListPage, PageListScope, PublishPageInput, PublishedPage, PageVisibility } from './types';

const enc = encodeURIComponent;

/** `GET /inference/public/pages/{slug}/` — one public page, no account. */
export function getPublicPage(slug: string): Promise<PublishedPage> {
  return api<PublishedPage>(`/inference/public/pages/${enc(slug)}/`, { auth: false });
}

/** `GET /inference/pages/{slug}/` — a page the signed-in user may read (link, platform or public). */
export function getPage(slug: string): Promise<PublishedPage> {
  return api<PublishedPage>(`/inference/pages/${enc(slug)}/`);
}

/** `GET /inference/pages/` — the caller's pages, or everyone's listed pages with `scope='platform'`. */
export function listPages(scope?: PageListScope): Promise<PageListPage> {
  return api<PageListPage>('/inference/pages/', { query: { scope } });
}

/**
 * `POST /inference/pages/` — freeze a snapshot and get its link. A `file` page
 * takes `body` as JSON text: `{"document_id": n}`. The server copies the file
 * as it is now, so later edits never change what a link shows.
 */
export function publishPage(input: PublishPageInput): Promise<PublishedPage> {
  return api<PublishedPage>('/inference/pages/', { method: 'POST', body: input });
}

/** Share one of the caller's files by link (`publishPage` with `kind: 'file'`). */
export function shareFile(documentId: number, title: string, visibility: PageVisibility): Promise<PublishedPage> {
  return publishPage({
    title,
    kind: 'file',
    body: JSON.stringify({ document_id: documentId }),
    visibility,
  });
}

/** `DELETE /inference/pages/{slug}/` — unlists the page. The link stops resolving; nothing is deleted. */
export function withdrawPage(slug: string): Promise<unknown> {
  return api<unknown>(`/inference/pages/${enc(slug)}/`, { method: 'DELETE' });
}

/** Path of a page's file. The public route needs no account. */
export function pageFilePath(slug: string, isPublic: boolean): string {
  return isPublic
    ? `/inference/public/pages/${enc(slug)}/download/`
    : `/inference/pages/${enc(slug)}/download/`;
}

/**
 * `GET .../download/` — a page's file as raw bytes. `inline` previews
 * (pdf, image) instead of forcing a save.
 */
export function downloadPageFile(slug: string, isPublic: boolean, opts: { inline?: boolean } = {}): Promise<Response> {
  return fetchFile(pageFilePath(slug, isPublic), {
    query: opts.inline ? { inline: 1 } : undefined,
    auth: !isPublic,
  });
}
