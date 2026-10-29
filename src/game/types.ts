/**
 * Tipos compartidos por el motor de reglas, el modo práctica, la capa de red y la interfaz.
 * La forma de `RoomSnapshot` coincide exactamente con lo que devuelve la función SQL
 * `get_room_state` (ver supabase/migrations).
 */

export type PlayerId = string;

export type RoomStatus = 'lobby' | 'playing' | 'level_complete' | 'won' | 'lost' | 'abandoned';

export type GameMode = 'concentration' | 'friends';
export type RewardPreset = 'classic' | 'custom' | 'none';
export type Difficulty = 'easy' | 'classic' | 'hard';
/** Orden en que se juegan las cartas: de 1 a 100 (clásico) o de 100 a 1. */
export type CardOrder = 'asc' | 'desc';

export interface Reward {
  /** Nivel que hay que superar para recibir la recompensa. */
  level: number;
  lives: number;
  /** Comodines a elegir (nombre histórico: antes solo existía el vistazo / shuriken). */
  shurikens: number;
}

/**
 * Comodines. En el código el vistazo se llama «shuriken» por motivos históricos.
 * - shuriken (Vistazo): cada uno descarta la carta que le toca.
 * - rewind (Rebobinar): se ofrece al perder una vida y la devuelve.
 * - shield (Escudo): el siguiente error del nivel no cuesta vida.
 */
export type ComodinKind = 'shuriken' | 'rewind' | 'shield';
export const COMODIN_KINDS: readonly ComodinKind[] = ['shuriken', 'rewind', 'shield'];

export interface RoomConfig {
  maxPlayers: number;
  /** Niveles a jugar. 0 = todos los que permite el número de jugadores (nunca más). */
  levels: number;
  order: CardOrder;
  mode: GameMode;
  rewardPreset: RewardPreset;
  customRewards: Reward[];
  maxLives: number;
  maxShurikens: number;
  difficulty: Difficulty;
  countdown: boolean;
}

/** Carta jugada sobre la mesa: `c` = valor, `p` = jugador. */
export interface PlayedCard {
  c: number;
  p: PlayerId;
}

/** Carta descartada y visible para todos (por error o por shuriken en variante revelación). */
export interface RevealedCard {
  c: number;
  p: PlayerId;
  r: 'mistake' | 'shuriken';
}

export interface ShurikenVote {
  /** Qué comodín se vota. Ausente en servidores antiguos = vistazo. */
  kind?: ComodinKind;
  /** Quién lo propuso. null en Rebobinar: lo propone el juego al perder una vida. */
  proposer: PlayerId | null;
  votes: PlayerId[];
  /** Fecha ISO del servidor en la que caduca la votación. */
  expiresAt: string;
}

export type GameEventKind =
  | 'player_joined'
  | 'player_left'
  | 'player_kicked'
  | 'host_changed'
  | 'game_start'
  | 'level_start'
  | 'play'
  | 'mistake'
  | 'shuriken_proposed'
  | 'shuriken_used'
  | 'shuriken_cancelled'
  | 'shield_used'
  | 'rewind_offered'
  | 'rewind_used'
  | 'comodin_chosen'
  | 'lightning_timeout'
  | 'level_complete'
  | 'won'
  | 'lost'
  | 'abandoned'
  | 'rematch';

export interface GameEvent {
  seq: number;
  kind: GameEventKind;
  actor: PlayerId | null;
  payload: Record<string, unknown>;
  at: string;
}

/** Cartas descartadas en un error (son públicas por las reglas del juego). */
export interface MistakePayload {
  card: number;
  discarded: PlayedCard[];
  lives: number;
  /** Un escudo activo ha evitado perder la vida. */
  shielded?: boolean;
}

export interface ShurikenUsedPayload {
  /** Las cartas descartadas se muestran siempre a todos. */
  discarded: { p: PlayerId; c: number }[];
}

