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
  LIGHTNING_INTRO_SECONDS,
  NAME_MAX_LENGTH,
  MIN_PLAYERS,
  REWIND_VOTE_SECONDS,
  SHURIKEN_VOTE_SECONDS,
  lightningSeconds,
  normalizeConfig,
  rewardFor,
  startingResources,
} from '../config/gameConfig';
import { cryptoRng, deal, shuffle, type Rng } from './deck';
import {
  COMODIN_KINDS,
  type ComodinKind,
  type ComodinOffer,
  type GameErrorCode,
  type GameEvent,
  type GameEventKind,
  type LevelReward,
  type PlayedCard,
  type PlayerId,
  type RevealedCard,
  type RoomConfig,
  type RoomSnapshot,
  type RoomStatus,
  type ShurikenVote,
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
  /** Comodines Rebobinar y Escudo. */
  rewinds: number;
  shields: number;
  /** Escudo activado en este nivel: el siguiente error no cuesta vida. */
  shieldActive: boolean;
  livesCap: number;
  /** Máximo de CADA comodín. */
  shurikensCap: number;
  players: EnginePlayer[];
  hands: Record<PlayerId, number[]>;
  pile: PlayedCard[];
  revealed: RevealedCard[];
  vote: ShurikenVote | null;
  /** Elección de comodín pendiente tras superar un nivel. */
  offer: ComodinOffer | null;
  /** Nivel de la ronda relámpago (0 = ninguno) y hora límite mientras se juega. */
  lightningLevel: number;
  lightningEndsAt: string | null;
  /**
   * Jugadores a los que se les rechazó (o caducó) un vistazo o escudo: no pueden volver a
   * proponer comodines hasta que se juegue una carta (evita insistir en bucle).
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
  d.s.offer = null;
  d.s.shieldActive = false; // el escudo solo dura el nivel en que se activa
  d.s.shurikenBlocked = [];
  d.s.lastReward = null;
  // Si es la ronda relámpago, el reloj empieza a contar tras el aviso y la cuenta atrás.
  d.s.lightningEndsAt =
    d.s.level === d.s.lightningLevel ? iso(d.now + (LIGHTNING_INTRO_SECONDS + lightningSeconds(d.s.level)) * 1000) : null;
  for (const p of d.s.players) p.ready = false;
}

/** Ronda relámpago: un nivel al azar de la partida, nunca el último (sin ronda si solo hay uno). */
function pickLightningLevel(maxLevel: number, rng: Rng) {
  return maxLevel >= 2 ? 1 + Math.floor(rng() * (maxLevel - 1)) : 0;
}

function endGame(d: Draft, status: 'won' | 'lost' | 'abandoned') {
  d.s.status = status;
  d.s.hands = {};
  d.s.vote = null;
  d.s.offer = null;
  d.s.lightningEndsAt = null;
  d.emit(status, null, { level: d.s.level });
}

// ───── Comodines ─────

const COUNT_FIELD = { shuriken: 'shurikens', rewind: 'rewinds', shield: 'shields' } as const;
const comodinCount = (s: EngineState, kind: ComodinKind) => s[COUNT_FIELD[kind]];
const voteKind = (v: ShurikenVote): ComodinKind => v.kind ?? 'shuriken';

/** Suma un comodín elegido al superar el nivel y lo apunta en la recompensa. */
function grantComodin(d: Draft, kind: ComodinKind, how: 'vote' | 'tie' | 'auto') {
  const field = COUNT_FIELD[kind];
  d.s[field] += 1;
  if (d.s.lastReward) d.s.lastReward[field] = (d.s.lastReward[field] ?? 0) + 1;
  d.emit('comodin_chosen', null, { kind, how });
}

/**
 * Prepara la elección de comodín: 2 de los 3 al azar, sin contar los que ya están al máximo.
 * Si solo queda uno posible se da directamente; si ninguno, el premio se pierde.
 */
function makeOffer(d: Draft, rng: Rng, left: number) {
  d.s.offer = null;
  while (left > 0) {
    const open = COMODIN_KINDS.filter((k) => comodinCount(d.s, k) < d.s.shurikensCap);
    if (open.length === 0) return;
    if (open.length === 1) {
      grantComodin(d, open[0]!, 'auto');
      left -= 1;
      continue;
    }
    d.s.offer = { choices: shuffle(open, rng).slice(0, 2), left, votes: {} };
    return;
  }
}

/** Gana el comodín más votado (empate o sin votos: al azar entre los empatados). */
function resolveOffer(d: Draft, rng: Rng) {
  const offer = d.s.offer!;
  const tally = offer.choices.map((k) => Object.values(offer.votes).filter((v) => v === k).length);
  const max = Math.max(...tally);
  const top = offer.choices.filter((_, i) => tally[i] === max);
  const kind = top.length === 1 ? top[0]! : top[Math.floor(rng() * top.length)]!;
  grantComodin(d, kind, top.length === 1 ? 'vote' : 'tie');
  makeOffer(d, rng, offer.left - 1);
}

const allPicked = (s: EngineState) => s.offer !== null && s.players.every((p) => s.offer!.votes[p.id] !== undefined);

/** Si ya no quedan cartas en ninguna mano, el nivel termina (victoria final o recompensa). */
function checkLevelEnd(d: Draft, rng: Rng) {
  if (d.s.status !== 'playing' || totalCards(d.s) > 0) return;
  if (d.s.level >= d.s.maxLevel) {
    endGame(d, 'won');
    return;
  }
  const reward = rewardFor(d.s.config, d.s.level);
  const newLives = Math.min(d.s.lives + reward.lives, Math.max(d.s.livesCap, d.s.lives));
  const gained: LevelReward = { level: d.s.level, lives: newLives - d.s.lives, shurikens: 0, rewinds: 0, shields: 0 };
  d.s.lives = newLives;
  d.s.lastReward = gained;
  d.s.status = 'level_complete';
  d.s.vote = null;
  d.s.shieldActive = false;
  d.s.lightningEndsAt = null;
  for (const p of d.s.players) p.ready = false;
  d.emit('level_complete', null, { level: gained.level, reward: { lives: gained.lives, comodines: reward.shurikens } });
  makeOffer(d, rng, reward.shurikens);
}

function startNextLevel(d: Draft, rng: Rng) {
  d.s.level += 1;
  d.s.status = 'playing';
  dealLevel(d, rng);
  d.emit('level_start', null, { level: d.s.level });
}

/** Se pasa de nivel cuando todos están listos y ya se ha elegido el comodín. */
function maybeAdvance(d: Draft, rng: Rng) {
  if (d.s.status === 'level_complete' && !d.s.offer && d.s.players.length > 0 && d.s.players.every((p) => p.ready)) {
    startNextLevel(d, rng);
  }
}

/** Quien propuso un comodín rechazado o caducado no puede proponer otro hasta que se juegue una carta. */
function blockProposer(d: Draft, proposer: PlayerId | null) {
  if (proposer && !d.s.shurikenBlocked.includes(proposer)) d.s.shurikenBlocked.push(proposer);
}

/**
 * Cancela la votación en curso. Si era Rebobinar, la vida no se recupera: si ya no
 * quedaban vidas se pierde la partida; si no, el nivel sigue (o termina si no quedan cartas).
 */
function cancelVote(d: Draft, actor: PlayerId | null, reason: 'rejected' | 'expired' | 'player_left', rng: Rng) {
  const vote = d.s.vote!;
  const kind = voteKind(vote);
  if (reason !== 'player_left') blockProposer(d, vote.proposer);
  d.s.vote = null;
  d.emit('shuriken_cancelled', actor, { reason, kind });
  if (kind === 'rewind') {
    if (d.s.lives <= 0) endGame(d, 'lost');
    else checkLevelEnd(d, rng);
  }
}

/**
 * Aplica los plazos vencidos. Devuelve true si ha cambiado algo.
 * - Ronda relámpago sin terminar a tiempo: se pierden todas las vidas y la partida
 *   (aunque hubiera una votación en curso, incluida la de Rebobinar).
 * - Votación caducada: se cancela.
 */
function expireIfDue(d: Draft, rng: Rng): boolean {
  if (d.s.status === 'playing' && d.s.lightningEndsAt && d.now >= Date.parse(d.s.lightningEndsAt)) {
    d.s.lives = 0;
    d.emit('lightning_timeout', null, { level: d.s.level });
    endGame(d, 'lost');
    return true;
  }
  if (d.s.vote && d.now >= Date.parse(d.s.vote.expiresAt)) {
    cancelVote(d, null, 'expired', rng);
    return true;
  }
  return false;
}

function executeShuriken(d: Draft, rng: Rng) {
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
  checkLevelEnd(d, rng);
}

/** Todos han aceptado: se aplica el comodín votado. */
function executeVote(d: Draft, rng: Rng) {
  switch (voteKind(d.s.vote!)) {
    case 'shuriken':
      executeShuriken(d, rng);
      return;
    case 'shield':
      d.s.shields -= 1;
      d.s.shieldActive = true;
      d.s.vote = null;
      d.s.shurikenBlocked = [];
      d.emit('shield_used', null, {});
      return;
    case 'rewind':
      d.s.rewinds -= 1;
      d.s.lives += 1;
      d.s.vote = null;
      d.emit('rewind_used', null, { lives: d.s.lives });
      checkLevelEnd(d, rng);
      return;
  }
}

const allVoted = (s: EngineState) => s.players.every((p) => s.vote!.votes.includes(p.id));

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
    rewinds: 0,
    shields: 0,
    shieldActive: false,
    livesCap: 0,
    shurikensCap: 0,
    players: [{ id: params.hostId, name: params.hostName, seat: 1, ready: false, lastSeenAt: iso(params.now) }],
    hands: {},
    pile: [],
    revealed: [],
    vote: null,
    offer: null,
    lightningLevel: 0,
    lightningEndsAt: null,
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
  d.s.rewinds = 0;
  d.s.shields = 0;
  d.s.livesCap = res.livesCap;
  d.s.shurikensCap = res.shurikensCap;
  d.s.status = 'playing';
  // Se sortea antes de repartir: el reparto pone en marcha el reloj si el nivel 1 es el relámpago.
  d.s.lightningLevel = pickLightningLevel(res.maxLevel, rng);
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
export function playCard(state: EngineState, actor: PlayerId, card: number, now: number, rng: Rng = cryptoRng): EngineResult {
  if (!isMember(state, actor)) return fail('NOT_MEMBER');
  if (state.status !== 'playing') return fail('NOT_PLAYING');
  const d = new Draft(state, now);
  expireIfDue(d, rng);
  if (d.s.status !== 'playing') return fail('NOT_PLAYING');
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
    for (const x of lower) d.s.revealed.push({ ...x, r: 'mistake' });
    if (d.s.shieldActive) {
      // El escudo absorbe este error: se descartan las cartas, pero no se pierde vida.
      d.s.shieldActive = false;
      d.emit('mistake', actor, { card, discarded: lower, lives: d.s.lives, shielded: true });
    } else {
      d.s.lives -= 1;
      d.emit('mistake', actor, { card, discarded: lower, lives: d.s.lives });
      if (d.s.rewinds > 0) {
        // Se pregunta a todos si quieren usar Rebobinar. Hasta decidirlo, la partida espera
        // (incluso si era la última vida o el nivel se ha quedado sin cartas).
        d.s.vote = { kind: 'rewind', proposer: null, votes: [], expiresAt: iso(now + REWIND_VOTE_SECONDS * 1000) };
        d.emit('rewind_offered', null, { lives: d.s.lives });
        return d.commit();
      }
      if (d.s.lives <= 0) {
        endGame(d, 'lost');
        return d.commit();
      }
    }
  } else {
    d.emit('play', actor, { card });
  }
  checkLevelEnd(d, rng);
  return d.commit();
}

