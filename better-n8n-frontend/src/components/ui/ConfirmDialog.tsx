import { Button } from './Button';
import { Modal, ModalBody, ModalFooter } from './Modal';
import { Spinner } from './Loading';

interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The five hand-rolled delete/share/logout/rotate confirms, plus the three
 * `window.confirm()` calls (Settings API key, Skills delete, chat delete),
 * in one styled, focus-managed place.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal size="sm" label={title} onClose={onCancel}>
      <div className="p-6">
        <h3 className="text-lg font-semibold mb-2">{title}</h3>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
      <ModalBody className="hidden" aria-hidden>
        <span />
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" size="sm" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button
          variant={danger ? 'destructive' : 'primary'}
          size="sm"
          loading={busy}
          onClick={onConfirm}
        >
          {!busy && confirmLabel}
          {busy && <Spinner size="sm" />}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
