import { useState } from 'react';
import { t } from '../../i18n';
import { reloadToNewVersion, useNewVersion } from '../update';
import { CloseIcon } from './Icons';

/**
 * «Hay una versión nueva» con el botón para cargarla. No se muestra durante una partida
 * (`hidden`): recargar a mitad de nivel cortaría el juego; aparece al volver al inicio.
 */
export function UpdateBanner({ hidden }: { hidden: boolean }) {
  const available = useNewVersion();
  const [dismissed, setDismissed] = useState(false);
  if (!available || dismissed || hidden) return null;
  return (
    <div className="update-banner" role="status">
      <div className="update-banner-text">
        <strong>{t('update.title')}</strong>
        <span>{t('update.body')}</span>
      </div>
      <button type="button" className="btn btn-primary btn-small" onClick={reloadToNewVersion}>
        {t('update.action')}
      </button>
      <button type="button" className="update-banner-close" aria-label={t('common.close')} onClick={() => setDismissed(true)}>
        <CloseIcon size={16} />
      </button>
    </div>
  );
}
