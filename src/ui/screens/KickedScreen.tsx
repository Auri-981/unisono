import { useEffect, useRef } from 'react';
import { t } from '../../i18n';
import { ExitIcon } from '../components/Icons';

/** Pantalla completa al ser expulsado de una sala (en vez del aviso pequeño en el inicio). */
export function KickedScreen({ code, onHome, onCreate }: { code?: string; onHome: () => void; onCreate: () => void }) {
  const homeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => homeRef.current?.focus(), []);

  return (
    <div className="kicked-screen">
      <div className="kicked-card" role="alert">
        <div className="kicked-icon" aria-hidden>
          <ExitIcon size={40} />
        </div>
        <h1 className="kicked-title">{t('kicked.title')}</h1>
        <p className="kicked-text">{code ? t('kicked.textCode', { code }) : t('kicked.text')}</p>
        <p className="kicked-hint">{t('kicked.hint')}</p>
        <div className="kicked-actions">
          <button ref={homeRef} type="button" className="btn btn-primary btn-large btn-block" onClick={onHome}>
            {t('kicked.home')}
          </button>
          <button type="button" className="btn btn-secondary btn-block" onClick={onCreate}>
            {t('kicked.create')}
          </button>
        </div>
      </div>
    </div>
  );
}
