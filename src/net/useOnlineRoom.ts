/**
 * Conecta la interfaz con una sala online.
 *
 * Fuente de verdad: la función `get_room_state` del servidor. El tiempo real solo avisa
 * de que «algo ha cambiado» (nueva `version` de la sala); entonces se pide la foto completa.
 * Así, aunque se pierda un evento (pantalla bloqueada, cambio de red…), el estado se
 * recupera siempre de forma consistente:
 *   - al suscribirse / reconectar el canal,
 *   - al volver a primer plano o recuperar la red,
 *   - en cada heartbeat (cada 15 s) si la versión del servidor es mayor,
 *   - con un sondeo de respaldo mientras el canal no esté conectado.
 * Una foto con versión menor que la actual se descarta (nunca se retrocede).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { HEARTBEAT_SECONDS } from '../config/gameConfig';
import type { ChatMessage, ConnectionState, ExitReason, RoomActions, RoomController } from '../game/controller';
import type { RoomConfig, RoomSnapshot } from '../game/types';
import { api, ApiError } from './api';
import { ensureSession, getSupabase } from './supabase';

const FALLBACK_POLL_MS = 4000;

export function useOnlineRoom(
  roomId: string,
  initial: RoomSnapshot | null,
  onExit: (reason: ExitReason) => void,
): RoomController {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(initial);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [onlineIds, setOnlineIds] = useState<ReadonlySet<string>>(new Set());
  const [clockOffset, setClockOffset] = useState(0);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [notice, setNotice] = useState<RoomController['notice']>(null);
  const [busy, setBusy] = useState(false);

  const snapRef = useRef<RoomSnapshot | null>(initial);
  const exitedRef = useRef(false);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  const exit = useCallback((reason: ExitReason) => {
    if (exitedRef.current) return;
    exitedRef.current = true;
    onExitRef.current(reason);
  }, []);

  const apply = useCallback((next: RoomSnapshot | null | undefined) => {
    if (!next || !next.room || exitedRef.current) return;
    const cur = snapRef.current;
    if (cur && cur.room.id === next.room.id && next.room.version < cur.room.version) return;
    snapRef.current = next;
    setSnapshot(next);
    const offset = Date.parse(next.serverTime) - Date.now();
    if (Number.isFinite(offset)) setClockOffset(offset);
  }, []);

  const handleError = useCallback(
    (e: unknown) => {
      const code = e instanceof ApiError ? e.code : 'NETWORK';
      if (code === 'NOT_MEMBER') exit('kicked');
      else if (code === 'ROOM_NOT_FOUND') exit('gone');
      return code;
    },
    [exit],
  );

  // Pide la foto completa; si llega otra petición mientras tanto, se repite una vez al terminar.
  const inflight = useRef(false);
  const again = useRef(false);
  const refresh = useCallback(async () => {
    if (exitedRef.current) return;
    if (inflight.current) {
      again.current = true;
      return;
    }
    inflight.current = true;
    try {
      do {
        again.current = false;
        apply(await api.getState(roomId));
      } while (again.current && !exitedRef.current);
    } catch (e) {
      if (handleError(e) === 'NETWORK') setConnection((c) => (c === 'online' ? 'reconnecting' : c));
    } finally {
      inflight.current = false;
    }
  }, [apply, handleError, roomId]);

  // Canal de tiempo real + presencia.
  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    (async () => {
      let uid: string;
      try {
        uid = await ensureSession();
      } catch {
        setConnection('offline');
        return;
      }
      if (cancelled) return;
      const sb = getSupabase();
      channel = sb
        .channel(`room:${roomId}`, { config: { presence: { key: uid } } })
        // Una señal por acción, con la nueva versión de la sala (nunca contiene cartas).
        .on('postgres_changes', { event: '*', schema: 'public', table: 'room_signals', filter: `room_id=eq.${roomId}` }, (payload) => {
          const version = Number((payload.new as { version?: number }).version ?? 0);
          if (!snapRef.current || version > snapRef.current.room.version) void refresh();
        })
        // El servidor confirma la escucha de cambios un instante DESPUÉS de «SUBSCRIBED»:
        // se re-sincroniza también entonces para no perder lo ocurrido entre medias.
        .on('system', {}, (msg: { extension?: string; status?: string }) => {
          if (msg.extension === 'postgres_changes' && msg.status === 'ok') void refresh();
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${roomId}` }, (payload) => {
          const m = payload.new as { id: number; user_id: string; name: string; body: string; created_at: string };
          setChat((prev) =>
            prev.some((x) => x.id === m.id)
              ? prev
              : [...prev.slice(-99), { id: m.id, userId: m.user_id, name: m.name, body: m.body, createdAt: m.created_at }],
          );
        })
        .on('presence', { event: 'sync' }, () => {
          if (channel) setOnlineIds(new Set(Object.keys(channel.presenceState())));
        })
        .subscribe((status) => {
          if (cancelled) return;
          if (status === 'SUBSCRIBED') {
            setConnection('online');
            void channel?.track({ since: Date.now() });
            void refresh();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            setConnection('reconnecting');
          }
        });

      // Historial reciente del chat (las políticas RLS solo devuelven el de esta sala si eres miembro).
      const { data } = await sb
        .from('chat_messages')
        .select('id, user_id, name, body, created_at')
        .eq('room_id', roomId)
        .order('id', { ascending: false })
        .limit(50);
      if (!cancelled && data) {
        setChat(
          data.reverse().map((m) => ({ id: m.id, userId: m.user_id, name: m.name, body: m.body, createdAt: m.created_at })),
        );
      }
    })();

    return () => {
      cancelled = true;
      if (channel) void getSupabase().removeChannel(channel);
    };
  }, [roomId, refresh]);

  // Heartbeat: señal de vida, cambio de anfitrión y detección de cambios perdidos.
  useEffect(() => {
    const beat = async () => {
      try {
        const { version } = await api.heartbeat(roomId);
        if (!snapRef.current || version > snapRef.current.room.version) void refresh();
      } catch (e) {
        handleError(e);
      }
    };
    void beat();
    const id = window.setInterval(beat, HEARTBEAT_SECONDS * 1000);
    return () => window.clearInterval(id);
  }, [roomId, refresh, handleError]);

  // Sondeo de respaldo mientras el tiempo real no esté disponible.
  useEffect(() => {
    if (connection === 'online') return;
    const id = window.setInterval(() => void refresh(), FALLBACK_POLL_MS);
    return () => window.clearInterval(id);
  }, [connection, refresh]);

  // Volver a primer plano o recuperar la red → re-sincronizar.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const onOnline = () => void refresh();
    const onOffline = () => setConnection('offline');
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [refresh]);

  const run = useCallback(
    async (fn: () => Promise<RoomSnapshot | unknown>) => {
      setBusy(true);
      try {
        const result = await fn();
        if (result && typeof result === 'object' && 'room' in result) apply(result as RoomSnapshot);
      } catch (e) {
        const code = handleError(e);
        setNotice({ code, at: Date.now() });
        void refresh();
      } finally {
        setBusy(false);
      }
    },
    [apply, handleError, refresh],
  );

  const actions = useMemo<RoomActions>(
    () => ({
      playCard: (card) => run(() => api.playCard(roomId, card)),
      proposeShuriken: () => run(() => api.proposeShuriken(roomId)),
      voteShuriken: (accept) => run(() => api.voteShuriken(roomId, accept)),
      expireVote: () => run(() => api.expireVote(roomId)),
      readyNextLevel: (force) => run(() => api.readyNextLevel(roomId, snapRef.current?.room.level ?? 0, force)),
      setLobbyReady: (ready) => run(() => api.setLobbyReady(roomId, ready)),
      updateConfig: (config: RoomConfig) => run(() => api.updateConfig(roomId, config)),
      startGame: () => run(() => api.startGame(roomId)),
      kick: (target) => run(() => api.kick(roomId, target)),
      rematch: () => run(() => api.rematch(roomId)),
      sendChat: (body) => run(() => api.sendChat(roomId, body)),
      leave: async () => {
        try {
          await api.leaveRoom(roomId);
        } catch {
          // Si falla la red, se sale igualmente en local; el anfitrión puede expulsar después.
        }
        exit('left');
      },
    }),
    [roomId, run, exit],
  );

  return { kind: 'online', snapshot, connection, onlineIds, clockOffset, chat, notice, busy, actions };
}
