/**
 * Economía contra el servidor SQL real (PGlite): fórmula de recompensas, cobro al terminar
 * partidas, tienda, colección, diseños en la partida y seguridad (nada se puede falsear).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { MatchReward, RoomSnapshot } from '../../src/game/types';
import { createTestDb, errorOf, type TestDb } from './db';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});

interface Profile {
  coins: number;
  equipped: Record<string, string>;
  owned: string[];
  catalog: { id: string; name: string; price: number | null; unlock: string }[];
}

async function started(n: number, config: object = {}) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(await t.newUser());
  const snap: RoomSnapshot = await t.rpc(ids[0]!, 'create_room', { p_name: 'Ana', p_config: config });
  for (let i = 1; i < n; i++) await t.rpc(ids[i]!, 'join_room', { p_code: snap.room.code, p_name: `J${i}` });
  for (const id of ids) await t.rpc(id, 'set_lobby_ready', { p_room: snap.room.id, p_ready: true });
  await t.rpc(ids[0]!, 'start_game', { p_room: snap.room.id });
  return { ids, room: snap.room.id };
}

async function setHands(room: string, ids: string[], hands: number[][], level: number) {
  await t.admin(`update public.rooms set level = $2 where id = $1`, [room, level]);
  await t.admin(`delete from public.hands where room_id = $1`, [room]);
  for (let i = 0; i < ids.length; i++) {
    for (const c of hands[i]!) await t.admin(`insert into public.hands (room_id, user_id, card) values ($1, $2, $3)`, [room, ids[i], c]);
  }
}

/** Juega la partida entera sin errores (todas las cartas en orden), nivel a nivel. */
async function playToTheEnd(room: string, ids: string[]): Promise<RoomSnapshot> {
  for (let guard = 0; guard < 30; guard++) {
    const state: RoomSnapshot = await t.rpc(ids[0]!, 'get_room_state', { p_room: room });
    if (['won', 'lost', 'abandoned'].includes(state.room.status)) return state;
    if (state.room.status === 'level_complete') {
      if (state.room.offer) for (const id of ids) await t.rpc(id, 'pick_comodin', { p_room: room, p_level: state.room.level, p_kind: state.room.offer.choices[0] });
      for (const id of ids) await t.rpc(id, 'ready_next_level', { p_room: room, p_level: state.room.level });
      continue;
    }
    const rows = await t.admin<{ user_id: string; card: number }>(`select user_id, card from public.hands where room_id = $1 order by card`, [room]);
    for (const r of rows) await t.rpc(r.user_id, 'play_card', { p_room: room, p_card: r.card });
  }
  throw new Error('la partida no terminó');
}

const reward = async (players: number, maxLevel: number, completed: number, won: boolean) =>
  (await t.admin<{ r: { total: number } }>(`select game_private.match_reward($1, $2, $3, $4) as r`, [players, maxLevel, completed, won]))[0]!.r;
const profile = (uid: string): Promise<Profile> => t.rpc(uid, 'get_my_profile', {});
/** Da monedas como lo haría un ajuste interno (solo en las pruebas). */
async function grant(uid: string, coins: number) {
  await t.admin(`select game_private.ensure_player($1)`, [uid]);
  await t.admin(`select game_private.add_coins($1, $2, 'adjustment', 'Prueba')`, [uid, coins]);
}

describe('fórmula de recompensas', () => {
  it('valores de referencia', async () => {
    expect(await reward(2, 12, 12, true)).toMatchObject({ levels: 90, participation: 2, victory: 39, total: 131 });
    expect((await reward(3, 10, 10, true)).total).toBe(139);
    expect((await reward(4, 8, 8, true)).total).toBe(118);
    expect((await reward(2, 3, 3, true)).total).toBe(14);
    expect((await reward(2, 12, 5, false)).total).toBe(22);
    expect((await reward(2, 12, 0, false)).total).toBe(0);
  });

  it('más niveles = más monedas; ganar > perder; una partida larga > muchas cortas', async () => {
    for (const players of [2, 3, 4]) {
      const max = { 2: 12, 3: 10, 4: 8 }[players]!;
      let previous = -1;
      for (let done = 0; done < max; done++) {
        const total = (await reward(players, max, done, false)).total;
        expect(total).toBeGreaterThan(previous);
        previous = total;
      }
      expect((await reward(players, max, max, true)).total).toBeGreaterThan(previous);
      let previousWin = 0;
      for (let m = 1; m <= max; m++) {
        const win = (await reward(players, m, m, true)).total;
        expect(win).toBeGreaterThan(previousWin);
        previousWin = win;
      }
      // Ganar `max` partidas de 1 nivel da mucho menos que ganar UNA de `max` niveles.
      expect(max * (await reward(players, 1, 1, true)).total).toBeLessThan((await reward(players, max, max, true)).total / 2);
    }
  });
});

