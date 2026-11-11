/**
 * Spend summary for the sidebar's "₹N this month" line.
 *
 * `GET /api/logs/spend/summary/` answers `{month_rupees, by_caller}`. Only the
 * month total is shown here: no budget, no bar. The line is optional, so every
 * failure path returns null and the sidebar simply omits it.
 */

import apiClient from './client';

export interface SpendSummary {
  month_rupees: number;
  by_caller?: Record<string, number>;
}

export const spendService = {
  async getMonthSummary(): Promise<SpendSummary> {
    const response = await apiClient.get<SpendSummary>('/logs/spend/summary/');
    return response.data;
  },
};

/**
 * The sidebar line for a summary, or null when there is nothing honest to show.
 * A missing, non-numeric or negative figure hides the line rather than printing
 * a made-up zero.
 */
export function monthSpendLabel(summary: unknown): string | null {
  if (!summary || typeof summary !== 'object') return null;
  const value = (summary as { month_rupees?: unknown }).month_rupees;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const rupees = Math.round(value);
  return `₹${rupees.toLocaleString('en-IN')} this month`;
}

export default spendService;
