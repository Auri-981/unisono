/**
 * Perfil del jugador (monedas, cosméticos, títulos y logros) compartido por toda la app.
 * La verdad está en el servidor: aquí solo se guarda la última respuesta, para pintarla al
 * instante (y para que la práctica, sin servidor, use el diseño equipado). Nunca se suman
 * monedas en el cliente: tras cada compra, equipamiento o partida se usa lo que devuelve el servidor.
 */
import { useSyncExternalStore } from 'react';
import { api, ApiError, type CatalogItem, type CosmeticKind, type Profile } from '../net/api';
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

/** Perfil que el servidor ha devuelto por otra vía (p. ej. al unir el progreso a la cuenta). */
export function acceptProfile(profile: Profile) {
  if (!frozen) set({ profile, error: null });
}

/** Olvida el perfil guardado: en este navegador juega ahora otra persona (o un invitado nuevo). */
export function forgetProfile() {
  if (frozen) return;
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // Sin almacenamiento: no había nada guardado.
  }
  set({ profile: null, error: null });
}

/** Compra un cosmético. Devuelve null si ha ido bien o el código de error. */
export async function buyCosmetic(id: string): Promise<string | null> {
  if (frozen) return simulate((p) => {
    const price = p.catalog.find((c) => c.id === id)?.price ?? 0;
    if (p.coins < price) return 'NOT_ENOUGH_COINS';
    return { ...p, coins: p.coins - price, owned: [...p.owned, id], sources: { ...p.sources, [id]: 'purchase' } };
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
  if (frozen) return simulate((p) => {
    const kind = p.catalog.find((c) => c.id === id)?.kind ?? 'card_design';
    return { ...p, equipped: { ...p.equipped, [kind]: id } };
  });
  try {
    set({ profile: await api.equipCosmetic(id) });
    return null;
  } catch (e) {
    return codeOf(e);
  }
}

/** Quita lo equipado de un tipo (solo los títulos: jugar sin título). */
export async function unequipCosmetic(kind: CosmeticKind): Promise<string | null> {
  if (frozen) return simulate((p) => {
    const equipped = { ...p.equipped };
    delete equipped[kind];
    return { ...p, equipped };
  });
  try {
    set({ profile: await api.unequipCosmetic(kind) });
    return null;
  } catch (e) {
    return codeOf(e);
  }
}

/** Avisa al servidor de que estos logros ya se han enseñado (si falla, se enseñarán otra vez). */
export async function markAchievementsSeen(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const forget = (p: Profile): Profile => ({ ...p, unseen: (p.unseen ?? []).filter((x) => !ids.includes(x)) });
  if (frozen) {
    set({ profile: forget(state.profile!) });
    return;
  }
  // Se quitan ya en local para no repetir el aviso mientras llega la respuesta.
  if (state.profile) set({ profile: forget(state.profile) });
  try {
    set({ profile: await api.markAchievementsSeen(ids) });
  } catch {
    // Sin red: el servidor los seguirá dando como no vistos y se enseñarán la próxima vez.
  }
}

/** Diseño de cartas equipado según la última respuesta del servidor (clásico si no se sabe). */
export function equippedCardDesign(profile: Profile | null = state.profile): string {
  return profile?.equipped.card_design ?? 'classic';
}

/** Título equipado (o null si no lleva ninguno). */
export function equippedTitle(profile: Profile | null = state.profile): CatalogItem | null {
  const id = profile?.equipped.title;
  return (id && profile?.catalog.find((c) => c.id === id)) || null;
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
