/**
 * The "₹N this month" line for the Activity and Settings screens.
 *
 * Mirrors `monthSpendLabel` in better-n8n-frontend/src/api/spend.ts. A missing,
 * non-numeric or negative figure hides the line rather than printing a made-up
 * zero, so every failure path returns null.
 */

export function monthSpendLabel(summary: unknown): string | null {
  if (!summary || typeof summary !== 'object') return null;
  const value = (summary as { month_rupees?: unknown }).month_rupees;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const rupees = Math.round(value);
  return `₹${rupees.toLocaleString('en-IN')} this month`;
}
