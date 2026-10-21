/**
 * Motor de reglas de Unísono (TypeScript puro, sin interfaz ni red).
 *
 * - Lo usa el modo práctica (partida local contra bots).
 * - Es la especificación ejecutable de las reglas: las funciones SQL del servidor
 *   implementan lo mismo y se prueban con los mismos escenarios
 *   (tests/integration/conformance.test.ts).
 *
 * Todas las funciones son puras: reciben un estado y devuelven uno nuevo (o un error).
 */
import {
  NAME_MAX_LENGTH,
  MIN_PLAYERS,
  SHURIKEN_VOTE_SECONDS,
  normalizeConfig,
  rewardFor,
  startingResources,
} from '../config/gameConfig';
import { deal, type Rng } from './deck';
import type {
  GameErrorCode,
  GameEvent,
  GameEventKind,
  LevelReward,
  PlayedCard,
  PlayerId,
  RevealedCard,
  RoomConfig,
  RoomSnapshot,
  RoomStatus,
  ShurikenVote,
} from './types';

export interface EnginePlayer {
  id: PlayerId;
  name: string;
  seat: number;
  ready: boolean;
  lastSeenAt: string;
}

/** Estado completo (con TODAS las manos). Nunca se envía tal cual a un jugador. */
export interface EngineState {
  id: string;
  code: string;
  status: RoomStatus;
  config: RoomConfig;
  hostId: PlayerId;
  gameNo: number;
  level: number;
  maxLevel: number;
  lives: number;
  shurikens: number;
  livesCap: number;
  shurikensCap: number;
  players: EnginePlayer[];
  hands: Record<PlayerId, number[]>;
  pile: PlayedCard[];
  revealed: RevealedCard[];
  vote: ShurikenVote | null;
  /**
   * Jugadores a los que se les rechazó (o caducó) un shuriken: no pueden volver a
   * proponerlo hasta que se juegue una carta (evita insistir en bucle).
   */
  shurikenBlocked: PlayerId[];
  lastEvent: GameEvent | null;
  /** Últimos eventos (máximo RECENT_EVENTS), igual que el servidor. */
  recentEvents: GameEvent[];
  lastReward: LevelReward | null;
  eventSeq: number;
  version: number;
}

export type EngineResult =
  | { ok: true; state: EngineState; events: GameEvent[] }
  | { ok: false; error: GameErrorCode };

// ───────────────────────── utilidades internas ─────────────────────────

const iso = (now: number) => new Date(now).toISOString();

/** Cuántos eventos recientes se envían en cada foto (también en el SQL). */
export const RECENT_EVENTS = 8;

class Draft {
  readonly s: EngineState;
  readonly events: GameEvent[] = [];
  constructor(state: EngineState, readonly now: number) {
    this.s = structuredClone(state);
  }
  emit(kind: GameEventKind, actor: PlayerId | null, payload: Record<string, unknown> = {}) {
    this.s.eventSeq += 1;
    const ev: GameEvent = { seq: this.s.eventSeq, kind, actor, payload, at: iso(this.now) };
    this.s.lastEvent = ev;
    this.s.recentEvents = [...this.s.recentEvents, ev].slice(-RECENT_EVENTS);
    this.events.push(ev);
  }
  commit(): EngineResult {
    this.s.version += 1;
    return { ok: true, state: this.s, events: this.events };
  }
}

const fail = (error: GameErrorCode): EngineResult => ({ ok: false, error });
const unchanged = (state: EngineState): EngineResult => ({ ok: true, state, events: [] });

const playersBySeat = (s: EngineState) => [...s.players].sort((a, b) => a.seat - b.seat);
const isMember = (s: EngineState, id: PlayerId) => s.players.some((p) => p.id === id);
const totalCards = (s: EngineState) => Object.values(s.hands).reduce((n, h) => n + h.length, 0);

/** Limpia un alias: sin caracteres de control, espacios normalizados, 1–20 caracteres. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = [...name];
  if (chars.length < 1 || chars.length > NAME_MAX_LENGTH) return null;
  return name;
}

/**
 * Orden de juego. Las manos se guardan siempre en el orden en que hay que jugarlas:
 * la primera carta de cada mano es la que toca (la más baja, o la más alta en descendente).
 */
