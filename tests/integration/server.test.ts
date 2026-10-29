/**
 * Pruebas de integración del servidor: privacidad, permisos, anti-duplicados,
 * reconexión, anfitrión, votaciones, chat, historial y partidas completas.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { LIGHTNING_INTRO_SECONDS, PLAYER_PRESETS, lightningSeconds } from '../../src/config/gameConfig';
import type { RoomSnapshot } from '../../src/game/types';
import { createTestDb, errorOf, type TestDb } from './db';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});

async function lobby(n: number, config: object = {}) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(await t.newUser());
  const snap: RoomSnapshot = await t.rpc(ids[0]!, 'create_room', { p_name: 'Ana', p_config: config });
  for (let i = 1; i < n; i++) await t.rpc(ids[i]!, 'join_room', { p_code: snap.room.code, p_name: `J${i}` });
  return { ids, room: snap.room.id, code: snap.room.code };
}

/** Todos marcan «Listo» (requisito para empezar). */
async function readyAll(room: string, ids: string[]) {
  for (const id of ids) await t.rpc(id, 'set_lobby_ready', { p_room: room, p_ready: true });
}

async function started(n: number, config: object = {}) {
  const l = await lobby(n, config);
  await readyAll(l.room, l.ids);
  await t.rpc(l.ids[0]!, 'start_game', { p_room: l.room });
  return l;
}

async function setHands(room: string, ids: string[], hands: number[][], level = hands[0]!.length) {
  await t.admin(`update public.rooms set level = $2 where id = $1`, [room, level]);
  await t.admin(`delete from public.hands where room_id = $1`, [room]);
  for (let i = 0; i < ids.length; i++) {
    for (const c of hands[i]!) {
      await t.admin(`insert into public.hands (room_id, user_id, card) values ($1, $2, $3)`, [room, ids[i], c]);
    }
  }
}

async function allHands(room: string) {
  return t.admin<{ user_id: string; card: number }>(
    `select user_id, card from public.hands where room_id = $1 order by card`,
    [room],
  );
}

describe('privacidad de las cartas', () => {
  it('cada jugador solo puede leer sus propias cartas, incluso consultando la tabla directamente', async () => {
    const { ids, room } = await started(4);
    await setHands(room, ids, [[1, 2], [11, 12], [21, 22], [31, 32]]);
    for (let i = 0; i < 4; i++) {
      const rows = await t.as<{ user_id: string; card: number }>(ids[i]!, `select user_id, card from public.hands order by card`);
      expect(rows.every((r) => r.user_id === ids[i])).toBe(true);
      expect(rows.map((r) => r.card)).toEqual([1 + 10 * i, 2 + 10 * i]);
      // Ni filtrando explícitamente por otro jugador.
      const other = await t.as(ids[i]!, `select * from public.hands where user_id = $1`, [ids[(i + 1) % 4]]);
      expect(other).toHaveLength(0);
    }
  });

  it('la foto de la partida solo incluye la mano propia y el número de cartas de los demás', async () => {
    const { ids, room } = await started(3);
    await setHands(room, ids, [[5, 6], [15, 16], [25, 26]]);
    const snap: RoomSnapshot = await t.rpc(ids[1]!, 'get_room_state', { p_room: room });
    expect(snap.myHand).toEqual([15, 16]);
    expect(snap.players.map((p) => p.cardsLeft)).toEqual([2, 2, 2]);
    const json = JSON.stringify(snap);
    expect(json).not.toContain('"hands"');
    expect(Object.keys(snap.players[0]!).sort()).toEqual(['cardsLeft', 'id', 'lastSeenAt', 'name', 'ready', 'seat']);
  });

  it('la señal de vida (ping) responde sin sesión y no da acceso a nada más', async () => {
    const [row] = await t.asAnon<{ r: string }>(`select public.ping() as r`);
    expect(row!.r).toBe('ok');
  });

  it('un usuario sin sesión (anon) no puede leer ni llamar a nada', async () => {
    const { room } = await started(2);
    expect(await errorOf(t.asAnon(`select * from public.hands`))).toMatch(/permission denied/);
    expect(await errorOf(t.asAnon(`select * from public.rooms`))).toMatch(/permission denied/);
    expect(await errorOf(t.asAnon(`select public.get_room_state($1)`, [room]))).toMatch(/permission denied/);
    expect(await errorOf(t.asAnon(`select public.create_room('x', '{}')`))).toMatch(/permission denied/);
  });

  it('un jugador ajeno a la sala no puede ver la sala, los jugadores, los eventos ni el chat', async () => {
    const { room } = await started(2, { mode: 'friends' });
    const outsider = await t.newUser();
    expect(await t.as(outsider, `select * from public.rooms where id = $1`, [room])).toHaveLength(0);
    expect(await t.as(outsider, `select * from public.room_players where room_id = $1`, [room])).toHaveLength(0);
    expect(await t.as(outsider, `select * from public.room_events where room_id = $1`, [room])).toHaveLength(0);
    expect(await t.as(outsider, `select * from public.chat_messages where room_id = $1`, [room])).toHaveLength(0);
    expect(await t.as(outsider, `select * from public.hands`)).toHaveLength(0);
    expect(await errorOf(t.rpc(outsider, 'get_room_state', { p_room: room }))).toBe('NOT_MEMBER');
    expect(await errorOf(t.rpc(outsider, 'play_card', { p_room: room, p_card: 50 }))).toBe('NOT_MEMBER');
    expect(await errorOf(t.rpc(outsider, 'send_chat', { p_room: room, p_body: 'hola' }))).toBe('NOT_MEMBER');
  });

  it('las cartas no se publican por tiempo real (solo la señal de versión y el chat)', async () => {
    const rows = await t.admin<{ tablename: string }>(
      `select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1`,
    );
    expect(rows.map((r) => r.tablename)).toEqual(['chat_messages', 'room_signals']);
  });

  it('cada acción produce exactamente una señal, solo visible para los miembros', async () => {
    const { ids, room } = await started(2);
    const outsider = await t.newUser();
    const snap: RoomSnapshot = await t.rpc(ids[0]!, 'propose_shuriken', { p_room: room });
    const rows = await t.as<{ room_id: string; version: number }>(ids[1]!, `select * from public.room_signals where room_id = $1`, [room]);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.version)).toBe(snap.room.version);
    expect(Object.keys(rows[0]!).sort()).toEqual(['room_id', 'updated_at', 'version']);
    expect(await t.as(outsider, `select * from public.room_signals`)).toHaveLength(0);
    expect(await errorOf(t.as(ids[0]!, `update public.room_signals set version = 1`))).toMatch(/permission denied/);
  });

  it('la fila pública de la sala (la que se emite en tiempo real) no contiene cartas en mano', async () => {
    const { ids, room } = await started(2);
    await setHands(room, ids, [[37, 38], [77, 78]]);
    const [row] = await t.as<Record<string, unknown>>(ids[0]!, `select * from public.rooms where id = $1`, [room]);
    // Se quitan las fechas: «19:37» no es una carta.
    const json = JSON.stringify(row).replace(/\d{4}-\d{2}-\d{2}[T ][\d:.+-]+/g, 'FECHA');
    for (const c of [37, 38, 77, 78]) expect(json).not.toMatch(new RegExp(`\\b${c}\\b`));
  });
});

