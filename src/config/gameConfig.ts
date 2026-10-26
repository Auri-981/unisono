/**
 * Configuración central del juego.
 *
 * IMPORTANTE: el servidor tiene un espejo de estas reglas en SQL
 * (funciones `game_private.preset`, `game_private.normalize_config`, `game_private.reward_for`).
 * La prueba `tests/integration/conformance.test.ts` comprueba que ambos coinciden.
 */
import type { Difficulty, Reward, RoomConfig } from '../game/types';

export const DECK_SIZE = 100;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

export const NAME_MAX_LENGTH = 20;
export const CHAT_MAX_LENGTH = 200;

/** Segundos que dura una votación de vistazo o escudo. */
export const SHURIKEN_VOTE_SECONDS = 15;
/** Segundos para decidir si se usa Rebobinar tras perder una vida. */
export const REWIND_VOTE_SECONDS = 20;
/** Cada cuántos segundos un móvil avisa de que sigue conectado. */
export const HEARTBEAT_SECONDS = 15;
/** Si el anfitrión no da señales en este tiempo, el rol pasa a otro jugador. */
export const HOST_STALE_SECONDS = 45;

export interface PlayerPreset {
  levels: number;
  lives: number;
  shurikens: number;
}

/** Configuración clásica según el número de jugadores. */
export const PLAYER_PRESETS: Record<number, PlayerPreset> = {
  2: { levels: 12, lives: 2, shurikens: 1 },
  3: { levels: 10, lives: 3, shurikens: 1 },
  4: { levels: 8, lives: 4, shurikens: 1 },
};

/**
 * Recompensas clásicas (2 ★, 3 ♥, 5 ★, 6 ♥, 8 ★, 9 ♥) con máximo 5 vidas y 3 de cada comodín.
 * ★ = un comodín a elegir entre 2 de los 3 (Vistazo, Rebobinar, Escudo).
 * Basadas en el juego original, donde ★ era siempre un shuriken.
 */
export const CLASSIC_REWARDS: Reward[] = [
  { level: 2, lives: 0, shurikens: 1 },
  { level: 3, lives: 1, shurikens: 0 },
  { level: 5, lives: 0, shurikens: 1 },
  { level: 6, lives: 1, shurikens: 0 },
  { level: 8, lives: 0, shurikens: 1 },
  { level: 9, lives: 1, shurikens: 0 },
];

/**
 * Recompensas «clásicas» en dificultad difícil: la mitad y más espaciadas (3 ★, 6 ♥, 9 ★).
 * Diseño propio de Unísono, no forma parte del juego original.
 */
export const HARD_REWARDS: Reward[] = [
  { level: 3, lives: 0, shurikens: 1 },
  { level: 6, lives: 1, shurikens: 0 },
  { level: 9, lives: 0, shurikens: 1 },
];

export const DEFAULT_CUSTOM_REWARDS: Reward[] = [
  { level: 2, lives: 0, shurikens: 1 },
  { level: 3, lives: 1, shurikens: 0 },
  { level: 5, lives: 0, shurikens: 1 },
  { level: 6, lives: 1, shurikens: 0 },
];

export const CONFIG_LIMITS = {
  levels: { min: 0, max: 12 },
  maxLives: { min: 1, max: 10 },
  maxShurikens: { min: 0, max: 10 },
  rewardLevel: { min: 1, max: 12 },
  rewardAmount: { min: 0, max: 3 },
  maxRewardRows: 20,
} as const;

export const DEFAULT_CONFIG: RoomConfig = {
  maxPlayers: 4,
  levels: 0,
  order: 'asc',
  mode: 'concentration',
  shurikenVariant: 'classic',
  rewardPreset: 'classic',
  customRewards: DEFAULT_CUSTOM_REWARDS,
  maxLives: 5,
  maxShurikens: 3,
  difficulty: 'classic',
  countdown: true,
};

