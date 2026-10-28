import type { ReactNode } from 'react';
import { t } from '../../i18n';
import { Card } from './Card';
import { BackIcon } from './Icons';

/** Pantalla con cabecera simple y contenido desplazable. */
export function Page({
  title,
  onBack,
  children,
  actions,
  className = '',
}: {
  title: string;
  onBack?: () => void;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`page ${className}`}>
      <SideDecor />
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

/** Cartas que flotan a los lados en pantallas anchas (solo decoración; en el móvil no se ven). */
const DECOR: { side: 'left' | 'right'; value: number }[] = [
  { side: 'left', value: 7 },
  { side: 'left', value: 34 },
  { side: 'left', value: 61 },
  { side: 'left', value: 88 },
  { side: 'right', value: 15 },
  { side: 'right', value: 42 },
  { side: 'right', value: 73 },
  { side: 'right', value: 100 },
];

function SideDecor() {
  return (
    <div className="side-decor" aria-hidden>
      {(['left', 'right'] as const).map((side) => (
        <div key={side} className={`side-decor-col side-decor-${side}`}>
          {DECOR.filter((d) => d.side === side).map((d) => (
            <div key={d.value} className="side-decor-card">
              <Card value={d.value} size="lg" label="" />
            </div>
          ))}
        </div>
      ))}
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