/** Propone usar un vistazo (`shuriken`) o un escudo. Lo tienen que aceptar todos. */
function propose(state: EngineState, actor: PlayerId, kind: 'shuriken' | 'shield', now: number, rng: Rng): EngineResult {
  if (!isMember(state, actor)) return fail('NOT_MEMBER');
  if (state.status !== 'playing') return fail('NOT_PLAYING');
  const d = new Draft(state, now);
  expireIfDue(d, rng);
  if (d.s.status !== 'playing') return fail('NOT_PLAYING');
  if (d.s.vote) return fail('VOTE_IN_PROGRESS');
  if (kind === 'shuriken' && d.s.shurikens <= 0) return fail('NO_SHURIKENS');
  if (kind === 'shield' && d.s.shields <= 0) return fail('NO_SHIELDS');
  if (kind === 'shield' && d.s.shieldActive) return fail('SHIELD_ACTIVE');
  if (d.s.shurikenBlocked.includes(actor)) return fail('SHURIKEN_BLOCKED');
  d.s.vote = {
    kind,
    proposer: actor,
    votes: [actor],
    expiresAt: iso(now + SHURIKEN_VOTE_SECONDS * 1000),
  };
  d.emit('shuriken_proposed', actor, { kind });
  if (allVoted(d.s)) executeVote(d, rng);
  return d.commit();
}

