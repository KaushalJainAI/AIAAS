/**
 * Solutions — what an organisation has already solved (`solutions/`).
 *
 * Every call names the org it asks from (`null` = personal). The server
 * resolves that through the same door the assistant's search uses, so this
 * page can never show more than a chat in that org could find.
 *
 * Lifecycle (`solutions/api.py`): a person writes or saves a fix (active, or
 * a draft when the org suggests captures); a draft is published (shared,
 * private, or waiting for a curator) or discarded; a curator approves or
 * sends back what is waiting.
 */
import apiClient from './client';

export type ClaimKind =
  | 'principle' | 'procedure' | 'versioned' | 'config' | 'time_sensitive' | 'ephemeral';

export interface SolutionClaim {
  text: string;
  kind: ClaimKind;
  state: 'fresh' | 'check';
  depends_on?: string;
}

export interface SolutionReviewRow {
  kind: 'confirmed' | 'failed' | 'doubt' | 'cleared' | 'verified' | 'contradicted' | 'edited';
  by: string;
  model: string;
  reason: string;
  at: string;
}

export type SolutionStatus =
  | 'active' | 'needs_check' | 'superseded' | 'retracted' | 'draft' | 'pending_review';

/** The statuses a `?status=` filter accepts (retracted rows are never listed). */
export type SolutionListStatus = 'active' | 'needs_check' | 'superseded' | 'draft' | 'pending_review';

export type CapturedBy = 'auto' | 'tool' | 'user' | 'import';

export interface Solution {
  id: number;
  problem: string;
  symptoms: string;
  root_cause: string;
  resolution: string;
  environment: Record<string, string>;
  solved_by: string;
  solved_on: string | null;
  last_known_true: string;
  shared_with_org: boolean;
  track_record: { worked: number; failed: number };
  status: SolutionStatus;
  volatility: ClaimKind;
  claims: SolutionClaim[];
  checks_needed: string[];
  doubtful?: string;
  reviews?: SolutionReviewRow[];
  superseded_by?: number;
  tags?: string[];
  phrasings?: string[];
  match?: string;
  /** Written by the server on every list and detail item (K2). */
  updated_at?: string;
  /** A draft only: the chat's sharing switch was on when it was captured. */
  share_requested?: boolean;
  captured_by?: CapturedBy;
  /** Set on rows of the "Needs attention" view: why each one is there. */
  attention?: string[];
  /** Whether the viewer may edit or remove it (authors, and curators for shared rows). */
  can_manage?: boolean;
}

/** `verified` is "Still true": the reader confirms the fix is current (K4.1). */
export type ReviewKind = 'confirmed' | 'failed' | 'doubt' | 'cleared' | 'verified';

/** What the Solution form sends (`api.Draft` on the server). */
export interface DraftFields {
  problem: string;
  symptoms: string;
  root_cause: string;
  resolution: string;
  environment: Record<string, string>;
  claims: { text: string; kind: ClaimKind }[];
  tags: string[];
}

export interface SolutionList {
  solutions: Solution[];
  /** Absent for a search (`?q=`), which does not count. */
  total?: number;
  /** More rows follow (library), or the attention scan was cut at its cap. */
  truncated?: boolean;
  /** The offset of the next page, or null on the last one. */
  next_offset?: number | null;
  /** A tag filter only looked at the newest rows; older matches may be missing. */
  tag_scan_capped?: boolean;
}

export interface SolutionListOptions {
  q?: string;
  status?: SolutionListStatus;
  /** Rows carrying this tag (the server lower-cases it). */
  tag?: string;
  /** Only the rows the viewer wrote. */
  mine?: boolean;
  /** The "Needs attention" view. It ignores search, status and paging. */
  attention?: boolean;
  offset?: number;
}

/** What a team's insight page answers (`solutions/insights.py::summary`). Curators only. */
export interface SolutionInsights {
  searches: number;
  answered: number;
  unanswered: number;
  solutions: {
    active: number;
    needs_attention: number;
    drafts: number;
    pending_review: number;
  };
  top_used: { id: number; problem: string; uses: number }[];
  /** Searches that found nothing. The query text only: nothing says who asked. */
  gaps: { query: string; times: number; last_asked: string }[];
}

/** The chat-draft outcome a publish or discard answers with (`chat.solution_draft.resolved`). */
export type DraftOutcome = 'shared' | 'waiting_review' | 'kept_private' | 'discarded' | 'returned';

