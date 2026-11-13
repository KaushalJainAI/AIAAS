import type { HITLAction, HITLOption, HITLRequestType } from './types';

/** Option values that are a real HITL action rather than free text. Mirrors the web's `ACTIONS`. */
const ACTIONS: ReadonlySet<string> = new Set(['approve', 'reject', 'retry', 'skip', 'stop']);

/** Normalises either stored option shape. Mirrors `hitlOption` in the web's `orchestrator.ts`. */
export function hitlOption(option: HITLOption): { label: string; value: string } {
  if (typeof option === 'string') return { label: option, value: option.toLowerCase() };
  return {
    label: option.label ?? String(option.value ?? ''),
    value: option.value ?? option.label ?? '',
  };
}

/** The action an option button posts. Free-text options answer with `respond`. */
export function actionFor(value: string): HITLAction {
  return ACTIONS.has(value) ? (value as HITLAction) : 'respond';
}

export function isFailure(type: HITLRequestType): boolean {
  return type === 'error' || type === 'error_recovery';
}

export function requestTypeLabel(type: HITLRequestType): string {
  if (type === 'clarification') return 'Needs an answer';
  if (isFailure(type)) return 'Failed, needs a decision';
  return 'Needs your approval';
}

/** A user-facing sentence for a failed request, from an ApiError or anything else. */
export function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Something went wrong. Try again.';
}