describe('el cliente no puede alterar el estado', () => {
  it('escrituras directas en las tablas están prohibidas', async () => {
    const { ids, room } = await started(2);
    const a = ids[0]!;
    const attempts = [
      `update public.rooms set lives = 99 where id = '${room}'`,
      `update public.rooms set level = 8, status = 'won' where id = '${room}'`,
      `insert into public.hands (room_id, user_id, card) values ('${room}', '${a}', 1)`,
      `delete from public.hands where room_id = '${room}'`,
      `update public.hands set user_id = '${a}' where room_id = '${room}'`,
      `update public.room_players set ready = true where room_id = '${room}'`,
      `insert into public.chat_messages (room_id, user_id, name, body) values ('${room}', '${a}', 'x', 'y')`,
      `delete from public.rooms where id = '${room}'`,
      `select * from public.processed_actions`,
      `select * from public.game_results`,
    ];
    for (const sql of attempts) expect(await errorOf(t.as(a, sql)), sql).toMatch(/permission denied/);
  });

  it('las funciones internas no son accesibles', async () => {
    const { ids, room } = await started(2);
    expect(await errorOf(t.as(ids[0]!, `select game_private.deal($1)`, [room]))).toMatch(/permission denied/);
    expect(await errorOf(t.as(ids[0]!, `select game_private.snapshot($1, $2)`, [room, ids[1]]))).toMatch(/permission denied/);
    expect(await errorOf(t.as(ids[0]!, `select game_private.end_game($1, 'won')`, [room]))).toMatch(/permission denied/);
  });

  it('no se puede jugar una carta ajena, inexistente ni que no sea la más baja', async () => {
    const { ids, room } = await started(2);
    await setHands(room, ids, [[10, 20], [30, 40]]);
    expect(await errorOf(t.rpc(ids[0]!, 'play_card', { p_room: room, p_card: 30 }))).toBe('NOT_IN_HAND');
    expect(await errorOf(t.rpc(ids[0]!, 'play_card', { p_room: room, p_card: 20 }))).toBe('NOT_LOWEST');
    expect(await errorOf(t.rpc(ids[0]!, 'play_card', { p_room: room, p_card: 0 }))).toBe('NOT_IN_HAND');
    expect(await errorOf(t.rpc(ids[0]!, 'play_card', { p_room: room, p_card: null }))).toBe('NOT_IN_HAND');
    expect((await allHands(room)).map((h) => h.card)).toEqual([10, 20, 30, 40]);
  });

  it('solo el anfitrión configura, inicia, expulsa y pide revancha', async () => {
    const { ids, room } = await lobby(3);
    expect(await errorOf(t.rpc(ids[1]!, 'update_config', { p_room: room, p_config: { maxLives: 10 } }))).toBe('NOT_HOST');
    expect(await errorOf(t.rpc(ids[1]!, 'start_game', { p_room: room }))).toBe('NOT_HOST');
    expect(await errorOf(t.rpc(ids[1]!, 'kick_player', { p_room: room, p_target: ids[2] }))).toBe('NOT_HOST');
    expect(await errorOf(t.rpc(ids[0]!, 'kick_player', { p_room: room, p_target: ids[0] }))).toBe('CANNOT_KICK_SELF');
    expect(await errorOf(t.rpc(ids[0]!, 'rematch', { p_room: room }))).toBe('INVALID_STATE');
  });

  it('una configuración maliciosa se normaliza en el servidor', async () => {
    const { ids, room } = await lobby(3);
    const snap: RoomSnapshot = await t.rpc(ids[0]!, 'update_config', {
      p_room: room,
      p_config: { maxPlayers: 2, maxLives: 999, mode: '<script>', customRewards: 'x', extra: 'ignorado' },
    });
    expect(snap.room.config.maxPlayers).toBe(3); // nunca por debajo de los jugadores presentes
    expect(snap.room.config.maxLives).toBe(10);
    expect(snap.room.config.mode).toBe('concentration');
    expect(snap.room.config).not.toHaveProperty('extra');
  });

  it('no se pueden usar recursos inexistentes', async () => {
    const { ids, room } = await started(2);
    await t.admin(`update public.rooms set shurikens = 0 where id = $1`, [room]);
    expect(await errorOf(t.rpc(ids[0]!, 'propose_shuriken', { p_room: room }))).toBe('NO_SHURIKENS');
    expect(await errorOf(t.rpc(ids[1]!, 'vote_shuriken', { p_room: room, p_accept: true }))).toBe('NO_VOTE');
  });
});

