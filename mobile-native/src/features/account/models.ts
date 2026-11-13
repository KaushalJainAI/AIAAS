/**
 * The model picker's pure helpers: shipped defaults, the effort ladder, and the
 * nearest-rung rule. Copied from better-n8n-frontend/src/hooks/useEffortSelection.ts
 * and useChatModelSelection.ts. Pure, so the mobile picker and the web pick the same rung.
 *
 * Three copies of the default triple exist on the web (ChatSession, UserProfile,
 * and here). Keep them together: a shipped default that the platform cannot run is a bug.
 */

import type { AIProvider } from './types';

/** Shipped defaults: a platform-key router, which survives individual models being retired. */
export const DEFAULT_PROVIDER = 'openrouter';
export const DEFAULT_MODEL = 'openrouter/free';
export const DEFAULT_EFFORT = 'medium';

/** The effort rungs, cheapest first. Mirrors `llm.effort.LADDER` on the backend. */
export const EFFORT_LADDER = ['none', 'minimal', 'low', 'medium', 'high'] as const;

/** What each rung means in the user's terms. `''` is the model's own default. */
export const EFFORT_LABELS: Record<string, string> = {
  '': 'Default',
  none: 'Instant',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export const EFFORT_HINTS: Record<string, string> = {
  '': "The model's own default.",
  none: 'Skip the thinking. Fastest and cheapest.',
  minimal: 'A brief pass before answering.',
  low: 'Light reasoning. Good for lookups and short tasks.',
  medium: 'Balanced. Suits most multi-step work.',
  high: 'Think hard. Slower and costs more; for analysis and tricky problems.',
};

/**
 * The offered rung closest to `wanted`, mirroring `nearest` in
 * `Backend/llm/effort.py`, including its downward tie-break. The UI shows the
 * level the server will actually use, not a plausible neighbour.
 */
export function nearestEffort(wanted: string, offered: readonly string[]): string {
  if (!offered.length) return '';
  if (offered.includes(wanted)) return wanted;
  const target = EFFORT_LADDER.indexOf(wanted as (typeof EFFORT_LADDER)[number]);
  if (target < 0) return '';
  return offered.reduce((best, level) => {
    const rank = EFFORT_LADDER.indexOf(level as (typeof EFFORT_LADDER)[number]);
    const bestRank = EFFORT_LADDER.indexOf(best as (typeof EFFORT_LADDER)[number]);
    const closer = Math.abs(rank - target) - Math.abs(bestRank - target);
    // A closer rung wins; on a tie the cheaper (lower) rung takes it.
    return closer < 0 || (closer === 0 && rank < bestRank) ? level : best;
  });
}

/** The rungs a model offers, or `[]` when it has no effort control. */
export function effortLevelsFor(providers: AIProvider[], provider: string, model: string): string[] {
  return (
    providers.find((p) => p.slug === provider)?.models.find((m) => m.value === model)
      ?.effort_levels ?? []
  );
}
