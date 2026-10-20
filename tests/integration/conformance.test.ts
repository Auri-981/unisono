/**
 * Ejecuta los MISMOS escenarios que el motor TypeScript contra las funciones SQL reales.
 * Si ambos coinciden, las reglas del modo práctica y del modo online son idénticas.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { SCENARIOS, type Scenario } from '../scenarios';
import { DEFAULT_CONFIG, normalizeConfig, rewardFor, startingResources } from '../../src/config/gameConfig';
import { createTestDb, errorOf, type TestDb } from './db';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});

async function setup(sc: Scenario) {
  const ids: string[] = [];
  for (let i = 0; i < sc.players; i++) ids.push(await t.newUser());
  const created = await t.rpc(ids[0]!, 'create_room', { p_name: 'P0', p_config: sc.config ?? {} });
  const room: string = created.room.id;
  for (let i = 1; i < sc.players; i++) {
    await t.rpc(ids[i]!, 'join_room', { p_code: created.room.code, p_name: `P${i}` });
  }
  await t.rpc(ids[0]!, 'start_game', { p_room: room });
  await t.admin(
    `update public.rooms set level = $2, lives = coalesce($3, lives), shurikens = coalesce($4, shurikens) where id = $1`,
    [room, sc.level, sc.lives ?? null, sc.shurikens ?? null],
  );
  await t.admin(`delete from public.hands where room_id = $1`, [room]);
  for (let i = 0; i < sc.players; i++) {
    for (const c of sc.hands[i]!) {
      await t.admin(`insert into public.hands (room_id, user_id, card) values ($1, $2, $3)`, [room, ids[i], c]);
    }
  }
  return { room, ids };
}

describe('escenarios compartidos (servidor SQL)', () => {
  for (const sc of SCENARIOS) {
    it(sc.name, async () => {
      const { room, ids } = await setup(sc);
      const present = [...ids];
      for (const step of sc.steps) {
        let p: Promise<unknown>;
        if ('play' in step) p = t.rpc(ids[step.play[0]]!, 'play_card', { p_room: room, p_card: step.play[1] });
        else if ('propose' in step) p = t.rpc(ids[step.propose]!, 'propose_shuriken', { p_room: room });
        else if ('vote' in step) p = t.rpc(ids[step.vote[0]]!, 'vote_shuriken', { p_room: room, p_accept: step.vote[1] });
        else {
          p = t.rpc(ids[step.leave]!, 'leave_room', { p_room: room });
          present.splice(present.indexOf(ids[step.leave]!), 1);
        }
        const expected = 'error' in step && step.error ? step.error : 'OK';
        expect(await errorOf(p)).toBe(expected);
      }

      const [r] = await t.admin<any>(`select * from public.rooms where id = $1`, [room]);
      const ex = sc.expect;
      expect(r.status).toBe(ex.status);
      if (ex.level !== undefined) expect(r.level).toBe(ex.level);
      if (ex.lives !== undefined) expect(r.lives).toBe(ex.lives);
      if (ex.shurikens !== undefined) expect(r.shurikens).toBe(ex.shurikens);
      if (ex.hands) {
        const hands = [];
        for (const id of present) {
          const rows = await t.admin<{ card: number }>(
            `select card from public.hands where room_id = $1 and user_id = $2 order by card`,
            [room, id],
          );
          hands.push(rows.map((x) => x.card));
        }
        expect(hands).toEqual(ex.hands);
      }
      if (ex.pile) expect(r.pile.map((x: any) => x.c)).toEqual(ex.pile);
      if (ex.revealed) expect(r.revealed.map((x: any) => x.c).sort((a: number, b: number) => a - b)).toEqual(ex.revealed);
      if (ex.reward !== undefined) {
        expect(r.last_reward ? { lives: r.last_reward.lives, shurikens: r.last_reward.shurikens } : null).toEqual(ex.reward);
      }
    });
  }
});

describe('configuración: el servidor y el cliente coinciden', () => {
  const inputs: unknown[] = [
    {},
    null,
    [],
    DEFAULT_CONFIG,
    { maxPlayers: 99, mode: 'hack', maxLives: -5, countdown: 'yes' },
    { maxPlayers: 2.4, maxShurikens: 7, difficulty: 'hard', shurikenVariant: 'reveal', mode: 'friends' },
    { customRewards: [{ level: 'x' }, { level: 4, lives: 50, shurikens: 0 }, { level: 4, lives: 1 }, null, { level: 1, lives: 0, shurikens: 0 }, { level: 1, lives: 1 }] },
    { rewardPreset: 'custom', customRewards: [{ level: 7, shurikens: 2 }, { level: 2, lives: 1, shurikens: 1 }] },
    { rewardPreset: 'none', countdown: false, maxLives: 1e30 },
    { customRewards: Array.from({ length: 30 }, (_, i) => ({ level: (i % 12) + 1, lives: 1 })) },
  ];

  it.each(inputs.map((x) => [JSON.stringify(x), x]))('normalize_config(%s)', async (_label, input) => {
    const [row] = await t.admin<{ c: unknown }>(`select game_private.normalize_config($1::jsonb) as c`, [JSON.stringify(input)]);
    expect(row!.c).toEqual(normalizeConfig(input));
  });

  it('recursos iniciales y recompensas', async () => {
    for (const difficulty of ['easy', 'classic', 'hard'] as const) {
      for (const rewardPreset of ['classic', 'custom', 'none'] as const) {
        const cfg = normalizeConfig({ difficulty, rewardPreset, maxLives: 3 });
        for (const n of [2, 3, 4]) {
          const [row] = await t.admin<{ r: unknown }>(`select game_private.starting_resources($1::jsonb, $2) as r`, [JSON.stringify(cfg), n]);
          expect(row!.r).toEqual(startingResources(cfg, n));
        }
        for (let level = 1; level <= 12; level++) {
          const [row] = await t.admin<{ r: unknown }>(`select game_private.reward_for($1::jsonb, $2) as r`, [JSON.stringify(cfg), level]);
          expect(row!.r).toEqual(rewardFor(cfg, level));
        }
      }
    }
  });

  it('limpieza de alias', async () => {
    const { cleanName } = await import('../../src/game/engine');
    for (const name of ['  Ana   María \n', '', 'x'.repeat(20), 'x'.repeat(21), 'Zoë 🎲', '\tLuis\u0007']) {
      const [row] = await t.admin<{ n: string | null }>(`select game_private.clean_name($1) as n`, [name]);
      expect(row!.n).toBe(cleanName(name));
    }
  });
});
