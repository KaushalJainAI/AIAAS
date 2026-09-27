/**
 * A pasted tool share link or a bare slug — the slug is the last path
 * segment. Pure, so the install dialog and its test share the rule.
 */
export function parseToolShareSlug(text: string): string {
  return text.trim().split('/').filter(Boolean).pop() ?? '';
}
