/**
 * Whether a URL from outside this app may be opened.
 *
 * Link cards, search results and sources are URLs a model or a web page
 * chose. Handing one straight to `window.open` also hands over its scheme —
 * `javascript:`, `data:text/html`, `blob:` — and every one of those is a way
 * to run someone else's script. Only `http:` and `https:` open (S9,
 * `Backend/docs/SECURITY_REVIEW_FIX_PLAN.md`); anything else, including a
 * string that does not parse, is refused rather than repaired, for the reason
 * `nextPath.ts` gives: a fixed hostile value is still a value someone chose.
 */
/**
 * Bidirectional and zero-width format characters (Unicode `Cf`).
 *
 * A hostname rendered with U+202E (right-to-left override) reads as a
 * different domain than the one in the URL — the Trojan Source trick applied
 * to a link instead of source code. No legitimate citation contains these, so
 * one that does is refused rather than stripped: the URL would otherwise point
 * somewhere other than where it claims.
 */
const BIDI_FORMAT = /[\u061C\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;

export function isSafeExternalUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (BIDI_FORMAT.test(url)) return false;
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** `window.open` for an external URL, or nothing if it is not http(s). */
export function openExternal(url: string): void {
  if (!isSafeExternalUrl(url)) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}
