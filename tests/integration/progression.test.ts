/**
 * Títulos, logros y cartas exclusivas contra el servidor SQL real (PGlite): se cuentan solos al
 * jugar, se desbloquean una vez, pagan una vez y nada se puede falsear desde la app.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { RoomSnapshot } from '../../src/game/types';
import { createTestDb, errorOf, type TestDb } from './db';
import { gameHelpers } from './game';

interface Achievement {
  id: string;
  category: string;
  target: number;
  progress: number;
  streak: number | null;
  rewardCoins: number;
  rewardCosmetics: string[];
  unlockedAt: string | null;
}

interface Profile {
  coins: number;
  equipped: Record<string, string>;
  owned: string[];
  sources: Record<string, string>;
  catalog: { id: string; kind: string; name: string; price: number | null; unlock: string; rarity: string; achievement: string | null }[];
  stats: { games: number; wins: number; levels: number; bestWinStreak: number; bestCleanStreak: number };
  achievements: Achievement[];
  unseen: string[];
}

let t: TestDb;
let h: ReturnType<typeof gameHelpers>;
beforeAll(async () => {
  t = await createTestDb();
  h = gameHelpers(t);
});

const profile = (uid: string): Promise<Profile> => t.rpc(uid, 'get_my_profile', {});
const unlocked = async (uid: string) => (await profile(uid)).achievements.filter((a) => a.unlockedAt).map((a) => a.id);
const stats = async (uid: string) =>
  (await t.admin<Record<string, number>>(`select * from public.player_stats where user_id = $1`, [uid]))[0]!;
const ach = async (uid: string, id: string) => (await profile(uid)).achievements.find((a) => a.id === id)!;

/** Fija contadores de un jugador (para probar objetivos altos sin jugar cien partidas). */
async function setStats(uid: string, values: Record<string, number>) {
  await t.admin(`select game_private.ensure_stats($1)`, [uid]);
  for (const [col, v] of Object.entries(values)) {
    await t.admin(`update public.player_stats set ${col} = $2 where user_id = $1`, [uid, v]);
  }
}

/** Partida de `levels` niveles con `ids`, jugada entera sin errores. */
async function win(ids: string[], config: object = {}) {
  const room = await h.startedWith(ids, config);
  const end = await h.playToTheEnd(room, ids);
  expect(end.room.status).toBe('won');
  return room;
}

