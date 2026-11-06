/**
 * Amigos contra el servidor SQL real (PGlite): solicitudes por código o desde una sala, invitar
 * directamente a una sala, quién está conectado, y que nadie vea ni haga nada que no le toque.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { RoomSnapshot } from '../../src/game/types';
import { createTestDb, errorOf, type TestDb } from './db';
import { gameHelpers } from './game';

interface Card {
  id: string;
  name: string;
  title: { id: string; name: string; rarity: string } | null;
  status?: 'online' | 'playing' | 'offline';
}

interface Friends {
  code: string;
  friends: Card[];
  incoming: Card[];
  outgoing: Card[];
  invites: { id: number; fromName: string; expiresAt: string }[];
  result?: 'friends' | 'requested';
}

let t: TestDb;
let h: ReturnType<typeof gameHelpers>;
beforeAll(async () => {
  t = await createTestDb();
  h = gameHelpers(t);
});

const state = (uid: string): Promise<Friends> => t.rpc(uid, 'get_friends', {});
const code = async (uid: string) => (await state(uid)).code;
const signal = async (uid: string) =>
  Number((await t.admin<{ version: string }>(`select version from public.player_signals where user_id = $1`, [uid]))[0]?.version ?? 0);

/** Dos jugadores que ya son amigos. */
async function friends(nameA = 'Ana', nameB = 'Beto') {
  const a = await t.newUser();
  const b = await t.newUser();
  await t.rpc(a, 'touch_presence', { p_name: nameA });
  await t.rpc(b, 'touch_presence', { p_name: nameB });
  await t.rpc(a, 'add_friend', { p_code: await code(b) });
  await t.rpc(b, 'respond_friend_request', { p_from: a, p_accept: true });
  return { a, b };
}

async function lobby(uid: string, name = 'Ana', config: object = {}) {
  const snap: RoomSnapshot = await t.rpc(uid, 'create_room', { p_name: name, p_config: config });
  return snap.room.id;
}

describe('código de amigo', () => {
  it('cada jugador tiene uno propio, de 8 caracteres, que no cambia', async () => {
    const a = await t.newUser();
    const b = await t.newUser();
    const first = await code(a);
    expect(first).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(await code(a)).toBe(first);
    expect(await code(b)).not.toBe(first);
  });

  it('un código que no existe no da pistas y no se puede probar sin límite', async () => {
    const a = await t.newUser();
    for (let i = 0; i < 20; i++) {
      expect((await t.rpc<{ error: string }>(a, 'add_friend', { p_code: 'ZZZZZZZZ' })).error).toBe('FRIEND_NOT_FOUND');
    }
    expect(await errorOf(t.rpc(a, 'add_friend', { p_code: 'ZZZZZZZZ' }))).toBe('TOO_MANY_ATTEMPTS');
  });

  it('acepta el código con guion, espacios o en minúsculas', async () => {
    const a = await t.newUser();
    const b = await t.newUser();
    const c = await code(b);
    const res: Friends = await t.rpc(a, 'add_friend', { p_code: ` ${c.slice(0, 4).toLowerCase()}-${c.slice(4)} ` });
    expect(res.result).toBe('requested');
  });
});

