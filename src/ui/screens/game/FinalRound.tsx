/**
 * Ronda final (el último nivel): sin comodines, mesa a ciegas y manos ocultas.
 * El servidor ya no envía lo que no se puede ver; aquí solo se muestra (y la última carta
 * se tapa en pantalla al pasar FINAL_PEEK_SECONDS, sin esperar a otra foto del servidor).
 */
import { useEffect, useState } from 'react';
import { FINAL_ALERT_SECONDS, FINAL_PEEK_SECONDS } from '../../../config/gameConfig';
import type { RoomSnapshot } from '../../../game/types';
import { t } from '../../../i18n';
import { Card } from '../../components/Card';
import { BlindIcon, FinalIcon, HiddenHandIcon, NoComodinIcon } from '../../components/Icons';
import { rich } from '../../rich';

/** Las tres reglas, con su icono (aviso al empezar, tutorial). */
export function FinalRules() {
  return (
    <ul className="final-rules">
      <li>
        <NoComodinIcon size={22} />
        <span>{rich(t('final.rule.noComodines'))}</span>
      </li>
      <li>
        <BlindIcon size={22} />
        <span>{rich(t('final.rule.blind', { s: FINAL_PEEK_SECONDS }))}</span>
      </li>
      <li>
        <HiddenHandIcon size={22} />
        <span>{rich(t('final.rule.hidden'))}</span>
      </li>
    </ul>
  );
}

/** «¡Último nivel! Ronda final»: antes de la cuenta atrás. Se puede cerrar tocando. */
export function FinalAlert({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const id = window.setTimeout(onDone, FINAL_ALERT_SECONDS * 1000);
    return () => window.clearTimeout(id);
  }, [onDone]);
  return (
    <button type="button" className="overlay overlay-final" onClick={onDone} aria-label={t('game.countdownSkip')}>
      <span className="final-glow" aria-hidden />
      <FinalIcon size={68} className="final-alert-icon" />
      <span className="final-alert-kicker">{t('final.alert')}</span>
      <span className="final-alert-title">{t('final.title')}</span>
      <FinalRules />
      <span className="muted small">{t('game.countdownSkip')}</span>
    </button>
  );
}

/** Distintivo de la cabecera durante la ronda final (ocupa el sitio del premio, que aquí no hay). */
export function FinalBadge() {
  return (
    <div className="final-badge" role="note">
      <FinalIcon size={16} />
      <span>{t('final.title')}</span>
    </div>
  );
}

/** Barra que se vacía mientras la carta sigue a la vista (la duración se fija al aparecer). */
function PeekTimer({ ms }: { ms: number }) {
  const [duration] = useState(() => Math.max(0, ms));
  return <span className="blind-timer" style={{ animationDuration: `${duration}ms` }} aria-hidden />;
}

/**
 * Mesa a ciegas: la última carta se ve unos segundos y después queda boca abajo con las demás.
 * `pile` solo trae la última carta si aún se puede ver; `pileHidden` cuenta las que están tapadas.
 */
export function BlindPile({ snap, clockOffset }: { snap: RoomSnapshot; clockOffset: number }) {
  const { room, pile, players } = snap;
  const top = pile.at(-1);
  const hideAt = room.pileAt ? Date.parse(room.pileAt) + FINAL_PEEK_SECONDS * 1000 : 0;
  // Siempre con la hora actual (no una guardada de antes: con una carta nueva saldría de más).
  const left = hideAt - (Date.now() + clockOffset);
  const peeking = Boolean(top) && left > 0;
  // Al llegar la hora, se vuelve a pintar para taparla.
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!top || left <= 0) return;
    const id = window.setTimeout(() => setTick((n) => n + 1), left + 20);
    return () => window.clearTimeout(id);
  }, [top, hideAt, peeking]);

  const hidden = (room.pileHidden ?? 0) + (top && !peeking ? 1 : 0);
  const played = hidden === 1 ? t('final.playedOne') : t('final.played', { n: hidden });
  if (!top && hidden === 0) {
    return <div className="pile-empty">{t(`game.tableEmpty.${room.config.order}`)}</div>;
  }
  return (
    <div className="blind-pile" aria-label={`${t('final.title')}: ${played}`}>
      {hidden > 0 && (
        <div className={`blind-stack ${peeking ? 'is-under' : ''}`} aria-hidden>
          <span className="blind-back" />
          {hidden > 1 && <span className="blind-back blind-back-2" />}
          {!peeking && (
            <span className="blind-count">{played}</span>
          )}
        </div>
      )}
      {peeking && top && (
        <div className="pile-top blind-peek" key={room.pileAt}>
          <Card value={top.c} size="xl" />
          <PeekTimer ms={left} />
          <span className="pile-owner">{players.find((p) => p.id === top.p)?.name ?? ''}</span>
        </div>
      )}
    </div>
  );
}