const isDesc = (s: EngineState) => s.config.order === 'desc';
/** ¿La carta `a` debía jugarse antes que `b`? */
const goesBefore = (s: EngineState, a: number, b: number) => (isDesc(s) ? a > b : a < b);
const byPlayOrder = (s: EngineState) => (a: number, b: number) => (isDesc(s) ? b - a : a - b);

function dealLevel(d: Draft, rng: Rng) {
  const ids = playersBySeat(d.s).map((p) => p.id);
  d.s.hands = deal(ids, d.s.level, rng);
  if (isDesc(d.s)) for (const h of Object.values(d.s.hands)) h.reverse();
  d.s.pile = [];
  d.s.revealed = [];
  d.s.vote = null;
  d.s.shurikenBlocked = [];
  d.s.lastReward = null;
  for (const p of d.s.players) p.ready = false;
}

function endGame(d: Draft, status: 'won' | 'lost' | 'abandoned') {
  d.s.status = status;
  d.s.hands = {};
  d.s.vote = null;
  d.emit(status, null, { level: d.s.level });
}

/** Si ya no quedan cartas en ninguna mano, el nivel termina (victoria final o recompensa). */
function checkLevelEnd(d: Draft) {
  if (d.s.status !== 'playing' || totalCards(d.s) > 0) return;
  if (d.s.level >= d.s.maxLevel) {
    endGame(d, 'won');
    return;
  }
  const reward = rewardFor(d.s.config, d.s.level);
  const newLives = Math.min(d.s.lives + reward.lives, Math.max(d.s.livesCap, d.s.lives));
  const newShurikens = Math.min(d.s.shurikens + reward.shurikens, Math.max(d.s.shurikensCap, d.s.shurikens));
  const gained: LevelReward = {
    level: d.s.level,
    lives: newLives - d.s.lives,
    shurikens: newShurikens - d.s.shurikens,
  };
  d.s.lives = newLives;
  d.s.shurikens = newShurikens;
  d.s.lastReward = gained;
  d.s.status = 'level_complete';
  d.s.vote = null;
  for (const p of d.s.players) p.ready = false;
  d.emit('level_complete', null, { level: gained.level, reward: { lives: gained.lives, shurikens: gained.shurikens } });
}

function startNextLevel(d: Draft, rng: Rng) {
  d.s.level += 1;
  d.s.status = 'playing';
  dealLevel(d, rng);
  d.emit('level_start', null, { level: d.s.level });
}

function maybeAdvance(d: Draft, rng: Rng) {
  if (d.s.status === 'level_complete' && d.s.players.length > 0 && d.s.players.every((p) => p.ready)) {
    startNextLevel(d, rng);
  }
}

/** Quien propuso un shuriken rechazado o caducado no puede repetirlo hasta que se juegue una carta. */
function blockProposer(d: Draft, proposer: PlayerId) {
  if (!d.s.shurikenBlocked.includes(proposer)) d.s.shurikenBlocked.push(proposer);
}

/** Cancela una votación caducada. Devuelve true si la ha cancelado. */
function expireIfDue(d: Draft): boolean {
  if (d.s.vote && d.now >= Date.parse(d.s.vote.expiresAt)) {
    blockProposer(d, d.s.vote.proposer);
    d.s.vote = null;
    d.emit('shuriken_cancelled', null, { reason: 'expired' });
    return true;
  }
  return false;
}

function executeShuriken(d: Draft) {
  const reveal = d.s.config.shurikenVariant === 'reveal';
  const discarded: { p: PlayerId; c?: number }[] = [];
  for (const p of playersBySeat(d.s)) {
    const hand = d.s.hands[p.id];
    if (!hand || hand.length === 0) continue;
    const c = hand.shift()!;
    if (reveal) {
      discarded.push({ p: p.id, c });
      d.s.revealed.push({ c, p: p.id, r: 'shuriken' });
    } else {
      discarded.push({ p: p.id });
    }
  }
  d.s.shurikens -= 1;
  d.s.vote = null;
  d.s.shurikenBlocked = []; // la mesa ha cambiado
  d.emit('shuriken_used', null, { discarded });
  checkLevelEnd(d);
}