describe('solicitudes', () => {
  it('se envía, la recibe el otro al momento y al aceptarla sois amigos los dos', async () => {
    const a = await t.newUser();
    const b = await t.newUser();
    await t.rpc(a, 'touch_presence', { p_name: 'Ana' });
    await t.rpc(b, 'touch_presence', { p_name: 'Beto' });
    const before = await signal(b);
    const sent: Friends = await t.rpc(a, 'add_friend', { p_code: await code(b) });
    expect(sent.result).toBe('requested');
    expect(sent.outgoing.map((x) => x.name)).toEqual(['Beto']);
    expect(await signal(b)).toBeGreaterThan(before);
    expect((await state(b)).incoming.map((x) => x.name)).toEqual(['Ana']);

    const done: Friends = await t.rpc(b, 'respond_friend_request', { p_from: a, p_accept: true });
    expect(done.incoming).toEqual([]);
    expect(done.friends.map((x) => x.name)).toEqual(['Ana']);
    const other = await state(a);
    expect(other.friends.map((x) => x.name)).toEqual(['Beto']);
    expect(other.outgoing).toEqual([]);
  });

  it('rechazarla la borra y no os hace amigos; se puede volver a pedir', async () => {
    const a = await t.newUser();
    const b = await t.newUser();
    await t.rpc(a, 'add_friend', { p_code: await code(b) });
    await t.rpc(b, 'respond_friend_request', { p_from: a, p_accept: false });
    expect((await state(a)).outgoing).toEqual([]);
    expect((await state(a)).friends).toEqual([]);
    expect((await t.rpc<Friends>(a, 'add_friend', { p_code: await code(b) })).result).toBe('requested');
  });

  it('si los dos os la pedís, sois amigos sin más', async () => {
    const a = await t.newUser();
    const b = await t.newUser();
    await t.rpc(a, 'add_friend', { p_code: await code(b) });
    const res: Friends = await t.rpc(b, 'add_friend', { p_code: await code(a) });
    expect(res.result).toBe('friends');
    expect(res.friends).toHaveLength(1);
  });

  it('se puede cancelar la que enviaste, y repetirla no la duplica', async () => {
    const a = await t.newUser();
    const b = await t.newUser();
    const c = await code(b);
    await t.rpc(a, 'add_friend', { p_code: c });
    await t.rpc(a, 'add_friend', { p_code: c });
    expect((await state(b)).incoming).toHaveLength(1);
    await t.rpc(a, 'cancel_friend_request', { p_to: b });
    expect((await state(b)).incoming).toEqual([]);
  });

  it('no puedes añadirte a ti ni a quien ya es tu amigo', async () => {
    const { a, b } = await friends();
    expect(await errorOf(t.rpc(a, 'add_friend', { p_code: await code(a) }))).toBe('CANNOT_ADD_SELF');
    expect(await errorOf(t.rpc(a, 'add_friend', { p_code: await code(b) }))).toBe('ALREADY_FRIENDS');
  });

  it('nadie puede aceptar una solicitud que no es suya ni inexistente', async () => {
    const a = await t.newUser();
    const b = await t.newUser();
    const intruso = await t.newUser();
    await t.rpc(a, 'add_friend', { p_code: await code(b) });
    expect(await errorOf(t.rpc(intruso, 'respond_friend_request', { p_from: a, p_accept: true }))).toBe('REQUEST_NOT_FOUND');
    expect((await state(a)).friends).toEqual([]);
  });

  it('eliminar a un amigo lo quita a los dos y anula sus invitaciones', async () => {
    const { a, b } = await friends();
    const room = await lobby(a);
    await t.rpc(a, 'invite_friend', { p_room: room, p_friend: b });
    await t.rpc(a, 'remove_friend', { p_friend: b });
    expect((await state(a)).friends).toEqual([]);
    const other = await state(b);
    expect(other.friends).toEqual([]);
    expect(other.invites).toEqual([]);
  });
});

describe('añadir desde una sala', () => {
  it('sin código, a quien está contigo en la sala', async () => {
    const a = await t.newUser();
    const b = await t.newUser();
    const snap: RoomSnapshot = await t.rpc(a, 'create_room', { p_name: 'Ana', p_config: {} });
    await t.rpc(b, 'join_room', { p_code: snap.room.code, p_name: 'Beto' });
    const res: Friends = await t.rpc(a, 'add_friend_from_room', { p_room: snap.room.id, p_target: b });
    expect(res.result).toBe('requested');
    expect((await state(b)).incoming).toHaveLength(1);
  });

  it('no sirve con quien no está en tu sala', async () => {
    const a = await t.newUser();
    const b = await t.newUser();
    const room = await lobby(a);
    expect(await errorOf(t.rpc(a, 'add_friend_from_room', { p_room: room, p_target: b }))).toBe('NOT_MEMBER');
    const ajena = await lobby(b, 'Beto');
    expect(await errorOf(t.rpc(a, 'add_friend_from_room', { p_room: ajena, p_target: b }))).toBe('NOT_MEMBER');
    expect((await state(b)).incoming).toEqual([]);
  });

  it('no puedes añadirte a ti mismo', async () => {
    const a = await t.newUser();
    expect(await errorOf(t.rpc(a, 'add_friend_from_room', { p_room: await lobby(a), p_target: a }))).toBe('CANNOT_ADD_SELF');
  });
});