describe('monedas al terminar una partida', () => {
  it('victoria: cada participante cobra una vez, con desglose y saldo antes/después', async () => {
    const { ids, room } = await started(2, { levels: 3 });
    const end = await playToTheEnd(room, ids);
    expect(end.room.status).toBe('won');
    const mine = end.myReward as MatchReward;
    expect(mine).toMatchObject({ coins: 14, balanceBefore: 0, balanceAfter: 14 });
    expect(mine.breakdown).toMatchObject({ levelsCompleted: 3, maxLevel: 3, won: true, participation: 2, levels: 9, victory: 3 });
    for (const id of ids) expect((await profile(id)).coins).toBe(14);

    // Pedirlo otra vez (o reintentar el pago desde dentro) no duplica nada.
    await t.rpc(ids[1]!, 'get_room_state', { p_room: room });
    const [match] = await t.admin<{ id: number }>(`select id from public.game_results where room_id = $1`, [room]);
    await t.admin(`select game_private.grant_match_rewards($1, $2, 3, true)`, [match!.id, room]);
    for (const id of ids) expect((await profile(id)).coins).toBe(14);
    const tx = await t.as<{ amount: number; kind: string; match_id: number }>(ids[0]!, `select amount, kind, match_id from public.coin_transactions`);
    expect(tx).toEqual([{ amount: 14, kind: 'match_reward', match_id: match!.id }]);

    // La revancha es otra partida: se cobra aparte.
    await t.rpc(ids[0]!, 'rematch', { p_room: room });
    for (const id of ids) await t.rpc(id, 'set_lobby_ready', { p_room: room, p_ready: true });
    await t.rpc(ids[0]!, 'start_game', { p_room: room });
    const again = await playToTheEnd(room, ids);
    expect(again.myReward).toMatchObject({ coins: 14, balanceBefore: 14, balanceAfter: 28 });
  });

  it('derrota en una partida larga: cobra lo superado; quien no jugó ninguna carta no cobra', async () => {
    const { ids, room } = await started(2); // 12 niveles
    await t.admin(`update public.rooms set lives = 1, rewinds = 0 where id = $1`, [room]);
    await setHands(room, ids, [[50, 60, 70, 80, 90, 95], [1, 2, 3, 4, 5, 6]], 6);
    const end: RoomSnapshot = await t.rpc(ids[0]!, 'play_card', { p_room: room, p_card: 50 });
    expect(end.room.status).toBe('lost');
    expect(end.myReward).toMatchObject({ coins: 22, breakdown: { levelsCompleted: 5, won: false } });
    const other: RoomSnapshot = await t.rpc(ids[1]!, 'get_room_state', { p_room: room });
    expect(other.myReward).toBeNull();
    expect((await profile(ids[1]!)).coins).toBe(0);
  });

  it('quien abandona no cobra; quien se queda cobra lo superado', async () => {
    const { ids, room } = await started(3, { levels: 5 });
    await setHands(room, ids, [[1, 2], [3, 4], [5, 6]], 2);
    for (const [i, c] of [[0, 1], [0, 2], [1, 3], [1, 4], [2, 5], [2, 6]] as const) await t.rpc(ids[i]!, 'play_card', { p_room: room, p_card: c });
    await t.rpc(ids[1]!, 'leave_room', { p_room: room });
    await t.rpc(ids[2]!, 'leave_room', { p_room: room });
    const end: RoomSnapshot = await t.rpc(ids[0]!, 'get_room_state', { p_room: room });
    expect(end.room.status).toBe('abandoned');
    // 3 jugadores, 2 niveles superados: (1+2) + (1+3) + participación 2.
    expect(end.myReward).toMatchObject({ coins: 9, breakdown: { levelsCompleted: 2, won: false } });
    expect((await profile(ids[1]!)).coins).toBe(0);
    expect((await profile(ids[2]!)).coins).toBe(0);
  });
});

