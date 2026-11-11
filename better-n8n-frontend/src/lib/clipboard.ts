/**
 * Copying text to the clipboard, including where the async API is missing.
 *
 * `navigator.clipboard` only exists in a secure context — an `http://` origin
 * that is not localhost has no `navigator.clipboard` at all. The code-block
 * copy button called it unguarded, so on a plain-HTTP deployment (an internal
 * host, a `.local` box) clicking Copy threw and nothing reached the clipboard.
 * The `textarea` + `execCommand('copy')` path still works there, and it works
 * in the browsers that never shipped the async API.
 *
 * Returns whether the text actually made it, so the caller can say so instead
 * of claiming success either way.
 */
export async function copyText(text: string): Promise<boolean> {
  // `navigator.clipboard` is simply absent outside a secure context, so its
  // presence is the whole test — and the call can still reject (a denied
  // permission, a page that lost focus), which falls through the same way.
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or the page lost focus: fall through to the old path.
    }
  }

  if (typeof document === 'undefined') return false;

  try {
    const area = document.createElement('textarea');
    area.value = text;
    // Off-screen but still selectable; `display: none` would not select.
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.left = '0';
    area.style.width = '1px';
    area.style.height = '1px';
    area.style.padding = '0';
    area.style.border = 'none';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  } catch {
    return false;
  }
}
