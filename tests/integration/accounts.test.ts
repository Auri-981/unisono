/**
 * Cuentas contra el servidor SQL real (PGlite): el progreso de invitado se une a la cuenta de
 * Google sin perder ni duplicar nada, el vale no se puede reutilizar ni robar, y se puede borrar
 * la cuenta con todo su progreso.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { RoomSnapshot } from '../../src/game/types';
import { createTestDb, errorOf, type TestDb } from './db';
import { gameHelpers } from './game';

interface Profile {
  coins: number;
  equipped: Record<string, string>;
  owned: string[];
  stats: { games: number; wins: number; levels: number };
  achievements: { id: string; unlockedAt: string | null }[];
  unseen: string[];
}

interface Claim {
  merged: { coins: number; cards: number; titles: number; achievements: number; games: number };
  profile: Profile;
}

let t: TestDb;
let h: ReturnType<typeof gameHelpers>;
beforeAll(async () => {
  t = await createTestDb();
  h = gameHelpers(t);
});

const profile = (uid: string): Promise<Profile> => t.rpc(uid, 'get_my_profile', {});
const unlocked = (p: Profile) => p.achievements.filter((a) => a.unlockedAt).map((a) => a.id);

/** Usuario que ya ha iniciado sesión con Google (no anónimo). */
async function account() {
  const id = await t.newUser();
  await t.admin(`update auth.users set is_anonymous = false where id = $1`, [id]);
  return id;
}

/** Invitado con una partida ganada, 60 monedas extra y el diseño Galaxia comprado y equipado. */
async function guestWithProgress() {
  const { ids, room } = await h.started(2, { levels: 1 });
  const end: RoomSnapshot = await h.playToTheEnd(room, ids);
  expect(end.room.status).toBe('won');
  const guest = ids[0]!;
  await h.grant(guest, 60);
  await t.rpc(guest, 'buy_cosmetic', { p_cosmetic: 'galaxy' });
  await t.rpc(guest, 'equip_cosmetic', { p_cosmetic: 'galaxy' });
  return { guest, partner: ids[1]! };
}

async function startMerge(uid: string): Promise<string> {
  return (await t.rpc<{ token: string }>(uid, 'start_account_merge', {})).token;
}

describe('unir el progreso de invitado a la cuenta', () => {
  it('pasa monedas, cartas, logros, estadísticas e historial a una cuenta nueva', async () => {
    const { guest } = await guestWithProgress();
    const before = await profile(guest);
    const history = await t.rpc(guest, 'get_my_history', {});
    const token = await startMerge(guest);

    const me = await account();
    const res: Claim = await t.rpc(me, 'claim_account_merge', { p_token: token });

    expect(res.merged.coins).toBe(before.coins);
    expect(res.merged.cards).toBe(1);
    expect(res.merged.games).toBe(1);
    expect(res.merged.achievements).toBe(unlocked(before).length);
    expect(res.profile.coins).toBe(before.coins);
    expect(res.profile.owned).toContain('galaxy');
    expect(res.profile.equipped.card_design).toBe('galaxy');
    expect(res.profile.stats).toMatchObject({ games: 1, wins: 1, levels: 1 });
    expect(unlocked(res.profile).sort()).toEqual(unlocked(before).sort());
    // Ya se enseñaron en el móvil del invitado: no se vuelven a avisar.
    expect(res.profile.unseen).toEqual([]);
    expect(await t.rpc(me, 'get_my_history', {})).toEqual(history);

    // El invitado queda vacío: no se puede unir dos veces.
    const empty = await profile(guest);
    expect(empty.coins).toBe(0);
    expect(empty.owned).toEqual(['classic']);
    expect(empty.equipped.card_design).toBe('classic');
    expect(unlocked(empty)).toEqual([]);
    expect((await t.rpc(guest, 'get_my_history', {})).games).toEqual([]);
  });

  it('suma a una cuenta que ya tenía progreso y respeta lo que llevaba equipado', async () => {
    const me = await account();
    await h.grant(me, 100);
    await t.rpc(me, 'buy_cosmetic', { p_cosmetic: 'neon' });
    await t.rpc(me, 'equip_cosmetic', { p_cosmetic: 'neon' });
    await t.admin(`select game_private.ensure_stats($1)`, [me]);
    await t.admin(`update public.player_stats set games_completed = 4, wins = 2, best_win_streak = 2, win_streak = 0 where user_id = $1`, [me]);
    const mine = await profile(me);

    const { guest } = await guestWithProgress();
    const theirs = await profile(guest);
    const res: Claim = await t.rpc(me, 'claim_account_merge', { p_token: await startMerge(guest) });

    expect(res.profile.coins).toBe(mine.coins + theirs.coins);
    expect(res.profile.owned).toEqual(expect.arrayContaining(['classic', 'neon', 'galaxy']));
    expect(res.profile.equipped.card_design).toBe('neon');
    expect(res.profile.stats).toMatchObject({ games: 5, wins: 3 });
    const st = (await t.admin<{ win_streak: number; best_win_streak: number }>(
      `select win_streak, best_win_streak from public.player_stats where user_id = $1`, [me]))[0]!;
    expect(st).toEqual({ win_streak: 1, best_win_streak: 2 });
  });

  it('un logro que tenían los dos se queda una vez, con la fecha más antigua', async () => {
    const { guest: a } = await guestWithProgress();
    const { guest: b } = await guestWithProgress();
    await t.admin(`update public.player_achievements set unlocked_at = '2026-01-01 12:00Z' where user_id = $1 and achievement_id = 'wins_1'`, [b]);
    await t.admin(`update auth.users set is_anonymous = false where id = $1`, [a]);
    const res: Claim = await t.rpc(a, 'claim_account_merge', { p_token: await startMerge(b) });
    expect(res.merged.achievements).toBe(0);
    const rows = await t.admin<{ unlocked_at: Date }>(
      `select unlocked_at from public.player_achievements where user_id = $1 and achievement_id = 'wins_1'`, [a]);
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0]!.unlocked_at).toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(res.profile.stats.wins).toBe(2);
  });

  it('las victorias con el mismo grupo siguen contando como el mismo grupo', async () => {
    const { guest, partner } = await guestWithProgress();
    const me = await account();
    await t.rpc(me, 'claim_account_merge', { p_token: await startMerge(guest) });
    const key = [me, partner].sort().join(',');
    const rows = await t.admin<{ group_key: string; wins: number }>(`select group_key, wins from public.player_group_wins where user_id = $1`, [me]);
    expect(rows).toEqual([{ group_key: key, wins: 1 }]);
    // Una victoria más con la cuenta suma al mismo grupo.
    const room = await h.startedWith([me, partner], { levels: 1 });
    await h.playToTheEnd(room, [me, partner]);
    const after = await t.admin<{ wins: number }>(`select wins from public.player_group_wins where user_id = $1 and group_key = $2`, [me, key]);
    expect(after[0]!.wins).toBe(2);
  });
});

