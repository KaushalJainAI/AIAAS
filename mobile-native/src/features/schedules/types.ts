/**
 * Schedules (triggers): the wire shapes this feature reads and writes.
 *
 * Copied from better-n8n-frontend/src/api/triggers.ts (the Trigger model's own
 * snake_case serializer, with no camelCase layer in front of it).
 */

export type TriggerMode = 'schedule' | 'webhook' | 'event';

/** What to do when a trigger fires while its previous run is still going. */
export type OverlapPolicy = 'skip' | 'queue' | 'cancel';

/**
 * The one-word result of a firing, as `agents/sweep.py::fire` reports it.
 * "Nothing was due" and "everything was refused" must stay distinguishable.
 */
export type FireOutcome =
  | 'fired'
  | 'queued'
  | 'dropped'
  | 'skipped'
  | 'late'
  | 'busy'
  | 'waiting'
  | 'paused'
  | 'expired'
  | 'stopped'
  | 'refused'
  | 'failed';

/** Where a schedule's cron came from, and therefore what may overwrite it. */
export type TriggerOrigin = 'builder' | 'manual';

/** Server-computed health, one word per trigger (`trigger_status`). */
export type TriggerStatus =
  | 'scheduler_down'
  | 'needs_permission'
  | 'agent_paused'
  | 'self_disabled'
  | 'ended'
  | 'paused'
  | 'not_started'
  | 'overdue'
  | 'failing'
  | 'ok';

export interface Trigger {
  id: number;
  subagent: number;
  agent_name: string;
  /** A schedule on an agent without this is refused at every firing. */
  agent_allows_unattended: boolean;
  /** A webhook with no goal falls back to the agent's; with neither it is refused. */
  agent_has_prompt: boolean;
  mode: TriggerMode;
  /** Mode-specific. For schedules this carries `{ cron }`. */
  config: { cron?: string; event?: string; [k: string]: unknown };
  /** The cron, read back out of `config`. `cron` itself is write-only. */
  schedule_cron: string;
  /** IANA zone the cron fields are read in. `next_due_at` is still UTC. */
  timezone: string;
  name: string;
  goal: string;
  enabled: boolean;
  overlap: OverlapPolicy;
  origin: TriggerOrigin;
  starts_at: string | null;
  ends_at: string | null;
  last_fired_at: string | null;
  next_due_at: string | null;
  /** Set when `overlap: 'queue'` deferred a firing that is still owed. */
  queued_for: string | null;
  consecutive_failures: number;
  last_outcome: FireOutcome | '';
  last_error: string;
  /** The cron in words, as the server reads it. */
  description: string;
  /** The next few firings, ISO, already narrowed by the window. */
  upcoming: string[];
  status: TriggerStatus;
  status_message: string;
  /** The run the last firing started, as the id the run screen links by. */
  last_run_id: string | null;
  last_run_status?: string | null;
  /** Only ever populated for webhook triggers, and only for the owner. */
  webhook_url: string | null;
  created_at: string;
  updated_at: string;
}

/** POST /orchestrator/triggers/ body, and the PATCH subset of it. */
export interface TriggerInput {
  subagent: number;
  mode: TriggerMode;
  /** Write-only on the server; it lands in `config.cron`. */
  cron?: string;
  timezone?: string;
  name?: string;
  goal?: string;
  enabled?: boolean;
  overlap?: OverlapPolicy;
  starts_at?: string | null;
  ends_at?: string | null;
}

/** POST /orchestrator/triggers/preview/ body. Saves nothing. */
export interface PreviewInput {
  cron: string;
  timezone?: string;
  /** Up to 10. */
  count?: number;
  starts_at?: string | null;
  ends_at?: string | null;
}

/** What `/triggers/preview/` answers. `valid: false` is a normal 200, not an error. */
export interface SchedulePreview {
  valid: boolean;
  error: string;
  description: string;
  upcoming: string[];
}

/** POST /orchestrator/triggers/{id}/run/. `execution_id` is present when the run started (202). */
export interface RunNowResult {
  outcome: FireOutcome;
  execution_id?: string;
  trigger: Trigger;
}

/** POST /orchestrator/triggers/{id}/rotate/ answers the whole trigger, with the new URL. */
export type RotateSecretResult = Trigger;

/** GET /orchestrator/triggers/health/: is anything sweeping, and since when. */
export interface SchedulerHealth {
  running: boolean;
  last_tick_at: string | null;
}