// ───────────────────────── API pública del motor ─────────────────────────

export function createRoom(params: {
  id: string;
  code: string;
  hostId: PlayerId;
  hostName: string;
  config?: unknown;
  now: number;
}): EngineState {
  return {
    id: params.id,
    code: params.code,
    status: 'lobby',
    config: normalizeConfig(params.config),
    hostId: params.hostId,
    gameNo: 0,
    level: 0,
    maxLevel: 0,
    lives: 0,
    shurikens: 0,
    livesCap: 0,
    shurikensCap: 0,
    players: [{ id: params.hostId, name: params.hostName, seat: 1, ready: false, lastSeenAt: iso(params.now) }],
    hands: {},
    pile: [],
    revealed: [],
    vote: null,
    shurikenBlocked: [],
    lastEvent: null,
    recentEvents: [],
    lastReward: null,
    eventSeq: 0,
    version: 1,
  };
}

export function addPlayer(state: EngineState, id: PlayerId, rawName: string, now: number): EngineResult {
  if (isMember(state, id)) return unchanged(state);
  const name = cleanName(rawName);
  if (!name) return fail('INVALID_NAME');
  if (state.status !== 'lobby') return fail('GAME_IN_PROGRESS');
  if (state.players.length >= state.config.maxPlayers) return fail('ROOM_FULL');
  const d = new Draft(state, now);
  const seat = Math.max(0, ...d.s.players.map((p) => p.seat)) + 1;
  d.s.players.push({ id, name, seat, ready: false, lastSeenAt: iso(now) });
  d.emit('player_joined', id, { name });
  return d.commit();
}

export function updateConfig(state: EngineState, actor: PlayerId, input: unknown, now: number): EngineResult {
  if (!isMember(state, actor)) return fail('NOT_MEMBER');
  if (actor !== state.hostId) return fail('NOT_HOST');
  if (state.status !== 'lobby') return fail('NOT_IN_LOBBY');
  const d = new Draft(state, now);
  const config = normalizeConfig(input);
  config.maxPlayers = Math.max(config.maxPlayers, d.s.players.length);
  d.s.config = config;
  return d.commit();
}

export function setLobbyReady(state: EngineState, actor: PlayerId, ready: boolean, now: number): EngineResult {
  if (!isMember(state, actor)) return fail('NOT_MEMBER');
  if (state.status !== 'lobby') return fail('NOT_IN_LOBBY');
  const d = new Draft(state, now);
  d.s.players.find((p) => p.id === actor)!.ready = ready;
  return d.commit();
}

export function startGame(state: EngineState, actor: PlayerId, rng: Rng, now: number): EngineResult {
  if (!isMember(state, actor)) return fail('NOT_MEMBER');
  if (actor !== state.hostId) return fail('NOT_HOST');
  if (state.status !== 'lobby') return fail('NOT_IN_LOBBY');
  if (state.players.length < MIN_PLAYERS) return fail('NOT_ENOUGH_PLAYERS');
  if (state.players.some((p) => !p.ready)) return fail('NOT_ALL_READY');
  const d = new Draft(state, now);
  const res = startingResources(d.s.config, d.s.players.length);
  d.s.gameNo += 1;
  d.s.level = 1;
  d.s.maxLevel = res.maxLevel;
  d.s.lives = res.lives;
  d.s.shurikens = res.shurikens;
  d.s.livesCap = res.livesCap;
  d.s.shurikensCap = res.shurikensCap;
  d.s.status = 'playing';
  dealLevel(d, rng);
  d.emit('game_start', actor, { level: 1, maxLevel: res.maxLevel });
  return d.commit();
}

/**
 * Juega la carta `card` del jugador `actor`.
 * Solo se acepta si es la carta que le toca (la más baja; la más alta en orden descendente).
 * Si otros jugadores tenían cartas que debían ir antes, se produce UN error: −1 vida y se
 * descartan TODAS esas cartas.
 */
