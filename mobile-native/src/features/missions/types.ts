/**
 * Missions (long-horizon goals): the wire shapes this feature reads.
 *
 * Copied from better-n8n-frontend/src/api/missions.ts. The detail-only fields
 * (`wait_for`, `notebook_path`, `updated_at`, `agent_id`) come from
 * Backend/chat/commands/views.py::mission_detail, which the web type leaves out.
 */

export type MissionStatus = 'active' | 'waiting' | 'paused' | 'done' | 'failed' | 'cancelled';

/** Statuses a mission can still advance from. Delete is refused for `active` and `waiting`. */
export const LIVE_MISSION_STATUSES: readonly MissionStatus[] = ['active', 'waiting', 'paused'];

export interface MissionPlanItem {
  text: string;
  status: string;
}

/** One row of GET /missions/ (also the create response's fields, plus the progress counts). */
export interface Mission {
  id: number;
  goal: string;
  status: MissionStatus;
  plan?: MissionPlanItem[];
  budget_inr: number;
  spent_inr: number;
  runs_done: number;
  max_runs: number;
  next_wake_at: string | null;
  last_report?: string;
  deadline?: string | null;
  agent_id?: number;
  open_todos?: number;
  total_todos?: number;
  created_at?: string | null;
}

/** GET /missions/{id}/: the row plus the fields only the detail view carries. */
export interface MissionDetail extends Mission {
  wait_for: unknown;
  notebook_path: string | null;
  updated_at: string | null;
}

/** POST /missions/ body. Same validation as `chat.commands.views.MissionCreateSerializer`. */
export interface MissionCreateInput {
  goal: string;
  agent_id: number;
  /** Positive integer, rupees. */
  budget_inr: number;
  /** 1–90, default 7 on the server. */
  deadline_days?: number;
  /** 1–100, default 20 on the server. */
  max_runs?: number;
}

/** POST /missions/ answers 201 with the same fields `start_goal_mission` returns. */
export interface MissionCreated {
  mission_id: number;
  goal: string;
  status: MissionStatus;
  agent_id: number;
  budget_inr: number;
  max_runs: number;
  deadline_days: number;
}

/** POST /missions/{id}/pause|resume|cancel/ answers this. */
export interface MissionActionResult {
  mission_id: number;
  status: MissionStatus;
}

export type MissionVerb = 'pause' | 'resume' | 'cancel';
