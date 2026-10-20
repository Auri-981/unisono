import type { ReactNode } from 'react';
import { t } from '../../i18n';
import { BackIcon } from './Icons';

/** Pantalla con cabecera simple y contenido desplazable. */
export function Page({ title, onBack, children, actions }: { title: string; onBack?: () => void; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page">
      <header className="page-header">
        {onBack ? (
          <button type="button" className="icon-btn" onClick={onBack} aria-label={t('common.back')}>
            <BackIcon />
          </button>
        ) : (
          <span className="icon-btn-placeholder" />
        )}
        <h1 className="page-title">{title}</h1>
        <div className="page-header-actions">{actions}</div>
      </header>
      <main className="page-body">{children}</main>
    </div>
  );
}

/** Mensaje flotante breve. */
export function Toast({ tone = 'info', title, detail }: { tone?: 'info' | 'danger' | 'success'; title: string; detail?: string }) {
  return (
    <div className={`toast toast-${tone}`} role="status" aria-live="polite">
      <strong>{title}</strong>
      {detail && <span>{detail}</span>}
    </div>
  );
}
