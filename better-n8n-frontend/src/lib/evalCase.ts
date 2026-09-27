/**
 * The case editor's form <-> the `EvalCase` the API stores.
 *
 * Grader parameters arrive from the catalogue as bare names (`value`,
 * `ignore_case`), with no types: the registry validates values, not the UI.
 * So a parameter is edited as text and read back by shape — `true`/`false`
 * are booleans, a plain number is a number, a JSON array or object is parsed,
 * and everything else stays the string the person typed. `"12"` meaning the
 * number twelve is what every numeric grader (`min_length`, `max_tokens`)
 * wants; a grader that needs the literal text `"12"` can still get it,
 * because `contains`/`equals` coerce with `str()` on the backend.
 */
import type { EvalCase, GraderSpec } from '../api/evals';

export interface GraderRow {
  type: string;
  /** Parameter name -> the text in its input. */
  params: Record<string, string>;
  /** The values as stored, so an untouched `"30"` is not re-saved as `30`. */
  stored?: Record<string, unknown>;
}

export interface CaseForm {
  name: string;
  goal: string;
  reference: string;
  graders: GraderRow[];
  weight: string;
  isActive: boolean;
}

export const EMPTY_FORM: CaseForm = {
  name: '', goal: '', reference: '', graders: [], weight: '1', isActive: true,
};

export function parseParam(text: string): unknown {
  const t = text.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t.startsWith('[') || t.startsWith('{')) {
    try { return JSON.parse(t); } catch { /* not JSON after all: keep the text */ }
  }
  return text;
}

export function formatParam(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export function toForm(c: EvalCase): CaseForm {
  return {
    name: c.name,
    goal: c.goal,
    reference: c.reference,
    graders: c.graders.map(({ type, ...rest }) => ({
      type,
      params: Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, formatParam(v)])),
      stored: rest,
    })),
    weight: String(c.weight),
    isActive: c.is_active,
  };
}

/** Empty parameters are left out, so an optional one keeps its default. */
export function toGraders(rows: GraderRow[]): GraderSpec[] {
  return rows.map(({ type, params, stored = {} }) => {
    const spec: GraderSpec = { type };
    for (const [k, v] of Object.entries(params)) {
      if (v.trim() === '') continue;
      const untouched = k in stored && formatParam(stored[k]) === v;
      spec[k] = untouched ? stored[k] : parseParam(v);
    }
    return spec;
  });
}

export function toPayload(form: CaseForm): Partial<EvalCase> {
  return {
    name: form.name.trim(),
    goal: form.goal.trim(),
    reference: form.reference.trim(),
    graders: toGraders(form.graders),
    weight: Number(form.weight),
    is_active: form.isActive,
  };
}

/** The first message in a DRF 400 body (`{"graders": ["..."]}` or `{"error": "..."}`). */
export function firstError(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const msg = Array.isArray(value) ? value[0] : value;
    if (typeof msg === 'string') return key === 'error' || key === 'detail' ? msg : `${key}: ${msg}`;
  }
  return null;
}
