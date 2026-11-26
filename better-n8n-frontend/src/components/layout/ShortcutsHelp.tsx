import { useEffect, useState } from 'react';
import { Modal, ModalBody } from '../ui/Modal';
import { Switch } from '../ui/Switch';
import {
  OPEN_SHORTCUTS_HELP_EVENT,
  SHORTCUTS,
  isMac,
  keyChips,
  readSingleKeyEnabled,
  writeSingleKeyEnabled,
  type Shortcut,
} from '../../lib/shortcuts';

const GROUPS: Shortcut['group'][] = ['Everywhere', 'Go to'];
const SINGLE_KEY_LABEL = 'Single-key shortcuts (?, /, G then …)';

/**
 * Listens for the help event and opens the sheet. Mount it once, in the app
 * shell. The rows come from SHORTCUTS, so the sheet cannot drift from the keys.
 */
export function ShortcutsHelpHost() {
  const [open, setOpen] = useState(false);
  const [singleKey, setSingleKey] = useState(true);

  useEffect(() => {
    const show = () => {
      setSingleKey(readSingleKeyEnabled());
      setOpen(true);
    };
    window.addEventListener(OPEN_SHORTCUTS_HELP_EVENT, show);
    return () => window.removeEventListener(OPEN_SHORTCUTS_HELP_EVENT, show);
  }, []);

  if (!open) return null;

  const mac = typeof navigator !== 'undefined' && isMac(navigator.userAgent);

  const toggleSingleKey = (next: boolean) => {
    writeSingleKeyEnabled(next);
    setSingleKey(next);
  };

  return (
    <Modal onClose={() => setOpen(false)} label="Keyboard shortcuts" size="md">
      <ModalBody>
        <h2 className="text-base font-semibold text-foreground">Keyboard shortcuts</h2>

        <div className="mt-3 flex items-start justify-between gap-4 rounded-md border border-border/50 bg-card/40 p-3">
          <div className="min-w-0">
            <p className="text-sm text-foreground">{SINGLE_KEY_LABEL}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Turn these off if a speech-input tool types letters as commands. Shortcuts with Ctrl or ⌘ stay on.
            </p>
          </div>
          <Switch checked={singleKey} onChange={toggleSingleKey} label={SINGLE_KEY_LABEL} />
        </div>

        {GROUPS.map((group) => (
          <section key={group} className="mt-5">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</h3>
            <ul className="divide-y divide-border/50">
              {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-4 py-2">
                  <span className="text-sm text-foreground">{s.label}</span>
                  <span className="flex shrink-0 flex-wrap justify-end gap-1">
                    {keyChips(s, mac).map((chip) => (
                      <kbd
                        key={chip}
                        className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                      >
                        {chip}
                      </kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </ModalBody>
    </Modal>
  );
}
