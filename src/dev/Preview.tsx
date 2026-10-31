/**
 * Solo en desarrollo (`npm run dev`): muestra pantallas con estados de ejemplo sin servidor.
 * Uso: http://localhost:5173/?preview=lobby | mistake | won | lost | vote | shieldvote | shieldon | rewind | rewindlast | pick | picked
 *      | lightning | lightninglow | lightningalert | lightningnext | lightninglost
 *      | final | finalpeek | finalalert | finalnext | finallost
 *      | shop | shoprich | collection | designs | wonreward | lostreward | noreward
 * No se incluye en la web publicada.
 */
import type { RoomController } from '../game/controller';
import * as E from '../game/engine';
import { seededRng } from '../game/testing';
import { GameScreen } from '../ui/screens/game/GameScreen';
import { LobbyScreen } from '../ui/screens/LobbyScreen';
import { CollectionScreen, ShopScreen } from '../ui/screens/ShopScreens';
import type { MatchReward } from '../game/types';
import type { Profile } from '../net/api';
import { previewProfile } from '../ui/profile';

/** Perfil de ejemplo (shop: 34 monedas y Galaxia comprada · shoprich: 120 y nada comprado). */
function demoProfile(kind: string): Profile {
  const rich = kind === 'shoprich';
  return {
    coins: rich ? 120 : 34,
    equipped: { card_design: rich ? 'classic' : 'galaxy' },
    owned: rich ? ['classic'] : ['classic', 'galaxy'],
    catalog: [
      { id: 'classic', kind: 'card_design', name: 'Clásico', description: 'El diseño de siempre: papel cálido y el color de cada número.', price: null, unlock: 'default', available: true },
      { id: 'galaxy', kind: 'card_design', name: 'Galaxia', description: 'Cartas llegadas del espacio profundo: nebulosas, estrellas y polvo cósmico.', price: 10, unlock: 'coins', available: true },
      { id: 'neon', kind: 'card_design', name: 'Neón', description: 'Rejilla futurista, bordes eléctricos y números que brillan en la oscuridad.', price: 30, unlock: 'coins', available: true },
      { id: 'emerald', kind: 'card_design', name: 'Esmeralda', description: 'Terciopelo verde, filigrana dorada y acabado de joya. El más exclusivo.', price: 50, unlock: 'coins', available: true },
    ],
    rewards: { perLevel: 1, cardsPerCoin: 2, participation: 2, victoryCardsPerCoin: 4, minCardsPlayed: 1 },
  };
}

/** Recompensa de ejemplo para la pantalla final. */
const DEMO_REWARD: Record<string, MatchReward | null> = {
  wonreward: { coins: 118, balanceBefore: 34, balanceAfter: 152, breakdown: { players: 4, maxLevel: 8, levelsCompleted: 8, won: true, participation: 2, levels: 80, victory: 36, total: 118 } },
  lostreward: { coins: 22, balanceBefore: 34, balanceAfter: 56, breakdown: { players: 4, maxLevel: 8, levelsCompleted: 3, won: false, participation: 2, levels: 20, victory: 0, total: 22 } },
  noreward: null,
};

const NOW = Date.now();
const noop = async () => {};

