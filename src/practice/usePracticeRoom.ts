/**
 * Partida local contra bots (sin red), usando el mismo motor de reglas.
 * Los bots «cuentan»: esperan un tiempo proporcional a la distancia entre su carta
 * más baja y la última carta jugada, con algo de imprecisión humana.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cryptoRng } from '../game/deck';
import * as E from '../game/engine';
import type { RoomActions, RoomController, ExitReason } from '../game/controller';
import type { RoomConfig } from '../game/types';

export const PRACTICE_ME = 'yo';
const BOT_NAMES = ['Lía', 'Teo', 'Noa'];
export const COUNTDOWN_MS = 3000;

const BOT_BASE_MS = 500;
const BOT_MS_PER_STEP = 115;

function newGame(bots: number, config: RoomConfig, myName: string): E.EngineState {
  const now = Date.now();
  let s = E.createRoom({ id: 'practica', code: 'LOCAL', hostId: PRACTICE_ME, hostName: myName, config, now });
  for (let i = 0; i < bots; i++) {
    const r = E.addPlayer(s, `bot${i + 1}`, BOT_NAMES[i] ?? `Bot ${i + 1}`, now);
    if (r.ok) s = r.state;
  }
  const started = E.startGame(s, PRACTICE_ME, cryptoRng, now);
  return started.ok ? started.state : s;
}

export function usePracticeRoom(
  opts: { bots: number; config: RoomConfig; myName: string },
  onExit: (reason: ExitReason) => void,
): RoomController {
  const [state, setState] = useState<E.EngineState>(() => newGame(opts.bots, opts.config, opts.myName));
  const [notice, setNotice] = useState<RoomController['notice']>(null);
  const stateRef = useRef(state);
  const startPause = () => (opts.config.countdown ? COUNTDOWN_MS : 0);
  /** Momento desde el que los bots empiezan a «contar». */
  const clockRef = useRef(Date.now() + startPause());
  const jitter = useRef(new Map<string, number>());

  const commit = useCallback(
    (r: E.EngineResult) => {
      if (!r.ok) {
        setNotice({ code: r.error, at: Date.now() });
        return;
      }
      if (r.state === stateRef.current) return; // sin cambios (p. ej. petición repetida)
      for (const ev of r.events) {
        if (ev.kind === 'level_start' || ev.kind === 'game_start') {
          clockRef.current = Date.now() + (r.state.config.countdown ? COUNTDOWN_MS : 0);
        } else if (['play', 'mistake', 'shuriken_used', 'shuriken_cancelled'].includes(ev.kind)) {
          clockRef.current = Date.now();
        }
      }
      stateRef.current = r.state;
      setState(r.state);
    },
    [],
  );

  // Comportamiento de los bots: se recalcula tras cada cambio de estado.
  useEffect(() => {
    const timers: number[] = [];
    const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, Math.max(0, ms)));
    const s = state;
    const bots = s.players.filter((p) => p.id !== PRACTICE_ME);

    if (s.status === 'playing' && !s.vote) {
      const top = s.pile.at(-1)?.c ?? 0;
      let best: { id: string; card: number; at: number } | null = null;
      for (const b of bots) {
        const card = s.hands[b.id]?.[0];
        if (card === undefined) continue;
        const key = `${s.gameNo}:${b.id}:${card}`;
        if (!jitter.current.has(key)) jitter.current.set(key, 0.7 + cryptoRng() * 0.6);
        const at = clockRef.current + BOT_BASE_MS + Math.max(0, card - top) * BOT_MS_PER_STEP * jitter.current.get(key)!;
        if (!best || at < best.at) best = { id: b.id, card, at };
      }
      if (best) {
        const { id, card } = best;
        later(best.at - Date.now(), () => commit(E.playCard(stateRef.current, id, card, Date.now())));
      }
    }

    if (s.status === 'playing' && s.vote) {
      for (const b of bots) {
        if (!s.vote.votes.includes(b.id)) {
          later(700 + cryptoRng() * 900, () => commit(E.voteShuriken(stateRef.current, b.id, true, Date.now())));
        }
      }
      later(Date.parse(s.vote.expiresAt) - Date.now() + 50, () => commit(E.expireVote(stateRef.current, Date.now())));
    }

    if (s.status === 'level_complete') {
      for (const b of bots) {
        if (!s.players.find((p) => p.id === b.id)?.ready) {
          later(600 + cryptoRng() * 800, () =>
            commit(E.readyNextLevel(stateRef.current, b.id, stateRef.current.level, false, cryptoRng, Date.now())),
          );
        }
      }
    }

    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [state, commit]);

  const actions = useMemo<RoomActions>(() => {
    const act = (fn: (s: E.EngineState, now: number) => E.EngineResult) => async () => {
      commit(fn(stateRef.current, Date.now()));
    };
    return {
      playCard: (card) => act((s, now) => E.playCard(s, PRACTICE_ME, card, now))(),
      proposeShuriken: act((s, now) => E.proposeShuriken(s, PRACTICE_ME, now)),
      voteShuriken: (accept) => act((s, now) => E.voteShuriken(s, PRACTICE_ME, accept, now))(),
      expireVote: act((s, now) => E.expireVote(s, now)),
      readyNextLevel: (force) => act((s, now) => E.readyNextLevel(s, PRACTICE_ME, s.level, force, cryptoRng, now))(),
      setLobbyReady: async () => {},
      updateConfig: async () => {},
      startGame: async () => {},
      kick: async () => {},
      sendChat: async () => {},
      rematch: async () => {
        jitter.current.clear();
        const fresh = newGame(opts.bots, stateRef.current.config, opts.myName);
        clockRef.current = Date.now() + startPause();
        stateRef.current = fresh;
        setState(fresh);
      },
      leave: async () => onExit('left'),
    };
  }, [commit, onExit]);

  const snapshot = useMemo(() => E.toSnapshot(state, PRACTICE_ME, Date.now()), [state]);
  const onlineIds = useMemo(() => new Set(state.players.map((p) => p.id)), [state.players]);

  return { kind: 'practice', snapshot, connection: 'online', onlineIds, clockOffset: 0, chat: [], notice, busy: false, actions };
}