/**
 * A team solution a chat turn read: one entry of `metadata.solutions_used` on
 * a saved answer, and of the `solutions_update` frame while it streams. It is
 * a summary written by `chat/turn/agent.py::_on_solutions`, not a full record.
 */
export interface SolutionUsed {
  id: number;
  problem: string;
  solved_by: string;
  last_known_true: string | null;
  /** How many of its claims may have stopped being true. */
  checks_needed: number;
  doubtful: boolean;
}

const orgParam = (org: number | null) => (org == null ? 'personal' : String(org));

const solutionsService = {
  list: async (org: number | null, opts: SolutionListOptions = {}): Promise<SolutionList> => {
    const params = new URLSearchParams({ org: orgParam(org) });
    if (opts.attention) {
      // The attention view takes only the tag and "mine" filters (solutions/views.py).
      params.set('attention', '1');
    } else {
      if (opts.q?.trim()) params.set('q', opts.q.trim());
      if (opts.status) params.set('status', opts.status);
      if (opts.offset) params.set('offset', String(opts.offset));
    }
    if (opts.tag?.trim()) params.set('tag', opts.tag.trim());
    if (opts.mine) params.set('author', 'me');
    const { data } = await apiClient.get(`/solutions/?${params.toString()}`);
    return {
      solutions: Array.isArray(data?.solutions) ? data.solutions : [],
      total: typeof data?.total === 'number' ? data.total : undefined,
      truncated: data?.truncated,
      next_offset: typeof data?.next_offset === 'number' ? data.next_offset : null,
      tag_scan_capped: data?.tag_scan_capped === true,
    };
  },
  /**
   * Start extracting solutions from one of the viewer's documents. Answers 202:
   * the drafts arrive later, with a notification. Errors carry a `detail` for
   * the person (a daily cap answers 429).
   */
  importDocument: async (org: number | null, documentId: number): Promise<void> => {
    await apiClient.post('/solutions/import/', { org, document_id: documentId });
  },
  /** The team's last 30 days, for curators. Other callers get 403 (or 404 for a non-member). */
  insights: async (org: number): Promise<SolutionInsights> =>
    (await apiClient.get(`/solutions/insights/?org=${org}`)).data,
  get: async (org: number | null, id: number): Promise<Solution> =>
    (await apiClient.get(`/solutions/${id}/?org=${orgParam(org)}`)).data,
  /** Write a solution by hand. `share` only has an effect when `org` is set. */
  create: async (org: number | null, fields: DraftFields, share: boolean): Promise<Solution> =>
    (await apiClient.post('/solutions/', { org, share, ...fields })).data,
  /** Edit the text. `verified` means the editor checked it is still true (K0.1). */
  update: async (org: number | null, id: number, fields: DraftFields, verified = false): Promise<Solution> =>
    (await apiClient.patch(`/solutions/${id}/`, {
      org,
      ...fields,
      ...(verified ? { verified: true } : {}),
    })).data,
  review: async (org: number | null, id: number, kind: ReviewKind, reason = ''): Promise<Solution> =>
    (await apiClient.post(`/solutions/${id}/review/`, { org, kind, reason })).data,
  setShared: async (org: number | null, id: number, shared: boolean): Promise<Solution> =>
    (await apiClient.patch(`/solutions/${id}/`, { org, shared })).data,
  /** Author: a draft becomes a real entry. `share` true = team (or the curators' queue). */
  publish: async (org: number | null, id: number, share: boolean): Promise<Solution> =>
    (await apiClient.post(`/solutions/${id}/publish/`, { org, share })).data,
  /** Author: a draft is dropped (the row is kept as retracted). */
  discard: async (org: number | null, id: number): Promise<Solution> =>
    (await apiClient.post(`/solutions/${id}/discard/`, { org })).data,
  /** Curator: a solution waiting for review goes into the library. */
  approve: async (org: number | null, id: number): Promise<Solution> =>
    (await apiClient.post(`/solutions/${id}/approve/`, { org })).data,
  /** Curator: a solution waiting for review goes back to its author. `reason` is required. */
  sendBack: async (org: number | null, id: number, reason: string): Promise<Solution> =>
    (await apiClient.post(`/solutions/${id}/send-back/`, { org, reason })).data,
  /** Remove a saved solution (author or curator). */
  retract: async (org: number | null, id: number) => {
    await apiClient.delete(`/solutions/${id}/?org=${orgParam(org)}`);
  },
};

export default solutionsService;
