/**
 * Convierte el último evento de la partida en un mensaje visible + sonido/vibración.
 * Solo reacciona a eventos NUEVOS (no repite los antiguos al entrar o reconectar).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameEvent, MistakePayload, RoomSnapshot, ShurikenUsedPayload } from '../../../game/types';
import { t } from '../../../i18n';
import { sfx, vibrate } from '../../feedback';

export interface FeedItem {
  id: number;
  tone: 'info' | 'danger' | 'success';
  title: string;
  detail?: string;
}

/** Un inicio de nivel ocurrido hace menos de esto todavía muestra la cuenta atrás al entrar. */
const FRESH_START_MS = 2500;

export function useEventFeed(snap: RoomSnapshot, clockOffset: number) {
  const [item, setItem] = useState<FeedItem | null>(null);
  const [shake, setShake] = useState(false);
  // La pantalla de juego se monta justo DESPUÉS del evento de inicio: si es reciente, cuenta atrás.
  const [countdownSeq, setCountdownSeq] = useState<number | null>(() => {
    const ev = snap.lastEvent;
    const fresh = ev && Date.now() + clockOffset - Date.parse(ev.at) < FRESH_START_MS;
    return fresh && (ev.kind === 'game_start' || ev.kind === 'level_start') ? ev.seq : null;
  });
  const lastSeq = useRef<number>(snap.lastEvent?.seq ?? 0);
  const names = new Map(snap.players.map((p) => [p.id, p.name]));
  const namesRef = useRef(names);
  namesRef.current = names;

  const ev = snap.lastEvent;
  useEffect(() => {
    if (!ev || ev.seq <= lastSeq.current) return;
    lastSeq.current = ev.seq;
    const name = (id: string | null) => (id && namesRef.current.get(id)) || '—';
    const show = (tone: FeedItem['tone'], title: string, detail?: string) => setItem({ id: ev.seq, tone, title, detail });
    const p = ev.payload as Record<string, unknown>;

    switch (ev.kind as GameEvent['kind']) {
      case 'play':
        sfx.play();
        break;
      case 'mistake': {
        const m = p as unknown as MistakePayload;
        sfx.mistake();
        vibrate([80, 60, 120]);
        setShake(true);
        window.setTimeout(() => setShake(false), 550);
        show(
          'danger',
          t('event.mistake', { name: name(ev.actor), card: m.card }),
          t('event.mistakeDetail', { cards: m.discarded.map((d) => d.c).join(', ') }),
        );
        break;
      }
      case 'shuriken_used': {
        const s = p as unknown as ShurikenUsedPayload;
        sfx.shuriken();
        const cards = s.discarded.filter((d) => d.c !== undefined).map((d) => d.c);
        show('info', cards.length ? t('event.shurikenRevealed', { cards: cards.join(', ') }) : t('event.shurikenUsed'));
        break;
      }
      case 'shuriken_cancelled':
        show(
          'info',
          p.reason === 'rejected'
            ? t('event.shurikenRejected', { name: name(ev.actor) })
            : p.reason === 'expired'
              ? t('event.shurikenExpired')
              : t('event.shurikenPlayerLeft'),
        );
        break;
      case 'shuriken_proposed':
        sfx.shuriken();
        vibrate(40);
        break;
      case 'level_complete':
        sfx.levelComplete();
        break;
      case 'won':
        sfx.won();
        break;
      case 'lost':
        sfx.lost();
        vibrate([120, 80, 200]);
        break;
      case 'game_start':
      case 'level_start':
        setCountdownSeq(ev.seq);
        break;
      case 'player_joined':
        show('info', t('event.joined', { name: String(p.name ?? '') }));
        break;
      case 'player_left':
        show('info', t('event.left', { name: String(p.name ?? '') }));
        break;
      case 'player_kicked':
        show('info', t('event.kicked', { name: String(p.name ?? '') }));
        break;
      case 'host_changed':
        show('info', t('event.hostChanged', { name: name(ev.actor) }));
        break;
      default:
        break;
    }
  }, [ev]);

  // Los mensajes desaparecen solos.
  useEffect(() => {
    if (!item) return;
    const id = window.setTimeout(() => setItem((cur) => (cur?.id === item.id ? null : cur)), item.tone === 'danger' ? 4200 : 2600);
    return () => window.clearTimeout(id);
  }, [item]);

  const clearCountdown = useCallback(() => setCountdownSeq(null), []);
  return { item, shake, countdownSeq, clearCountdown };
}