describe('títulos', () => {
  it('catálogo: 12 títulos con precios del servidor, de menor a mayor', async () => {
    const p = await profile(await t.newUser());
    const titles = p.catalog.filter((c) => c.kind === 'title');
    expect(titles.map((c) => [c.name, c.price])).toEqual([
      ['Aprendiz', 10], ['Observador', 20], ['Estratega', 35], ['Visionario', 50], ['Mente Maestra', 75], ['Imparable', 100],
      ['Leyenda', 150], ['El Elegido', 200], ['Oráculo', 250], ['Maestro del Tiempo', 300], ['Sincronía Perfecta', 400], ['La Última Mente', 500],
    ]);
    expect(titles.every((c) => c.unlock === 'coins')).toBe(true);
    expect(new Set(titles.map((c) => c.rarity))).toEqual(new Set(['common', 'rare', 'epic', 'legendary']));
  });

  it('comprar: sin saldo no, con saldo sí, nunca dos veces; equipar, cambiar y quitar', async () => {
    const me = await t.newUser();
    expect(await errorOf(t.rpc(me, 'buy_cosmetic', { p_cosmetic: 'title_legend' }))).toBe('NOT_ENOUGH_COINS');
    expect(await errorOf(t.rpc(me, 'equip_cosmetic', { p_cosmetic: 'title_legend' }))).toBe('NOT_OWNED');
    await h.grant(me, 170);
    let p: Profile = await t.rpc(me, 'buy_cosmetic', { p_cosmetic: 'title_legend' });
    expect(p.coins).toBe(20);
    expect(p.owned).toContain('title_legend');
    expect(p.sources.title_legend).toBe('purchase');
    expect(p.equipped.title).toBeUndefined(); // comprar no equipa: son cosas distintas
    expect(await errorOf(t.rpc(me, 'buy_cosmetic', { p_cosmetic: 'title_legend' }))).toBe('ALREADY_OWNED');
    p = await t.rpc(me, 'buy_cosmetic', { p_cosmetic: 'title_observer' });
    expect(p.coins).toBe(0);

    p = await t.rpc(me, 'equip_cosmetic', { p_cosmetic: 'title_legend' });
    expect(p.equipped).toMatchObject({ title: 'title_legend', card_design: 'classic' });
    p = await t.rpc(me, 'equip_cosmetic', { p_cosmetic: 'title_observer' });
    expect(p.equipped.title).toBe('title_observer');
    expect(p.coins).toBe(0); // cambiar de título es gratis
    // Se recuerda (otra sesión = otro get_my_profile).
    expect((await profile(me)).equipped.title).toBe('title_observer');
    p = await t.rpc(me, 'unequip_cosmetic', { p_kind: 'title' });
    expect(p.equipped.title).toBeUndefined();
    expect(p.owned).toContain('title_observer'); // quitarlo no lo pierde
    // El diseño de cartas no se quita (se cambia por otro).
    expect(await errorOf(t.rpc(me, 'unequip_cosmetic', { p_kind: 'card_design' }))).toBe('CANNOT_UNEQUIP');
  });

  it('el título sale en la sala para todos y es de cada jugador', async () => {
    const [a, b] = [await t.newUser(), await t.newUser()];
    await h.grant(a, 10);
    await t.rpc(a, 'buy_cosmetic', { p_cosmetic: 'title_apprentice' });
    await t.rpc(a, 'equip_cosmetic', { p_cosmetic: 'title_apprentice' });
    const snap: RoomSnapshot = await t.rpc(a, 'create_room', { p_name: 'Ana', p_config: {} });
    await t.rpc(b, 'join_room', { p_code: snap.room.code, p_name: 'Beto' });
    let seen: RoomSnapshot = await t.rpc(b, 'get_room_state', { p_room: snap.room.id });
    expect(seen.players.map((p) => p.title)).toEqual([{ id: 'title_apprentice', name: 'Aprendiz', rarity: 'common' }, null]);
    // Cambiarlo se ve al momento en la sala de espera.
    await t.rpc(a, 'unequip_cosmetic', { p_kind: 'title' });
    seen = await t.rpc(b, 'get_room_state', { p_room: snap.room.id });
    expect(seen.players.map((p) => p.title)).toEqual([null, null]);
    // Nadie puede equipar el título de otro.
    expect(await errorOf(t.rpc(b, 'equip_cosmetic', { p_cosmetic: 'title_apprentice' }))).toBe('NOT_OWNED');
  });
});

