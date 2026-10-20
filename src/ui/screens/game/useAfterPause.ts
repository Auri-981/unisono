import { useEffect, useState } from 'react';

/** Pausa antes de mostrar «nivel superado» o el final: así se ve la última carta jugada. */
export const RESULT_PAUSE_MS = 2500;

/**
 * Devuelve true cuando `active` lleva al menos `delay` ms desde `sinceIso` (hora del servidor).
 * Si el momento ya pasó (p. ej. al reconectar más tarde) devuelve true al instante.
 */
export function useAfterPause(active: boolean, sinceIso: string | undefined, clockOffset: number, delay = RESULT_PAUSE_MS): boolean {
  const remaining = () => (sinceIso ? Date.parse(sinceIso) + delay - (Date.now() + clockOffset) : 0);
  const [ready, setReady] = useState(() => active && remaining() <= 0);

  useEffect(() => {
    if (!active) {
      setReady(false);
      return;
    }
    const ms = remaining();
    if (!(ms > 0)) {
      setReady(true);
      return;
    }
    setReady(false);
    const id = window.setTimeout(() => setReady(true), Math.min(ms, delay));
    return () => window.clearTimeout(id);
  }, [active, sinceIso, clockOffset, delay]);

  return ready;
}
