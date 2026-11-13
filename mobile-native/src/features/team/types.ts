/**
 * Team knowledge (solutions): the wire shapes this feature reads and writes.
 *
 * Copied from better-n8n-frontend/src/api/solutions.ts, with the same names.
 * Lifecycle (`solutions/api.py`): a person writes or saves a fix (active, or a
 * draft when the org suggests captures); a draft is published (shared, private,
 * or waiting for a curator) or discarded; a curator approves or sends back what
 * is waiting.
 *
 * `org` is always passed explicitly. `null` means personal; the server resolves
 * it through the same door the assistant's search uses.
 */

/** `null` is the personal library; a number is that organisation. */
export type OrgScope = number | null;

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

/**
 * `verified` is "Still true": the reader confirms the fix is current (K4.1).
 * `contradicted` is accepted by the server but not offered by the web's review
 * controls, so it is left out here too. `edited` is refused by the server.
 */
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
  /** Absent for a search (`q`), which does not count. */
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
 * A team solution a chat turn read: one entry of `metadata.solutions_used` on a
 * saved answer, and of the `solutions_update` frame while it streams. A summary
 * written by `chat/turn/agent.py::_on_solutions`, not a full record.
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
