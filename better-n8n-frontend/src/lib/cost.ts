/**
 * How a cost is written down.
 *
 * One module because the same figure appears on the Activity list, inside a run's
 * turns, on the agent list and in Insights, and a cost that reads `₹0.02` in
 * one place and `$0.0002` in another is a cost nobody trusts. The backend does
 * every piece of arithmetic (`llm/pricing.py`); this only formats, deliberately
 * — a second implementation of the math in TypeScript is exactly the drift
 * `agents/spend.py` exists to document.
 *
 * The rule that matters more than the formatting: **`unpriced` is not zero.**
 * It means no price is on record for the model the run used, so we do not know
 * what it cost. Printing `₹0.00` there would claim the run was free, which is
 * the one thing we are sure it was not.
 */
import type { CostSource } from '@/api/logs';

/**
 * What callers may pass as a source.
 *
 * `''` is what a conversation carries before it has answered anything, and
 * `undefined` is what an older payload carries. Both mean "no figure yet" and
 * are treated exactly like `unpriced`: not a number, because there isn't one.
 */
export type MaybeCostSource = CostSource | '' | undefined;

/**
 * Rupees per US dollar.
 *
 * Must match `USD_TO_INR` in `Backend/llm/pricing.py`. It is duplicated rather
 * than fetched because it changes about once a year and a network round trip
 * to render a table cell is worse than a stale constant — but if you change it
 * there, change it here.
 */
export const USD_TO_INR = 88;

/** Rendered in place of a number when no price is on record. */
export const UNPRICED_LABEL = '—';

export interface CostParts {
  input_tokens: number;
  output_tokens: number;
  cached_read_tokens: number;
  cached_write_tokens: number;
}

function usd(costUsd: string | number | null | undefined): number {
  const value = typeof costUsd === 'number' ? costUsd : parseFloat(costUsd ?? '');
  return Number.isFinite(value) ? value : 0;
}

/**
 * A cost as it appears to the user, in rupees.
 *
 * Sub-paisa amounts are shown at three decimals rather than rounded to `₹0.00`:
 * a cheap turn genuinely costs a fraction of a paisa, and a column of zeroes
 * that sums to something is worse than a column of small numbers.
 */
export function formatCost(
  costUsd: string | number | null | undefined,
  source: MaybeCostSource,
): string {
  if (!source || source === 'unpriced') return UNPRICED_LABEL;
  const inr = usd(costUsd) * USD_TO_INR;
  if (inr === 0) return '₹0';
  if (inr < 0.01) return `₹${inr.toFixed(3)}`;
  if (inr < 100) return `₹${inr.toFixed(2)}`;
  return `₹${Math.round(inr).toLocaleString()}`;
}

/** The same figure in dollars, for the tooltip where the rate is worth showing. */
export function formatCostUsd(costUsd: string | number | null | undefined): string {
  const value = usd(costUsd);
  return value !== 0 && value < 0.01 ? `$${value.toFixed(6)}` : `$${value.toFixed(4)}`;
}

/**
 * The word a bare figure needs beside it: `charged` or `est.`, never nothing.
 *
 * A chip reading `₹1.02` on its own was read as "this chat has cost me ₹1.02",
 * which it is only when the provider billed it on the user's own key. The Runs
 * page always said which kind of number it was; the chat header did not.
 */
export function costQualifier(source: MaybeCostSource): string {
  if (source === 'billed') return 'charged';
  if (source === 'estimated') return 'est.';
  return '';
}

/**
 * Whose money a figure is. Mirrors `llm.access.PAYERS` plus `mixed`, which a
 * conversation reads once it has switched keys partway. `''` is "not known":
 * an older row, or a lookup that failed.
 */
export type Payer = 'own_key' | 'platform' | 'free' | 'local' | 'mixed' | '';

const PAYER_SENTENCE: Record<Exclude<Payer, ''>, string> = {
  own_key: 'This runs on your own API key, so the provider bills it to your account.',
  platform: "This runs on the platform's key: the platform pays the provider, and "
    + 'you are charged credits for it instead (Settings → Billing).',
  free: "A free model on the platform's key — nobody pays for it and no credits are used.",
  local: 'This runs on your own machine, so nobody is billed for it.',
  mixed: 'Part of this ran on your own key (billed by the provider) and part on '
    + "the platform's key (charged in credits).",
};

/**
 * What the conversation cost chip means, for its hover text.
 *
 * Two meters exist and the chip is only one of them. It is what the *model
 * provider* charges for this conversation's calls. Who pays that depends on
 * the key: on the user's own key it is on their provider bill, and on the
 * platform key the platform pays it and the user is charged credits instead
 * (`Backend/llm/credits.py`), which is a different unit shown in Settings.
 */
export function describeConversationCost(
  costUsd: string | number | null | undefined,
  source: MaybeCostSource,
  tokens: number,
  paidBy: Payer = '',
): string {
  const figure = describeCost(costUsd, source);
  return [
    `This conversation so far: ${figure} · ${tokens.toLocaleString()} tokens.`,
    // Precisely what is counted, because each of these used to be missing.
    'Counts every model call: the answers, the suggested follow-up questions, '
      + 'and image questions to the vision model.',
    // Said for this conversation when the server knows who paid; the general
    // rule only when it does not.
    paidBy
      ? PAYER_SENTENCE[paidBy]
      : 'This is the model provider\'s price. On your own API key it is billed to '
        + 'that account; on the platform key you are charged credits instead '
        + '(Settings → Billing).',
  ].join('\n');
}

/**
 * The hover text behind a cost: where the number came from, and what it is made
 * of. Worth spelling out because the breakdown is the whole reason the figure
 * is trustworthy — output tokens cost several times input, and a cached read a
 * tenth of one, so the same total token count can mean very different money.
 */
export function describeCost(
  costUsd: string | number | null | undefined,
  source: MaybeCostSource,
  parts?: Partial<CostParts>,
): string {
  if (!source || source === 'unpriced') {
    return 'No price on record for this model — cost unknown, not zero.';
  }

  const provenance = source === 'billed'
    ? 'Charged by the provider'
    : 'Estimated from the model price list';

  const segments: string[] = [];
  if (parts) {
    const cached = parts.cached_read_tokens ?? 0;
    const input = parts.input_tokens ?? 0;
    segments.push(
      cached > 0
        ? `${input.toLocaleString()} in + ${cached.toLocaleString()} cached`
        : `${input.toLocaleString()} in`,
    );
    segments.push(`${(parts.output_tokens ?? 0).toLocaleString()} out`);
    if (parts.cached_write_tokens) {
      segments.push(`${parts.cached_write_tokens.toLocaleString()} cache write`);
    }
  }

  const detail = segments.length ? ` · ${segments.join(' · ')}` : '';
  return `${provenance}: ${formatCostUsd(costUsd)}${detail}`;
}
