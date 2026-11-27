/**
 * The Essentials / All settings split of the agent builder (Phase 10).
 *
 * Pure logic only: which fields the simple view shows, which hidden fields
 * differ from the defaults, and the per-viewer choice of view. The builder page
 * draws the controls; it does not decide what counts as essential.
 */
import type { AgentConfig } from '../types/agentConfig';

export type BuilderView = 'essentials' | 'all';

/** The fields Essentials shows. Keep in step with the Essentials sections in
 *  `pages/AgentBuilder.tsx`. Every other field lives under All settings. */
export const ESSENTIAL_FIELDS: readonly (keyof AgentConfig)[] = [
  'name',
  'brief',
  'provider',
  'model',
  'tools',
  'connectors',
  'skills',
  'autonomy',
  'spendCapRupees',
  'allowUnattended',
];

/** Fields no view shows as a setting. Schedules live on Trigger rows the
 *  Schedules page owns (the wire omits these), and the other two are read-only. */
const NOT_SHOWN: readonly (keyof AgentConfig)[] = [
  'schedule',
  'scheduleTimezone',
  'extraSchedules',
  'trigger',
];

const ESSENTIAL = new Set<string>(ESSENTIAL_FIELDS);
const NOT_SHOWN_SET = new Set<string>(NOT_SHOWN);

export function isEssentialField(key: string): boolean {
  return ESSENTIAL.has(key);
}

/** Order-insensitive for object keys, order-sensitive for arrays. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => sameValue(item, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    const keys = Object.keys(ra);
    if (keys.length !== Object.keys(rb).length) return false;
    return keys.every((k) => sameValue(ra[k], rb[k]));
  }
  return false;
}

/**
 * The hidden (All settings only) fields whose value differs from `defaults`.
 * Essentials uses the count to say "N other settings are changed", so a saved
 * setting is never invisible.
 */
export function changedAdvancedFields(
  config: Partial<AgentConfig>,
  defaults: AgentConfig,
): string[] {
  return (Object.keys(defaults) as (keyof AgentConfig)[])
    .filter((key) => !ESSENTIAL.has(key) && !NOT_SHOWN_SET.has(key))
    .filter((key) => !sameValue(config[key], defaults[key]))
    .map(String);
}

/* ---------- the per-viewer choice ----------
 *
 * A preference, not account content, so it is kept on sign-out (see
 * `lib/accountData.ts`). Storage can be blocked; then the view simply is not
 * remembered and Essentials is shown. */

export const BUILDER_VIEW_KEY = 'aiaas.builderView';

export function readBuilderView(): BuilderView {
  try {
    return window.localStorage.getItem(BUILDER_VIEW_KEY) === 'all' ? 'all' : 'essentials';
  } catch {
    return 'essentials';
  }
}

export function writeBuilderView(view: BuilderView): void {
  try {
    window.localStorage.setItem(BUILDER_VIEW_KEY, view);
  } catch {
    // Blocked or full storage: the choice is not remembered, nothing else breaks.
  }
}
