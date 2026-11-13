/** The first value of a route param, or undefined. */
export function param(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** A route param as a positive whole id, or null when it is missing or not one. */
export function idParam(value: string | string[] | undefined): number | null {
  const text = param(value);
  if (!text) return null;
  const n = Number(text);
  return Number.isInteger(n) && n > 0 ? n : null;
}
