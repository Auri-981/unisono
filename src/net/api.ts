/**
 * Llamadas a las funciones del servidor (RPC de Supabase), con tiempo límite,
 * reintentos seguros y errores traducidos a códigos del juego.
 */
import { isGameErrorCode, type RoomConfig, type RoomSnapshot } from '../game/types';
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
  voteShuriken: (room: string, accept: boolean) => rpc<RoomSnapshot>('vote_shuriken', { p_room: room, p_accept: accept }, 1),
  expireVote: (room: string) => rpc<RoomSnapshot>('expire_shuriken_vote', { p_room: room }, 1),
  readyNextLevel: (room: string, level: number, force: boolean) =>
    rpc<RoomSnapshot>('ready_next_level', { p_room: room, p_level: level, p_force: force }, 1),
  leaveRoom: (room: string) => rpc<{ left: boolean }>('leave_room', { p_room: room }),
  kick: (room: string, target: string) => rpc<RoomSnapshot>('kick_player', { p_room: room, p_target: target }),
  rematch: (room: string) => rpc<RoomSnapshot>('rematch', { p_room: room }),
  heartbeat: (room: string) => rpc<{ version: number }>('heartbeat', { p_room: room }),
  sendChat: (room: string, body: string) => rpc<{ ok: boolean }>('send_chat', { p_room: room, p_body: body }),
  history: () =>
    rpc<{
      stats: { played: number; won: number; bestLevel: number };
      games: { result: 'won' | 'lost' | 'abandoned'; level: number; maxLevel: number; players: string[]; finishedAt: string }[];
    }>('get_my_history', {}, 1),
};