export function proposeShuriken(state: EngineState, actor: PlayerId, now: number, rng: Rng = cryptoRng): EngineResult {
  return propose(state, actor, 'shuriken', now, rng);
}

export function proposeShield(state: EngineState, actor: PlayerId, now: number, rng: Rng = cryptoRng): EngineResult {
  return propose(state, actor, 'shield', now, rng);
}

/** Voto en la votación en curso (vistazo, escudo o rebobinar). Un «no» la cancela. */
export function voteShuriken(state: EngineState, actor: PlayerId, accept: boolean, now: number, rng: Rng = cryptoRng): EngineResult {
  if (!isMember(state, actor)) return fail('NOT_MEMBER');
  if (state.status !== 'playing') return fail('NOT_PLAYING');
  const d = new Draft(state, now);
  if (expireIfDue(d, rng)) return d.commit();
  if (!d.s.vote) return fail('NO_VOTE');
  if (!accept) {
    cancelVote(d, actor, 'rejected', rng);
    return d.commit();
  }
  if (d.s.vote.votes.includes(actor)) return unchanged(state);
  d.s.vote.votes.push(actor);
  if (allVoted(d.s)) executeVote(d, rng);
  return d.commit();
}

/** Aplica los plazos vencidos: votación caducada o tiempo agotado en la ronda relámpago. */
export function expireVote(state: EngineState, now: number, rng: Rng = cryptoRng): EngineResult {
  const d = new Draft(state, now);
  return expireIfDue(d, rng) ? d.commit() : unchanged(state);
}