describe('quién está conectado', () => {
  it('se ve el alias, el título y si está conectado, jugando o desconectado', async () => {
    const { a, b } = await friends('Ana', 'Beto');
    expect((await state(a)).friends[0]).toMatchObject({ name: 'Beto', status: 'online', title: null });

    await h.grant(b, 10);
    await t.rpc(b, 'buy_cosmetic', { p_cosmetic: 'title_apprentice' });
    await t.rpc(b, 'equip_cosmetic', { p_cosmetic: 'title_apprentice' });
    expect((await state(a)).friends[0]!.title?.name).toBe('Aprendiz');

    const c = await t.newUser();
    const room = await h.startedWith([b, c]);
    expect(room).toBeTruthy();
    expect((await state(a)).friends[0]!.status).toBe('playing');

    await t.admin(`update public.player_public set last_seen_at = now() - interval '2 minutes' where user_id = $1`, [b]);
    expect((await state(a)).friends[0]!.status).toBe('offline');
  });

  it('el alias se actualiza, y uno no válido no borra el anterior', async () => {
    const { a, b } = await friends('Ana', 'Beto');
    await t.rpc(b, 'touch_presence', { p_name: 'Bet' });
    expect((await state(a)).friends[0]!.name).toBe('Bet');
    await t.rpc(b, 'touch_presence', { p_name: '   ' });
    expect((await state(a)).friends[0]!.name).toBe('Bet');
  });

  it('los conectados salen primero', async () => {
    const { a, b } = await friends('Ana', 'Aaron');
    const c = await t.newUser();
    await t.rpc(c, 'touch_presence', { p_name: 'Zoe' });
    await t.rpc(a, 'add_friend', { p_code: await code(c) });
    await t.rpc(c, 'respond_friend_request', { p_from: a, p_accept: true });
    await t.admin(`update public.player_public set last_seen_at = now() - interval '2 minutes' where user_id = $1`, [b]);
    expect((await state(a)).friends.map((x) => x.name)).toEqual(['Zoe', 'Aaron']);
  });
});