describe('salas', () => {
  it('códigos inexistentes, salas llenas y partidas empezadas', async () => {
    const u = await t.newUser();
    expect(await t.rpc(u, 'join_room', { p_code: 'ZZZZZ', p_name: 'Eva' })).toEqual({ error: 'ROOM_NOT_FOUND' });

    const full = await lobby(2, { maxPlayers: 2 });
    expect(await errorOf(t.rpc(u, 'join_room', { p_code: full.code, p_name: 'Eva' }))).toBe('ROOM_FULL');

    const busy = await started(2);
    expect(await errorOf(t.rpc(u, 'join_room', { p_code: busy.code, p_name: 'Eva' }))).toBe('GAME_IN_PROGRESS');

    const open = await lobby(2);
    expect(await errorOf(t.rpc(u, 'join_room', { p_code: open.code, p_name: '   ' }))).toBe('INVALID_NAME');
    // El código admite minúsculas y separadores.
    const snap: RoomSnapshot = await t.rpc(u, 'join_room', { p_code: ` ${open.code.toLowerCase().slice(0, 2)}-${open.code.toLowerCase().slice(2)} `, p_name: 'Eva' });
    expect(snap.players.map((p) => p.name)).toEqual(['Ana', 'J1', 'Eva']);
  });

  it('frena la búsqueda de códigos por fuerza bruta', async () => {
    const u = await t.newUser();
    for (let i = 0; i < 20; i++) await t.rpc(u, 'join_room', { p_code: `QQQ${String(i).padStart(2, '2')}`, p_name: 'X' });
    expect(await errorOf(t.rpc(u, 'join_room', { p_code: 'QQQQQ', p_name: 'X' }))).toBe('TOO_MANY_ATTEMPTS');
  });

  it('limita la creación masiva de salas', async () => {
    const u = await t.newUser();
    for (let i = 0; i < 5; i++) await t.rpc(u, 'create_room', { p_name: 'Spam', p_config: {} });
    expect(await errorOf(t.rpc(u, 'create_room', { p_name: 'Spam', p_config: {} }))).toBe('TOO_MANY_ROOMS');
  });

  it('no se puede empezar hasta que todos estén listos, anfitrión incluido', async () => {
    const { ids, room } = await lobby(3);
    await t.rpc(ids[1]!, 'set_lobby_ready', { p_room: room, p_ready: true });
    await t.rpc(ids[2]!, 'set_lobby_ready', { p_room: room, p_ready: true });
    expect(await errorOf(t.rpc(ids[0]!, 'start_game', { p_room: room }))).toBe('NOT_ALL_READY');
    await t.rpc(ids[0]!, 'set_lobby_ready', { p_room: room, p_ready: true });
    await t.rpc(ids[2]!, 'set_lobby_ready', { p_room: room, p_ready: false });
    expect(await errorOf(t.rpc(ids[0]!, 'start_game', { p_room: room }))).toBe('NOT_ALL_READY');
    await t.rpc(ids[2]!, 'set_lobby_ready', { p_room: room, p_ready: true });
    const snap: RoomSnapshot = await t.rpc(ids[0]!, 'start_game', { p_room: room });
    expect(snap.room.status).toBe('playing');
  });

  it('se necesitan al menos 2 jugadores para empezar', async () => {
    const { ids, room } = await lobby(1);
    expect(await errorOf(t.rpc(ids[0]!, 'start_game', { p_room: room }))).toBe('NOT_ENOUGH_PLAYERS');
  });

  it('reconexión: al volver (misma sesión) recupera su sitio y sus cartas, incluso con la partida empezada', async () => {
    const { ids, room, code } = await started(3);
    const before: RoomSnapshot = await t.rpc(ids[2]!, 'get_room_state', { p_room: room });
    const again: RoomSnapshot = await t.rpc(ids[2]!, 'join_room', { p_code: code, p_name: 'Otro nombre' });
    expect(again.room.id).toBe(room);
    expect(again.myHand).toEqual(before.myHand);
    expect(again.players).toHaveLength(3);
  });

  it('el anfitrión inactivo cede el rol a un jugador conectado', async () => {
    const { ids, room } = await started(3);
    await t.admin(`update public.room_players set last_seen_at = now() - interval '2 minutes' where room_id = $1 and user_id = $2`, [room, ids[0]]);
    const before = (await t.admin<{ version: number }>(`select version from public.rooms where id = $1`, [room]))[0]!.version;
    const hb = await t.rpc(ids[2]!, 'heartbeat', { p_room: room });
    expect(hb.version).toBe(Number(before) + 1);
    const snap: RoomSnapshot = await t.rpc(ids[2]!, 'get_room_state', { p_room: room });
    expect(snap.room.hostId).toBe(ids[1]);
    expect(snap.lastEvent?.kind).toBe('host_changed');
    // Un heartbeat normal no cambia nada.
    const hb2 = await t.rpc(ids[1]!, 'heartbeat', { p_room: room });
    expect(hb2.version).toBe(hb.version);
  });

  it('abandonar en la sala de espera y quedarse vacía borra la sala', async () => {
    const { ids, room } = await lobby(2);
    await t.rpc(ids[0]!, 'leave_room', { p_room: room });
    let snap: RoomSnapshot = await t.rpc(ids[1]!, 'get_room_state', { p_room: room });
    expect(snap.room.hostId).toBe(ids[1]);
    await t.rpc(ids[1]!, 'leave_room', { p_room: room });
    expect(await t.admin(`select 1 from public.rooms where id = $1`, [room])).toHaveLength(0);
  });

  it('una partida abandonada aparece en el historial de todos, también de quien se fue', async () => {
    const { ids, room } = await started(2);
    await t.rpc(ids[1]!, 'leave_room', { p_room: room });
    for (const id of ids) {
      const h = await t.rpc(id, 'get_my_history', {});
      expect(h.stats.played).toBe(1);
      expect(h.games[0].result).toBe('abandoned');
      expect(h.games[0].players).toEqual(['Ana', 'J1']);
    }
  });

  it('expulsar a un jugador desconectado durante la partida descarta sus cartas', async () => {
    const { ids, room } = await started(3);
    await setHands(room, ids, [[5], [6], [7]]);
    const snap: RoomSnapshot = await t.rpc(ids[0]!, 'kick_player', { p_room: room, p_target: ids[1] });
    expect(snap.players.map((p) => p.id)).toEqual([ids[0], ids[2]]);
    expect(snap.lastEvent?.kind).toBe('player_kicked');
    expect(await errorOf(t.rpc(ids[1]!, 'get_room_state', { p_room: room }))).toBe('NOT_MEMBER');
    expect((await allHands(room)).map((h) => h.card)).toEqual([5, 7]);
  });
});

