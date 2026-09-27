/**
 * Triggers API — the ways something other than the user starts a run.
 *
 * The backend surface for this has existed since triggers shipped and nothing
 * in this app called it, so a schedule could be set on an agent and then never
 * seen again: no list, no next-due time, no way to tell that a trigger had
 * disabled itself after five failures. This module is that missing half.
 *
 * The wire shape is the model's own, snake_case, because `TriggerSerializer` is
 * a `ModelSerializer` — unlike agents, there is no camelCase config contract in
 * front of it to match.
 */
import apiClient from './client';
import { asArray } from './unwrap';

export type TriggerMode = 'schedule' | 'webhook' | 'event';

/** What to do when a trigger fires while its previous run is still going. */
export type OverlapPolicy = 'skip' | 'queue' | 'cancel';

/**
 * The one-word result of a firing, as `agents/sweep.py::fire` reports it.
 * Distinguishing these is the whole point of the run-now button: "nothing was
 * due" and "everything was refused" look identical in a boolean.
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

/**
 * One status per trigger, computed on the server
 * (`agents/views/triggers.py::trigger_status`). The card renders this
 * instead of assembling warning boxes from the raw columns.
 */
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
  /**
   * Whether the agent may run unattended. A schedule on an agent without it is
   * refused at every firing, so the editor can say so up front instead of
   * leaving the user to infer it from five failures and a self-disabled row.
   */
  agent_allows_unattended: boolean;
  /**
   * Whether the agent carries an instruction of its own. A webhook with no goal
   * falls back to it; with neither, every request is refused by an opaque 404,
   * so the editor needs to know which of the two is missing.
   */
  agent_has_prompt: boolean;
  mode: TriggerMode;
  /** Mode-specific. For schedules this carries `{ cron }`. */
  config: { cron?: string; event?: string; [k: string]: unknown };
  /** The cron, read back out of `config` — `cron` itself is write-only. */
  schedule_cron: string;
  /** IANA zone the cron fields are read in. `next_due_at` is still UTC. */
  timezone: string;
  /** What the user calls this schedule; an agent may have several. */
  name: string;
  goal: string;
  enabled: boolean;
  overlap: OverlapPolicy;
  origin: TriggerOrigin;
  /** Optional live window. Nulls mean "from now" and "for ever". */
  starts_at: string | null;
  ends_at: string | null;
  last_fired_at: string | null;
  next_due_at: string | null;
  /** Set when `overlap: 'queue'` deferred a firing that is still owed. */
  queued_for: string | null;
  consecutive_failures: number;
  /** The sweep's own word for what happened last time, and why. */
  last_outcome: FireOutcome | '';
  last_error: string;
  /** The cron in words, as the server reads it. */
  description: string;
  /** The next few firings, ISO, already narrowed by the window. */
  upcoming: string[];
  /** Server-computed health: one word plus one human sentence with its fix. */
  status: TriggerStatus;
  status_message: string;
  /** The run the last firing started, as the id `/runs?run=` links by. */
  last_run_id: string | null;
  /** Only ever populated for webhook triggers, and only for the owner. */
  webhook_url: string | null;
  created_at: string;
  updated_at: string;
}

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

/** What `/triggers/preview/` answers: the schedule as the sweep reads it. */
export interface SchedulePreview {
  valid: boolean;
  error: string;
  description: string;
  upcoming: string[];
}

export interface PreviewInput {
  cron: string;
  timezone?: string;
  count?: number;
  starts_at?: string | null;
  ends_at?: string | null;
}

export interface RunNowResult {
  outcome: FireOutcome;
  /** Present when the run started (202): the id `/runs?run=` links by. */
  execution_id?: string;
  trigger: Trigger;
}

/** What `/triggers/health/` answers: is anything sweeping, and since when. */
export interface SchedulerHealth {
  running: boolean;
  last_tick_at: string | null;
}

const triggersService = {
  /** Every trigger the caller owns, or one agent's when `agentId` is given. */
  list: async (agentId?: number): Promise<Trigger[]> => {
    const { data } = await apiClient.get<Trigger[]>('/orchestrator/triggers/', {
      params: agentId ? { agent: agentId } : undefined,
    });
    // `asArray` because the list answers a bare array normally and an object
    // with `results` when it hits its cap.
    return asArray<Trigger>(data);
  },

  /**
   * What a cron expression means, before it is saved.
   *
   * Answers 200 with `valid: false` for a bad expression, so a field the user
   * is still typing in does not produce an error per keystroke. Deliberately
   * the server's reading rather than the client's: `lib/cron.ts` renders a
   * draft instantly, but the only reading that matters is the one the sweep
   * will act on.
   */
  preview: async (input: PreviewInput): Promise<SchedulePreview> => {
    const { data } = await apiClient.post<SchedulePreview>(
      '/orchestrator/triggers/preview/', input,
    );
    return data;
  },

  create: async (input: TriggerInput): Promise<Trigger> => {
    const { data } = await apiClient.post<Trigger>('/orchestrator/triggers/', input);
    return data;
  },

  /** PATCH, so an unmentioned field keeps its value — same reasoning as agents. */
  update: async (id: number, patch: Partial<TriggerInput>): Promise<Trigger> => {
    const { data } = await apiClient.patch<Trigger>(`/orchestrator/triggers/${id}/`, patch);
    return data;
  },

  remove: async (id: number): Promise<void> => {
    await apiClient.delete(`/orchestrator/triggers/${id}/`);
  },

  /**
   * Issue a new secret for a webhook, revoking the URL that was handed out.
   *
   * Not delete-and-recreate, which was the only way to change a leaked URL
   * before this endpoint existed: that discards the row, and with it the
   * failure count, the last-fired time, and the identity every calling system
   * was pointed at. Rotation is instant — there is no window where both
   * secrets work, because a leaked credential that keeps working is leaked.
   */
  rotateSecret: async (id: number): Promise<Trigger> => {
    const { data } = await apiClient.post<Trigger>(
      `/orchestrator/triggers/${id}/rotate/`, {},
    );
    return data;
  },

  /**
   * Fire a schedule now, through the sweep's own gates. Answers 202 with the
   * execution id as soon as the run has *started* — the request no longer
   * waits for the whole agent run, so the button cannot time out behind a
   * proxy. A manual firing is extra, not the next slot: `next_due_at` does
   * not move.
   */
  runNow: async (id: number): Promise<RunNowResult> => {
    const { data } = await apiClient.post<RunNowResult>(
      `/orchestrator/triggers/${id}/run/`, {},
    );
    return data;
  },

  /**
   * Whether the in-process scheduler is checking in. The Schedules page
   * polls it for the red banner — a stopped scheduler must say so instead
   * of showing cards that look healthy while nothing fires.
   */
  health: async (): Promise<SchedulerHealth> => {
    const { data } = await apiClient.get<SchedulerHealth>(
      '/orchestrator/triggers/health/',
    );
    return data;
  },
};

export default triggersService;