export function playCard(state: EngineState, actor: PlayerId, card: number, now: number): EngineResult {
  if (!isMember(state, actor)) return fail('NOT_MEMBER');
  if (state.status !== 'playing') return fail('NOT_PLAYING');
  const d = new Draft(state, now);
  expireIfDue(d);
  if (d.s.vote) return fail('VOTE_IN_PROGRESS');
  const hand = d.s.hands[actor] ?? [];
  if (hand.length === 0) return fail('NO_CARDS');
  if (hand[0] !== card) return fail(hand.includes(card) ? 'NOT_LOWEST' : 'NOT_IN_HAND');

  hand.shift();
  d.s.pile.push({ c: card, p: actor });
  d.s.shurikenBlocked = []; // se ha jugado una carta: todos pueden volver a proponer

  const lower: PlayedCard[] = [];
  for (const p of playersBySeat(d.s)) {
    const h = d.s.hands[p.id] ?? [];
    while (h.length > 0 && goesBefore(d.s, h[0]!, card)) lower.push({ c: h.shift()!, p: p.id });
  }
  const order = byPlayOrder(d.s);
  lower.sort((a, b) => order(a.c, b.c));

  if (lower.length > 0) {
    d.s.lives -= 1;
    for (const x of lower) d.s.revealed.push({ ...x, r: 'mistake' });
    d.emit('mistake', actor, { card, discarded: lower, lives: d.s.lives });
    if (d.s.lives <= 0) {
      endGame(d, 'lost');
      return d.commit();
    }
  } else {
    d.emit('play', actor, { card });
  }
  checkLevelEnd(d);
  return d.commit();
}

export function proposeShuriken(state: EngineState, actor: PlayerId, now: number): EngineResult {
  if (!isMember(state, actor)) return fail('NOT_MEMBER');
  if (state.status !== 'playing') return fail('NOT_PLAYING');
  const d = new Draft(state, now);
  expireIfDue(d);
  if (d.s.vote) return fail('VOTE_IN_PROGRESS');
  if (d.s.shurikens <= 0) return fail('NO_SHURIKENS');
  if (d.s.shurikenBlocked.includes(actor)) return fail('SHURIKEN_BLOCKED');
  d.s.vote = {
    proposer: actor,
    votes: [actor],
    expiresAt: iso(now + SHURIKEN_VOTE_SECONDS * 1000),
  };
  d.emit('shuriken_proposed', actor, {});
  if (d.s.players.every((p) => d.s.vote!.votes.includes(p.id))) executeShuriken(d);
  return d.commit();
}

export function voteShuriken(state: EngineState, actor: PlayerId, accept: boolean, now: number): EngineResult {
  if (!isMember(state, actor)) return fail('NOT_MEMBER');
  if (state.status !== 'playing') return fail('NOT_PLAYING');
  const d = new Draft(state, now);
  if (expireIfDue(d)) return d.commit();
  if (!d.s.vote) return fail('NO_VOTE');
  if (!accept) {
    blockProposer(d, d.s.vote.proposer);
    d.s.vote = null;
    d.emit('shuriken_cancelled', actor, { reason: 'rejected' });
    return d.commit();
  }
  if (d.s.vote.votes.includes(actor)) return unchanged(state);
  d.s.vote.votes.push(actor);
  if (d.s.players.every((p) => d.s.vote!.votes.includes(p.id))) executeShuriken(d);
  return d.commit();
}

export function expireVote(state: EngineState, now: number): EngineResult {
  const d = new Draft(state, now);
  return expireIfDue(d) ? d.commit() : unchanged(state);
}

/**
 * El jugador indica que está listo para el siguiente nivel. `level` es el nivel recién
 * superado: si no coincide (petición repetida o tardía) no se hace nada.
 */
export function readyNextLevel(
  state: EngineState,
  actor: PlayerId,
  level: number,
  force: boolean,
  rng: Rng,
  now: number,
): EngineResult {
  if (!isMember(state, actor)) return fail('NOT_MEMBER');
  if (state.status !== 'level_complete' || state.level !== level) return unchanged(state);
  const d = new Draft(state, now);
  d.s.players.find((p) => p.id === actor)!.ready = true;
  if (force && actor === d.s.hostId) startNextLevel(d, rng);
  else maybeAdvance(d, rng);
  return d.commit();
}

