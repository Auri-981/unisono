/**
 * Preferencias locales del dispositivo (no son estado de juego).
 * El acceso a localStorage puede fallar (modo privado, bloqueos): siempre con try/catch.
 */
import { useSyncExternalStore } from 'react';

export interface Prefs {
  name: string;
  sound: boolean;
  vibration: boolean;
  reducedMotion: boolean;
}

const KEY = 'unisono.prefs';
const ROOM_KEY = 'unisono.room';

const defaults: Prefs = {
  name: '',
  sound: true,
  vibration: true,
  reducedMotion: false,
};

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sin almacenamiento: la app sigue funcionando, solo no recuerda la preferencia.
  }
}

let prefs: Prefs = { ...defaults, ...(read<Partial<Prefs>>(KEY) ?? {}) };
const listeners = new Set<() => void>();

export function getPrefs(): Prefs {
  return prefs;
}

export function setPrefs(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch };
  write(KEY, prefs);
  applyMotionPref();
  listeners.forEach((l) => l());
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => prefs,
  );
}

export function applyMotionPref() {
  document.documentElement.classList.toggle('reduce-motion', prefs.reducedMotion);
}

/** Sala online actual, para reanudarla tras recargar o cerrar la pestaña. */
export interface StoredRoom {
  id: string;
  code: string;
}

export const storedRoom = {
  get: () => read<StoredRoom>(ROOM_KEY),
  set: (room: StoredRoom | null) => write(ROOM_KEY, room),
};