describe('logros: se cuentan jugando', () => {
  it('perfil nuevo: 25 logros en 6 categorías, todos pendientes con su progreso a 0', async () => {
    const p = await profile(await t.newUser());
    expect(p.achievements).toHaveLength(25);
    expect(new Set(p.achievements.map((a) => a.category))).toEqual(new Set(['games', 'wins', 'progress', 'skill', 'team', 'special']));
    expect(p.achievements.every((a) => a.unlockedAt === null && a.progress === 0)).toBe(true);
    expect(p.stats).toEqual({ games: 0, wins: 0, levels: 0, bestWinStreak: 0, bestCleanStreak: 0 });
    expect(p.unseen).toEqual([]);
  });

  it('una victoria limpia de 5 niveles a dos: partidas, victorias, niveles y hazañas', async () => {
    const ids = [await t.newUser(), await t.newUser()];
    await win(ids, { levels: 5 });
    for (const id of ids) {
      expect(await stats(id)).toMatchObject({
        games_completed: 1, wins: 1, levels_completed: 5, clean_streak: 5, best_clean_streak: 5, safe_streak: 5,
        wins_duo: 1, flawless_wins: 1, wins_no_vistazo: 1, wins_full_team: 0, team_levels: 0, hard_wins: 0, long_wins: 0,
      });
      expect((await unlocked(id)).sort()).toEqual(['duo_win', 'flawless_win', 'games_1', 'no_vistazo_win', 'safe_5', 'wins_1'].sort());
      const p = await profile(id);
      // Monedas: partida + logros (5 + 10 + 15 + 20 + 30 + 10), apuntadas como «achievement».
      const tx = await t.as<{ amount: number; kind: string }>(id, `select amount, kind from public.coin_transactions where kind = 'achievement' order by id`);
      expect(tx.reduce((s, x) => s + x.amount, 0)).toBe(90);
      expect(p.unseen).toHaveLength(6);
      expect(p.stats).toMatchObject({ games: 1, wins: 1, levels: 5 });
    }
  });

  it('las hazañas de partida no cuentan en partidas cortas (menos de 5 niveles)', async () => {
    const ids = [await t.newUser(), await t.newUser()];
    await win(ids, { levels: 2 });
    expect(await unlocked(ids[0]!)).toEqual(['games_1', 'wins_1']);
  });

  it('a 4 jugadores: «El equipo completo» y los niveles en grupo', async () => {
    const ids = [await t.newUser(), await t.newUser(), await t.newUser(), await t.newUser()];
    await win(ids, { levels: 5 });
    expect(await stats(ids[3]!)).toMatchObject({ wins_full_team: 1, wins_duo: 0, team_levels: 5 });
    expect(await unlocked(ids[3]!)).toContain('full_team_win');
  });

  it('niveles seguidos sin errores: un error rompe la racha; con escudo no se pierde vida', async () => {
    const ids = [await t.newUser(), await t.newUser()];
    const room = await h.startedWith(ids, { levels: 6 });
    // Nivel 1 limpio.
    await h.setHands(room, ids, [[10], [20]], 1);
    await t.rpc(ids[0]!, 'play_card', { p_room: room, p_card: 10 });
    await t.rpc(ids[1]!, 'play_card', { p_room: room, p_card: 20 });
    expect(await stats(ids[0]!)).toMatchObject({ clean_streak: 1, safe_streak: 1, levels_completed: 1 });
    await h.nextLevel(room, ids);
    // Nivel 2 con un error absorbido por el escudo: se rompe «sin errores», no «sin perder vidas».
    await h.setHands(room, ids, [[10, 50], [20]], 2);
    await t.admin(`update public.rooms set shield_active = true where id = $1`, [room]);
    await t.rpc(ids[1]!, 'play_card', { p_room: room, p_card: 20 }); // el 10 debía ir antes
    await t.rpc(ids[0]!, 'play_card', { p_room: room, p_card: 50 });
    expect(await stats(ids[0]!)).toMatchObject({ clean_streak: 0, best_clean_streak: 1, safe_streak: 2, best_safe_streak: 2 });
    await h.nextLevel(room, ids);
    // Nivel 3 con un error que cuesta vida: se rompen las dos. (Sin Rebobinar, para no votar.)
    await h.setHands(room, ids, [[10, 50], [20]], 3);
    await t.admin(`update public.rooms set rewinds = 0 where id = $1`, [room]);
    await t.rpc(ids[1]!, 'play_card', { p_room: room, p_card: 20 });
    await t.rpc(ids[0]!, 'play_card', { p_room: room, p_card: 50 });
    expect(await stats(ids[0]!)).toMatchObject({ clean_streak: 0, safe_streak: 0, best_safe_streak: 2, levels_completed: 3 });
    // La racha en curso se ve en el logro (llevas 0 de 10) y el récord en su progreso.
    expect(await ach(ids[0]!, 'clean_10')).toMatchObject({ progress: 1, streak: 0, target: 10 });
  });

  it('perder corta las rachas de niveles y la de victorias', async () => {
    const ids = [await t.newUser(), await t.newUser()];
    await win(ids, { levels: 1 });
    await win(ids, { levels: 1 });
    expect(await stats(ids[0]!)).toMatchObject({ win_streak: 2, clean_streak: 2 });
    const room = await h.startedWith(ids, { levels: 3 });
    await t.admin(`update public.rooms set lives = 1, rewinds = 0 where id = $1`, [room]);
    await h.setHands(room, ids, [[10], [20]], 1);
    const end: RoomSnapshot = await t.rpc(ids[1]!, 'play_card', { p_room: room, p_card: 20 });
    expect(end.room.status).toBe('lost');
    expect(await stats(ids[1]!)).toMatchObject({ games_completed: 3, wins: 2, win_streak: 0, best_win_streak: 2, clean_streak: 0, best_clean_streak: 2 });
    // Quien no llegó a jugar ninguna carta no suma la partida, pero también pierde las rachas.
    expect(await stats(ids[0]!)).toMatchObject({ games_completed: 2, win_streak: 0, clean_streak: 0, best_clean_streak: 2 });
  });

  it('«En racha»: tres victorias seguidas', async () => {
    const ids = [await t.newUser(), await t.newUser()];
    for (let i = 0; i < 2; i++) await win(ids, { levels: 1 });
    expect(await unlocked(ids[0]!)).not.toContain('win_streak_3');
    await win(ids, { levels: 1 });
    expect(await unlocked(ids[0]!)).toContain('win_streak_3');
  });

  it('«Unidos hasta el final»: 5 victorias con el mismo grupo exacto', async () => {
    const [a, b, c] = [await t.newUser(), await t.newUser(), await t.newUser()];
    for (let i = 0; i < 4; i++) await win([a, b], { levels: 1 });
    await win([a, c], { levels: 1 }); // otro grupo: no suma al de a+b
    expect(await stats(a)).toMatchObject({ best_group_wins: 4 });
    expect(await unlocked(a)).not.toContain('group_5');
    await win([b, a], { levels: 1 }); // mismo grupo aunque cambie quién crea la sala
    expect(await stats(a)).toMatchObject({ best_group_wins: 5 });
    expect(await unlocked(a)).toContain('group_5');
    expect(await unlocked(c)).not.toContain('group_5');
  });

  it('Difícil y 12 niveles: «Mente extraordinaria» y «Hasta el final»', async () => {
    const ids = [await t.newUser(), await t.newUser()];
    await win(ids, { levels: 3, difficulty: 'hard' });
    expect(await unlocked(ids[0]!)).toContain('hard_win');
    expect(await unlocked(ids[0]!)).not.toContain('long_win');
    await win(ids, { levels: 12 });
    expect(await unlocked(ids[0]!)).toContain('long_win');
  });

  it('«Madrugador» según la hora de España al terminar', async () => {
    const ids = [await t.newUser(), await t.newUser()];
    await win(ids, { levels: 1 });
    const [row] = await t.admin<{ hour: number }>(`select extract(hour from now() at time zone 'Europe/Madrid')::int as hour`);
    const early = row!.hour >= 6 && row!.hour < 9;
    expect((await stats(ids[0]!)).early_games).toBe(early ? 1 : 0);
    expect((await unlocked(ids[0]!)).includes('early_bird')).toBe(early);
  });

  it('la práctica y las partidas abandonadas no cuentan; quien no juega ninguna carta tampoco', async () => {
    const ids = [await t.newUser(), await t.newUser(), await t.newUser()];
    const room = await h.startedWith(ids, { levels: 3 });
    await h.setHands(room, ids, [[1], [2], [3]], 1);
    for (const [i, c] of [[0, 1], [1, 2], [2, 3]] as const) await t.rpc(ids[i]!, 'play_card', { p_room: room, p_card: c });
    await h.nextLevel(room, ids);
    await t.rpc(ids[1]!, 'leave_room', { p_room: room });
    await t.rpc(ids[2]!, 'leave_room', { p_room: room });
    const end: RoomSnapshot = await t.rpc(ids[0]!, 'get_room_state', { p_room: room });
    expect(end.room.status).toBe('abandoned');
    // El nivel superado sí cuenta (estaban todos); la partida abandonada no.
    expect(await stats(ids[0]!)).toMatchObject({ levels_completed: 1, games_completed: 0 });
  });
});

