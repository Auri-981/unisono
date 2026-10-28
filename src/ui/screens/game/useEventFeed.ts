/**
 * Convierte los eventos de la partida en mensajes visibles + sonido/vibración.
 * Solo reacciona a eventos NUEVOS (no repite los antiguos al entrar o reconectar).
 *
 * Una sola acción puede producir varios eventos (p. ej. un error que además cierra el nivel):
 * se procesan todos en orden y se muestra el mensaje más importante (error > éxito > info).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComodinKind, GameEvent, MistakePayload, RoomSnapshot, ShurikenUsedPayload } from '../../../game/types';
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
const RANK: Record<FeedItem['tone'], number> = { info: 1, success: 2, danger: 3 };

/** Eventos recientes de la foto (servidores antiguos solo envían el último). */
function eventsOf(snap: RoomSnapshot): GameEvent[] {
  if (snap.recentEvents?.length) return snap.recentEvents;
  return snap.lastEvent ? [snap.lastEvent] : [];
}

export function useEventFeed(snap: RoomSnapshot, clockOffset: number) {
  const [item, setItem] = useState<FeedItem | null>(null);
  const [shake, setShake] = useState(false);
  // La pantalla de juego se monta justo DESPUÉS del evento de inicio: si es reciente, cuenta atrás.
  const [countdownSeq, setCountdownSeq] = useState<number | null>(() => {
    const ev = snap.lastEvent;
    const fresh = ev && Date.now() + clockOffset - Date.parse(ev.at) < FRESH_START_MS;
    return fresh && (ev.kind === 'game_start' || ev.kind === 'level_start') ? ev.seq : null;
  });
  const events = eventsOf(snap);
  const newestSeq = Math.max(snap.lastEvent?.seq ?? 0, events.at(-1)?.seq ?? 0);
  const lastSeq = useRef<number>(newestSeq);
  const latest = useRef({ events, players: snap.players, me: snap.me });
  latest.current = { events, players: snap.players, me: snap.me };

  useEffect(() => {
    const { events: all, players, me } = latest.current;
    const fresh = all.filter((e) => e.seq > lastSeq.current).sort((a, b) => a.seq - b.seq);
    if (fresh.length === 0) return;
    lastSeq.current = fresh.at(-1)!.seq;
    const names = new Map(players.map((p) => [p.id, p.name]));
    const name = (id: string | null) => (id && names.get(id)) || '—';

    let best: FeedItem | null = null;
    for (const ev of fresh) {
      const p = ev.payload as Record<string, unknown>;
      let next: FeedItem | null = null;
      const show = (tone: FeedItem['tone'], title: string, detail?: string) => {
        next = { id: ev.seq, tone, title, detail };
      };

      switch (ev.kind) {
        case 'play':
          sfx.play();
          break;
        case 'mistake': {
          const m = p as unknown as MistakePayload;
          const cards = m.discarded.map((d) => d.c).join(', ');
          sfx.mistake();
          vibrate([80, 60, 120]);
          setShake(true);
          window.setTimeout(() => setShake(false), 550);
          if (m.shielded) {
            show(
              'info',
              ev.actor === me
                ? t('event.mistakeShieldedMine', { card: m.card })
                : t('event.mistakeShielded', { name: name(ev.actor), card: m.card }),
              t('event.mistakeShieldedDetail', { cards }),
            );
          } else {
            show(
              'danger',
              ev.actor === me ? t('event.mistakeMine', { card: m.card }) : t('event.mistake', { name: name(ev.actor), card: m.card }),
              t('event.mistakeDetail', { cards }),
            );
          }
          break;
        }
        case 'shield_used':
          sfx.shuriken();
          show('success', t('event.shieldUsed'));
          break;
        case 'rewind_offered':
          vibrate(40);
          break;
        case 'rewind_used':
          sfx.levelComplete();
          show('success', t('event.rewindUsed'));
          break;
        case 'comodin_chosen': {
          const comodin = t(`comodin.${String(p.kind) as ComodinKind}`);
          sfx.shuriken();
          show(
            'success',
            p.how === 'tie'
              ? t('event.comodinTie', { name: comodin })
              : p.how === 'auto'
                ? t('event.comodinAuto', { name: comodin })
                : t('event.comodinChosen', { name: comodin }),
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
        case 'shuriken_cancelled': {
          // Los textos de cada comodín: event.shuriken…, event.shield…, event.rewind…
          const k = p.kind === 'shield' || p.kind === 'rewind' ? p.kind : 'shuriken';
          show(
            'info',
            p.reason === 'rejected'
              ? ev.actor === me
                ? t(`event.${k}RejectedMine`)
                : t(`event.${k}Rejected`, { name: name(ev.actor) })
              : p.reason === 'expired'
                ? t(`event.${k}Expired`)
                : t(`event.${k}PlayerLeft`),
          );
          break;
        }
        case 'shuriken_proposed':
          sfx.shuriken();
          vibrate(40);
          break;
        case 'level_complete':
          sfx.levelComplete();
          show('success', t('level.complete', { level: Number(p.level ?? 0) }));
          break;
        case 'won':
          sfx.won();
          show('success', t('end.won'));
          break;
        case 'lost':
          sfx.lost();
          vibrate([120, 80, 200]);
          break;
        case 'lightning_timeout':
          show('danger', t('event.lightningTimeout'), t('event.lightningTimeoutDetail'));
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
      const candidate = next as FeedItem | null;
      if (candidate && (!best || RANK[candidate.tone] >= RANK[best.tone])) best = candidate;
    }
    if (best) setItem(best);
  }, [newestSeq]);

  // Los mensajes desaparecen solos.
  useEffect(() => {
    if (!item) return;
    const id = window.setTimeout(() => setItem((cur) => (cur?.id === item.id ? null : cur)), item.tone === 'danger' ? 4200 : 2600);
    return () => window.clearTimeout(id);
  }, [item]);

  const clearCountdown = useCallback(() => setCountdownSeq(null), []);
  return { item, shake, countdownSeq, clearCountdown };
}