describe('anti-duplicados y concurrencia', () => {
  it('un error que cierra el nivel envía ambos eventos (para mostrar el error y luego el nivel)', async () => {
    const { ids, room } = await started(2);
    await setHands(room, ids, [[30], [50]]);
    const snap: RoomSnapshot = await t.rpc(ids[1]!, 'play_card', { p_room: room, p_card: 50 });
    expect(snap.room.status).toBe('level_complete');
    const kinds = snap.recentEvents!.map((e) => e.kind);
    expect(kinds.slice(-2)).toEqual(['mistake', 'level_complete']);
    expect(snap.recentEvents!.length).toBeLessThanOrEqual(8);
    const seqs = snap.recentEvents!.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(snap.lastEvent?.seq).toBe(seqs.at(-1));
  });

  it('un reintento con el mismo action_id no juega otra carta', async () => {
    const { ids, room } = await started(2);
    await setHands(room, ids, [[10, 20], [30, 40]]);
    const action = crypto.randomUUID();
    await t.rpc(ids[0]!, 'play_card', { p_room: room, p_card: 10, p_action: action });
    // Mismo id (reintento de red), aunque pida otra carta: se ignora.
    const snap: RoomSnapshot = await t.rpc(ids[0]!, 'play_card', { p_room: room, p_card: 20, p_action: action });
    expect(snap.myHand).toEqual([20]);
    expect(snap.pile.map((p) => p.c)).toEqual([10]);
  });

  it('una doble pulsación (dos ids distintos, misma carta) solo juega una vez', async () => {
    const { ids, room } = await started(2);
    await setHands(room, ids, [[10, 20], [30, 40]]);
    await t.rpc(ids[0]!, 'play_card', { p_room: room, p_card: 10, p_action: crypto.randomUUID() });
    expect(await errorOf(t.rpc(ids[0]!, 'play_card', { p_room: room, p_card: 10, p_action: crypto.randomUUID() }))).toBe('NOT_IN_HAND');
    const [r] = await t.admin<any>(`select lives, pile from public.rooms where id = $1`, [room]);
    expect(r.lives).toBe(2);
    expect(r.pile).toHaveLength(1);
  });

  it('un error no puede descontar dos vidas aunque se reintente', async () => {
    const { ids, room } = await started(3);
    await setHands(room, ids, [[18, 60], [25, 70], [40, 80]]);
    const action = crypto.randomUUID();
    await t.rpc(ids[2]!, 'play_card', { p_room: room, p_card: 40, p_action: action });
    await t.rpc(ids[2]!, 'play_card', { p_room: room, p_card: 40, p_action: action });
    expect(await errorOf(t.rpc(ids[2]!, 'play_card', { p_room: room, p_card: 40 }))).toBe('NOT_IN_HAND');
    const [r] = await t.admin<any>(`select lives from public.rooms where id = $1`, [room]);
    expect(r.lives).toBe(2);
  });

  it('dos jugadores pulsando a la vez: se procesan en orden y la versión crece en cada jugada', async () => {
    const { ids, room } = await started(2);
    await setHands(room, ids, [[10, 50], [20, 60]]);
    // PGlite usa una sola conexión: Promise.all encola ambas transacciones. En Supabase, el
    // bloqueo `FOR UPDATE` de la sala produce el mismo efecto con conexiones reales.
    const results = await Promise.all([
      t.rpc(ids[1]!, 'play_card', { p_room: room, p_card: 20 }),
      t.rpc(ids[0]!, 'play_card', { p_room: room, p_card: 10 }).catch((e: Error) => e.message),
    ]);
    const versions = results.filter((r) => typeof r === 'object').map((r: any) => r.room.version);
    expect(new Set(versions).size).toBe(versions.length);
    const [r] = await t.admin<any>(`select lives, pile, version from public.rooms where id = $1`, [room]);
    // Se procesó primero el 20 → el 10 pendiente provoca un error (1 vida).
    expect(r.pile.map((x: any) => x.c)).toEqual([20]);
    expect(r.lives).toBe(1);
    expect(results[1]).toBe('NOT_IN_HAND');
  });

  it('votar el shuriken dos veces no lo consume dos veces', async () => {
    const { ids, room } = await started(3);
    await t.admin(`update public.rooms set shurikens = 2 where id = $1`, [room]);
    await t.rpc(ids[0]!, 'propose_shuriken', { p_room: room });
    await t.rpc(ids[1]!, 'vote_shuriken', { p_room: room, p_accept: true });
    await t.rpc(ids[1]!, 'vote_shuriken', { p_room: room, p_accept: true });
    let [r] = await t.admin<any>(`select shurikens, vote from public.rooms where id = $1`, [room]);
    expect(r.shurikens).toBe(2);
    expect(r.vote.votes).toHaveLength(2);
    await t.rpc(ids[2]!, 'vote_shuriken', { p_room: room, p_accept: true });
    [r] = await t.admin<any>(`select shurikens, vote from public.rooms where id = $1`, [room]);
    expect(r.shurikens).toBe(1);
    expect(r.vote).toBeNull();
  });

  it('una votación caducada se cancela y deja jugar', async () => {
    const { ids, room } = await started(2);
    await setHands(room, ids, [[10], [20]]);
    await t.rpc(ids[0]!, 'propose_shuriken', { p_room: room });
    expect(await errorOf(t.rpc(ids[0]!, 'play_card', { p_room: room, p_card: 10 }))).toBe('VOTE_IN_PROGRESS');
    await t.admin(`update public.rooms set vote = jsonb_set(vote, '{expiresAt}', to_jsonb(now() - interval '1 second')) where id = $1`, [room]);
    const snap: RoomSnapshot = await t.rpc(ids[1]!, 'expire_shuriken_vote', { p_room: room });
    expect(snap.vote).toBeNull();
    expect(snap.room.shurikens).toBe(1);
    expect(await errorOf(t.rpc(ids[0]!, 'play_card', { p_room: room, p_card: 10 }))).toBe('OK');
  });

  it('una votación caducada bloquea a quien la propuso hasta que se juegue una carta', async () => {
    const { ids, room } = await started(2);
    await setHands(room, ids, [[10, 60], [20, 70]]);
    await t.rpc(ids[0]!, 'propose_shuriken', { p_room: room });
    await t.admin(`update public.rooms set vote = jsonb_set(vote, '{expiresAt}', to_jsonb(now() - interval '1 second')) where id = $1`, [room]);
    let snap: RoomSnapshot = await t.rpc(ids[1]!, 'expire_shuriken_vote', { p_room: room });
    expect(snap.room.shurikenBlocked).toEqual([ids[0]]);
    expect(await errorOf(t.rpc(ids[0]!, 'propose_shuriken', { p_room: room }))).toBe('SHURIKEN_BLOCKED');
    snap = await t.rpc(ids[0]!, 'play_card', { p_room: room, p_card: 10 });
    expect(snap.room.shurikenBlocked).toEqual([]);
    expect(await errorOf(t.rpc(ids[0]!, 'propose_shuriken', { p_room: room }))).toBe('OK');
  });

  it('salir de la sala cancela la votación sin bloquear a nadie', async () => {
    const { ids, room } = await started(3);
    await t.rpc(ids[0]!, 'propose_shuriken', { p_room: room });
    const before = await t.admin<any>(`select shuriken_blocked from public.rooms where id = $1`, [room]);
    await t.rpc(ids[2]!, 'leave_room', { p_room: room });
    const [r] = await t.admin<any>(`select vote, shuriken_blocked from public.rooms where id = $1`, [room]);
    expect(before[0].shuriken_blocked).toEqual([]);
    expect(r.vote).toBeNull();
    expect(r.shuriken_blocked).toEqual([]);
  });

  it('«listo» repetido o tardío no salta niveles', async () => {
    const { ids, room } = await started(2);
    await setHands(room, ids, [[10], [20]]);
    await t.rpc(ids[0]!, 'play_card', { p_room: room, p_card: 10 });
    await t.rpc(ids[1]!, 'play_card', { p_room: room, p_card: 20 });
    await t.rpc(ids[0]!, 'ready_next_level', { p_room: room, p_level: 1 });
    await t.rpc(ids[0]!, 'ready_next_level', { p_room: room, p_level: 1 });
    let snap: RoomSnapshot = await t.rpc(ids[1]!, 'get_room_state', { p_room: room });
    expect(snap.room.status).toBe('level_complete');
    await t.rpc(ids[1]!, 'ready_next_level', { p_room: room, p_level: 1 });
    snap = await t.rpc(ids[1]!, 'ready_next_level', { p_room: room, p_level: 1 });
    expect(snap.room.level).toBe(2);
    expect(snap.room.status).toBe('playing');
    expect(snap.myHand).toHaveLength(2);
  });
});

