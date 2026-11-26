/* Keyboard shortcuts: one table. The key handler (hooks/useShortcuts.ts) and
 * the help sheet (components/layout/ShortcutsHelp.tsx) both read it, so a
 * shortcut cannot work without being listed, or be listed without working.
 * Pure: no React here. */

export type ShortcutScope = 'global';

export interface Shortcut {
  id: string;
  /**
   * Chord specs such as 'mod+k', '?', '/'. A row with `sequence: true` is one
   * sequence instead: its keys are pressed in order, e.g. ['g', 'c'].
   * Modifiers: mod (Ctrl or Cmd), shift, alt.
   */
  keys: string[];
  label: string;
  group: 'Everywhere' | 'Go to';
  /** True when one of its keys has no Ctrl/Cmd/Alt, so the single-key switch turns it off. */
  singleKey: boolean;
  /** Route for go-to rows. */
  to?: string;
  /** Listed on the help sheet only. Another part of the app handles the key. */
  handledElsewhere?: boolean;
  /** `keys` is a sequence, not a set of alternatives. */
  sequence?: boolean;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { id: 'command-menu', keys: ['mod+k'], label: 'Open the command menu', group: 'Everywhere', singleKey: false, handledElsewhere: true },
  { id: 'help', keys: ['?', 'mod+/'], label: 'Show these shortcuts', group: 'Everywhere', singleKey: true },
  { id: 'focus-search', keys: ['/'], label: "Focus this page's search", group: 'Everywhere', singleKey: true },
  { id: 'escape', keys: ['escape'], label: 'Close the top dialog, menu or pane', group: 'Everywhere', singleKey: false, handledElsewhere: true },
  { id: 'toggle-sidebar', keys: ['mod+\\'], label: 'Show or hide the sidebar', group: 'Everywhere', singleKey: false },
  { id: 'new-chat', keys: ['mod+shift+o'], label: 'New chat', group: 'Everywhere', singleKey: false },
  {
    id: 'back-to-previous',
    keys: ['mod+k', 'enter'],
    sequence: true,
    label: 'Back to the previous page',
    group: 'Everywhere',
    singleKey: false,
    handledElsewhere: true,
  },
  { id: 'go-chat', keys: ['g', 'c'], sequence: true, label: 'Go to Ask', group: 'Go to', singleKey: true, to: '/ai-chat' },
  { id: 'go-runs', keys: ['g', 'r'], sequence: true, label: 'Go to Activity', group: 'Go to', singleKey: true, to: '/runs' },
  { id: 'go-agents', keys: ['g', 'a'], sequence: true, label: 'Go to Agents', group: 'Go to', singleKey: true, to: '/agents' },
  { id: 'go-explore', keys: ['g', 'e'], sequence: true, label: 'Go to Explore', group: 'Go to', singleKey: true, to: '/explore' },
  { id: 'go-files', keys: ['g', 'f'], sequence: true, label: 'Go to Files', group: 'Go to', singleKey: true, to: '/documents' },
  { id: 'go-connections', keys: ['g', 'k'], sequence: true, label: 'Go to Connections', group: 'Go to', singleKey: true, to: '/connections' },
  { id: 'go-settings', keys: ['g', 's'], sequence: true, label: 'Go to Settings', group: 'Go to', singleKey: true, to: '/settings' },
];

/** Chords the browser or the OS owns. No shortcut may take one of these. */
export const RESERVED_BROWSER_CHORDS: readonly string[] = [
  'mod+t',
  'mod+w',
  'mod+n',
  'mod+l',
  'mod+r',
  'mod+d',
  'mod+h',
  'mod+j',
  'mod+p',
  'mod+f',
  'mod+g',
  'mod+tab',
  'mod+shift+t',
  'mod+1',
  'mod+2',
  'mod+3',
  'mod+4',
  'mod+5',
  'mod+6',
  'mod+7',
  'mod+8',
  'mod+9',
  'f5',
  'f11',
  'f12',
  'alt+arrowleft',
  'alt+arrowright',
];

export const SEQUENCE_TIMEOUT_MS = 1500;

/** The key that starts every go-to sequence. */
export const SEQUENCE_START_KEY = 'g';

export const TOGGLE_SIDEBAR_EVENT = 'aiaas:toggle-sidebar';
export const OPEN_SHORTCUTS_HELP_EVENT = 'aiaas:open-shortcuts-help';
export const SINGLE_KEY_CHANGED_EVENT = 'aiaas:shortcuts-single-key';

