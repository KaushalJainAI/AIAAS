/**
 * What a chat answer or an agent run changed, and putting it back.
 *
 * Backend: `Backend/logs/views.py` (`change_set_detail`, `change_set_revert`),
 * routes in `Backend/logs/urls.py`, the shapes in `Backend/logs/undo.py`
 * (`describe`, `revert`) and `Backend/logs/changes.py` (`summary`). Keep the
 * types here in step with those functions.
 */
import axios from 'axios';

import apiClient from './client';

/** `''` = not tried yet; the others are what the revert wrote down. */
export type ChangeOutcome = '' | 'reverted' | 'skipped' | 'failed';

/** What a revert said about one change. `not_revertible` is never written to a row. */
export type RevertOutcomeKind = 'reverted' | 'skipped' | 'failed' | 'not_revertible';

export type ChangeTargetType = '' | 'document' | 'folder' | 'memory' | 'agent';

export interface ChangeRow {
  id: number;
  label: string;
  /** `''` is an untracked change: listed so the person sees it, never touched. */
  target_type: ChangeTargetType;
  revertible: boolean;
  /** Why it cannot be undone from here. Empty when it can. */
  reason: string;
  outcome: ChangeOutcome;
  outcome_note: string;
  tool: string;
}

/** One set (a chat answer or a run) and, nested, the workers it started. */
export interface ChangeSetNode {
  id: number;
  owner_kind: 'chat' | 'run';
  status: string;
  incomplete: boolean;
  created_at: string;
  live: boolean;
  live_reason: string | null;
  changes: ChangeRow[];
  children: ChangeSetNode[];
}

export interface ChangeSetDetail {
  live: boolean;
  live_reason: string | null;
  /** Changes over the whole tree, including the ones not listed. */
  total: number;
  /** Some changes were left out of the list (the cap). */
  truncated: boolean;
  set: ChangeSetNode;
}

export interface RevertOutcome {
  change_id: number;
  label: string;
  outcome: RevertOutcomeKind;
  note: string;
}

export interface RevertResult {
  status: string;
  outcomes: RevertOutcome[];
  reverted: number;
  skipped: number;
  failed: number;
  not_revertible: number;
  already_reverted: number;
}

/** The counts a chat message or a run carries (`summary` in `changes.py`). */
export interface ChangeSetSummary {
  set_id: number;
  total: number;
  revertible: number;
  not_revertible: number;
  incomplete: boolean;
}

export const getChangeSet = async (setId: number): Promise<ChangeSetDetail> => {
  const { data } = await apiClient.get<ChangeSetDetail>(`/logs/changes/sets/${setId}/`);
  return data;
};

/**
 * Put back the whole set, or only `changeIds`. A 409 (still running, or already
 * being undone) throws an Error whose message is the server's `detail`.
 */
export const revertChangeSet = async (
  setId: number,
  changeIds?: number[],
): Promise<RevertResult> => {
  try {
    const body = changeIds === undefined ? {} : { change_ids: changeIds };
    const { data } = await apiClient.post<RevertResult>(
      `/logs/changes/sets/${setId}/revert/`,
      body,
    );
    return data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 409) {
      const detail = (error.response.data as { detail?: string })?.detail;
      throw new Error(detail || 'This cannot be undone right now.', { cause: error });
    }
    throw error;
  }
};