describe('partidas completas a través de la API', () => {
  it.each([2, 3, 4])('%i jugadores: reparto correcto en cada nivel y victoria final', async (n) => {
    const { ids, room } = await started(n);
    const maxLevel = PLAYER_PRESETS[n]!.levels;
    for (let level = 1; level <= maxLevel; level++) {
      const hands = await allHands(room);
      expect(hands).toHaveLength(n * level);
      expect(new Set(hands.map((h) => h.card)).size).toBe(n * level);
      for (const id of ids) expect(hands.filter((h) => h.user_id === id)).toHaveLength(level);
      for (const h of hands) await t.rpc(h.user_id, 'play_card', { p_room: room, p_card: h.card, p_action: crypto.randomUUID() });
      if (level < maxLevel) {
        const snap: RoomSnapshot = await t.rpc(ids[0]!, 'get_room_state', { p_room: room });
        expect(snap.room.status).toBe('level_complete');
        expect(snap.lastReward?.level).toBe(level);
        // Si hay comodín para elegir, todos votan el primero que se ofrece.
        const offer = snap.room.offer;
        if (offer) for (const id of ids) await t.rpc(id, 'pick_comodin', { p_room: room, p_level: level, p_kind: offer.choices[0] });
        for (const id of ids) await t.rpc(id, 'ready_next_level', { p_room: room, p_level: level });
      }
    }
    const final: RoomSnapshot = await t.rpc(ids[1]!, 'get_room_state', { p_room: room });
    expect(final.room.status).toBe('won');
    expect(final.room.lives).toBeLessThanOrEqual(5);
    expect(final.room.shurikens).toBeLessThanOrEqual(3);

    const history = await t.rpc(ids[1]!, 'get_my_history', {});
    expect(history.stats).toEqual({ played: 1, won: 1, bestLevel: maxLevel });

    // Revancha con el mismo grupo.
    const again: RoomSnapshot = await t.rpc(ids[0]!, 'rematch', { p_room: room });
    expect(again.room.status).toBe('lobby');
    expect(again.players).toHaveLength(n);
    expect(again.players.every((p) => !p.ready)).toBe(true); // la revancha exige volver a marcar «Listo»
    await readyAll(room, ids);
    const second: RoomSnapshot = await t.rpc(ids[0]!, 'start_game', { p_room: room });
    expect(second.room.gameNo).toBe(2);
    expect(second.myHand).toHaveLength(1);
  });

  it('el reparto del servidor es uniforme (sin favorecer a ningún asiento)', async () => {
    const { ids, room } = await started(2);
    let firstLower = 0;
    const rounds = 400;
    for (let i = 0; i < rounds; i++) {
      await t.admin(`select game_private.deal($1)`, [room]);
      const hands = await allHands(room);
      if (hands[0]!.user_id === ids[0]) firstLower++;
    }
    expect(firstLower / rounds).toBeGreaterThan(0.4);
    expect(firstLower / rounds).toBeLessThan(0.6);
  });
});

