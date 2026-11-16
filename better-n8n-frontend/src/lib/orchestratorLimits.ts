/**
 * The chat orchestrator's limits: defaults, ranges, presets and the words that
 * explain them. Pure, so the Settings tab and its tests share one copy.
 *
 * The ranges mirror `workflow_backend/thresholds.py` (the server validates the
 * same numbers and says so in a 400); the rupee rate mirrors
 * `RUPEES_PER_MILLION_TOKENS`, the blended rate every spend cap uses.
 */

export const DEFAULT_LIMITS = {
  maxSteps: 36,
  timeLimitSeconds: 30 * 60,
  spendCapRupees: 500,
  summariseLongTurns: false,
} as const;

export const RANGES = {
  steps: { min: 3, max: 200 },
  minutes: { min: 1, max: 8 * 60 },
  rupees: { min: 0, max: 100_000 },
} as const;

/** The blended rate behind every spend cap (`agents/spend.py`). */
export const RUPEES_PER_MILLION_TOKENS = 85;

export interface OrchestratorLimits {
  maxSteps: number;
  timeLimitSeconds: number;
  spendCapRupees: number;
  summariseLongTurns: boolean;
}

/** The account's stored values, each falling back to its default. */
export function limitsFromProfile(profile: {
  chat_max_steps?: number;
  chat_time_limit_seconds?: number;
  chat_spend_cap_rupees?: number;
  chat_summarise_long_turns?: boolean;
} | null | undefined): OrchestratorLimits {
  return {
    maxSteps: profile?.chat_max_steps ?? DEFAULT_LIMITS.maxSteps,
    timeLimitSeconds: profile?.chat_time_limit_seconds ?? DEFAULT_LIMITS.timeLimitSeconds,
    // `??`: 0 is a real choice (no cap).
    spendCapRupees: profile?.chat_spend_cap_rupees ?? DEFAULT_LIMITS.spendCapRupees,
    summariseLongTurns: profile?.chat_summarise_long_turns ?? DEFAULT_LIMITS.summariseLongTurns,
  };
}

export function toPayload(limits: OrchestratorLimits) {
  return {
    chat_max_steps: limits.maxSteps,
    chat_time_limit_seconds: limits.timeLimitSeconds,
    chat_spend_cap_rupees: limits.spendCapRupees,
    chat_summarise_long_turns: limits.summariseLongTurns,
  };
}

export function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

/** Whole presets: the step and time limits move together, because a step
 *  limit the clock cannot reach (or a clock the steps cannot fill) is a
 *  setting that does nothing. */
export const PRESETS: { id: string; label: string; steps: number; minutes: number; rupees: number; fits: string }[] = [
  { id: 'focused', label: 'Focused', steps: 12, minutes: 10, rupees: 200,
    fits: 'Questions, quick lookups, a short piece of writing.' },
  { id: 'standard', label: 'Standard', steps: 36, minutes: 30, rupees: 500,
    fits: 'The default. Research with a few sources, a report, a handful of delegated tasks.' },
  { id: 'long', label: 'Long', steps: 100, minutes: 120, rupees: 1500,
    fits: 'Multi-step projects: many sources, several specialists, files written along the way.' },
  { id: 'marathon', label: 'Marathon', steps: 200, minutes: 480, rupees: 4000,
    fits: 'Hours of work in one turn. For anything that should run for days, start a mission instead.' },
];

export function presetFor(limits: OrchestratorLimits): string | null {
  const hit = PRESETS.find((p) =>
    p.steps === limits.maxSteps
    && p.minutes * 60 === limits.timeLimitSeconds
    && p.rupees === limits.spendCapRupees);
  return hit?.id ?? null;
}

/** "about 5.9 million tokens", the size of a spend cap in model work. */
export function tokensForRupees(rupees: number): string {
  if (rupees <= 0) return 'no limit';
  const tokens = (rupees * 1_000_000) / RUPEES_PER_MILLION_TOKENS;
  if (tokens >= 1_000_000) return `about ${(tokens / 1_000_000).toFixed(1)} million tokens`;
  return `about ${Math.round(tokens / 1000)} thousand tokens`;
}

/** "30 minutes", "2 hours", "1 hour 30 minutes". */
export function describeDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const h = hours ? `${hours} hour${hours === 1 ? '' : 's'}` : '';
  const m = rest ? `${rest} minute${rest === 1 ? '' : 's'}` : '';
  return [h, m].filter(Boolean).join(' ') || '0 minutes';
}

export function isDefault(limits: OrchestratorLimits): boolean {
  return limits.maxSteps === DEFAULT_LIMITS.maxSteps
    && limits.timeLimitSeconds === DEFAULT_LIMITS.timeLimitSeconds
    && limits.spendCapRupees === DEFAULT_LIMITS.spendCapRupees
    && limits.summariseLongTurns === DEFAULT_LIMITS.summariseLongTurns;
}
