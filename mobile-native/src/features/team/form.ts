/**
 * The solution form's rules, ported from better-n8n-frontend/src/lib/solutionForm.ts.
 * The numbers mirror `solutions/api.py`; the server still checks everything, these
 * are the same answers given before a round trip.
 */
import type { ClaimKind, DraftFields, Solution } from './types';

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
}

/**
 * The claim kinds a person can pick. `ephemeral` is dropped by the server, so it
 * is not offered (the web's `SAVED_CLAIM_KINDS`).
 */
export const SAVED_CLAIM_KINDS: ClaimKindInfo[] = [
  {
    value: 'procedure',
    label: 'Steps',
    help: 'Steps that stay right until the system changes. Re-check about once a year.',
  },
  {
    value: 'principle',
    label: 'General rule',
    help: 'A rule that does not change. It never needs a re-check.',
  },
  {
    value: 'versioned',
    label: 'Version-specific',
    help: 'True for particular versions of a product. Re-check about every six months, or when the version changes.',
  },
  {
    value: 'config',
    label: 'Setting',
    help: 'A setting, address or port that someone can change. Re-check about every three months.',
  },
  {
    value: 'time_sensitive',
    label: 'Changes often',
    help: 'A limit, price, person, schedule or policy. Re-check about every month.',
  },
];

export function claimKindInfo(value: string): ClaimKindInfo {
  return SAVED_CLAIM_KINDS.find((k) => k.value === value) ?? SAVED_CLAIM_KINDS[0];
}

export interface EnvRow {
  key: string;
  value: string;
}
export interface ClaimRow {
  text: string;
  kind: ClaimKind;
}

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

export function emptyValues(problem = ''): FormValues {
  return {
    problem,
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

/** Comma list to tags: trimmed, empties and repeats dropped, server limits applied. */
export function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const tag = part.trim().slice(0, LIMITS.tagLength);
    if (tag) seen.add(tag);
  }
  return [...seen].slice(0, LIMITS.tags);
}

/** Field-level messages a person can act on. An empty object means ready to send. */
export function validate(values: FormValues): FormErrors {
  const errors: FormErrors = {};
  const problem = values.problem.trim();
  const resolution = values.resolution.trim();

  if (!problem) errors.problem = 'Describe the problem in a sentence.';
  else if (problem.length > LIMITS.problem) errors.problem = `Keep the problem under ${LIMITS.problem} characters.`;

  if (!resolution) errors.resolution = 'Say what fixed it.';
  else if (resolution.length > LIMITS.text) {
    errors.resolution = `Keep the fix under ${LIMITS.text.toLocaleString()} characters.`;
  }

  if (values.symptoms.length > LIMITS.text) {
    errors.symptoms = `Keep the symptoms under ${LIMITS.text.toLocaleString()} characters.`;
  }
  if (values.root_cause.length > LIMITS.text) {
    errors.root_cause = `Keep the cause under ${LIMITS.text.toLocaleString()} characters.`;
  }

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

/** Form values to the body the server takes. Call only after `validate` passes. */
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

/** The sentence a failed call should show: the server's own words (the client keeps `detail`), or the fallback. */
export function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
