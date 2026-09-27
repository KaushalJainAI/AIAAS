/**
 * Human names for model slugs.
 *
 * Two places show the user which model answered — the guest bar and the
 * "Prepared with" line under each answer — and they must agree. Kept here so
 * adding a served model is one edit, not a hunt for the other copy.
 */

/* Model ids are slugs. Spell out the ones we actually serve — "120B/12B-active"
   is the interesting part (mixture-of-experts) and no amount of string munging
   gets you there from the slug. */
export const MODEL_NAMES: Record<string, string> = {
  'nvidia/nemotron-3.5-lightning-30b-a3b': 'Nemotron 3.5 Lightning (30B/3B-active)',
  'nvidia/nemotron-3-super-120b-a12b': 'Nemotron 3 Super (120B/12B-active)',
  'nvidia/llama-3.3-nemotron-super-49b-v1': 'Llama 3.3 Nemotron Super 49B',
};

/** Readable name for a slug. `fallback` is used when there is no slug at all. */
export function prettyModel(id?: string | null, fallback = 'a hosted model') {
  if (!id) return fallback;
  if (MODEL_NAMES[id]) return MODEL_NAMES[id];
  // Unknown id: fall back to a readable form of the slug rather than showing raw.
  return (id.split('/').pop() ?? id)
    .replace(/:free$/, '')
    .replace(/-v\d+$/, '')
    .replace(/-/g, ' ')
    .replace(/\b(\d+)b\b/gi, '$1B')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