function build(kind: string): E.EngineState {
  let s = E.createRoom({ id: 'demo', code: 'K7MPQ', hostId: 'me', hostName: 'Rubén', config: { mode: 'friends' }, now: NOW });
  for (const [id, name] of [['a', 'Lucía'], ['b', 'Marcos'], ['c', 'Ainhoa']] as const) {
    const r = E.addPlayer(s, id, name, NOW);
    if (r.ok) s = r.state;
  }
  if (kind === 'lobby') {
    s.players[1]!.ready = true;
    return s;
  }
  for (const p of s.players) p.ready = true;
  const started = E.startGame(s, 'me', seededRng(3), NOW - 10000);
  if (started.ok) s = started.state;
  // Sin ronda relámpago salvo en sus propios ejemplos.
  s.lightningLevel = 0;
  s.lightningEndsAt = null;
  s.level = 4;
  s.hands = { me: [18, 52, 77, 90], a: [25, 61, 70], b: [40, 44, 99], c: [9, 66, 81] };
  const step = (r: E.EngineResult) => {
    if (r.ok) s = r.state;
  };
  step(E.playCard(s, 'c', 9, NOW));
  if (kind === 'mistake') step(E.playCard(s, 'b', 40, NOW));
  if (kind === 'vote') step(E.proposeShuriken(s, 'a', NOW));
  if (kind === 'lost') {
    s.lives = 1;
    step(E.playCard(s, 'b', 40, NOW));
  }
  if (kind === 'big' || kind === 'bigvote') {
    // Nivel 11 de 2 jugadores con muchas cartas y varias descartadas (peor caso de espacio).
    s.players = s.players.slice(0, 2);
    s.level = 11;
    s.maxLevel = 12;
    s.hands = { me: [25, 37, 57, 58, 60, 64, 69, 86, 89, 94], a: [26, 30, 41, 50, 52, 70, 71, 80, 95] };
    s.pile = [{ c: 11, p: 'a' }, { c: 14, p: 'me' }];
    s.revealed = [3, 5, 9, 12, 13].map((c) => ({ c, p: 'a', r: 'mistake' as const }));
    if (kind === 'bigvote') step(E.proposeShuriken(s, 'a', NOW));
  }
  if (kind === 'reward') {
    s.level = 3; // nivel con premio (+1 vida) en la tabla clásica
    s.hands = { me: [18, 52, 77], a: [25, 61, 70], b: [40, 44, 99], c: [66, 81, 90] };
    s.recentEvents = [];
    s.lastEvent = null;
  }
  if (kind === 'levelup') {
    s.level = 1;
    s.hands = { me: [], a: [], b: [], c: [] };
    s.status = 'level_complete';
    s.lastReward = { level: 1, lives: 0, shurikens: 0 };
    s.lastEvent = null;
  }
  if (kind === 'blocked') {
    // A «me» le han rechazado el shuriken: no puede repetirlo hasta que se juegue una carta.
    step(E.proposeShuriken(s, 'me', NOW));
    step(E.voteShuriken(s, 'a', false, NOW));
  }
  if (kind === 'shieldvote') {
    s.shields = 1;
    step(E.proposeShield(s, 'a', NOW));
  }
  if (kind === 'shieldon') {
    s.shields = 1;
    s.shieldActive = true;
  }
  if (kind === 'rewind' || kind === 'rewindlast') {
    s.rewinds = 1;
    s.shields = 1;
    if (kind === 'rewindlast') s.lives = 1;
    step(E.playCard(s, 'b', 40, NOW));
    step(E.voteShuriken(s, 'a', true, NOW));
  }
  if (kind === 'pick' || kind === 'picked') {
    s.level = 2;
    s.hands = { me: [10, 11], a: [20, 21], b: [30, 31], c: [40, 41] };
    for (const [p, c] of [['me', 10], ['me', 11], ['a', 20], ['a', 21], ['b', 30], ['b', 31], ['c', 40], ['c', 41]] as const) {
      step(E.playCard(s, p, c, NOW - 4000, seededRng(4)));
    }
    s.lastEvent = null;
    step(E.pickComodin(s, 'a', 2, s.offer!.choices[0]!, seededRng(5), NOW - 4000));
    if (kind === 'picked') {
      for (const p of ['me', 'b', 'c']) step(E.pickComodin(s, p, 2, s.offer!.choices[1]!, seededRng(5), NOW - 4000));
      s.players.find((p) => p.id === 'a')!.ready = true;
    }
  }
  if (kind.startsWith('lightning')) {
    // lightning: reloj en marcha · lightninglow: últimos segundos · lightningalert: el aviso al empezar
    // lightningnext: «nivel superado» antes de la ronda · lightninglost: se acabó el tiempo
    s.lightningLevel = 4;
    const left = kind === 'lightninglow' ? 8 : kind === 'lightningalert' ? 75 : 47;
    s.lightningEndsAt = new Date(NOW + left * 1000).toISOString();
    if (kind === 'lightningalert') {
      s.pile = [];
      s.hands = { me: [18, 52, 77, 90], a: [9, 25, 61, 70], b: [40, 44, 99, 100], c: [3, 66, 81, 85] };
      s.eventSeq += 1;
      s.lastEvent = { seq: s.eventSeq, kind: 'level_start', actor: null, payload: { level: 4 }, at: new Date(NOW).toISOString() };
      s.recentEvents = [s.lastEvent];
    }
    if (kind === 'lightningnext') {
      s.level = 3;
      s.hands = { me: [], a: [], b: [], c: [] };
      s.status = 'level_complete';
      s.lightningEndsAt = null;
      s.lastReward = { level: 3, lives: 1, shurikens: 0 };
      s.lastEvent = null;
    }
    if (kind === 'lightninglost') {
      s.lightningEndsAt = new Date(NOW - 5000).toISOString();
      step(E.expireVote(s, NOW - 4000));
    }
  }
  if (kind.startsWith('final')) {
    // final: mesa a ciegas con las cartas ya tapadas · finalpeek: la última carta aún a la vista
    // finalalert: el aviso al empezar · finalnext: «nivel superado» justo antes · finallost: derrota en la final
    s.level = s.maxLevel;
    s.hands = { me: [18, 52, 77, 90], a: [25, 61, 70], b: [40, 44, 99], c: [9, 66, 81] };
    s.pile = [];
    s.pileAt = null;
    s.revealed = [];
    s.recentEvents = [];
    s.lastEvent = null;
    if (kind === 'finalalert') {
      s.eventSeq += 1;
      s.lastEvent = { seq: s.eventSeq, kind: 'level_start', actor: null, payload: { level: s.level }, at: new Date(NOW).toISOString() };
      s.recentEvents = [s.lastEvent];
    } else if (kind === 'finalnext') {
      s.level = s.maxLevel - 1;
      s.hands = { me: [], a: [], b: [], c: [] };
      s.status = 'level_complete';
      s.lastReward = { level: s.level, lives: 1, shurikens: 0 };
    } else {
      step(E.playCard(s, 'c', 9, NOW - 9000));
      step(E.playCard(s, 'me', 18, kind === 'finalpeek' ? NOW : NOW - 6000));
      if (kind === 'finallost') {
        s.lives = 1;
        step(E.playCard(s, 'b', 40, NOW - 4000));
      }
    }
  }
  if (kind === 'designs') {
    // Cada jugador con su diseño: tu mano en Galaxia; en la mesa, la de Ainhoa (Esmeralda) y la de Marcos (Neón).
    step(E.playCard(s, 'b', 40, NOW));
    s.revealed = [];
  }
  if (kind === 'wonreward' || kind === 'lostreward' || kind === 'noreward') {
    s.status = kind === 'wonreward' ? 'won' : 'lost';
    if (kind === 'wonreward') s.level = s.maxLevel;
    s.recentEvents = [];
    s.lastEvent = null;
  }
  if (kind === 'won') {
    s.status = 'won';
    s.level = s.maxLevel;
  }
  return s;
}