describe('logros: una sola vez y a prueba de trampas', () => {
  it('no se desbloquea antes de tiempo; al llegar, se desbloquea y paga una vez', async () => {
    const ids = [await t.newUser(), await t.newUser()];
    await setStats(ids[0]!, { games_completed: 13 });
    await win(ids, { levels: 1 });
    expect(await unlocked(ids[0]!)).not.toContain('games_15');
    expect(await ach(ids[0]!, 'games_15')).toMatchObject({ progress: 14, target: 15, rewardCoins: 15, rewardCosmetics: ['obsidian'] });
    await win(ids, { levels: 1 });
    expect(await unlocked(ids[0]!)).toContain('games_15');
    const coinsBefore = (await profile(ids[0]!)).coins;
    // Evaluar otra vez (o volver a apuntar la partida) no duplica nada.
    await t.admin(`select game_private.evaluate_achievements($1)`, [ids[0]]);
    const [last] = await t.admin<{ id: number; room_id: string }>(`select id, room_id from public.game_results order by id desc limit 1`);
    await t.admin(`select game_private.record_match_progress($1, $2, true)`, [last!.id, last!.room_id]);
    await t.admin(`select game_private.record_level_done($1)`, [last!.room_id]);
    expect((await profile(ids[0]!)).coins).toBe(coinsBefore);
    expect((await stats(ids[0]!)).games_completed).toBe(15);
    const rows = await t.admin(`select 1 from public.player_achievements where user_id = $1 and achievement_id = 'games_15'`, [ids[0]]);
    expect(rows).toHaveLength(1);
  });

  it('un reintento de la misma jugada (reconexión) no cuenta el nivel dos veces', async () => {
    const ids = [await t.newUser(), await t.newUser()];
    const room = await h.startedWith(ids, { levels: 3 });
    await h.setHands(room, ids, [[10], [20]], 1);
    const action = crypto.randomUUID();
    await t.rpc(ids[0]!, 'play_card', { p_room: room, p_card: 10 });
    await t.rpc(ids[1]!, 'play_card', { p_room: room, p_card: 20, p_action: action });
    await t.rpc(ids[1]!, 'play_card', { p_room: room, p_card: 20, p_action: action });
    expect((await stats(ids[1]!)).levels_completed).toBe(1);
  });

  it('desde la app no se puede tocar el progreso, los logros ni los premios', async () => {
    const me = await t.newUser();
    await profile(me);
    await expect(t.as(me, `update public.player_stats set wins = 999 where user_id = auth.uid()`)).rejects.toThrow();
    await expect(t.as(me, `insert into public.player_achievements (user_id, achievement_id) values (auth.uid(), 'wins_50')`)).rejects.toThrow();
    await expect(t.as(me, `insert into public.player_cosmetics (user_id, cosmetic_id, source) values (auth.uid(), 'phoenix', 'achievement')`)).rejects.toThrow();
    await expect(t.as(me, `select game_private.evaluate_achievements(auth.uid())`)).rejects.toThrow();
    await expect(t.as(me, `select * from public.progress_events`)).rejects.toThrow();
    expect(await errorOf(t.rpc(me, 'buy_cosmetic', { p_cosmetic: 'phoenix' }))).toBe('NOT_FOR_SALE');
    expect(await errorOf(t.rpc(me, 'equip_cosmetic', { p_cosmetic: 'phoenix' }))).toBe('NOT_OWNED');
    // Solo se ve lo propio.
    const other = await t.newUser();
    await setStats(other, { wins: 3 });
    expect(await t.as(me, `select * from public.player_stats where user_id <> auth.uid()`)).toEqual([]);
    expect(await unlocked(me)).toEqual([]);
  });

  it('marcar como vistos solo quita el aviso (no el logro)', async () => {
    const ids = [await t.newUser(), await t.newUser()];
    await win(ids, { levels: 1 });
    expect((await profile(ids[0]!)).unseen).toEqual(['games_1', 'wins_1']);
    const p: Profile = await t.rpc(ids[0]!, 'mark_achievements_seen', { p_ids: ['games_1', 'wins_1'] });
    expect(p.unseen).toEqual([]);
    expect(await unlocked(ids[0]!)).toEqual(['games_1', 'wins_1']);
    // El de otro jugador no cambia.
    expect((await profile(ids[1]!)).unseen).toEqual(['games_1', 'wins_1']);
  });
});

