/**
 * Cuenta del jugador. Todos empiezan como invitados (sesión anónima, guardada solo en este
 * navegador); con «Continuar con Google» su progreso pasa a una cuenta que se abre en cualquier móvil.
 *
 * Cómo se hace sin perder nada (el servidor lo explica junto a la tabla account_merges):
 *   1. Antes de ir a Google, el invitado pide un vale de un solo uso y se guarda aquí.
 *   2. Google vuelve a la app con un código y supabase-js lo canjea por la sesión de la cuenta.
 *   3. Ya con la cuenta se canjea el vale: el progreso del invitado se une al de la cuenta.
 * Funciona igual si la cuenta es nueva (primer móvil) o si ya tenía progreso (otro móvil).
 */
import { useSyncExternalStore } from 'react';
import type { Session } from '@supabase/supabase-js';
import { api, ApiError, type MergeSummary } from '../net/api';
import { dropSession, ensureSession, getSupabase, googleEnabled, onlineAvailable } from '../net/supabase';
import { startFriends, stopFriends } from './friends';
import { getPrefs, setPrefs } from './prefs';
import { acceptProfile, forgetProfile, refreshProfile } from './profile';

export type AccountNotice =
  | { kind: 'signedIn'; merged: MergeSummary | null }
  | { kind: 'cancelled' }
  /** detail: el motivo técnico (lo que devuelven Google o Supabase), para poder arreglarlo. */
  | { kind: 'failed'; detail: string | null }
  | { kind: 'signedOut' }
  | { kind: 'deleted' };

export interface AccountState {
  /** unknown: todavía cargando la sesión. */
  kind: 'unknown' | 'guest' | 'google';
  email: string | null;
  /** ¿Está activado el inicio de sesión con Google en el servidor? (null: aún no se sabe). */
  googleReady: boolean | null;
  busy: boolean;
  /** Lo que hay que contar al volver de Google, al cerrar sesión o al borrar la cuenta. */
  notice: AccountNotice | null;
}

const PENDING_KEY = 'unisono.merge';
const UID_KEY = 'unisono.uid';
const NUDGE_KEY = 'unisono.saveNudge';
/** El vale caduca en el servidor a la hora. */
const PENDING_MS = 60 * 60 * 1000;

let state: AccountState = { kind: 'unknown', email: null, googleReady: null, busy: false, notice: null };
const listeners = new Set<() => void>();