describe('invitar a una sala', () => {
  it('le llega al amigo y al aceptar entra en la sala sin saber el código', async () => {
    const { a, b } = await friends();
    const room = await lobby(a);
    const before = await signal(b);
    await t.rpc(a, 'invite_friend', { p_room: room, p_friend: b });
    expect(await signal(b)).toBeGreaterThan(before);

    const { invites } = await state(b);
    expect(invites).toHaveLength(1);
    expect(invites[0]!.fromName).toBe('Ana');
    expect(JSON.stringify(invites)).not.toContain(room);

    const snap: RoomSnapshot = await t.rpc(b, 'accept_invite', { p_invite: invites[0]!.id, p_name: 'Beto' });
    expect(snap.room.id).toBe(room);
    expect(snap.players.map((p) => p.name)).toEqual(['Ana', 'Beto']);
    expect((await state(b)).invites).toEqual([]);
  });

  it('rechazarla la quita; repetirla la renueva sin duplicarla', async () => {
    const { a, b } = await friends();
    const room = await lobby(a);
    await t.rpc(a, 'invite_friend', { p_room: room, p_friend: b });
    await t.rpc(a, 'invite_friend', { p_room: room, p_friend: b });
    const { invites } = await state(b);
    expect(invites).toHaveLength(1);
    const res: Friends = await t.rpc(b, 'decline_invite', { p_invite: invites[0]!.id });
    expect(res.invites).toEqual([]);
  });

  it('caduca a los 2 minutos', async () => {
    const { a, b } = await friends();
    await t.rpc(a, 'invite_friend', { p_room: await lobby(a), p_friend: b });
    const { invites } = await state(b);
    await t.admin(`update public.room_invites set expires_at = now() - interval '1 second' where to_user = $1`, [b]);
    expect((await state(b)).invites).toEqual([]);
    expect(await errorOf(t.rpc(b, 'accept_invite', { p_invite: invites[0]!.id, p_name: 'Beto' }))).toBe('INVITE_EXPIRED');
  });

  it('solo a amigos, solo desde tu sala y solo en espera', async () => {
    const { a, b } = await friends();
    const desconocido = await t.newUser();
    const room = await lobby(a);
    expect(await errorOf(t.rpc(a, 'invite_friend', { p_room: room, p_friend: desconocido }))).toBe('NOT_FRIENDS');
    expect(await errorOf(t.rpc(desconocido, 'invite_friend', { p_room: room, p_friend: b }))).toBe('NOT_MEMBER');

    const c = await t.newUser();
    const jugando = await h.startedWith([a, c]);
    expect(await errorOf(t.rpc(a, 'invite_friend', { p_room: jugando, p_friend: b }))).toBe('NOT_IN_LOBBY');
  });

  it('no se puede invitar a quien ya está, ni a una sala llena', async () => {
    const { a, b } = await friends();
    const snap: RoomSnapshot = await t.rpc(a, 'create_room', { p_name: 'Ana', p_config: { maxPlayers: 2 } });
    const room = snap.room.id;
    await t.rpc(a, 'invite_friend', { p_room: room, p_friend: b });
    const inviteId = (await state(b)).invites[0]!.id;
    await t.rpc(b, 'accept_invite', { p_invite: inviteId, p_name: 'Beto' });
    expect(await errorOf(t.rpc(a, 'invite_friend', { p_room: room, p_friend: b }))).toBe('ALREADY_IN_ROOM');

    const c = await t.newUser();
    await t.rpc(a, 'touch_presence', { p_name: 'Ana' });
    await t.rpc(c, 'add_friend', { p_code: await code(a) });
    await t.rpc(a, 'respond_friend_request', { p_from: c, p_accept: true });
    expect(await errorOf(t.rpc(a, 'invite_friend', { p_room: room, p_friend: c }))).toBe('ROOM_FULL');
  });

  it('la invitación de otro no sirve, y si la sala se llena o empieza no se entra', async () => {
    const { a, b } = await friends();
    const intruso = await t.newUser();
    const room = await lobby(a);
    await t.rpc(a, 'invite_friend', { p_room: room, p_friend: b });
    const id = (await state(b)).invites[0]!.id;
    expect(await errorOf(t.rpc(intruso, 'accept_invite', { p_invite: id, p_name: 'X' }))).toBe('INVITE_EXPIRED');
    expect(await errorOf(t.rpc(intruso, 'decline_invite', { p_invite: id }))).toBe('OK');
    expect((await state(b)).invites).toHaveLength(1);

    const c = await t.newUser();
    const { room: code2 } = await t.rpc<RoomSnapshot>(a, 'get_room_state', { p_room: room });
    await t.rpc(c, 'join_room', { p_code: code2.code, p_name: 'Cris' });
    for (const u of [a, c]) await t.rpc(u, 'set_lobby_ready', { p_room: room, p_ready: true });
    await t.rpc(a, 'start_game', { p_room: room });
    expect(await errorOf(t.rpc(b, 'accept_invite', { p_invite: id, p_name: 'Beto' }))).toBe('GAME_IN_PROGRESS');
  });

  it('si tu nombre ya está en la sala, la invitación sigue viva y entras con otro', async () => {
    const { a, b } = await friends();
    const room = await lobby(a, 'Ana');
    await t.rpc(a, 'invite_friend', { p_room: room, p_friend: b });
    const id = (await state(b)).invites[0]!.id;
    expect(await errorOf(t.rpc(b, 'accept_invite', { p_invite: id, p_name: 'ana' }))).toBe('NAME_TAKEN');
    expect((await state(b)).invites).toHaveLength(1);
    const snap: RoomSnapshot = await t.rpc(b, 'accept_invite', { p_invite: id, p_name: 'Anita' });
    expect(snap.players.map((p) => p.name)).toEqual(['Ana', 'Anita']);
  });

  it('si la sala desaparece, la invitación también', async () => {
    const { a, b } = await friends();
    const room = await lobby(a);
    await t.rpc(a, 'invite_friend', { p_room: room, p_friend: b });
    await t.rpc(a, 'leave_room', { p_room: room });
    expect((await state(b)).invites).toEqual([]);
  });
});

