import { type FormEvent, type ReactNode } from 'react';
import { Modal } from './Modal';
import { Btn } from './ui';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
  busy = false,
  children,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onConfirm();
  };

  return (
    <Modal open={open} title={title} onClose={busy ? () => undefined : onCancel}>
      <form onSubmit={handleSubmit}>
        {message && <p className="muted" style={{ marginBottom: '0.6rem' }}>{message}</p>}
        {children}
        <div className="modal-actions">
          <Btn type="submit" variant={danger ? 'danger' : 'primary'} disabled={busy}>
            {busy ? 'Processando…' : confirmLabel}
          </Btn>
          <Btn type="button" variant="ghost" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}