function set(patch: Partial<AccountState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useAccount(): AccountState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export function clearAccountNotice() {
  set({ notice: null });
}

function storage<T>(key: string, value?: T | null): T | null {
  try {
    if (value === undefined) {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    }
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sin almacenamiento: sin vale guardado, el progreso del invitado se queda en el invitado.
  }
  return null;
}

interface Pending {
  token: string;
  at: number;
}

const readPending = () => {
  const p = storage<Pending>(PENDING_KEY);
  return p && Date.now() - p.at < PENDING_MS ? p : null;
};

function fromSession(session: Session | null) {
  const user = session?.user;
  if (!user) return;
  const google = !user.is_anonymous;
  set({ kind: google ? 'google' : 'guest', email: google ? (user.email ?? null) : null });
  // Con la cuenta recién abierta y sin alias en este móvil, se propone su nombre de pila.
  if (google && !getPrefs().name.trim()) {
    const meta = user.user_metadata as { given_name?: string; full_name?: string; name?: string } | undefined;
    const first = (meta?.given_name || meta?.full_name || meta?.name || '').trim().split(/\s+/)[0] ?? '';
    if (first) setPrefs({ name: first.slice(0, 20) });
  }
}

/** ¿Vuelve de Google? Se mira antes de que supabase-js limpie la dirección. */
function readReturn(): { kind: 'none' | 'code' | 'error'; error: string | null; detail: string | null } {
  try {
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const get = (k: string) => query.get(k) ?? hash.get(k);
    const error = get('error');
    if (error) return { kind: 'error', error, detail: [get('error_code'), get('error_description')].filter(Boolean).join(': ') || error };
    return { kind: query.has('code') ? 'code' : 'none', error: null, detail: null };
  } catch {
    return { kind: 'none', error: null, detail: null };
  }
}

/** Quita de la dirección lo que deja Google (para que recargar no lo repita). */
function cleanUrl() {
  try {
    const url = new URL(window.location.href);
    for (const k of ['code', 'error', 'error_code', 'error_description', 'state']) url.searchParams.delete(k);
    if (/error|access_token/.test(url.hash)) url.hash = '';
    window.history.replaceState(window.history.state, '', url.toString());
  } catch {
    // Sin History API: se queda como está.
  }
}

const anything = (m: MergeSummary) => m.coins > 0 || m.cards > 0 || m.titles > 0 || m.achievements > 0 || m.games > 0;

/** Canjea el vale pendiente (ya con la cuenta abierta). */
async function claim(pending: Pending) {
  try {
    const res = await api.claimAccountMerge(pending.token);
    storage(PENDING_KEY, null);
    acceptProfile(res.profile);
    set({ notice: { kind: 'signedIn', merged: anything(res.merged) ? res.merged : null } });
  } catch (e) {
    const code = e instanceof ApiError ? e.code : 'NETWORK';
    // Sin red se reintenta la próxima vez que se abra la app (el vale dura una hora).
    if (code !== 'NETWORK') storage(PENDING_KEY, null);
    set({ notice: { kind: 'signedIn', merged: null } });
    void refreshProfile();
  }
}

/** Al abrir la app: prepara la sesión y, si vuelve de Google, termina de iniciar sesión. */
export async function initAccount(): Promise<void> {
  if (!onlineAvailable) return;
  const back = readReturn();
  const sb = getSupabase();
  // Si el canje del código de Google falla, supabase-js lo devuelve aquí (y deja la sesión de invitado).
  const started = sb.auth.initialize();
  sb.auth.onAuthStateChange((_event, session) => fromSession(session));
  void googleEnabled().then(
    (googleReady) => set({ googleReady }),
    () => set({ googleReady: false }),
  );
  let uid: string;
  try {
    uid = await ensureSession();
  } catch {
    return;
  }
  fromSession((await sb.auth.getSession()).data.session);
  cleanUrl();
  // Otro jugador en este navegador (inicio o cierre de sesión): el perfil guardado ya no es suyo.
  if (storage<string>(UID_KEY) !== uid) {
    forgetProfile();
    storage(UID_KEY, uid);
  }

  const pending = readPending();
  if (state.kind === 'google') {
    if (pending) await claim(pending);
    else if (back.kind === 'code') set({ notice: { kind: 'signedIn', merged: null } });
    // Después de unir: los amigos del invitado ya están en la cuenta.
    void startFriends();
    return;
  }
  void startFriends();
  if (back.kind === 'error') {
    storage(PENDING_KEY, null);
    set({ notice: back.error === 'access_denied' ? { kind: 'cancelled' } : { kind: 'failed', detail: back.detail } });
  } else if (back.kind === 'code') {
    storage(PENDING_KEY, null);
    const { error } = await started;
    set({ notice: { kind: 'failed', detail: error?.message ?? 'no_session_after_code' } });
  }
}

/** «Continuar con Google»: si todo va bien, la página se va a Google y vuelve ya con la cuenta. */
export async function signInWithGoogle(): Promise<string | null> {
  if (state.busy) return null;
  set({ busy: true });
  try {
    await ensureSession();
    if (state.kind === 'guest') {
      const { token } = await api.startAccountMerge();
      storage<Pending>(PENDING_KEY, { token, at: Date.now() });
    }
    const { error } = await getSupabase().auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + window.location.pathname,
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) throw error;
    return null;
  } catch (e) {
    set({ busy: false });
    return e instanceof ApiError ? e.code : 'NETWORK';
  }
}

/** Vuelve a un invitado nuevo en este navegador (tras cerrar sesión o borrar la cuenta). */
async function startOver(notice: AccountNotice) {
  stopFriends();
  await dropSession().catch(() => {});
  storage(PENDING_KEY, null);
  forgetProfile();
  set({ kind: 'unknown', email: null });
  try {
    const uid = await ensureSession();
    storage(UID_KEY, uid);
    fromSession((await getSupabase().auth.getSession()).data.session);
  } catch {
    // Sin red: se creará el invitado al volver a intentarlo.
  }
  void refreshProfile();
  void startFriends();
  set({ busy: false, notice });
}

/** Cierra la sesión de la cuenta en este móvil (el progreso sigue en la cuenta). */
export async function signOut(): Promise<void> {
  if (state.busy) return;
  set({ busy: true });
  await startOver({ kind: 'signedOut' });
}

/** Borra al jugador y todo su progreso. Devuelve null si ha ido bien o el código de error. */
export async function deleteAccount(): Promise<string | null> {
  if (state.busy) return null;
  set({ busy: true });
  try {
    await api.deleteMyAccount();
  } catch (e) {
    set({ busy: false });
    return e instanceof ApiError ? e.code : 'NETWORK';
  }
  await startOver({ kind: 'deleted' });
  return null;
}

/** Aviso en el inicio para guardar el progreso: se puede cerrar y no vuelve en dos semanas. */
const NUDGE_PAUSE_MS = 14 * 24 * 60 * 60 * 1000;

export function nudgeDismissed(): boolean {
  const at = storage<number>(NUDGE_KEY);
  return at !== null && Date.now() - at < NUDGE_PAUSE_MS;
}

export function dismissNudge() {
  storage(NUDGE_KEY, Date.now());
}

// ── Solo para las pantallas de ejemplo de desarrollo (src/dev/Preview.tsx) ──
export function previewAccount(patch: Partial<AccountState>) {
  set(patch);
}