export function removePlayer(
  state: EngineState,
  target: PlayerId,
  reason: 'left' | 'kicked',
  rng: Rng,
  now: number,
): EngineResult {
  const player = state.players.find((p) => p.id === target);
  if (!player) return fail('NOT_MEMBER');
  const d = new Draft(state, now);
  const cards = d.s.hands[target]?.length ?? 0;
  delete d.s.hands[target];
  d.s.players = d.s.players.filter((p) => p.id !== target);
  d.emit(reason === 'left' ? 'player_left' : 'player_kicked', target, { name: player.name, cards });

  if (d.s.players.length === 0) {
    d.s.status = 'abandoned';
    return d.commit();
  }
  if (d.s.hostId === target) {
    d.s.hostId = playersBySeat(d.s)[0]!.id;
    d.emit('host_changed', d.s.hostId, {});
  }
  if (d.s.vote) {
    d.s.vote = null;
    d.emit('shuriken_cancelled', null, { reason: 'player_left' });
  }
  if (d.s.status === 'playing' || d.s.status === 'level_complete') {
    if (d.s.players.length < MIN_PLAYERS) {
      endGame(d, 'abandoned');
    } else if (d.s.status === 'playing') {
      checkLevelEnd(d);
    } else {
      maybeAdvance(d, rng);
    }
  }
  return d.commit();
}

export function kickPlayer(state: EngineState, actor: PlayerId, target: PlayerId, rng: Rng, now: number): EngineResult {
  if (!isMember(state, actor)) return fail('NOT_MEMBER');
  if (actor !== state.hostId) return fail('NOT_HOST');
  if (actor === target) return fail('CANNOT_KICK_SELF');
  return removePlayer(state, target, 'kicked', rng, now);
}

export function rematch(state: EngineState, actor: PlayerId, now: number): EngineResult {
  if (!isMember(state, actor)) return fail('NOT_MEMBER');
  if (actor !== state.hostId) return fail('NOT_HOST');
  if (!['won', 'lost', 'abandoned'].includes(state.status)) return fail('INVALID_STATE');
  const d = new Draft(state, now);
  Object.assign(d.s, {
    status: 'lobby',
    level: 0,
    maxLevel: 0,
    lives: 0,
    shurikens: 0,
    livesCap: 0,
    shurikensCap: 0,
    hands: {},
    pile: [],
    revealed: [],
    vote: null,
    shurikenBlocked: [],
    lastReward: null,
  } satisfies Partial<EngineState>);
  for (const p of d.s.players) p.ready = false;
  d.emit('rematch', actor, {});
  return d.commit();
}

/** Lo que `viewer` puede ver. Nunca incluye las cartas de otros jugadores. */
export function toSnapshot(state: EngineState, viewer: PlayerId, now: number): RoomSnapshot {
  return {
    serverTime: iso(now),
    me: viewer,
    room: {
      id: state.id,
      code: state.code,
      status: state.status,
      hostId: state.hostId,
      config: structuredClone(state.config),
      gameNo: state.gameNo,
      level: state.level,
      maxLevel: state.maxLevel,
      lives: state.lives,
      shurikens: state.shurikens,
      version: state.version,
      shurikenBlocked: [...state.shurikenBlocked],
    },
    players: playersBySeat(state).map((p) => ({
      id: p.id,
      name: p.name,
      seat: p.seat,
      ready: p.ready,
      lastSeenAt: p.lastSeenAt,
      cardsLeft: state.hands[p.id]?.length ?? 0,
    })),
    pile: structuredClone(state.pile),
    revealed: structuredClone(state.revealed),
    vote: structuredClone(state.vote),
    lastEvent: structuredClone(state.lastEvent),
    recentEvents: structuredClone(state.recentEvents),
    lastReward: structuredClone(state.lastReward),
    myHand: [...(state.hands[viewer] ?? [])],
  };
}