describe('el vale para unir cuentas no se puede abusar', () => {
  it('solo sirve una vez', async () => {
    const { guest } = await guestWithProgress();
    const token = await startMerge(guest);
    await t.rpc(await account(), 'claim_account_merge', { p_token: token });
    expect(await errorOf(t.rpc(await account(), 'claim_account_merge', { p_token: token }))).toBe('MERGE_INVALID');
  });

  it('un invitado no puede canjearlo (hace falta haber iniciado sesión)', async () => {
    const { guest } = await guestWithProgress();
    const token = await startMerge(guest);
    expect(await errorOf(t.rpc(await t.newUser(), 'claim_account_merge', { p_token: token }))).toBe('NOT_SIGNED_IN');
  });

  it('una cuenta no puede pedir un vale (no es un invitado)', async () => {
    expect(await errorOf(t.rpc(await account(), 'start_account_merge', {}))).toBe('NOT_GUEST');
  });

  it('caduca a la hora, y un vale inventado no sirve', async () => {
    const { guest } = await guestWithProgress();
    const token = await startMerge(guest);
    await t.admin(`update public.account_merges set created_at = now() - interval '2 hours' where token = $1`, [token]);
    const me = await account();
    expect(await errorOf(t.rpc(me, 'claim_account_merge', { p_token: token }))).toBe('MERGE_INVALID');
    expect(await errorOf(t.rpc(me, 'claim_account_merge', { p_token: 'x'.repeat(64) }))).toBe('MERGE_INVALID');
  });

  it('pedir otro vale anula el anterior', async () => {
    const { guest } = await guestWithProgress();
    const old = await startMerge(guest);
    const fresh = await startMerge(guest);
    const me = await account();
    expect(await errorOf(t.rpc(me, 'claim_account_merge', { p_token: old }))).toBe('MERGE_INVALID');
    await t.rpc(me, 'claim_account_merge', { p_token: fresh });
  });

  it('nadie puede leer los vales desde la app', async () => {
    const { guest } = await guestWithProgress();
    await startMerge(guest);
    expect(await errorOf(t.as(guest, `select * from public.account_merges`))).toMatch(/permission denied/);
  });
});

describe('borrar la cuenta', () => {
  it('borra todo su progreso y la cuenta, y le saca de su sala', async () => {
    const { guest, partner } = await guestWithProgress();
    const lobby: RoomSnapshot = await t.rpc(partner, 'create_room', { p_name: 'Bea', p_config: {} });
    await t.rpc(guest, 'join_room', { p_code: lobby.room.code, p_name: 'Ana' });

    const res = await t.rpc(guest, 'delete_my_account', {});
    expect(res).toEqual({ deleted: true, account: true });

    for (const table of ['player_wallets', 'player_cosmetics', 'player_equipped', 'player_achievements', 'player_stats', 'coin_transactions', 'progress_events']) {
      expect(await t.admin(`select 1 from public.${table} where user_id = $1`, [guest])).toEqual([]);
    }
    expect(await t.admin(`select 1 from auth.users where id = $1`, [guest])).toEqual([]);
    const state: RoomSnapshot = await t.rpc(partner, 'get_room_state', { p_room: lobby.room.id });
    expect(state.players.map((p) => p.name)).toEqual(['Bea']);
    // Su compañero conserva su historial, pero ya sin relación con la cuenta borrada.
    const ids = await t.admin<{ player_ids: string[] }>(`select player_ids from public.game_results where $1 = any (player_ids)`, [partner]);
    expect(ids[0]!.player_ids).not.toContain(guest);
    expect((await t.rpc(partner, 'get_my_history', {})).games).toHaveLength(1);
  });
});
