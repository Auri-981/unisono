/**
 * Ventana de confirmación con el estilo del juego (en lugar del `window.confirm` del navegador).
 * Se cierra con «Cancelar», con Escape o tocando fuera de la tarjeta.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { t } from '../../i18n';

export function ConfirmDialog({
  icon,
  title,
  text,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="overlay overlay-confirm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-text"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="overlay-card">
        <div className="confirm-badge" aria-hidden>
          {icon}
        </div>
        <h2 id="confirm-title" className="overlay-title confirm-title">
          {title}
        </h2>
        <p id="confirm-text" className="muted">
          {text}
        </p>
        <div className="confirm-actions">
          <button ref={cancelRef} type="button" className="btn btn-ghost" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
