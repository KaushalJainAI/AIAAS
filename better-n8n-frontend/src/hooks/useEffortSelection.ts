/**
 * How hard the chosen model is asked to think, and the control that changes it.
 *
 * A sibling to `useChatModelSelection` rather than part of it, because the two
 * answer to different things: a model is chosen from a catalogue, an effort is
 * chosen from *whatever the chosen model happens to offer*. Folding them
 * together would mean the model hook growing a dependency on the catalogue's
 * per-model detail, and every consumer that only wants the model re-rendering
 * when the effort changes.
 *
 * The rule that shapes everything here: **the model can change under the
 * choice**. A user picks `high` on a reasoning model and then switches to one
 * that offers nothing, or offers a different set of rungs. Two consequences,
 * and the second is the one that is easy to get wrong:
 *
 * 1. The UI must not go on *displaying* a level that is no longer on offer — a
 *    control showing a value the run will not use is worse than no control. So
 *    the displayed level is snapped to the nearest offered rung, by the same
 *    rule `llm/effort.py` uses server-side (ties break downward).
 * 2. But the snap must not **overwrite** what the user chose. An earlier
 *    version cleared the stored preference whenever the model lacked it, which
 *    meant passing through one non-reasoning model silently reset a standing
 *    `high` to the default, for ever. The preference and the effective level
 *    are therefore two separate values: `effort` is what was chosen, `effective`
 *    is what this model can honour, and only the user writes the former.
 */

import { useCallback, useMemo, useState } from 'react';
import type { AIProvider } from '../api/nodeService';

const EFFORT_KEY = 'standalone_chat_llm_effort';

/** Cheapest first, mirroring `LADDER` in `Backend/llm/effort.py`. */
export const EFFORT_LADDER = ['none', 'minimal', 'low', 'medium', 'high'] as const;

/**
 * Where a new chat starts, mirroring the `ChatSession.llm_effort` column
 * default. `medium` rather than blank because the routers a new chat opens on
 * declare the standard three rungs, so the knob is live from the first message
 * — and `medium` is the rung that neither pays for reasoning nobody asked for
 * nor withholds it from work that needs it. `''` stays reachable and still
 * means "let the model decide".
 */
export const DEFAULT_EFFORT = 'medium';

/**
 * What each rung means, in the user's terms rather than the API's.
 *
 * Worth writing down because the names alone are misleading in one specific
 * way: `none` is not "no reasoning model", it is a reasoning model told to skip
 * the thinking — which is a thing only some models can be asked, and is why the
 * catalogue declares rungs per model instead of the UI assuming all five.
 */
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
 * `Backend/llm/effort.py` — including its downward tie-break, so the UI shows
 * the level the server will actually use rather than a plausible neighbour.
 */
export function nearestEffort(wanted: string, offered: readonly string[]): string {
  if (!offered.length) return '';
  if (offered.includes(wanted)) return wanted;
  const target = EFFORT_LADDER.indexOf(wanted as typeof EFFORT_LADDER[number]);
  if (target < 0) return '';
  return offered.reduce((best, level) => {
    const rank = EFFORT_LADDER.indexOf(level as typeof EFFORT_LADDER[number]);
    const bestRank = EFFORT_LADDER.indexOf(best as typeof EFFORT_LADDER[number]);
    const closer = Math.abs(rank - target) - Math.abs(bestRank - target);
    // `< 0` closer wins; `=== 0` is a tie and the cheaper (lower) rung takes it.
    return closer < 0 || (closer === 0 && rank < bestRank) ? level : best;
  });
}

/** The rungs a given model offers, or `[]` when it has no effort control. */
export function effortLevelsFor(
  providers: AIProvider[], provider: string, model: string,
): string[] {
  return (
    providers.find((p) => p.slug === provider)?.models.find((m) => m.value === model)
      ?.effort_levels ?? []
  );
}

interface Options {
  /** Provider list from `useAIModels`. */
  providers: AIProvider[];
  /** The provider slug currently selected. */
  provider: string;
  /** The model value currently selected. */
  model: string;
  /** Guests are pinned to the served model and get no choice here either. */
  isGuest?: boolean;
}

export function useEffortSelection({ providers, provider, model, isGuest = false }: Options) {
  // Read synchronously during the first render, like the model hook: it is
  // localStorage, there was never anything to wait for, and doing it in an
  // effect is what produces a one-frame flash of the wrong value.
  const [effort, setEffort] = useState(() => {
    if (isGuest) return '';
    try {
      return localStorage.getItem(EFFORT_KEY) ?? DEFAULT_EFFORT;
    } catch {
      // Private mode and "block site data" both throw on access.
      return DEFAULT_EFFORT;
    }
  });

  /** The rungs the *currently selected* model offers, or `[]` for none. */
  const available = useMemo(
    () => effortLevelsFor(providers, provider, model),
    [providers, provider, model],
  );

  const supported = available.length > 0;

  /**
   * What this model will actually run at.
   *
   * Derived, never stored — which is the whole point. Switching to a model
   * that lacks the chosen rung changes what is *shown and sent*, and leaves
   * what the user chose untouched, so switching back restores it.
   */
  const effective = useMemo(() => {
    if (!supported || !effort) return '';
    return nearestEffort(effort, available);
  }, [supported, effort, available]);

  const choose = useCallback((next: string) => {
    if (isGuest) return;
    setEffort(next);
    try {
      if (next) localStorage.setItem(EFFORT_KEY, next);
      else localStorage.removeItem(EFFORT_KEY);
    } catch {
      // A preference that cannot be persisted still applies to this session.
    }
  }, [isGuest]);

  /**
   * Adopt the level stored on a loaded session. Like the model hook's `adopt`,
   * this deliberately skips localStorage: opening an old chat should not change
   * what the user's next new chat starts at.
   */
  const adopt = useCallback((next: string) => {
    if (isGuest) return;
    setEffort(next ?? '');
  }, [isGuest]);

  return {
    /** What the user chose, whether or not this model can honour it. */
    effort,
    /** What this model will run at: the chosen rung, snapped, or `''`. */
    effective,
    /**
     * What to send. `undefined` when this model has no effort control, so the
     * request omits the field entirely rather than asserting a preference
     * about a knob that does not exist.
     */
    effortToSend: supported ? effective : undefined,
    /** Rungs this model offers, cheapest first. Empty means: hide the control. */
    available,
    supported,
    choose,
    adopt,
  };
}
