/**
 * The solution form's rules, kept out of the component so they can be tested
 * without a DOM. The numbers mirror `solutions/api.py` (MAX_PROBLEM, MAX_TEXT,
 * MAX_CLAIMS, MAX_PHRASINGS) and its `_clean_claims` / `_clean_env`; the server
 * still checks everything, these are the same answers given before a round trip.
 */
import type { ClaimKind, DraftFields, Solution } from '../api/solutions';

export const LIMITS = {
  problem: 500,
  text: 8000,
  claims: 12,
  claimText: 400,
  envRows: 12,
  envKey: 40,
  envValue: 80,
  tags: 8,
  tagLength: 40,
} as const;

export interface ClaimKindInfo {
  value: ClaimKind;
  label: string;
  /** Plain-language helper text shown under the picker. */
  help: string;
  /** False when the server drops the claim on save (it is never kept). */
  saved: boolean;
}

/**
 * The six claim kinds of `solutions/freshness.py`, with what each one means
 * and how long it may be stated before someone re-checks it (the windows are
 * `freshness.KINDS`: procedure 365 days, versioned 180, config 90,
 * time_sensitive 30, principle never).
 */
export const CLAIM_KINDS: ClaimKindInfo[] = [
  {
    value: 'procedure',
    label: 'Steps',
    help: 'Steps that stay right until the system changes. Re-check about once a year.',
    saved: true,
  },
  {
    value: 'principle',
    label: 'General rule',
    help: 'A rule that does not change. It never needs a re-check.',
    saved: true,
  },
  {
    value: 'versioned',
    label: 'Version-specific',
    help: 'True for particular versions of a product. Re-check about every six months, or when the version changes.',
    saved: true,
  },
  {
    value: 'config',
    label: 'Setting',
    help: 'A setting, address or port that someone can change. Re-check about every three months.',
    saved: true,
  },
  {
    value: 'time_sensitive',
    label: 'Changes often',
    help: 'A limit, price, person, schedule or policy. Re-check about every month.',
    saved: true,
  },
  {
    value: 'ephemeral',
    label: 'Only right now',
    help: 'True only at the moment, such as an outage. These are not kept, so they are not offered here.',
    saved: false,
  },
];

/** The kinds a person can pick. `ephemeral` is dropped by the server, so it is not offered. */
export const SAVED_CLAIM_KINDS: ClaimKindInfo[] = CLAIM_KINDS.filter((k) => k.saved);

export function claimKindInfo(value: string): ClaimKindInfo {
  return CLAIM_KINDS.find((k) => k.value === value) ?? CLAIM_KINDS[0];
}

export interface EnvRow { key: string; value: string }
export interface ClaimRow { text: string; kind: ClaimKind }

export interface FormValues {
  problem: string;
  symptoms: string;
  root_cause: string;
  resolution: string;
  /** Comma-separated, as typed. */
  tags: string;
  environment: EnvRow[];
  claims: ClaimRow[];
}

export type FormField = 'problem' | 'symptoms' | 'root_cause' | 'resolution' | 'tags' | 'environment' | 'claims';
export type FormErrors = Partial<Record<FormField, string>>;

/** The `detail` a refusal carries (`{detail: "..."}`), or the fallback. */
export function detailOf(error: unknown, fallback: string): string {
  return (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}

export function emptyValues(): FormValues {
  return {
    problem: '',
    symptoms: '',
    root_cause: '',
    resolution: '',
    tags: '',
    environment: [],
    claims: [],
  };
}

/** The form's starting values for an existing solution (edit or draft review). */
export function valuesFromSolution(s: Solution): FormValues {
  return {
    problem: s.problem ?? '',
    symptoms: s.symptoms ?? '',
    root_cause: s.root_cause ?? '',
    resolution: s.resolution ?? '',
    tags: (s.tags ?? []).join(', '),
    environment: Object.entries(s.environment ?? {}).map(([key, value]) => ({ key, value: String(value) })),
    claims: (s.claims ?? []).map((c) => ({ text: c.text, kind: c.kind })),
  };
}

/** Comma list → tags: trimmed, empties and repeats dropped, server limits applied. */
export function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const tag = part.trim().slice(0, LIMITS.tagLength);
    if (tag) seen.add(tag);
  }
  return [...seen].slice(0, LIMITS.tags);
}

/** Field-level messages a person can act on. Empty object = ready to send. */
export function validate(values: FormValues): FormErrors {
  const errors: FormErrors = {};
  const problem = values.problem.trim();
  const resolution = values.resolution.trim();

  if (!problem) errors.problem = 'Describe the problem in a sentence.';
  else if (problem.length > LIMITS.problem) errors.problem = `Keep the problem under ${LIMITS.problem} characters.`;

  if (!resolution) errors.resolution = 'Say what fixed it.';
  else if (resolution.length > LIMITS.text) errors.resolution = `Keep the fix under ${LIMITS.text.toLocaleString()} characters.`;

  if (values.symptoms.length > LIMITS.text) errors.symptoms = `Keep the symptoms under ${LIMITS.text.toLocaleString()} characters.`;
  if (values.root_cause.length > LIMITS.text) errors.root_cause = `Keep the cause under ${LIMITS.text.toLocaleString()} characters.`;

  const distinctTags = new Set(values.tags.split(',').map((t) => t.trim()).filter(Boolean));
  if (distinctTags.size > LIMITS.tags) errors.tags = `Use at most ${LIMITS.tags} tags.`;

  if (values.environment.length > LIMITS.envRows) {
    errors.environment = `Use at most ${LIMITS.envRows} environment rows.`;
  } else if (values.environment.some((row) => !row.key.trim() && row.value.trim())) {
    errors.environment = 'Name each environment value, for example "os: Windows 11".';
  } else if (values.environment.some((row) => row.key.trim() && !row.value.trim())) {
    errors.environment = 'Add a value for each environment name, or remove the row.';
  }

  const filledClaims = values.claims.filter((c) => c.text.trim());
  if (values.claims.length > LIMITS.claims) {
    errors.claims = `Use at most ${LIMITS.claims} claims.`;
  } else if (filledClaims.some((c) => c.text.trim().length > LIMITS.claimText)) {
    errors.claims = `Keep each claim under ${LIMITS.claimText} characters.`;
  }

  return errors;
}

export function hasErrors(errors: FormErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Form values → the body the server takes. Call only after `validate` passes. */
export function toDraft(values: FormValues): DraftFields {
  const environment: Record<string, string> = {};
  for (const row of values.environment) {
    const key = row.key.trim();
    if (key) environment[key.slice(0, LIMITS.envKey)] = row.value.trim().slice(0, LIMITS.envValue);
  }
  return {
    problem: values.problem.trim(),
    symptoms: values.symptoms.trim(),
    root_cause: values.root_cause.trim(),
    resolution: values.resolution.trim(),
    environment,
    claims: values.claims
      .filter((c) => c.text.trim())
      .map((c) => ({ text: c.text.trim(), kind: c.kind })),
    tags: parseTags(values.tags),
  };
}