export interface LevelReward {
  level: number;
  lives: number;
  shurikens: number;
  /** Comodines elegidos al superar el nivel (opcionales: servidores antiguos). */
  rewinds?: number;
  shields?: number;
}

/**
 * Elección de comodín pendiente al superar un nivel: se ofrecen 2 de los 3 al azar y cada
 * jugador vota uno. Cuando han votado todos, gana el más votado (empate: al azar).
 */
export interface ComodinOffer {
  choices: ComodinKind[];
  /** Elecciones que quedan (incluida esta). */
  left: number;
  /** Voto de cada jugador. */
  votes: Record<PlayerId, ComodinKind>;
}

export interface PublicPlayer {
  id: PlayerId;
  name: string;
  seat: number;
  ready: boolean;
  lastSeenAt: string;
  cardsLeft: number;
}

export interface PublicRoom {
  id: string;
  code: string;
  status: RoomStatus;
  hostId: PlayerId;
  config: RoomConfig;
  gameNo: number;
  level: number;
  maxLevel: number;
  lives: number;
  shurikens: number;
  /** Comodines Rebobinar y Escudo, y si hay un escudo activo en este nivel (opcionales: servidores antiguos). */
  rewinds?: number;
  shields?: number;
  shieldActive?: boolean;
  /** Elección de comodín pendiente (solo en «nivel superado»). */
  offer?: ComodinOffer | null;
  /**
   * Ronda relámpago: nivel en que toca (0 = ninguno) y hora límite para terminarlo
   * (solo mientras se juega ese nivel). Opcionales: servidores antiguos.
   */
  lightningLevel?: number;
  lightningEndsAt?: string | null;
  version: number;
  /** Quién no puede proponer shuriken hasta que se juegue una carta (opcional: servidores antiguos). */
  shurikenBlocked?: PlayerId[];
}

/** Lo que un jugador concreto puede saber de la partida. */
export interface RoomSnapshot {
  serverTime: string;
  me: PlayerId;
  room: PublicRoom;
  players: PublicPlayer[];
  pile: PlayedCard[];
  revealed: RevealedCard[];
  vote: ShurikenVote | null;
  lastEvent: GameEvent | null;
  /**
   * Últimos eventos de la sala (hasta 8, en orden). Una acción puede generar varios
   * (p. ej. «error» + «nivel superado») y la interfaz necesita verlos todos.
   * Opcional: servidores con la migración anterior no lo envían.
   */
  recentEvents?: GameEvent[];
  lastReward: LevelReward | null;
  /** Solo las cartas de `me`, ordenadas de menor a mayor. */
  myHand: number[];
}

/** Códigos de error compartidos por el motor TS y las funciones SQL. */
export const GAME_ERROR_CODES = [
  'NOT_AUTHENTICATED',
  'ROOM_NOT_FOUND',
  'NOT_MEMBER',
  'NOT_HOST',
  'GAME_IN_PROGRESS',
  'ROOM_FULL',
  'NOT_ENOUGH_PLAYERS',
  'NOT_ALL_READY',
  'NOT_IN_LOBBY',
  'NOT_PLAYING',
  'NOT_IN_HAND',
  'NOT_LOWEST',
  'NO_CARDS',
  'VOTE_IN_PROGRESS',
  'NO_VOTE',
  'NO_SHURIKENS',
  'SHURIKEN_BLOCKED',
  'NO_SHIELDS',
  'SHIELD_ACTIVE',
  'NO_OFFER',
  'INVALID_NAME',
  'INVALID_MESSAGE',
  'CHAT_DISABLED',
  'TOO_FAST',
  'TOO_MANY_ROOMS',
  'TOO_MANY_ATTEMPTS',
  'CANNOT_KICK_SELF',
  'INVALID_STATE',
] as const;

export type GameErrorCode = (typeof GAME_ERROR_CODES)[number];

export function isGameErrorCode(value: unknown): value is GameErrorCode {
  return typeof value === 'string' && (GAME_ERROR_CODES as readonly string[]).includes(value);
}
