/**
 * Activity — the unions behind the Activity page (`/runs`).
 *
 * The server computes `actions` per row, so this service is transport only:
 * the UI never offers a verb the backend refuses. Which buttons those verbs
 * become lives in `lib/activity.ts` (pure, vitest-covered).
 */
import apiClient from './client';

export type LiveKind =
  | 'agent_run'
  | 'code_task'
  | 'eval_sweep'
  | 'eval_world'
  | 'chat_turn';

/** One live process. Only the controls in `actions` exist for this row. */
export interface LiveItem {
  kind: LiveKind;
  id: string;
  title: string;
  status: string;
  started_at: string | null;
  /** Seconds since start, where the server knows it (chat turns) or null. */
  elapsed_s: number | null;
  spend_rupees: number | null;
  actions: string[];
  href: string;
  /** Past its own run limit plus grace — offers "Mark as failed". */
  stuck?: boolean;
  caller?: string;
  is_delegated?: boolean;
  mission_id?: number | null;
  agent?: string;
  project?: string;
}

export type FileActivityKind = 'file_opened' | 'file_version' | 'code_change';

export interface FileActivityItem {
  kind: FileActivityKind;
  /** ISO time, newest first. */
  at: string | null;
  name: string;
  href: string;
  document_id?: number | null;
  app?: string;
  open_count?: number;
  source?: string;
  path?: string;
}

const activityService = {
  /** Every live process of any kind for the caller, newest first. */
  async live(): Promise<{ items: LiveItem[]; truncated: boolean; note: string }> {
    const { data } = await apiClient.get('/activity/live/');
    return {
      items: Array.isArray(data?.items) ? data.items : [],
      truncated: !!data?.truncated,
      note: typeof data?.note === 'string' ? data.note : '',
    };
  },

  /** Recent file and content activity, newest first. */
  async recentFiles(): Promise<{ items: FileActivityItem[]; truncated: boolean }> {
    const { data } = await apiClient.get('/activity/recent-files/');
    return {
      items: Array.isArray(data?.items) ? data.items : [],
      truncated: !!data?.truncated,
    };
  },
};

export default activityService;
