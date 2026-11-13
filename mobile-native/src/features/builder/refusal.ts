/**
 * Reads a 400 from the agent serializer: which field it refused, and the sentence
 * it wrote. The body is `{field: [message]}`, or `{detail}`/`{error}` for a
 * refusal that is not about one field. A nested field (`{tools: {fileOps: [...]}}`)
 * is reported under its outer key, which is the name the builder screens use.
 */
import { ApiError } from '../../api/client';

export interface ServerRefusal {
  /** The first message for each refused field, keyed by the config field name. */
  errors: Record<string, string>;
  /** One sentence for the whole save. */
  summary: string;
}

/** Keys that describe the whole request rather than one field. */
const GENERAL_KEYS = new Set(['detail', 'error', 'message', 'code', 'non_field_errors']);

function firstMessage(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstMessage(item);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      const found = firstMessage(item);
      if (found) return found;
    }
  }
  return null;
}

export function refusalFrom(err: unknown, fallback: string): ServerRefusal {
  if (!(err instanceof ApiError)) {
    return { errors: {}, summary: fallback };
  }
  const errors: Record<string, string> = {};
  let summary = err.message || fallback;
  const body = err.body;
  if (body && typeof body === 'object') {
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      const message = firstMessage(value);
      if (!message) continue;
      if (GENERAL_KEYS.has(key)) {
        summary = message;
      } else {
        errors[key] = message;
      }
    }
  }
  return { errors, summary };
}