describe('cartas exclusivas', () => {
  it('se ven bloqueadas con su logro; al conseguirlo llegan solas y se juegan como las compradas', async () => {
    const ids = [await t.newUser(), await t.newUser()];
    let p = await profile(ids[0]!);
    const chrono = p.catalog.find((c) => c.id === 'chrono')!;
    expect(chrono).toMatchObject({ unlock: 'achievement', price: null, achievement: 'clean_10' });
    expect(p.owned).not.toContain('chrono');

    await setStats(ids[0]!, { clean_streak: 9, best_clean_streak: 9 });
    await win(ids, { levels: 1 });
    p = await profile(ids[0]!);
    expect(p.owned).toContain('chrono');
    expect(p.sources.chrono).toBe('achievement');
    expect(p.unseen).toContain('clean_10');
    // Se equipa y se juega con ella, igual que una comprada.
    await t.rpc(ids[0]!, 'equip_cosmetic', { p_cosmetic: 'chrono' });
    const room = await h.startedWith(ids, { levels: 1 });
    const snap: RoomSnapshot = await t.rpc(ids[1]!, 'get_room_state', { p_room: room });
    expect(snap.players.map((x) => x.cardDesign)).toEqual(['chrono', 'classic']);
    // No cambia las reglas: la partida se juega igual.
    expect((await h.playToTheEnd(room, ids)).room.status).toBe('won');
  });

  it('«Coleccionista» cuenta compradas y exclusivas; «La mente definitiva» da Trascendencia', async () => {
    const me = await t.newUser();
    await h.grant(me, 90);
    for (const id of ['galaxy', 'neon', 'emerald']) await t.rpc(me, 'buy_cosmetic', { p_cosmetic: id });
    await setStats(me, { games_completed: 15, wins: 10 }); // Obsidiana y Aurora
    await t.admin(`select game_private.evaluate_achievements($1)`, [me]);
    let p = await profile(me);
    expect(p.owned).toEqual(expect.arrayContaining(['obsidian', 'aurora']));
    expect(p.achievements.find((a) => a.id === 'collector_5')!.unlockedAt).not.toBeNull();
    expect(p.owned).not.toContain('transcendence');
    // Con suficientes logros se encadena: el logro de logros se evalúa en la misma pasada.
    await setStats(me, {
      games_completed: 100, wins: 50, best_win_streak: 3, levels_completed: 100, long_wins: 1, hard_wins: 1, best_safe_streak: 5,
      best_clean_streak: 10, wins_no_vistazo: 1, flawless_wins: 1, wins_duo: 1, wins_full_team: 1,
    });
    await t.admin(`select game_private.evaluate_achievements($1)`, [me]);
    p = await profile(me);
    const done = p.achievements.filter((a) => a.unlockedAt).map((a) => a.id);
    expect(done.length).toBeGreaterThanOrEqual(21);
    expect(done).toContain('achievements_20');
    expect(p.owned).toEqual(expect.arrayContaining(['obsidian', 'aurora', 'chrono', 'phoenix', 'transcendence']));
    // Las monedas de cada logro, una sola vez.
    const tx = await t.as<{ n: number }>(me, `select count(*)::int as n from public.coin_transactions where kind = 'achievement'`);
    expect(tx[0]!.n).toBe(done.length);
  });

  it('las compras anteriores siguen ahí y siguen siendo «compradas»', async () => {
    const me = await t.newUser();
    await h.grant(me, 10);
    await t.rpc(me, 'buy_cosmetic', { p_cosmetic: 'galaxy' });
    const p = await profile(me);
    expect(p.sources).toMatchObject({ classic: 'default', galaxy: 'purchase' });
    expect(p.equipped.card_design).toBe('classic');
  });
});