describe('migración', () => {
  it('se puede volver a ejecutar sin errores ni pérdida de datos', async () => {
    const { ids, room } = await started(2);
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync(new URL('../../supabase/migrations/20261019000000_unisono.sql', import.meta.url), 'utf8');
    await t.db.exec(sql);
    const snap: RoomSnapshot = await t.rpc(ids[0]!, 'get_room_state', { p_room: room });
    expect(snap.myHand).toHaveLength(1);
    // Y los permisos siguen cerrados.
    expect(await errorOf(t.as(ids[0]!, `update public.rooms set lives = 99`))).toMatch(/permission denied/);
  });
});

describe('niveles a jugar', () => {
  it('se puede elegir jugar menos niveles y la partida termina antes', async () => {
    const { ids, room } = await started(2, { levels: 2 });
    const snap0: RoomSnapshot = await t.rpc(ids[0]!, 'get_room_state', { p_room: room });
    expect(snap0.room.maxLevel).toBe(2);
    for (let level = 1; level <= 2; level++) {
      for (const h of await allHands(room)) await t.rpc(h.user_id, 'play_card', { p_room: room, p_card: h.card });
      if (level < 2) for (const id of ids) await t.rpc(id, 'ready_next_level', { p_room: room, p_level: level });
    }
    const final: RoomSnapshot = await t.rpc(ids[0]!, 'get_room_state', { p_room: room });
    expect(final.room.status).toBe('won');
  });

  it('nunca más niveles de los que permite el número de jugadores', async () => {
    const { ids, room } = await started(4, { levels: 12 });
    const snap: RoomSnapshot = await t.rpc(ids[0]!, 'get_room_state', { p_room: room });
    expect(snap.room.maxLevel).toBe(8);
  });
});

describe('orden descendente', () => {
  it('la mano llega ordenada en orden de juego (de mayor a menor) y el reparto también', async () => {
    const { ids, room } = await started(2, { order: 'desc' });
    const dealt: RoomSnapshot = await t.rpc(ids[0]!, 'get_room_state', { p_room: room });
    expect(dealt.room.config.order).toBe('desc');
    await setHands(room, ids, [[10, 30, 20], [5, 7, 6]]);
    const snap: RoomSnapshot = await t.rpc(ids[0]!, 'get_room_state', { p_room: room });
    expect(snap.myHand).toEqual([30, 20, 10]);
    expect(await errorOf(t.rpc(ids[0]!, 'play_card', { p_room: room, p_card: 10 }))).toBe('NOT_LOWEST');
    expect(await errorOf(t.rpc(ids[0]!, 'play_card', { p_room: room, p_card: 30 }))).toBe('OK');
  });
});

describe('chat (modo amigos)', () => {
  it('desactivado en modo concentración', async () => {
    const { ids, room } = await started(2);
    expect(await errorOf(t.rpc(ids[0]!, 'send_chat', { p_room: room, p_body: 'hola' }))).toBe('CHAT_DISABLED');
  });

  it('funciona en modo amigos, con límites', async () => {
    const { ids, room } = await started(2, { mode: 'friends' });
    expect(await t.rpc(ids[0]!, 'send_chat', { p_room: room, p_body: '  ¡vamos!  ' })).toEqual({ ok: true });
    expect(await errorOf(t.rpc(ids[0]!, 'send_chat', { p_room: room, p_body: 'otra' }))).toBe('TOO_FAST');
    expect(await errorOf(t.rpc(ids[1]!, 'send_chat', { p_room: room, p_body: 'x'.repeat(201) }))).toBe('INVALID_MESSAGE');
    const rows = await t.as<{ name: string; body: string }>(ids[1]!, `select name, body from public.chat_messages where room_id = $1`, [room]);
    expect(rows).toEqual([{ name: 'Ana', body: '¡vamos!' }]);
  });

  it('no deja enviar números, en ninguna forma', async () => {
    const { ids, room } = await started(2, { mode: 'friends' });
    for (const body of ['42', 'tengo el 7', 'casi 100!', '７', 'el ① y el Ⅻ', '½', 'x²', '٣']) {
      expect(await errorOf(t.rpc(ids[0]!, 'send_chat', { p_room: room, p_body: body })), body).toBe('NO_NUMBERS');
    }
    expect(await t.rpc(ids[0]!, 'send_chat', { p_room: room, p_body: 'Ⓐ ¡ya casi, sin prisa! ¿Tienes alguna baja?' })).toEqual({ ok: true });
    const rows = await t.as<{ body: string }>(ids[0]!, `select body from public.chat_messages where room_id = $1`, [room]);
    expect(rows).toEqual([{ body: 'Ⓐ ¡ya casi, sin prisa! ¿Tienes alguna baja?' }]);
  });
});

