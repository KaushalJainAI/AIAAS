/** Ctrl/Cmd+S → save, without the browser's "Save page as". */
export function isSaveKey(e: { ctrlKey: boolean; metaKey: boolean; key: string }): boolean {
  return (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's';
}

type Key = { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; key: string };

/** Ctrl/Cmd+Z → undo. */
export function isUndoKey(e: Key): boolean {
  return (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z';
}

/** Ctrl/Cmd+Y, or Ctrl/Cmd+Shift+Z → redo. */
export function isRedoKey(e: Key): boolean {
  if (!(e.ctrlKey || e.metaKey)) return false;
  const k = e.key.toLowerCase();
  return k === 'y' || (k === 'z' && e.shiftKey);
}

/**
 * Whether the key event started in a text field — where undo/redo belong to
 * the field's own stack. Container-level history (slides, sheet grid) must
 * ignore these, or one Ctrl+Z would fight the field's native undo.
 */
export function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof (el as HTMLElement).tagName !== 'string') return false;
  const tag = (el as HTMLElement).tagName;
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!(el as HTMLElement).isContentEditable
  );
}
