/**
 * Published pages: snapshots of a report, an HTML page or a file, shareable by link.
 *
 * Mirrors: better-n8n-frontend/src/api/pages.ts
 */

export type PageKind = 'report' | 'html' | 'file';

/** Narrowest first: a link needs an account, `platform` lists it, `public` needs none. */
export type PageVisibility = 'link' | 'platform' | 'public';

export interface PublishedPage {
  slug: string;
  title: string;
  kind: PageKind;
  body: string;
  file_name: string;
  has_file: boolean;
  updated_at: string;
  /** Signed-in reads only. */
  visibility?: PageVisibility;
  is_listed?: boolean;
  is_mine?: boolean;
  created_at?: string;
}

/** `GET /inference/pages/` answer: a capped list with `truncated` (no cursor). */
export interface PageListPage {
  results: PublishedPage[];
  truncated: boolean;
}

export interface PublishPageInput {
  title: string;
  kind: PageKind;
  body: string;
  visibility: PageVisibility;
}

/** Scope of `GET /inference/pages/`: omitted = the caller's own pages; `platform` = everyone's listed pages. */
export type PageListScope = 'platform';