describe('cuentas', () => {
  it('al iniciar sesión, amigos, solicitudes y código pasan a la cuenta', async () => {
    const { a: guest, b: friend } = await friends('Ana', 'Beto');
    const pendiente = await t.newUser();
    await t.rpc(pendiente, 'add_friend', { p_code: await code(guest) });
    const myCode = await code(guest);
    const { token } = await t.rpc<{ token: string }>(guest, 'start_account_merge', {});

    const me = await t.newUser();
    await t.admin(`update auth.users set is_anonymous = false where id = $1`, [me]);
    await t.rpc(me, 'claim_account_merge', { p_token: token });

    const mine = await state(me);
    expect(mine.code).toBe(myCode);
    expect(mine.friends.map((x) => x.id)).toEqual([friend]);
    expect(mine.incoming.map((x) => x.id)).toEqual([pendiente]);
    expect((await state(friend)).friends.map((x) => x.id)).toEqual([me]);
    expect(await t.admin(`select 1 from public.friendships where user_id = $1 or friend_id = $1`, [guest])).toEqual([]);
  });

  it('una cuenta con amigos conserva su código, y un amigo común no se duplica', async () => {
    const { a: cuenta, b: comun } = await friends();
    await t.admin(`update auth.users set is_anonymous = false where id = $1`, [cuenta]);
    const codigo = await code(cuenta);
    const guest = await t.newUser();
    await t.rpc(guest, 'add_friend', { p_code: await code(comun) });
    await t.rpc(comun, 'respond_friend_request', { p_from: guest, p_accept: true });
    await t.rpc(guest, 'add_friend', { p_code: codigo });

    const { token } = await t.rpc<{ token: string }>(guest, 'start_account_merge', {});
    await t.rpc(cuenta, 'claim_account_merge', { p_token: token });

    const mine = await state(cuenta);
    expect(mine.code).toBe(codigo);
    expect(mine.friends.map((x) => x.id)).toEqual([comun]);
    expect(mine.incoming).toEqual([]);
    expect(mine.outgoing).toEqual([]);
  });

  it('borrar la cuenta la quita de las listas de sus amigos', async () => {
    const { a, b } = await friends();
    const before = await signal(b);
    await t.rpc(a, 'delete_my_account', {});
    expect((await state(b)).friends).toEqual([]);
    expect(await signal(b)).toBeGreaterThan(before);
    for (const table of ['player_public', 'player_signals']) {
      expect(await t.admin(`select 1 from public.${table} where user_id = $1`, [a])).toEqual([]);
    }
  });
});

describe('seguridad', () => {
  it('nadie lee las tablas de amigos desde la app; de las señales, solo la suya', async () => {
    const { a, b } = await friends();
    for (const table of ['player_public', 'friendships', 'friend_requests', 'room_invites']) {
      expect(await errorOf(t.as(a, `select * from public.${table}`))).toMatch(/permission denied/);
    }
    const rows = await t.as<{ user_id: string }>(a, `select user_id from public.player_signals`);
    expect(rows.map((r) => r.user_id)).not.toContain(b);
    expect(await errorOf(t.as(a, `update public.player_signals set version = 9`))).toMatch(/permission denied/);
    expect(await errorOf(t.as(a, `insert into public.friendships (user_id, friend_id) values ($1, $2)`, [a, b]))).toMatch(/permission denied/);
  });

  it('la lista de un jugador no enseña su código ni a sus otros amigos', async () => {
    const { a, b } = await friends();
    const seen = JSON.stringify((await state(a)).friends);
    expect(seen).not.toContain(await code(b));
  });
});
