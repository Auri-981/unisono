/**
 * Amigos: lista, solicitudes e invitaciones. La verdad está en el servidor; aquí se guarda la
 * última respuesta.
 *
 * Mientras la app está abierta y visible se avisa al servidor cada 45 s («sigo aquí», con el alias
 * actual, que vive en el móvil) y se pide la lista. Además hay una señal de tiempo real por
 * jugador (player_signals): cuando alguien te escribe, te invita o te acepta, la lista se pide
 * al momento. Con la app cerrada no llega nada: las invitaciones no son notificaciones.
 */
import { useSyncExternalStore } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { cleanName } from '../game/engine';
import type { RoomSnapshot } from '../game/types';
import { api, ApiError, type FriendsState, type RoomInvite } from '../net/api';
import { ensureSession, getSupabase, onlineAvailable } from '../net/supabase';
import { getPrefs } from './prefs';

const TICK_MS = 45_000;

export interface FriendsStore {
  data: FriendsState | null;
  error: string | null;
  /** Diferencia con el reloj del servidor (para saber si una invitación ha caducado). */
  clockOffset: number;
}

let state: FriendsStore = { data: null, error: null, clockOffset: 0 };
const listeners = new Set<() => void>();

function set(patch: Partial<FriendsStore>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useFriends(): FriendsStore {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

const codeOf = (e: unknown) => (e instanceof ApiError ? e.code : 'NETWORK');

function accept(data: FriendsState) {
  const offset = Date.parse(data.serverTime) - Date.now();
  set({ data, error: null, clockOffset: Number.isFinite(offset) ? offset : state.clockOffset });
}

export function refreshFriends(): Promise<void> {
  if (!onlineAvailable || frozen) return Promise.resolve();
  return api.getFriends().then(accept, (e) => set({ error: codeOf(e) }));
}

/** Invitaciones que siguen vigentes (por si la última respuesta ya es antigua). */
export function liveInvites(store: FriendsStore): RoomInvite[] {
  const now = Date.now() + store.clockOffset;
  return (store.data?.invites ?? []).filter((i) => Date.parse(i.expiresAt) > now);
}

/** Lo que espera una respuesta tuya (el número del botón de Amigos). */
export function pendingCount(store: FriendsStore): number {
  return (store.data?.incoming.length ?? 0) + liveInvites(store).length;
}

let channel: RealtimeChannel | null = null;
let timer: number | null = null;

async function tick() {
  if (document.visibilityState !== 'visible') return;
  await api.touchPresence(cleanName(getPrefs().name) || null).catch(() => {});
  await refreshFriends();
}

const onVisible = () => void tick();

/** Empieza a escuchar (al tener sesión). Se llama de nuevo si cambia el jugador. */
export async function startFriends(): Promise<void> {
  if (!onlineAvailable) return;
  stopFriends();
  let uid: string;
  try {
    uid = await ensureSession();
  } catch {
    return;
  }
  const sb = getSupabase();
  channel = sb
    .channel(`player:${uid}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'player_signals', filter: `user_id=eq.${uid}` }, () => void refreshFriends())
    // Al reconectar se pueden haber perdido señales.
    .on('system', {}, (msg: { extension?: string; status?: string }) => {
      if (msg.extension === 'postgres_changes' && msg.status === 'ok') void refreshFriends();
    })
    .subscribe();
  timer = window.setInterval(() => void tick(), TICK_MS);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  void tick();
}

/** Deja de escuchar y olvida la lista (al cerrar sesión o borrar la cuenta). */
export function stopFriends() {
  if (channel) void getSupabase().removeChannel(channel);
  channel = null;
  if (timer !== null) window.clearInterval(timer);
  timer = null;
  document.removeEventListener('visibilitychange', onVisible);
  window.removeEventListener('focus', onVisible);
  set({ data: null, error: null });
}

async function run(call: () => Promise<FriendsState>): Promise<string | null> {
  if (frozen) return null;
  try {
    accept(await call());
    return null;
  } catch (e) {
    return codeOf(e);
  }
}

/** Añade con un código. Devuelve el error, o si ya sois amigos o queda la solicitud enviada. */
export async function addFriendByCode(code: string): Promise<{ error: string | null; result?: 'friends' | 'requested' }> {
  if (frozen) return { error: null, result: 'requested' };
  try {
    const res = await api.addFriend(code);
    accept(res);
    return { error: null, result: res.result };
  } catch (e) {
    return { error: codeOf(e) };
  }
}

export const addFriendFromRoom = (room: string, target: string) => run(() => api.addFriendFromRoom(room, target));
export const respondRequest = (from: string, accepted: boolean) => run(() => api.respondFriendRequest(from, accepted));
export const cancelRequest = (to: string) => run(() => api.cancelFriendRequest(to));
export const removeFriend = (friend: string) => run(() => api.removeFriend(friend));
export const declineInvite = (id: number) => run(() => api.declineInvite(id));

/** Invita a un amigo a la sala. Devuelve null si ha ido bien o el código de error. */
export async function inviteFriend(room: string, friend: string): Promise<string | null> {
  if (frozen) return null;
  try {
    await api.inviteFriend(room, friend);
    return null;
  } catch (e) {
    return codeOf(e);
  }
}

/** Nombre con el que se entra si no se elige otro. */
export const defaultName = () => cleanName(getPrefs().name) || 'Jugador';

/** Entra en la sala de la invitación (si el nombre ya está en la sala, la invitación sigue viva). */
export async function acceptInvite(id: number, name = defaultName()): Promise<{ snapshot?: RoomSnapshot; error?: string }> {
  if (frozen) return name === defaultName() ? { error: 'NAME_TAKEN' } : {};
  try {
    const snapshot = await api.acceptInvite(id, name);
    void refreshFriends();
    return { snapshot };
  } catch (e) {
    void refreshFriends();
    return { error: codeOf(e) };
  }
}

// ── Solo para las pantallas de ejemplo de desarrollo (src/dev/Preview.tsx) ──
let frozen = false;

export function previewFriends(data: FriendsState) {
  frozen = true;
  set({ data, error: null, clockOffset: 0 });
}
