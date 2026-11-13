/**
 * Accepts only a path inside the app: one leading slash, then no second slash
 * and no backslash (either would make a protocol-relative URL that leaves the
 * API origin). Control characters are refused too.
 */
export function safePath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const backslash = String.fromCharCode(92);
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith(`/${backslash}`)) return null;
  if (value.includes(backslash)) return null;
  if (value.split('').some((c) => c.charCodeAt(0) < 32)) return null;
  return value;
}