/**
 * Voto para elegir comodín tras superar el nivel `level` (se puede cambiar mientras falten
 * votos). Cuando han votado todos, gana el más votado; si hay empate, al azar.
 */
export function pickComodin(
  state: EngineState,
  actor: PlayerId,
  level: number,
  kind: ComodinKind,
  rng: Rng,
  now: number,
): EngineResult {
  if (!isMember(state, actor)) return fail('NOT_MEMBER');
  if (state.status !== 'level_complete' || state.level !== level || !state.offer) return unchanged(state);
  if (!state.offer.choices.includes(kind)) return fail('INVALID_STATE');
  if (state.offer.votes[actor] === kind) return unchanged(state);
  const d = new Draft(state, now);
  d.s.offer!.votes[actor] = kind;
  if (allPicked(d.s)) {
    resolveOffer(d, rng);
    maybeAdvance(d, rng);
  }
  return d.commit();
}

/**
 * El jugador indica que está listo para el siguiente nivel. `level` es el nivel recién
 * superado: si no coincide (petición repetida o tardía) no se hace nada.
 * Si el anfitrión fuerza el avance con una elección de comodín pendiente, se decide con
 * los votos que haya (o al azar).
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
  if (force && actor === d.s.hostId) {
    while (d.s.offer) resolveOffer(d, rng);
    startNextLevel(d, rng);
  } else {
    maybeAdvance(d, rng);
  }
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
  if (d.s.offer) delete d.s.offer.votes[target];
  d.emit(reason === 'left' ? 'player_left' : 'player_kicked', target, { name: player.name, cards });

  if (d.s.players.length === 0) {
    d.s.status = 'abandoned';
    return d.commit();
  }
  if (d.s.hostId === target) {
    d.s.hostId = playersBySeat(d.s)[0]!.id;
    d.emit('host_changed', d.s.hostId, {});
  }
  if (d.s.vote) cancelVote(d, null, 'player_left', rng);
  if (d.s.status === 'playing' || d.s.status === 'level_complete') {
    if (d.s.players.length < MIN_PLAYERS) {
      endGame(d, 'abandoned');
    } else if (d.s.status === 'playing') {
      checkLevelEnd(d, rng);
    } else {
      if (allPicked(d.s)) resolveOffer(d, rng);
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
    rewinds: 0,
    shields: 0,
    shieldActive: false,
    livesCap: 0,
    shurikensCap: 0,
    hands: {},
    pile: [],
    revealed: [],
    vote: null,
    offer: null,
    lightningLevel: 0,
    lightningEndsAt: null,
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
      rewinds: state.rewinds,
      shields: state.shields,
      shieldActive: state.shieldActive,
      offer: structuredClone(state.offer),
      lightningLevel: state.lightningLevel,
      lightningEndsAt: state.lightningEndsAt,
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
