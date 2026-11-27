import type { SetupGuide, SetupGuideEmpty } from './types';

/**
 * True only when a connector has a Get started guide to show: its `steps`
 * are a non-empty list. `{}` (no guide) and any guide without steps are false.
 */
export function hasSetupGuide(guide: SetupGuide | SetupGuideEmpty | null | undefined): guide is SetupGuide {
  if (!guide || !('steps' in guide)) return false;
  return Array.isArray(guide.steps) && guide.steps.length > 0;
}
