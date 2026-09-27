/**
 * Ask for a name — a new file, a new folder. Replaces `window.prompt`, which
 * cannot be styled, cannot pre-select the stem, and is blocked in some
 * embedded browsers. The stem (everything before the extension) is selected
 * on open, as a desktop file dialog does.
 */
import { useEffect, useRef, useState } from 'react';

import { Button } from '../ui/Button';
import { Modal, ModalFooter } from '../ui/Modal';

interface Props {
  title: string;
  initial: string;
  confirmLabel?: string;
  busy?: boolean;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

export default function NameDialog({ title, initial, confirmLabel = 'Create', busy, onSubmit, onCancel }: Props) {
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    const dot = initial.lastIndexOf('.');
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);

  const submit = () => {
    const name = value.trim();
    if (name) onSubmit(name);
  };

  return (
    <Modal size="sm" label={title} onClose={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="p-6">
          <h3 className="mb-3 text-lg font-semibold">{title}</h3>
          <input
            ref={input}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label="Name"
            className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
        <ModalFooter>
          <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" loading={busy} disabled={!value.trim()}>
            {confirmLabel}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