export function Preview({ kind }: { kind: string }) {
  if (kind === 'shop' || kind === 'shoprich' || kind === 'collection') {
    previewProfile(demoProfile(kind));
    return kind === 'collection' ? <CollectionScreen onBack={noop} onShop={noop} /> : <ShopScreen onBack={noop} onCollection={noop} />;
  }
  previewProfile(demoProfile('shop'));
  const s = build(kind);
  const snapshot = E.toSnapshot(s, 'me', NOW);
  if (kind === 'designs') {
    const designs: Record<string, string> = { me: 'galaxy', a: 'classic', b: 'neon', c: 'emerald' };
    for (const p of snapshot.players) p.cardDesign = designs[p.id];
  }
  if (kind in DEMO_REWARD) snapshot.myReward = DEMO_REWARD[kind];
  const ctl: RoomController = {
    kind: 'online',
    snapshot,
    connection: 'online',
    onlineIds: new Set(['me', 'a', 'c']),
    clockOffset: 0,
    chat: [],
    notice: null,
    busy: false,
    actions: {
      playCard: noop,
      proposeShuriken: noop,
      proposeShield: noop,
      voteShuriken: noop,
      pickComodin: noop,
      expireVote: noop,
      readyNextLevel: noop,
      setLobbyReady: noop,
      updateConfig: noop,
      startGame: noop,
      kick: noop,
      rematch: noop,
      leave: noop,
      sendChat: noop,
    },
  };
  return kind === 'lobby' ? <LobbyScreen ctl={ctl} /> : <GameScreen ctl={ctl} onExit={() => {}} />;
}
