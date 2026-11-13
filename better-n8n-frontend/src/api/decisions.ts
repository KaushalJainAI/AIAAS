/**
 * Decision models: the picker in Settings, provider first then model.
 *
 * `GET /api/llm/decision-models/?provider=` answers the providers that have a
 * decision endpoint, that provider's models from its live listing (newest
 * first), the platform default and what this user gets right now. The choice
 * is saved on the profile (`decision_provider` / `decision_model`) and read by
 * the `decide` tool for chat and every agent the user owns.
 */

import apiClient from './client';

export interface DecisionProvider {
  slug: string;
  label: string;
  default_model: string;
}

export interface DecisionModel {
  id: string;
  name: string;
  /** Unix seconds; 0 when unknown. The list arrives newest first. */
  created: number;
  /** USD per million input tokens; output is free. null when unknown. */
  input_price_per_million: number | null;
  is_free: boolean;
  context_length: number;
  input_modalities: string[];
  /** A `~vendor/x-latest` alias that follows the newest release. */
  is_router: boolean;
  expires: string;
  /** The provider's listing could not be reached; this row is the default only. */
  unverified?: boolean;
}

export interface DecisionModelListing {
  providers: DecisionProvider[];
  provider: string;
  models: DecisionModel[];
  default: { provider: string; model: string };
  effective: { provider: string; model: string };
}

export const decisionsService = {
  async list(provider?: string): Promise<DecisionModelListing> {
    const response = await apiClient.get<DecisionModelListing>('/llm/decision-models/', {
      params: provider ? { provider } : undefined,
    });
    return response.data;
  },
};

/** "Jev 1.14 · $0.042/M in" — the price is what a decision costs, output is free. */
export function decisionModelLabel(model: DecisionModel): string {
  const name = model.name.includes(': ') ? model.name.split(': ').slice(1).join(': ') : model.name;
  const vendor = model.name.includes(': ') ? model.name.split(': ')[0] : '';
  const price = model.is_free
    ? 'free'
    : model.input_price_per_million == null
      ? ''
      : `$${formatPrice(model.input_price_per_million)}/M in`;
  return [vendor ? `${vendor} ${name}` : name, price].filter(Boolean).join(' · ');
}

function formatPrice(value: number): string {
  if (value >= 1) return value.toFixed(2).replace(/\.?0+$/, '');
  return value.toPrecision(2).replace(/\.?0+$/, '');
}

export default decisionsService;
