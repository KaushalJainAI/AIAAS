/**
 * A question an agent asked with `ask_user`: its shape, and the check an answer
 * must pass.
 *
 * The check mirrors `chat/tools/ask.py::normalise_answer`, which is the one
 * that decides — the server re-checks every answer against the question the
 * run actually asked. This copy only exists so the card can say what is wrong
 * before sending, instead of after a round trip.
 */

export type QuestionKind = 'choice' | 'multi_choice' | 'number' | 'text';

export interface QuestionSpec {
  call_id?: string;
  question: string;
  assumption?: string;
  kind: QuestionKind;
  options?: string[];
  allow_other?: boolean;
  min?: number | null;
  max?: number | null;
  step?: number | null;
  unit?: string;
}

export type QuestionAnswer = string | number | string[];

const KINDS: QuestionKind[] = ['choice', 'multi_choice', 'number', 'text'];

/** A frame or row payload as a spec, or null when it cannot be drawn. */
export function toQuestionSpec(raw: unknown): QuestionSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const question = typeof r.question === 'string' ? r.question.trim() : '';
  if (!question) return null;
  const kind = KINDS.includes(r.kind as QuestionKind) ? (r.kind as QuestionKind) : 'text';
  const options = Array.isArray(r.options)
    ? r.options.filter((o): o is string => typeof o === 'string' && o.trim() !== '')
    : [];
  if ((kind === 'choice' || kind === 'multi_choice') && options.length < 2) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    call_id: typeof r.call_id === 'string' ? r.call_id : undefined,
    question,
    assumption: typeof r.assumption === 'string' ? r.assumption : undefined,
    kind,
    options,
    allow_other: Boolean(r.allow_other),
    min: num(r.min),
    max: num(r.max),
    step: num(r.step),
    unit: typeof r.unit === 'string' ? r.unit : '',
  };
}

/** Why `answer` does not fit `spec`, or null when it can be sent. */
export function answerProblem(spec: QuestionSpec, answer: QuestionAnswer | null): string | null {
  const options = spec.options ?? [];
  switch (spec.kind) {
    case 'choice': {
      const value = typeof answer === 'string' ? answer.trim() : '';
      if (!value) return 'Pick one option.';
      if (!options.includes(value) && !spec.allow_other) return 'Pick one of the options.';
      return null;
    }
    case 'multi_choice': {
      const values = Array.isArray(answer) ? answer.filter((v) => v.trim() !== '') : [];
      if (values.length === 0) return 'Pick at least one option.';
      if (!spec.allow_other && values.some((v) => !options.includes(v))) {
        return 'Pick from the options.';
      }
      return null;
    }
    case 'number': {
      const value = typeof answer === 'number' ? answer : Number(answer);
      if (answer === null || answer === '' || !Number.isFinite(value)) return 'Enter a number.';
      if (spec.min != null && value < spec.min) return `The number must be at least ${spec.min}.`;
      if (spec.max != null && value > spec.max) return `The number must be at most ${spec.max}.`;
      return null;
    }
    default:
      return typeof answer === 'string' && answer.trim() ? null : 'Write an answer.';
  }
}
