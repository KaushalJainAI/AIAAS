import { useEffect, useRef } from 'react';
import { isEditableTarget } from '../lib/editorKeys';
import {
  SHORTCUTS,
  TOGGLE_SIDEBAR_EVENT,
  isInEditorSurface,
  isSingleKeySpec,
  matchesChord,
  readSingleKeyEnabled,
  requestShortcutsHelp,
  stepSequence,
  type SequenceState,
  type Shortcut,
} from '../lib/shortcuts';

type Navigate = (to: string, opts?: { state?: unknown }) => void;

const DIALOG_SELECTOR = '[role="dialog"][aria-modal="true"]';
const SEARCH_SELECTOR = 'main input[type="search"], main [data-page-search]';

/**
 * The global shortcuts. One window listener, bubble phase, so an editor that
 * handles a key first (`defaultPrevented`) keeps it.
 *
 * Single-key shortcuts (?, /, g then …) stay quiet while typing, while a
 * dialog is open, and when the Settings switch has turned them off. Nothing
 * fires inside the code, document or sheet editors.
 */
export function useShortcuts(navigate: Navigate, enabled: boolean): void {
  const navRef = useRef(navigate);
  const seqRef = useRef<SequenceState>({ pending: null, at: 0 });

  useEffect(() => {
    navRef.current = navigate;
  }, [navigate]);

  useEffect(() => {
    if (!enabled) return;

    // Returns true when the row ran, so the caller stops looking.
    const act = (row: Shortcut, e: KeyboardEvent): boolean => {
      switch (row.id) {
        case 'help':
          requestShortcutsHelp();
          break;
        case 'focus-search': {
          const el = document.querySelector<HTMLElement>(SEARCH_SELECTOR);
          if (!el) return false;
          el.focus();
          break;
        }
        case 'toggle-sidebar':
          window.dispatchEvent(new Event(TOGGLE_SIDEBAR_EVENT));
          break;
        case 'new-chat':
          navRef.current('/ai-chat', { state: { newChat: true } });
          break;
        default:
          if (!row.to) return false;
          navRef.current(row.to);
      }
      e.preventDefault();
      return true;
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (isInEditorSurface(e.target)) {
        seqRef.current = { pending: null, at: 0 };
        return;
      }

      const singleAllowed =
        !isEditableTarget(e.target) &&
        readSingleKeyEnabled() &&
        !document.querySelector(DIALOG_SELECTOR);
      const plain = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;

      if (singleAllowed && plain) {
        const { state, match } = stepSequence(seqRef.current, e.key, Date.now());
        seqRef.current = state;
        if (match && act(match, e)) return;
      } else {
        seqRef.current = { pending: null, at: 0 };
      }

      for (const row of SHORTCUTS) {
        if (row.handledElsewhere || row.sequence) continue;
        for (const spec of row.keys) {
          if (!matchesChord(e, spec)) continue;
          if (isSingleKeySpec(spec) && !singleAllowed) continue;
          if (act(row, e)) return;
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