function intIn(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Limpia una configuración que llega del exterior. Nunca lanza errores: usa valores por defecto. */
export function normalizeConfig(input: unknown): RoomConfig {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const d = DEFAULT_CONFIG;

  let customRewards: Reward[] = d.customRewards;
  if (Array.isArray(raw.customRewards)) {
    const seen = new Set<number>();
    customRewards = [];
    for (const row of raw.customRewards.slice(0, CONFIG_LIMITS.maxRewardRows)) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      if (typeof r.level !== 'number' || !Number.isFinite(r.level)) continue;
      const level = intIn(r.level, 1, CONFIG_LIMITS.rewardLevel.min, CONFIG_LIMITS.rewardLevel.max);
      if (seen.has(level)) continue;
      seen.add(level);
      const lives = intIn(r.lives, 0, CONFIG_LIMITS.rewardAmount.min, CONFIG_LIMITS.rewardAmount.max);
      const shurikens = intIn(r.shurikens, 0, CONFIG_LIMITS.rewardAmount.min, CONFIG_LIMITS.rewardAmount.max);
      if (lives === 0 && shurikens === 0) continue;
      customRewards.push({ level, lives, shurikens });
    }
    customRewards.sort((a, b) => a.level - b.level);
  }

  return {
    maxPlayers: intIn(raw.maxPlayers, d.maxPlayers, MIN_PLAYERS, MAX_PLAYERS),
    levels: intIn(raw.levels, d.levels, CONFIG_LIMITS.levels.min, CONFIG_LIMITS.levels.max),
    order: oneOf(raw.order, ['asc', 'desc'] as const, d.order),
    mode: oneOf(raw.mode, ['concentration', 'friends'] as const, d.mode),
    shurikenVariant: oneOf(raw.shurikenVariant, ['classic', 'reveal'] as const, d.shurikenVariant),
    rewardPreset: oneOf(raw.rewardPreset, ['classic', 'custom', 'none'] as const, d.rewardPreset),
    customRewards,
    maxLives: intIn(raw.maxLives, d.maxLives, CONFIG_LIMITS.maxLives.min, CONFIG_LIMITS.maxLives.max),
    maxShurikens: intIn(raw.maxShurikens, d.maxShurikens, CONFIG_LIMITS.maxShurikens.min, CONFIG_LIMITS.maxShurikens.max),
    difficulty: oneOf(raw.difficulty, ['easy', 'classic', 'hard'] as const, d.difficulty),
    countdown: typeof raw.countdown === 'boolean' ? raw.countdown : d.countdown,
  };
}

export function presetFor(playerCount: number): PlayerPreset {
  const n = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, playerCount));
  return PLAYER_PRESETS[n]!;
}

/**
 * Recursos iniciales por dificultad:
 * - fácil: los clásicos +1 vida y +1 shuriken;
 * - clásica: los del juego (vidas = jugadores, 1 shuriken);
 * - difícil: 1 sola vida y ningún shuriken, sea cual sea el número de jugadores.
 */
function startingLivesAndShurikens(difficulty: Difficulty, preset: PlayerPreset): { lives: number; shurikens: number } {
  switch (difficulty) {
    case 'easy':
      return { lives: preset.lives + 1, shurikens: preset.shurikens + 1 };
    case 'classic':
      return { lives: preset.lives, shurikens: preset.shurikens };
    case 'hard':
      return { lives: 1, shurikens: 0 };
  }
}

export interface StartingResources {
  maxLevel: number;
  lives: number;
  shurikens: number;
  /** Máximos que las recompensas no pueden superar (nunca por debajo de lo inicial). */
  livesCap: number;
  shurikensCap: number;
}

/**
 * Niveles que se jugarán: los elegidos, pero nunca más de los que permite el número de
 * jugadores (12 / 10 / 8). 0 = todos.
 */
export function levelsToPlay(config: RoomConfig, playerCount: number): number {
  const max = presetFor(playerCount).levels;
  return config.levels >= 1 ? Math.min(config.levels, max) : max;
}

export function startingResources(config: RoomConfig, playerCount: number): StartingResources {
  const { lives, shurikens } = startingLivesAndShurikens(config.difficulty, presetFor(playerCount));
  return {
    maxLevel: levelsToPlay(config, playerCount),
    lives,
    shurikens,
    livesCap: Math.max(config.maxLives, lives),
    shurikensCap: Math.max(config.maxShurikens, shurikens),
  };
}

export function rewardTable(config: RoomConfig): Reward[] {
  switch (config.rewardPreset) {
    case 'classic':
      // En difícil, la tabla «clásica» da menos premios y más espaciados.
      return config.difficulty === 'hard' ? HARD_REWARDS : CLASSIC_REWARDS;
    case 'custom':
      return config.customRewards;
    case 'none':
      return [];
  }
}

/** Recompensa por superar `level` (sin aplicar límites). */
export function rewardFor(config: RoomConfig, level: number): { lives: number; shurikens: number } {
  const row = rewardTable(config).find((r) => r.level === level);
  return { lives: row?.lives ?? 0, shurikens: row?.shurikens ?? 0 };
}
