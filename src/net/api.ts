/**
 * Llamadas a las funciones del servidor (RPC de Supabase), con tiempo límite,
 * reintentos seguros y errores traducidos a códigos del juego.
 */
import { isGameErrorCode, type ComodinKind, type Rarity, type RoomConfig, type RoomSnapshot } from '../game/types';
import { ensureSession, getSupabase } from './supabase';

const TIMEOUT_MS = 8000;

export class ApiError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function toCode(err: unknown): string {
  const msg = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : '';
  if (isGameErrorCode(msg) || msg === 'ANON_DISABLED' || msg === 'NOT_CONFIGURED') return msg;
  return 'NETWORK';
}

async function rpcOnce<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  await ensureSession();
  const { data, error } = await getSupabase().rpc(fn, args).abortSignal(AbortSignal.timeout(TIMEOUT_MS));
  if (error) throw new ApiError(toCode(error));
  if (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string') {
    throw new ApiError((data as { error: string }).error);
  }
  return data as T;
}

/**
 * `retries` solo debe usarse en llamadas idempotentes (lecturas, o acciones con action_id):
 * así un fallo de red no puede aplicar una jugada dos veces.
 */
async function rpc<T>(fn: string, args: Record<string, unknown>, retries = 0): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rpcOnce<T>(fn, args);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : toCode(e);
      if (code !== 'NETWORK' || attempt >= retries) throw new ApiError(code);
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
}

export type CosmeticKind = 'card_design' | 'title';

/** Cosmético del catálogo (lo que se vende, lo que se consigue con logros y lo que ya se posee). */
export interface CatalogItem {
  id: string;
  kind: CosmeticKind;
  name: string;
  description: string;
  /** Precio en monedas (null: no se compra, p. ej. el clásico o los de logros). */
  price: number | null;
  unlock: 'default' | 'coins' | 'achievement' | 'event';
  /** Opcional en perfiles guardados de versiones anteriores. */
  rarity?: Rarity;
  available: boolean;
  /** Logro que lo da (solo los que se consiguen con logros). */
  achievement?: string | null;
}

export type AchievementCategory = 'games' | 'wins' | 'progress' | 'skill' | 'team' | 'special';

/** Logro con el progreso del jugador (todo lo calcula el servidor). */
export interface Achievement {
  id: string;
  category: AchievementCategory;
  name: string;
  description: string;
  /** Qué hay que hacer, en una frase. */
  condition: string;
  target: number;
  /** Progreso (récord en las rachas), como mucho `target`. */
  progress: number;
  /** Racha en curso (solo en los logros de racha; null en los demás). */
  streak: number | null;
  rewardCoins: number;
  rewardCosmetics: string[];
  unlockedAt: string | null;
  secret: boolean;
}

export interface PlayerStats {
  games: number;
  wins: number;
  levels: number;
  bestWinStreak: number;
  bestCleanStreak: number;
}

/** Números de las recompensas (los decide el servidor: game_private.reward_settings). */
export interface RewardSettings {
  perLevel: number;
  cardsPerCoin: number;
  participation: number;
  victoryCardsPerCoin: number;
  minCardsPlayed: number;
}

export interface Profile {
  coins: number;
  /** Equipado por tipo: { card_design: 'galaxy', title: 'title_legend' } (sin `title`: ninguno). */
  equipped: Record<string, string>;
  owned: string[];
  /** Cómo se consiguió cada cosmético: default, purchase, achievement… (opcional: perfiles antiguos). */
  sources?: Record<string, string>;
  catalog: CatalogItem[];
  rewards: RewardSettings;
  stats?: PlayerStats;
  achievements?: Achievement[];
  /** Logros conseguidos que aún no se han enseñado (en orden). */
  unseen?: string[];
}

export interface CoinMovement {
  amount: number;
  balanceAfter: number;
  kind: 'match_reward' | 'purchase' | 'adjustment' | 'achievement';
  reason: string;
  cosmeticId: string | null;
  at: string;
}