describe('tienda y colección', () => {
  it('perfil inicial: 0 monedas, el clásico equipado y el catálogo con precios', async () => {
    const me = await t.newUser();
    const p = await profile(me);
    expect(p).toMatchObject({ coins: 0, owned: ['classic'], equipped: { card_design: 'classic' } });
    expect(p.catalog.map((c) => [c.id, c.price])).toEqual([['classic', null], ['galaxy', 10], ['neon', 30], ['emerald', 50]]);
  });

  it('comprar: sin saldo no; con saldo se cobra, se apunta y se entrega; nunca dos veces', async () => {
    const me = await t.newUser();
    expect(await errorOf(t.rpc(me, 'buy_cosmetic', { p_cosmetic: 'galaxy' }))).toBe('NOT_ENOUGH_COINS');
    expect((await profile(me)).owned).toEqual(['classic']);
    await grant(me, 90);
    let p: Profile = await t.rpc(me, 'buy_cosmetic', { p_cosmetic: 'galaxy' });
    expect(p).toMatchObject({ coins: 80, owned: ['classic', 'galaxy'] });
    expect(await errorOf(t.rpc(me, 'buy_cosmetic', { p_cosmetic: 'galaxy' }))).toBe('ALREADY_OWNED');
    expect(await errorOf(t.rpc(me, 'buy_cosmetic', { p_cosmetic: 'classic' }))).toBe('ALREADY_OWNED');
    p = await t.rpc(me, 'buy_cosmetic', { p_cosmetic: 'neon' });
    expect(p.coins).toBe(50);
    p = await t.rpc(me, 'buy_cosmetic', { p_cosmetic: 'emerald' }); // justo lo que cuesta
    expect(p).toMatchObject({ coins: 0, owned: ['classic', 'galaxy', 'neon', 'emerald'] });
    expect(await errorOf(t.rpc(me, 'buy_cosmetic', { p_cosmetic: 'gold' }))).toBe('COSMETIC_NOT_FOUND');
    const tx = await t.as<{ amount: number; balance_after: number; cosmetic_id: string | null }>(
      me,
      `select amount, balance_after, cosmetic_id from public.coin_transactions order by id`,
    );
    expect(tx).toEqual([
      { amount: 90, balance_after: 90, cosmetic_id: null },
      { amount: -10, balance_after: 80, cosmetic_id: 'galaxy' },
      { amount: -30, balance_after: 50, cosmetic_id: 'neon' },
      { amount: -50, balance_after: 0, cosmetic_id: 'emerald' },
    ]);
    const history: { amount: number }[] = await t.rpc(me, 'get_my_coin_history', {});
    expect(history.map((h) => h.amount)).toEqual([-50, -30, -10, 90]);
  });

  it('lo que no está a la venta no se puede comprar', async () => {
    const me = await t.newUser();
    await grant(me, 100);
    await t.admin(`update public.cosmetics set is_available = false where id = 'neon'`);
    try {
      expect(await errorOf(t.rpc(me, 'buy_cosmetic', { p_cosmetic: 'neon' }))).toBe('NOT_FOR_SALE');
      expect((await profile(me)).catalog.map((c) => c.id)).not.toContain('neon');
    } finally {
      await t.admin(`update public.cosmetics set is_available = true where id = 'neon'`);
    }
    expect((await profile(me)).coins).toBe(100);
  });

  it('equipar: solo lo que se posee, gratis, tantas veces como se quiera, y se recuerda', async () => {
    const me = await t.newUser();
    expect(await errorOf(t.rpc(me, 'equip_cosmetic', { p_cosmetic: 'neon' }))).toBe('NOT_OWNED');
    await grant(me, 90);
    for (const id of ['galaxy', 'neon', 'emerald']) await t.rpc(me, 'buy_cosmetic', { p_cosmetic: id });
    for (const id of ['galaxy', 'neon', 'emerald', 'classic', 'neon']) {
      const p: Profile = await t.rpc(me, 'equip_cosmetic', { p_cosmetic: id });
      expect(p.equipped.card_design).toBe(id);
      expect(p.coins).toBe(0);
    }
    expect((await profile(me)).equipped.card_design).toBe('neon');
  });
});

