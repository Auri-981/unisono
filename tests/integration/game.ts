/**
 * Ayudas para jugar partidas completas contra el servidor SQL de las pruebas (PGlite).
 * Las usan las pruebas de economía y las de logros.
 */
import type { RoomSnapshot } from '../../src/game/types';
import type { TestDb } from './db';

export function gameHelpers(t: TestDb) {
  /** Sala con n jugadores nuevos, todos listos y la partida empezada. */
  async function started(n: number, config: object = {}) {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) ids.push(await t.newUser());
    return { ids, room: await startedWith(ids, config) };
  }

  /** Igual, pero con jugadores ya existentes (el primero crea la sala). */
  async function startedWith(ids: string[], config: object = {}) {
    const snap: RoomSnapshot = await t.rpc(ids[0]!, 'create_room', { p_name: 'Ana', p_config: config });
    for (let i = 1; i < ids.length; i++) await t.rpc(ids[i]!, 'join_room', { p_code: snap.room.code, p_name: `J${i}` });
    for (const id of ids) await t.rpc(id, 'set_lobby_ready', { p_room: snap.room.id, p_ready: true });
    await t.rpc(ids[0]!, 'start_game', { p_room: snap.room.id });
    return snap.room.id;
  }

  /** Fuerza el nivel y las manos (índice de jugador → cartas). */
  async function setHands(room: string, ids: string[], hands: number[][], level: number) {
    await t.admin(`update public.rooms set level = $2 where id = $1`, [room, level]);
    await t.admin(`delete from public.hands where room_id = $1`, [room]);
    for (let i = 0; i < ids.length; i++) {
      for (const c of hands[i]!) await t.admin(`insert into public.hands (room_id, user_id, card) values ($1, $2, $3)`, [room, ids[i], c]);
    }
  }

  /** Pasa la pantalla de «nivel superado» (eligiendo comodín si toca). */
  async function nextLevel(room: string, ids: string[]) {
    const state: RoomSnapshot = await t.rpc(ids[0]!, 'get_room_state', { p_room: room });
    if (state.room.offer) for (const id of ids) await t.rpc(id, 'pick_comodin', { p_room: room, p_level: state.room.level, p_kind: state.room.offer.choices[0] });
    for (const id of ids) await t.rpc(id, 'ready_next_level', { p_room: room, p_level: state.room.level });
  }

  /** Juega la partida entera sin errores (todas las cartas en orden), nivel a nivel. */
  async function playToTheEnd(room: string, ids: string[]): Promise<RoomSnapshot> {
    for (let guard = 0; guard < 30; guard++) {
      const state: RoomSnapshot = await t.rpc(ids[0]!, 'get_room_state', { p_room: room });
      if (['won', 'lost', 'abandoned'].includes(state.room.status)) return state;
      if (state.room.status === 'level_complete') {
        await nextLevel(room, ids);
        continue;
      }
      const rows = await t.admin<{ user_id: string; card: number }>(`select user_id, card from public.hands where room_id = $1 order by card`, [room]);
      for (const r of rows) await t.rpc(r.user_id, 'play_card', { p_room: room, p_card: r.card });
    }
    throw new Error('la partida no terminó');
  }

  /** Da monedas como lo haría un ajuste interno (solo en las pruebas). */
  async function grant(uid: string, coins: number) {
    await t.admin(`select game_private.ensure_player($1)`, [uid]);
    await t.admin(`select game_private.add_coins($1, $2, 'adjustment', 'Prueba')`, [uid, coins]);
  }

  return { started, startedWith, setHands, nextLevel, playToTheEnd, grant };
}
