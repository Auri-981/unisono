import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** true si la web se compiló con las variables de Supabase. */
export const onlineAvailable = Boolean(url && key && url.startsWith('https://'));

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!onlineAvailable) throw new Error('NOT_CONFIGURED');
  if (!client) {
    client = createClient(url!, key!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Al volver de Google la dirección trae un código de un solo uso: se canjea por la sesión.
        detectSessionInUrl: true,
        flowType: 'pkce',
        storageKey: 'unisono-auth',
      },
      realtime: { params: { eventsPerSecond: 20 } },
    });
  }
  return client;
}

let sessionPromise: Promise<string> | null = null;

/**
 * Garantiza una sesión (la de la cuenta de Google o, si no hay, una de invitado anónima) y
 * devuelve el id del jugador. La sesión se guarda en el navegador: al cerrar y reabrir la
 * pestaña se recupera la misma identidad (y por tanto el mismo sitio en la sala).
 */
export function ensureSession(): Promise<string> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const sb = getSupabase();
      const { data } = await sb.auth.getSession();
      if (data.session?.user) return data.session.user.id;
      const { data: signed, error } = await sb.auth.signInAnonymously();
      if (error || !signed.user) {
        const msg = error?.message ?? '';
        throw new Error(/anonymous/i.test(msg) && /disabled/i.test(msg) ? 'ANON_DISABLED' : 'NETWORK');
      }
      return signed.user.id;
    })().catch((e) => {
      sessionPromise = null;
      throw e;
    });
  }
  return sessionPromise;
}

/** Olvida la sesión de este navegador (cerrar sesión o cuenta borrada); la siguiente llamada crea un invitado nuevo. */
export async function dropSession(): Promise<void> {
  sessionPromise = null;
  await getSupabase().auth.signOut({ scope: 'local' });
}

/** ¿Está activado «Continuar con Google» en Supabase? (Ajuste público: así el botón no sale antes de tiempo.) */
export async function googleEnabled(): Promise<boolean> {
  if (!onlineAvailable) return false;
  const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key! }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return false;
  const body = (await res.json()) as { external?: Record<string, boolean> };
  return Boolean(body.external?.google);
}
