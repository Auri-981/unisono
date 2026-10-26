/**
 * Contrato común entre la interfaz y la fuente de la partida.
 * Lo implementan `useOnlineRoom` (Supabase) y `usePracticeRoom` (motor local con bots),
 * de modo que las mismas pantallas sirven para ambos modos.
 */
import type { ComodinKind, PlayerId, RoomConfig, RoomSnapshot } from './types';

export type ConnectionState = 'connecting' | 'online' | 'reconnecting' | 'offline';

export interface ChatMessage {
  id: number;
  userId: PlayerId;
  name: string;
  body: string;
  createdAt: string;
}

export interface RoomActions {
  playCard(card: number): Promise<void>;
  proposeShuriken(): Promise<void>;
  proposeShield(): Promise<void>;
  /** Vota en la votación en curso (vistazo, escudo o rebobinar). */
  voteShuriken(accept: boolean): Promise<void>;
  /** Vota qué comodín elegir tras superar un nivel. */
  pickComodin(kind: ComodinKind): Promise<void>;
  expireVote(): Promise<void>;
  readyNextLevel(force: boolean): Promise<void>;
  setLobbyReady(ready: boolean): Promise<void>;
  updateConfig(config: RoomConfig): Promise<void>;
  startGame(): Promise<void>;
  kick(playerId: PlayerId): Promise<void>;
  rematch(): Promise<void>;
  leave(): Promise<void>;
  sendChat(body: string): Promise<void>;
}

export interface RoomController {
  kind: 'online' | 'practice';
  snapshot: RoomSnapshot | null;
  connection: ConnectionState;
  /** Jugadores con la app abierta ahora mismo. */
  onlineIds: ReadonlySet<PlayerId>;
  /** Milisegundos a sumar al reloj local para obtener la hora del servidor. */
  clockOffset: number;
  chat: ChatMessage[];
  /** Último error de una acción (código), para mostrarlo al usuario. */
  notice: { code: string; at: number } | null;
  /** Hay una acción enviándose. */
  busy: boolean;
  actions: RoomActions;
}

export type ExitReason = 'left' | 'kicked' | 'gone';
