/**
 * Perfil de la economía (monedas y cosméticos) compartido por toda la app.
 * La verdad está en el servidor: aquí solo se guarda la última respuesta, para pintarla al
 * instante (y para que la práctica, sin servidor, use el diseño equipado). Nunca se suman
 * monedas en el cliente: tras cada compra, equipamiento o partida se usa lo que devuelve el servidor.
 */
import { useSyncExternalStore } from 'react';
import { api, ApiError, type Profile } from '../net/api';
import { onlineAvailable } from '../net/supabase';

export interface ProfileState {
  profile: Profile | null;
  loading: boolean;
  error: string | null;
}

const CACHE_KEY = 'unisono.profile';

function readCache(): Profile | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Profile) : null;
  } catch {
    return null;
  }
}

function writeCache(profile: Profile) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(profile));
  } catch {
    // Sin almacenamiento: se vuelve a pedir al servidor la próxima vez.
  }
}

let state: ProfileState = { profile: onlineAvailable ? readCache() : null, loading: false, error: null };
const listeners = new Set<() => void>();

function set(patch: Partial<ProfileState>) {
  state = { ...state, ...patch };
  if (patch.profile) writeCache(patch.profile);
  listeners.forEach((l) => l());
}

export function useProfile(): ProfileState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

const codeOf = (e: unknown) => (e instanceof ApiError ? e.code : 'NETWORK');

let inFlight: Promise<void> | null = null;

/** Pide el perfil al servidor (una sola petición a la vez). */
export function refreshProfile(): Promise<void> {
  if (!onlineAvailable || frozen) return Promise.resolve();
  if (!inFlight) {
    set({ loading: true, error: null });
    inFlight = api
      .getProfile()
      .then(
        (profile) => set({ profile, loading: false }),
        (e) => set({ loading: false, error: codeOf(e) }),
      )
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** Compra un cosmético. Devuelve null si ha ido bien o el código de error. */
export async function buyCosmetic(id: string): Promise<string | null> {
  if (frozen) return simulate((p) => {
    const price = p.catalog.find((c) => c.id === id)?.price ?? 0;
    if (p.coins < price) return 'NOT_ENOUGH_COINS';
    return { ...p, coins: p.coins - price, owned: [...p.owned, id] };
  });
  try {
    set({ profile: await api.buyCosmetic(id) });
    return null;
  } catch (e) {
    const code = codeOf(e);
    // Ya era suyo (p. ej. doble pulsación o compra desde otra pestaña): se refresca y listo.
    if (code === 'ALREADY_OWNED') {
      await refreshProfile();
      return null;
    }
    return code;
  }
}

/** Equipa un cosmético que ya se posee. Devuelve null si ha ido bien o el código de error. */
export async function equipCosmetic(id: string): Promise<string | null> {
  if (frozen) return simulate((p) => ({ ...p, equipped: { ...p.equipped, card_design: id } }));
  try {
    set({ profile: await api.equipCosmetic(id) });
    return null;
  } catch (e) {
    return codeOf(e);
  }
}

/** Diseño de cartas equipado según la última respuesta del servidor (clásico si no se sabe). */
export function equippedCardDesign(profile: Profile | null = state.profile): string {
  return profile?.equipped.card_design ?? 'classic';
}

// ── Solo para las pantallas de ejemplo de desarrollo (src/dev/Preview.tsx) ──
let frozen = false;

/** Fija un perfil de ejemplo sin servidor; comprar y equipar se simulan en local. */
export function previewProfile(profile: Profile) {
  frozen = true;
  set({ profile, loading: false, error: null });
}

async function simulate(change: (p: Profile) => Profile | string): Promise<string | null> {
  await new Promise((r) => setTimeout(r, 400));
  const next = change(state.profile!);
  if (typeof next === 'string') return next;
  set({ profile: next });
  return null;
}
