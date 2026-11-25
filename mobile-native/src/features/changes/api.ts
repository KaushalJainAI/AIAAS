/**
 * What a chat answer or an agent run changed, and putting it back
 * (`Backend/docs/UNDO_PLAN.md` §6.8). Same routes, types and request bodies as
 * the web's `better-n8n-frontend/src/api/changes.ts`, which is the reference.
 * Keep the types here in step with `Backend/logs/undo.py` (`describe`, `revert`).
 *
 * Paths are relative to /api (see src/api/client.ts).
 */
import { ApiError, api } from '../../api/client';

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

/** The counts a chat message carries (`metadata.changes`, `summary` in `changes.py`). */
export interface ChangeSetSummary {
  set_id: number;
  total: number;
  revertible: number;
  not_revertible: number;
  incomplete: boolean;
}

export function getChangeSet(setId: number): Promise<ChangeSetDetail> {
  return api<ChangeSetDetail>(`/logs/changes/sets/${setId}/`);
}

/**
 * Put back the whole set, or only `changeIds`. A 409 (still running, or already
 * being undone) throws an Error whose message is the server's `detail`.
 */
export async function revertChangeSet(setId: number, changeIds?: number[]): Promise<RevertResult> {
  const body = changeIds === undefined ? {} : { change_ids: changeIds };
  try {
    return await api<RevertResult>(`/logs/changes/sets/${setId}/revert/`, { method: 'POST', body });
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      throw new Error(err.message || 'This cannot be undone right now.', { cause: err });
    }
    throw err;
  }
}