describe('diseños en la partida', () => {
  it('cada jugador juega con el suyo; cambiarlo durante la partida se aplica en la siguiente', async () => {
    const a = await t.newUser();
    await grant(a, 40);
    await t.rpc(a, 'buy_cosmetic', { p_cosmetic: 'galaxy' });
    await t.rpc(a, 'buy_cosmetic', { p_cosmetic: 'neon' });
    await t.rpc(a, 'equip_cosmetic', { p_cosmetic: 'galaxy' });
    const b = await t.newUser();
    const snap0: RoomSnapshot = await t.rpc(a, 'create_room', { p_name: 'Ana', p_config: { levels: 1 } });
    const room = snap0.room.id;
    await t.rpc(b, 'join_room', { p_code: snap0.room.code, p_name: 'Beto' });
    for (const id of [a, b]) await t.rpc(id, 'set_lobby_ready', { p_room: room, p_ready: true });
    let snap: RoomSnapshot = await t.rpc(a, 'start_game', { p_room: room });
    expect(snap.players.map((p) => p.cardDesign)).toEqual(['galaxy', 'classic']);

    await t.rpc(a, 'equip_cosmetic', { p_cosmetic: 'neon' });
    snap = await t.rpc(b, 'get_room_state', { p_room: room });
    expect(snap.players.map((p) => p.cardDesign)).toEqual(['galaxy', 'classic']);

    await playToTheEnd(room, [a, b]);
    await t.rpc(a, 'rematch', { p_room: room });
    for (const id of [a, b]) await t.rpc(id, 'set_lobby_ready', { p_room: room, p_ready: true });
    snap = await t.rpc(a, 'start_game', { p_room: room });
    expect(snap.players.map((p) => p.cardDesign)).toEqual(['neon', 'classic']);
  });
});

describe('seguridad de la economía', () => {
  it('desde la app no se puede tocar ni el saldo, ni lo que se posee, ni los precios', async () => {
    const me = await t.newUser();
    const other = await t.newUser();
    await grant(me, 5);
    await grant(other, 77);
    const attempts = [
      `update public.player_wallets set coins = 9999`,
      `insert into public.player_wallets (user_id, coins) values ('${await t.newUser()}', 500)`,
      `insert into public.coin_transactions (user_id, amount, balance_after, kind, reason) values ('${me}', 500, 505, 'adjustment', 'x')`,
      `insert into public.player_cosmetics (user_id, cosmetic_id, source) values ('${me}', 'emerald', 'purchase')`,
      `update public.player_equipped set cosmetic_id = 'emerald'`,
      `update public.cosmetics set price = 0`,
      `insert into public.match_rewards (match_id, user_id, coins, breakdown, balance_before, balance_after) values (1, '${me}', 500, '{}', 0, 500)`,
      `select game_private.add_coins('${me}', 500, 'adjustment', 'x')`,
      `select game_private.grant_match_rewards(1, gen_random_uuid(), 12, true)`,
    ];
    for (const sql of attempts) {
      const res = await t.as(me, sql).then((rows) => (rows.length === 0 ? 'sin efecto' : 'OK'), () => 'denegado');
      expect(res, sql).not.toBe('OK');
    }
    const p = await profile(me);
    expect(p).toMatchObject({ coins: 5, owned: ['classic'], equipped: { card_design: 'classic' } });
    expect((await t.admin<{ price: number }>(`select price from public.cosmetics where id = 'galaxy'`))[0]!.price).toBe(10);
    // Solo se ve lo propio.
    expect(await t.as(me, `select * from public.player_wallets where user_id = '${other}'`)).toEqual([]);
    expect(await t.as(me, `select coins from public.player_wallets`)).toEqual([{ coins: 5 }]);
    // Sin sesión, nada.
    expect(await t.asAnon(`select public.get_my_profile()`).then(() => 'OK', () => 'denegado')).toBe('denegado');
  });
});
