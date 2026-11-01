/**
 * Actualización automática. GitHub Pages deja que el móvil guarde la página hasta 10 minutos y
 * la app de la pantalla de inicio del iPhone a veces la guarda más; así que de vez en cuando
 * se pide la página de nuevo y, si apunta a otro código (otro `assets/index-….js`), hay
 * versión nueva y la app se recarga sola (así nadie juega con una versión distinta a la de
 * los demás). Nunca a mitad de partida: mientras se ve una partida (`useHoldUpdates`) se espera
 * a que termine y se vuelva a la sala de espera o al inicio.
 *
 * La comprobación usa `cache: 'reload'`: va a la red y además guarda la página nueva en la
 * caché del navegador, así que al recargar se abre ya la versión nueva y no la guardada.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';

const CHECK_EVERY_MS = 2 * 60_000;
const MIN_GAP_MS = 30_000;
const SCRIPT_RE = /assets\/index-[\w-]+\.js/;

/** El código con el que se ha abierto esta página (no existe en desarrollo). */
function currentScript(): string | null {
  const el = document.querySelector<HTMLScriptElement>('script[type="module"][src*="assets/index-"]');
  return el?.getAttribute('src')?.match(SCRIPT_RE)?.[0] ?? null;
}

/** La dirección de esta página sin el «#…», que es la que guarda el navegador. */
function pageUrl(): string {
  return window.location.pathname + window.location.search;
}

async function latestScript(): Promise<string | null> {
  const res = await fetch(pageUrl(), { cache: 'reload', credentials: 'same-origin' });
  if (!res.ok) return null;
  return (await res.text()).match(SCRIPT_RE)?.[0] ?? null;
}

/** true cuando hay publicada una versión más nueva que la que se está usando. */
export function useNewVersion(): boolean {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const mine = currentScript();
    if (!mine || available) return;
    let last = 0;
    let stopped = false;
    const check = () => {
      if (stopped || document.visibilityState !== 'visible' || Date.now() - last < MIN_GAP_MS) return;
      last = Date.now();
      latestScript()
        .then((latest) => {
          if (!stopped && latest && latest !== mine) setAvailable(true);
        })
        .catch(() => {});
    };
    check();
    const id = window.setInterval(check, CHECK_EVERY_MS);
    // Al volver a la app (el iPhone la «despierta» sin recargarla) es cuando más falta hace.
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, [available]);

  return available;
}

export function reloadToNewVersion() {
  window.location.reload();
}

// Pantallas que retienen la actualización mientras están abiertas (la partida).
let holds = 0;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Mientras el componente que lo usa esté en pantalla, la app no se recarga sola. */
export function useHoldUpdates() {
  useEffect(() => {
    holds += 1;
    listeners.forEach((fn) => fn());
    return () => {
      holds -= 1;
      listeners.forEach((fn) => fn());
    };
  }, []);
}

/** true si alguna pantalla está reteniendo la actualización. */
export function useUpdatesHeld(): boolean {
  return useSyncExternalStore(subscribe, () => holds > 0);
}