describe('comodines a través de la API', () => {
  it('la elección de comodín: votos visibles, empate al azar y solo entre los ofrecidos', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const { ids, room } = await started(2, { maxShurikens: 1 });
      await setHands(room, ids, [[1], [2]], 2);
      await t.rpc(ids[0]!, 'play_card', { p_room: room, p_card: 1 });
      let snap: RoomSnapshot = await t.rpc(ids[1]!, 'play_card', { p_room: room, p_card: 2 });
      expect(snap.room.status).toBe('level_complete');
      expect([...snap.room.offer!.choices].sort()).toEqual(['rewind', 'shield']);
      expect(await errorOf(t.rpc(ids[0]!, 'pick_comodin', { p_room: room, p_level: 2, p_kind: 'shuriken' }))).toBe('INVALID_STATE');
      expect(await errorOf(t.rpc(ids[0]!, 'pick_comodin', { p_room: room, p_level: 2, p_kind: null }))).toBe('INVALID_STATE');
      snap = await t.rpc(ids[0]!, 'pick_comodin', { p_room: room, p_level: 2, p_kind: 'rewind' });
      expect(snap.room.offer!.votes).toEqual({ [ids[0]!]: 'rewind' });
      // Un voto tardío de otro nivel no hace nada.
      await t.rpc(ids[1]!, 'pick_comodin', { p_room: room, p_level: 1, p_kind: 'shield' });
      snap = await t.rpc(ids[1]!, 'pick_comodin', { p_room: room, p_level: 2, p_kind: 'shield' });
      expect(snap.room.offer).toBeNull();
      expect((snap.room.rewinds ?? 0) + (snap.room.shields ?? 0)).toBe(1);
      expect(snap.recentEvents!.at(-1)).toMatchObject({ kind: 'comodin_chosen', payload: { how: 'tie' } });
      expect(snap.lastReward).toMatchObject({ level: 2, shurikens: 0 });
      seen.add(snap.room.rewinds ? 'rewind' : 'shield');
    }
    expect(seen).toEqual(new Set(['rewind', 'shield']));
  });

  it('el anfitrión puede forzar el nivel con la elección pendiente', async () => {
    const { ids, room } = await started(2, { maxShurikens: 1 });
    await setHands(room, ids, [[1], [2]], 2);
    await t.rpc(ids[0]!, 'play_card', { p_room: room, p_card: 1 });
    await t.rpc(ids[1]!, 'play_card', { p_room: room, p_card: 2 });
    await t.rpc(ids[1]!, 'pick_comodin', { p_room: room, p_level: 2, p_kind: 'shield' });
    await t.rpc(ids[1]!, 'ready_next_level', { p_room: room, p_level: 2, p_force: true }); // no es anfitrión
    let snap: RoomSnapshot = await t.rpc(ids[0]!, 'get_room_state', { p_room: room });
    expect(snap.room.status).toBe('level_complete');
    snap = await t.rpc(ids[0]!, 'ready_next_level', { p_room: room, p_level: 2, p_force: true });
    expect(snap.room).toMatchObject({ status: 'playing', level: 3, shields: 1, offer: null });
  });

  it('rebobinar caduca y cuenta como no usarlo (con la última vida, se pierde)', async () => {
    const { ids, room } = await started(2);
    await setHands(room, ids, [[30, 80], [50, 90]]);
    await t.admin(`update public.rooms set lives = 1, rewinds = 1 where id = $1`, [room]);
    let snap: RoomSnapshot = await t.rpc(ids[1]!, 'play_card', { p_room: room, p_card: 50 });
    expect(snap.vote).toMatchObject({ kind: 'rewind', proposer: null, votes: [] });
    expect(snap.room).toMatchObject({ status: 'playing', lives: 0 });
    // Aún no ha caducado: no pasa nada.
    snap = await t.rpc(ids[0]!, 'expire_shuriken_vote', { p_room: room });
    expect(snap.vote).not.toBeNull();
    await t.admin(`update public.rooms set vote = jsonb_set(vote, '{expiresAt}', to_jsonb(now() - interval '1 second')) where id = $1`, [room]);
    snap = await t.rpc(ids[0]!, 'expire_shuriken_vote', { p_room: room });
    expect(snap.room).toMatchObject({ status: 'lost', rewinds: 1 });
    const h = await t.rpc(ids[0]!, 'get_my_history', {});
    expect(h.games[0].result).toBe('lost');
  });

  it('proponer escudo dos veces con el mismo action_id solo crea una votación', async () => {
    const { ids, room } = await started(2);
    await t.admin(`update public.rooms set shields = 1 where id = $1`, [room]);
    const action = crypto.randomUUID();
    await t.rpc(ids[0]!, 'propose_shield', { p_room: room, p_action: action });
    const snap: RoomSnapshot = await t.rpc(ids[0]!, 'propose_shield', { p_room: room, p_action: action });
    expect(snap.vote).toMatchObject({ kind: 'shield', votes: [ids[0]] });
    const after: RoomSnapshot = await t.rpc(ids[1]!, 'vote_shuriken', { p_room: room, p_accept: true });
    expect(after.room).toMatchObject({ shields: 0, shieldActive: true });
    expect(after.lastEvent?.kind).toBe('shield_used');
  });

  it('la revancha reinicia los comodines', async () => {
    const { ids, room } = await started(2);
    await t.admin(`update public.rooms set rewinds = 2, shields = 1, shield_active = true where id = $1`, [room]);
    await t.rpc(ids[1]!, 'leave_room', { p_room: room });
    const snap: RoomSnapshot = await t.rpc(ids[0]!, 'rematch', { p_room: room });
    expect(snap.room).toMatchObject({ rewinds: 0, shields: 0, shieldActive: false, offer: null });
  });
});

