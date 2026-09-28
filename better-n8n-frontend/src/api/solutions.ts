/**
 * Solutions — what an organisation has already solved (`solutions/`).
 *
 * Every call names the org it asks from (`null` = personal). The server
 * resolves that through the same door the assistant's search uses, so this
 * page can never show more than a chat in that org could find.
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
  kind: 'confirmed' | 'failed' | 'doubt' | 'cleared' | 'verified' | 'contradicted';
  by: string;
  model: string;
  reason: string;
  at: string;
}

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
  status: 'active' | 'needs_check' | 'superseded' | 'retracted';
  volatility: ClaimKind;
  claims: SolutionClaim[];
  checks_needed: string[];
  doubtful?: string;
  can_manage?: boolean;
  reviews?: SolutionReviewRow[];
  superseded_by?: number;
  tags?: string[];
  match?: string;
}

export type ReviewKind = 'confirmed' | 'failed' | 'doubt' | 'cleared';

const orgParam = (org: number | null) => (org == null ? 'personal' : String(org));

const solutionsService = {
  list: async (org: number | null, q = ''): Promise<{ solutions: Solution[]; truncated?: boolean }> => {
    const params = new URLSearchParams({ org: orgParam(org) });
    if (q.trim()) params.set('q', q.trim());
    const { data } = await apiClient.get(`/solutions/?${params.toString()}`);
    return { solutions: Array.isArray(data?.solutions) ? data.solutions : [], truncated: data?.truncated };
  },
  get: async (org: number | null, id: number): Promise<Solution> =>
    (await apiClient.get(`/solutions/${id}/?org=${orgParam(org)}`)).data,
  review: async (org: number | null, id: number, kind: ReviewKind, reason = ''): Promise<Solution> =>
    (await apiClient.post(`/solutions/${id}/review/`, { org, kind, reason })).data,
  setShared: async (org: number | null, id: number, shared: boolean): Promise<Solution> =>
    (await apiClient.patch(`/solutions/${id}/`, { org, shared })).data,
  retract: async (org: number | null, id: number) => {
    await apiClient.delete(`/solutions/${id}/?org=${orgParam(org)}`);
  },
};

export default solutionsService;