const newActionId = () => crypto.randomUUID();

export const api = {
  createRoom: (name: string, config: RoomConfig) => rpc<RoomSnapshot>('create_room', { p_name: name, p_config: config }),
  joinRoom: (code: string, name: string) => rpc<RoomSnapshot>('join_room', { p_code: code, p_name: name }, 1),
  getState: (room: string) => rpc<RoomSnapshot>('get_room_state', { p_room: room }, 2),
  updateConfig: (room: string, config: RoomConfig) => rpc<RoomSnapshot>('update_config', { p_room: room, p_config: config }, 1),
  setLobbyReady: (room: string, ready: boolean) => rpc<RoomSnapshot>('set_lobby_ready', { p_room: room, p_ready: ready }, 1),
  startGame: (room: string) => rpc<RoomSnapshot>('start_game', { p_room: room }),
  playCard: (room: string, card: number) =>
    rpc<RoomSnapshot>('play_card', { p_room: room, p_card: card, p_action: newActionId() }, 2),
  proposeShuriken: (room: string) => rpc<RoomSnapshot>('propose_shuriken', { p_room: room, p_action: newActionId() }, 2),
  proposeShield: (room: string) => rpc<RoomSnapshot>('propose_shield', { p_room: room, p_action: newActionId() }, 2),
  pickComodin: (room: string, level: number, kind: ComodinKind) =>
    rpc<RoomSnapshot>('pick_comodin', { p_room: room, p_level: level, p_kind: kind }, 1),
  voteShuriken: (room: string, accept: boolean) => rpc<RoomSnapshot>('vote_shuriken', { p_room: room, p_accept: accept }, 1),
  expireVote: (room: string) => rpc<RoomSnapshot>('expire_shuriken_vote', { p_room: room }, 1),
  readyNextLevel: (room: string, level: number, force: boolean) =>
    rpc<RoomSnapshot>('ready_next_level', { p_room: room, p_level: level, p_force: force }, 1),
  leaveRoom: (room: string) => rpc<{ left: boolean }>('leave_room', { p_room: room }),
  kick: (room: string, target: string) => rpc<RoomSnapshot>('kick_player', { p_room: room, p_target: target }),
  rematch: (room: string) => rpc<RoomSnapshot>('rematch', { p_room: room }),
  heartbeat: (room: string) => rpc<{ version: number }>('heartbeat', { p_room: room }),
  sendChat: (room: string, body: string) => rpc<{ ok: boolean }>('send_chat', { p_room: room, p_body: body }),
  /** Perfil de la economía: saldo, lo equipado, lo que se posee y el catálogo. */
  getProfile: () => rpc<Profile>('get_my_profile', {}, 2),
  /** Compra (todo o nada en el servidor). Sin reintentos automáticos: el usuario decide. */
  buyCosmetic: (id: string) => rpc<Profile>('buy_cosmetic', { p_cosmetic: id }),
  equipCosmetic: (id: string) => rpc<Profile>('equip_cosmetic', { p_cosmetic: id }, 1),
  /** Quita el título equipado (solo los títulos se pueden quitar). */
  unequipCosmetic: (kind: CosmeticKind) => rpc<Profile>('unequip_cosmetic', { p_kind: kind }, 1),
  /** Los avisos de estos logros ya se han enseñado. */
  markAchievementsSeen: (ids: string[]) => rpc<Profile>('mark_achievements_seen', { p_ids: ids }, 1),
  coinHistory: () => rpc<CoinMovement[]>('get_my_coin_history', {}, 1),
  history: () =>
    rpc<{
      stats: { played: number; won: number; bestLevel: number };
      games: { result: 'won' | 'lost' | 'abandoned'; level: number; maxLevel: number; players: string[]; finishedAt: string }[];
    }>('get_my_history', {}, 1),
};
