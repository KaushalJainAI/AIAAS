/**
 * The one-line summary of a revert, for the toast: "6 undone, 1 skipped".
 * Plain function, no React, so the sheet's container and any other caller
 * word it the same way.
 */
import type { RevertResult } from '@/api/changes';

export function summariseRevert(result: RevertResult): string {
  const parts = [`${result.reverted} undone`];
  if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
  if (result.failed > 0) parts.push(`${result.failed} failed`);
  return parts.join(', ');
}