const SINGLE_KEY_STORAGE = 'aiaas_ui:shortcuts.singleKey';

export function isMac(userAgent: string): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(userAgent);
}

/** One key name as a person reads it on this platform. */
export function keyLabel(key: string, mac: boolean): string {
  switch (key) {
    case 'mod':
      return mac ? '⌘' : 'Ctrl';
    case 'shift':
      return mac ? '⇧' : 'Shift';
    case 'alt':
      return mac ? '⌥' : 'Alt';
    case 'enter':
      return 'Enter';
    case 'escape':
      return 'Esc';
    case 'tab':
      return 'Tab';
    default:
      return key.length === 1 ? key.toUpperCase() : key;
  }
}

function formatSpec(spec: string, mac: boolean): string {
  const parts = spec.split('+').map((p) => keyLabel(p, mac));
  return parts.join(mac ? '' : '+');
}

/** One label per alternative. A sequence is one label: 'G then C'. */
export function keyChips(shortcut: Shortcut, mac: boolean): string[] {
  if (shortcut.sequence) {
    return [shortcut.keys.map((k) => formatSpec(k, mac)).join(' then ')];
  }
  return shortcut.keys.map((k) => formatSpec(k, mac));
}

/** The shortcut as shown in a tooltip or the help sheet, e.g. '⌘K' or 'Ctrl+K'. */
export function formatKeys(shortcut: Shortcut, mac: boolean): string {
  return keyChips(shortcut, mac).join(' or ');
}

/** A spec with no Ctrl/Cmd or Alt: it is a single-key shortcut. */
export function isSingleKeySpec(spec: string): boolean {
  const mods = spec.split('+').slice(0, -1);
  return !mods.includes('mod') && !mods.includes('alt');
}

/**
 * Whether a key event matches a spec. Unlisted modifiers must not be held.
 * '?' ignores Shift, because most layouts need it to type '?'.
 */
export function matchesChord(
  e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean },
  spec: string,
): boolean {
  const parts = spec.split('+');
  const key = parts[parts.length - 1].toLowerCase();
  const mods = parts.slice(0, -1);
  const wantMod = mods.includes('mod');
  const wantShift = mods.includes('shift');
  const wantAlt = mods.includes('alt');

  if (wantMod !== (e.ctrlKey || e.metaKey)) return false;
  if (wantAlt !== e.altKey) return false;
  if (key !== '?' && wantShift !== e.shiftKey) return false;
  return e.key.toLowerCase() === key;
}

/** Whether a key event started in an editor surface where shortcuts must stay out. */
export function isInEditorSurface(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return el.closest('.cm-editor, .ProseMirror, [contenteditable="true"], .univer-container') !== null;
}

export function readSingleKeyEnabled(): boolean {
  try {
    return window.localStorage.getItem(SINGLE_KEY_STORAGE) !== 'false';
  } catch {
    return true;
  }
}

export function writeSingleKeyEnabled(on: boolean): void {
  try {
    window.localStorage.setItem(SINGLE_KEY_STORAGE, on ? 'true' : 'false');
  } catch {
    // Storage blocked: the switch still works for this page view.
  }
  try {
    window.dispatchEvent(new Event(SINGLE_KEY_CHANGED_EVENT));
  } catch {
    // No window (tests, SSR).
  }
}

export function requestShortcutsHelp(): void {
  window.dispatchEvent(new Event(OPEN_SHORTCUTS_HELP_EVENT));
}

export interface SequenceState {
  pending: string | null;
  at: number;
}

/**
 * Feeds one key into the go-to sequence. `g` starts it; a second key within
 * SEQUENCE_TIMEOUT_MS either matches a go-to row or clears it.
 */
export function stepSequence(
  state: SequenceState,
  key: string,
  now: number,
): { state: SequenceState; match: Shortcut | null } {
  const k = key.toLowerCase();
  if (state.pending !== null && now - state.at <= SEQUENCE_TIMEOUT_MS) {
    const match =
      SHORTCUTS.find(
        (s) =>
          s.sequence === true &&
          !s.handledElsewhere &&
          s.keys.length === 2 &&
          s.keys[0] === state.pending &&
          s.keys[1] === k,
      ) ?? null;
    if (match) return { state: { pending: null, at: now }, match };
  }
  if (k === SEQUENCE_START_KEY) return { state: { pending: k, at: now }, match: null };
  return { state: { pending: null, at: now }, match: null };
}
