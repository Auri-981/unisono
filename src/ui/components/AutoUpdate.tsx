import { useEffect } from 'react';
import { t } from '../../i18n';
import { reloadToNewVersion, useNewVersion, useUpdatesHeld } from '../update';

const SHOW_BEFORE_RELOAD_MS = 900;

/**
 * Carga la versión nueva en cuanto se publica, sin botón: así todos los jugadores llevan la
 * misma. Espera mientras haya una partida en pantalla o algo a medio hacer (`blocked`: práctica,
 * tutorial, escribiendo un nombre o un código). Antes de recargar avisa un momento para que
 * el parpadeo no parezca un fallo.
 */
export function AutoUpdate({ blocked }: { blocked: boolean }) {
  const available = useNewVersion();
  const held = useUpdatesHeld();
  const go = available && !blocked && !held;

  useEffect(() => {
    if (!go) return;
    const id = window.setTimeout(reloadToNewVersion, SHOW_BEFORE_RELOAD_MS);
    return () => window.clearTimeout(id);
  }, [go]);

  if (!go) return null;
  return (
    <div className="update-notice" role="status">
      <span className="update-notice-spinner" aria-hidden />
      {t('update.applying')}
    </div>
  );
}
