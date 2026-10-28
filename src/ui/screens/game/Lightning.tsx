/**
 * Ronda relámpago: aviso al empezar el nivel y reloj del equipo.
 * El reloj lo marca el servidor (`lightningEndsAt`); aquí solo se muestra y, al llegar a cero,
 * se pide al servidor que aplique la derrota (como las votaciones caducadas).
 */
import { useEffect, useRef, useState } from 'react';
import { LIGHTNING_ALERT_SECONDS, lightningSeconds } from '../../../config/gameConfig';
import type { RoomController } from '../../../game/controller';
import type { RoomSnapshot } from '../../../game/types';
import { t } from '../../../i18n';
import { LightningIcon } from '../../components/Icons';
import { rich } from '../../rich';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * Barra con el tiempo que queda. `chip`: versión compacta para la cabecera de la partida
 * (en el móvil solo el rayo y el tiempo). El tutorial usa la versión normal.
 */
export function LightningBar({ seconds, total, chip }: { seconds: number; total: number; chip?: boolean }) {
  const low = seconds <= 10;
  return (
    <div
      className={`lightning-bar ${chip ? 'lightning-chip' : ''} ${low ? 'is-low' : ''}`}
      role="timer"
      aria-label={t('lightning.timer', { s: seconds })}
    >
      <span className="lightning-bar-label">
        <LightningIcon size={16} />
        <span className="lightning-bar-text">{t('lightning.title')}</span>
      </span>
      <span className="lightning-bar-time" key={low ? seconds : undefined}>
        {clock(seconds)}
      </span>
      <span className="lightning-bar-track" aria-hidden>
        <span className="lightning-bar-fill" style={{ width: `${(100 * seconds) / total}%` }} />
      </span>
    </div>
  );
}

/** Reloj de la partida. Durante el aviso y la cuenta atrás muestra el tiempo completo. */
export function LightningTimer({ ctl, snap }: { ctl: RoomController; snap: RoomSnapshot }) {
  const endsAt = Date.parse(snap.room.lightningEndsAt!);
  const total = lightningSeconds(snap.room.level);
  const [now, setNow] = useState(() => Date.now() + ctl.clockOffset);
  const lastAsk = useRef(0);
  const seconds = Math.max(0, Math.min(total, Math.ceil((endsAt - now) / 1000)));

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() + ctl.clockOffset), 250);
    return () => window.clearInterval(id);
  }, [ctl.clockOffset]);

  // Tiempo agotado: se pide al servidor que lo aplique (y se repite cada pocos segundos por si
  // la petición se pierde; el servidor ignora las peticiones antes de tiempo).
  useEffect(() => {
    if (endsAt - now > 0 || Date.now() - lastAsk.current < 3000) return;
    lastAsk.current = Date.now();
    void ctl.actions.expireVote();
  }, [now, endsAt, ctl.actions]);

  return <LightningBar seconds={seconds} total={total} chip />;
}

/** «¡Alerta! Ronda relámpago»: unos segundos antes de la cuenta atrás. Se puede cerrar tocando. */
export function LightningAlert({ level, onDone }: { level: number; onDone: () => void }) {
  useEffect(() => {
    const id = window.setTimeout(onDone, LIGHTNING_ALERT_SECONDS * 1000);
    return () => window.clearTimeout(id);
  }, [onDone]);
  return (
    <button type="button" className="overlay overlay-lightning" onClick={onDone} aria-label={t('game.countdownSkip')}>
      <span className="lightning-flash" aria-hidden />
      <LightningIcon size={72} className="lightning-alert-icon" />
      <span className="lightning-alert-kicker">{t('lightning.alert')}</span>
      <span className="lightning-alert-title">{t('lightning.title')}</span>
      <span className="lightning-alert-text">{rich(t('lightning.text', { s: lightningSeconds(level) }))}</span>
      <span className="muted small">{t('game.countdownSkip')}</span>
    </button>
  );
}
