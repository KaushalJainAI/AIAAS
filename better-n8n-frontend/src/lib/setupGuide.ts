/**
 * Whether a connector has a "Get started" guide to show.
 *
 * The backend sends `{}` when there is no guide, and a guide with 1..12 steps
 * when there is one. A guide with no steps has nothing to walk a user through,
 * so it is treated as absent rather than rendered as an empty panel.
 */
import type { SetupGuide, SetupGuideValue } from '@/api/mcp';

export function hasSetupGuide(
  guide: SetupGuideValue | null | undefined,
): guide is SetupGuide {
  return Array.isArray(guide?.steps) && guide.steps.length > 0;
}
