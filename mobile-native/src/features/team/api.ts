/**
 * Team knowledge (solutions) over HTTP.
 *
 * Mirrors better-n8n-frontend/src/api/solutions.ts, call for call. Every call
 * names the org it asks from (`null` = personal), so the server can never show
 * more than a chat in that org could find.
 *
 * Backend: `solutions/urls.py`, mounted at `/api/solutions/`. The shape of every
 * route is documented in `Backend/docs/API.md` under "Solutions".
 */
import { api, type ApiOptions } from '../../api/client';
import type {
  DraftFields,
  OrgScope,
  ReviewKind,
  Solution,
  SolutionInsights,
  SolutionList,
  SolutionListOptions,
} from './types';

type Query = NonNullable<ApiOptions['query']>;

/** The wire form of `org`: the word `personal`, or the organisation id. */
const orgParam = (org: OrgScope): string => (org == null ? 'personal' : String(org));

/** What `GET /solutions/` answers. Every field is optional on the wire. */
interface SolutionListWire {
  solutions?: Solution[];
  total?: number;
  truncated?: boolean;
  next_offset?: number | null;
  tag_scan_capped?: boolean;
}

export const solutionsApi = {
  /**
   * The library, a search (`q`), a status filter, the "Needs attention" view, or
   * the caller's own rows (`mine`). Mirrors the web's query string exactly:
   * the attention view takes only `tag` and `author`, and ignores search,
   * status and paging.
   */
  list: async (org: OrgScope, opts: SolutionListOptions = {}): Promise<SolutionList> => {
    const query: Query = { org: orgParam(org) };
    if (opts.attention) {
      // solutions/views.py: the attention view takes only the tag and "mine" filters.
      query.attention = '1';
    } else {
      const q = opts.q?.trim();
      if (q) query.q = q;
      if (opts.status) query.status = opts.status;
      if (opts.offset) query.offset = opts.offset;
    }
    const tag = opts.tag?.trim();
    if (tag) query.tag = tag;
    if (opts.mine) query.author = 'me';

    // An empty body parses to null; treat it as an empty page.
    const wire: SolutionListWire = (await api<SolutionListWire | null>('/solutions/', { query })) ?? {};
    return {
      solutions: Array.isArray(wire.solutions) ? wire.solutions : [],
      total: typeof wire.total === 'number' ? wire.total : undefined,
      truncated: wire.truncated,
      next_offset: typeof wire.next_offset === 'number' ? wire.next_offset : null,
      tag_scan_capped: wire.tag_scan_capped === true,
    };
  },

  /**
   * Start extracting solutions from one of the viewer's documents. Answers 202:
   * the drafts arrive later, with a notification. A daily cap answers 429 with a
   * `detail` for the person.
   */
  importDocument: (org: OrgScope, documentId: number) =>
    api<void>('/solutions/import/', { method: 'POST', body: { org, document_id: documentId } }),

  /** The team's last 30 days, for curators. Other callers get 403 (or 404 for a non-member). */
  insights: (org: number) =>
    api<SolutionInsights>('/solutions/insights/', { query: { org } }),

  get: (org: OrgScope, id: number) =>
    api<Solution>(`/solutions/${id}/`, { query: { org: orgParam(org) } }),

  /** Write a solution by hand. `share` only has an effect when `org` is set. */
  create: (org: OrgScope, fields: DraftFields, share: boolean) =>
    api<Solution>('/solutions/', { method: 'POST', body: { org, share, ...fields } }),

  /**
   * Edit the text. `verified` means the editor checked it is still true, which
   * resets the freshness clock (K0.1). Without it the clock keeps running.
   */
  update: (org: OrgScope, id: number, fields: DraftFields, verified = false) =>
    api<Solution>(`/solutions/${id}/`, {
      method: 'PATCH',
      body: { org, ...fields, ...(verified ? { verified: true } : {}) },
    }),

  review: (org: OrgScope, id: number, kind: ReviewKind, reason = '') =>
    api<Solution>(`/solutions/${id}/review/`, { method: 'POST', body: { org, kind, reason } }),

  setShared: (org: OrgScope, id: number, shared: boolean) =>
    api<Solution>(`/solutions/${id}/`, { method: 'PATCH', body: { org, shared } }),

  /**
   * Author: a draft becomes a real entry. `share` true sends it to the team (or
   * the curators' queue in a curated org); false keeps it private.
   */
  publish: (org: OrgScope, id: number, share: boolean) =>
    api<Solution>(`/solutions/${id}/publish/`, { method: 'POST', body: { org, share } }),

  /** Author: a draft is dropped. The row is kept as retracted. */
  discard: (org: OrgScope, id: number) =>
    api<Solution>(`/solutions/${id}/discard/`, { method: 'POST', body: { org } }),

  /** Curator: a solution waiting for review goes into the library. */
  approve: (org: OrgScope, id: number) =>
    api<Solution>(`/solutions/${id}/approve/`, { method: 'POST', body: { org } }),

  /** Curator: a solution waiting for review goes back to its author. `reason` is required. */
  sendBack: (org: OrgScope, id: number, reason: string) =>
    api<Solution>(`/solutions/${id}/send-back/`, { method: 'POST', body: { org, reason } }),

  /** Remove a saved solution (author or curator). The row is retracted, not erased. */
  retract: (org: OrgScope, id: number) =>
    api<void>(`/solutions/${id}/`, { method: 'DELETE', query: { org: orgParam(org) } }),
};