describe('ronda relámpago a través de la API', () => {
  it('se sortea al empezar en un nivel que nunca es el último, y la revancha la quita', async () => {
    const seen = new Set<number>();
    for (let i = 0; i < 25; i++) {
      const { ids, room } = await started(4); // 8 niveles
      const snap: RoomSnapshot = await t.rpc(ids[0]!, 'get_room_state', { p_room: room });
      expect(snap.room.lightningLevel).toBeGreaterThanOrEqual(1);
      expect(snap.room.lightningLevel).toBeLessThan(PLAYER_PRESETS[4]!.levels);
      seen.add(snap.room.lightningLevel!);
      if (i === 0) {
        await t.admin(`update public.rooms set status = 'lost' where id = $1`, [room]);
        const again: RoomSnapshot = await t.rpc(ids[0]!, 'rematch', { p_room: room });
        expect(again.room).toMatchObject({ lightningLevel: 0, lightningEndsAt: null });
      }
    }
    expect(seen.size).toBeGreaterThan(2);
    const { ids, room } = await started(2, { levels: 1 });
    const one: RoomSnapshot = await t.rpc(ids[0]!, 'get_room_state', { p_room: room });
    expect(one.room).toMatchObject({ lightningLevel: 0, lightningEndsAt: null });
  });

  it('el reloj dura lo mismo que en la app (aviso + 60 s … 90 s según el nivel)', async () => {
    const { ids, room } = await started(2);
    await t.admin(`update public.rooms set lightning_level = 5, lightning_ends_at = null where id = $1`, [room]);
    await setHands(room, ids, [[10], [20]], 4);
    await t.rpc(ids[0]!, 'play_card', { p_room: room, p_card: 10 });
    await t.rpc(ids[1]!, 'play_card', { p_room: room, p_card: 20 });
    await t.rpc(ids[0]!, 'ready_next_level', { p_room: room, p_level: 4 });
    const snap: RoomSnapshot = await t.rpc(ids[1]!, 'ready_next_level', { p_room: room, p_level: 4 });
    expect(snap.room.level).toBe(5);
    const seconds = (Date.parse(snap.room.lightningEndsAt!) - Date.parse(snap.serverTime)) / 1000;
    expect(seconds).toBeCloseTo(LIGHTNING_INTRO_SECONDS + lightningSeconds(5), 0);
  });

  it('al agotarse el tiempo la partida queda perdida y en el historial', async () => {
    const { ids, room } = await started(2);
    await t.admin(
      `update public.rooms set lightning_level = level, lightning_ends_at = now() - interval '1 second' where id = $1`,
      [room],
    );
    const snap: RoomSnapshot = await t.rpc(ids[1]!, 'expire_shuriken_vote', { p_room: room });
    expect(snap.room).toMatchObject({ status: 'lost', lives: 0, lightningEndsAt: null });
    expect(snap.recentEvents!.map((e) => e.kind).slice(-2)).toEqual(['lightning_timeout', 'lost']);
    const results = await t.admin<{ result: string }>(`select result from public.game_results where room_id = $1`, [room]);
    expect(results.map((r) => r.result)).toEqual(['lost']);
  });
});

describe('ronda final a través de la API', () => {
  it('manos ocultas y mesa a ciegas: el servidor no envía lo que no se puede ver', async () => {
    const { ids, room } = await started(2, { levels: 2 });
    await setHands(room, ids, [[10, 40], [20, 50]], 2);
    let snap: RoomSnapshot = await t.rpc(ids[0]!, 'get_room_state', { p_room: room });
    expect(snap.players.map((p) => p.cardsLeft)).toEqual([2, null]);

    await t.rpc(ids[0]!, 'play_card', { p_room: room, p_card: 10 });
    snap = await t.rpc(ids[1]!, 'play_card', { p_room: room, p_card: 20 });
    expect(snap.pile).toEqual([{ c: 20, p: ids[1] }]);
    expect(snap.room.pileHidden).toBe(1);
    expect(snap.players.map((p) => p.cardsLeft)).toEqual([null, 1]);

    // Pasados unos segundos, la última carta también queda boca abajo.
    await t.admin(`update public.rooms set pile_at = now() - interval '4 seconds' where id = $1`, [room]);
    snap = await t.rpc(ids[0]!, 'get_room_state', { p_room: room });
    expect(snap.pile).toEqual([]);
    expect(snap.room.pileHidden).toBe(2);
    expect(snap.recentEvents!.filter((e) => e.kind === 'play').map((e) => e.payload)).toEqual([{}, {}]);
    expect(JSON.stringify(snap)).not.toMatch(/"c": ?(10|20)\b/);

    // Al ganar, se ve toda la mesa.
    await t.rpc(ids[0]!, 'play_card', { p_room: room, p_card: 40 });
    snap = await t.rpc(ids[1]!, 'play_card', { p_room: room, p_card: 50 });
    expect(snap.room.status).toBe('won');
    expect(snap.pile.map((x) => x.c)).toEqual([10, 20, 40, 50]);
  });

  it('en los demás niveles todo se ve como siempre', async () => {
    const { ids, room } = await started(2, { levels: 3 });
    await setHands(room, ids, [[10, 40], [20, 50]], 2);
    await t.rpc(ids[0]!, 'play_card', { p_room: room, p_card: 10 });
    await t.admin(`update public.rooms set pile_at = now() - interval '1 minute' where id = $1`, [room]);
    const snap: RoomSnapshot = await t.rpc(ids[1]!, 'get_room_state', { p_room: room });
    expect(snap.pile).toEqual([{ c: 10, p: ids[0] }]);
    expect(snap.room.pileHidden).toBe(0);
    expect(snap.players.map((p) => p.cardsLeft)).toEqual([1, 2]);
  });
});
