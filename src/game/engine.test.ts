import { describe, expect, it } from 'vitest';
import {
  CLASSIC_REWARDS,
  DEFAULT_CONFIG,
  PLAYER_PRESETS,
  SHURIKEN_VOTE_SECONDS,
  normalizeConfig,
  rewardFor,
  rewardTable,
  startingResources,
} from '../config/gameConfig';
import { createDeck, deal, shuffle } from './deck';
import * as E from './engine';
import { seededRng } from './testing';

const NOW = Date.parse('2026-10-19T12:00:00Z');

function ok(r: E.EngineResult): E.EngineState {
  if (!r.ok) throw new Error(`Se esperaba éxito y llegó ${r.error}`);
  return r.state;
}

function room(players: number, config?: unknown) {
  const ids = Array.from({ length: players }, (_, i) => `p${i}`);
  let s = E.createRoom({ id: 'r', code: 'ABCDE', hostId: ids[0]!, hostName: 'Ana', config, now: NOW });
  for (const id of ids.slice(1)) s = ok(E.addPlayer(s, id, `Jugador ${id}`, NOW));
  s = readyAll(s);
  return { s, ids };
}

/** Todos marcan «Listo» (requisito para empezar). */
function readyAll(s: E.EngineState): E.EngineState {
  for (const p of s.players) s = ok(E.setLobbyReady(s, p.id, true, NOW));
  return s;
}

/** Juega todas las cartas en el orden global correcto. */
function playPerfectLevel(s: E.EngineState): E.EngineState {
  const all = Object.entries(s.hands)
    .flatMap(([p, h]) => h.map((c) => ({ p, c })))
    .sort((a, b) => a.c - b.c);
  for (const { p, c } of all) s = ok(E.playCard(s, p, c, NOW));
  return s;
}

describe('baraja', () => {
  it('tiene exactamente las cartas del 1 al 100', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(100);
    expect(deck[0]).toBe(1);
    expect(deck[99]).toBe(100);
    expect(deck).not.toContain(0);
  });

  it('no tiene duplicados, tampoco después de mezclar', () => {
    const shuffled = shuffle(createDeck(), seededRng(7));
    expect(new Set(shuffled).size).toBe(100);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(createDeck());
    expect(shuffled).not.toEqual(createDeck());
  });
});

describe('reparto', () => {
  it.each([2, 3, 4])('reparte bien a %i jugadores en todos los niveles', (n) => {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const levels = PLAYER_PRESETS[n]!.levels;
    for (let level = 1; level <= levels; level++) {
      const hands = deal(ids, level, seededRng(level * 31 + n));
      const all = Object.values(hands).flat();
      expect(Object.keys(hands)).toHaveLength(n);
      for (const h of Object.values(hands)) {
        expect(h).toHaveLength(level);
        expect(h).toEqual([...h].sort((a, b) => a - b));
      }
      expect(new Set(all).size).toBe(n * level);
      expect(all.every((c) => c >= 1 && c <= 100)).toBe(true);
    }
  });

  it('es uniforme: ningún jugador recibe sistemáticamente cartas más bajas', () => {
    const rng = seededRng(12345);
    const trials = 20000;
    let p0Lower = 0;
    let sum = 0;
    for (let i = 0; i < trials; i++) {
      const h = deal(['a', 'b'], 1, rng);
      if (h.a![0]! < h.b![0]!) p0Lower++;
      sum += h.a![0]!;
    }
    expect(p0Lower / trials).toBeGreaterThan(0.48);
    expect(p0Lower / trials).toBeLessThan(0.52);
    expect(sum / trials).toBeGreaterThan(49);
    expect(sum / trials).toBeLessThan(52);
  });

  it('rechaza repartos imposibles', () => {
    expect(() => deal(['a', 'b', 'c', 'd'], 26, seededRng(1))).toThrow();
  });
});

describe('configuración', () => {
  it('usa los valores clásicos por número de jugadores', () => {
    expect(startingResources(DEFAULT_CONFIG, 2)).toMatchObject({ maxLevel: 12, lives: 2, shurikens: 1 });
    expect(startingResources(DEFAULT_CONFIG, 3)).toMatchObject({ maxLevel: 10, lives: 3, shurikens: 1 });
    expect(startingResources(DEFAULT_CONFIG, 4)).toMatchObject({ maxLevel: 8, lives: 4, shurikens: 1 });
  });

  it('permite jugar menos niveles, pero nunca más de los que tocan por jugadores', () => {
    expect(startingResources({ ...DEFAULT_CONFIG, levels: 5 }, 2).maxLevel).toBe(5);
    expect(startingResources({ ...DEFAULT_CONFIG, levels: 10 }, 4).maxLevel).toBe(8);
    expect(startingResources({ ...DEFAULT_CONFIG, levels: 0 }, 3).maxLevel).toBe(10);
    expect(normalizeConfig({ levels: 50 }).levels).toBe(12);
    expect(normalizeConfig({}).levels).toBe(0);
  });

  it('aplica la dificultad', () => {
    expect(startingResources({ ...DEFAULT_CONFIG, difficulty: 'easy' }, 2)).toMatchObject({ lives: 3, shurikens: 2 });
    // Difícil: 1 sola vida y ningún shuriken, sea cual sea el número de jugadores.
    for (const n of [2, 3, 4]) {
      expect(startingResources({ ...DEFAULT_CONFIG, difficulty: 'hard' }, n)).toMatchObject({ lives: 1, shurikens: 0 });
    }
  });

  it('normaliza entradas maliciosas o incorrectas sin romperse', () => {
    const c = normalizeConfig({
      maxPlayers: 99,
      mode: 'hack',
      maxLives: -5,
      customRewards: [{ level: 'x' }, { level: 4, lives: 50, shurikens: 0 }, { level: 4, lives: 1 }, null],
      countdown: 'yes',
    });
    expect(c.maxPlayers).toBe(4);
    expect(c.mode).toBe('concentration');
    expect(c.maxLives).toBe(1);
    expect(c.customRewards).toEqual([{ level: 4, lives: 3, shurikens: 0 }]);
    expect(c.countdown).toBe(true);
    expect(normalizeConfig(null)).toEqual(DEFAULT_CONFIG);
  });

  it('en difícil hay menos recompensas y más espaciadas (salvo personalizadas)', () => {
    const hard = { ...DEFAULT_CONFIG, rewardPreset: 'classic' as const, difficulty: 'hard' as const };
    expect(rewardTable(hard).map((r) => r.level)).toEqual([3, 6, 9]);
    expect(rewardFor(hard, 2)).toEqual({ lives: 0, shurikens: 0 });
    expect(rewardFor(hard, 3)).toEqual({ lives: 0, shurikens: 1 });
    expect(rewardFor(hard, 6)).toEqual({ lives: 1, shurikens: 0 });
    const custom = { ...hard, rewardPreset: 'custom' as const, customRewards: [{ level: 1, lives: 1, shurikens: 0 }] };
    expect(rewardFor(custom, 1)).toEqual({ lives: 1, shurikens: 0 });
  });

  it('tabla de recompensas clásica', () => {
    const cfg = { ...DEFAULT_CONFIG, rewardPreset: 'classic' as const };
    expect(CLASSIC_REWARDS.map((r) => r.level)).toEqual([2, 3, 5, 6, 8, 9]);
    expect(rewardFor(cfg, 2)).toEqual({ lives: 0, shurikens: 1 });
    expect(rewardFor(cfg, 3)).toEqual({ lives: 1, shurikens: 0 });
    expect(rewardFor(cfg, 4)).toEqual({ lives: 0, shurikens: 0 });
    expect(rewardFor({ ...cfg, rewardPreset: 'none' }, 2)).toEqual({ lives: 0, shurikens: 0 });
  });
});

describe('sala', () => {
  it('limpia los alias y rechaza los inválidos', () => {
    expect(E.cleanName('  Ana   María \n')).toBe('Ana María');
    expect(E.cleanName('')).toBeNull();
    expect(E.cleanName('x'.repeat(21))).toBeNull();
    expect(E.cleanName(42)).toBeNull();
  });

  it('impide entrar si la sala está llena o la partida ha empezado', () => {
    let { s } = room(2, { maxPlayers: 2 });
    expect(E.addPlayer(s, 'x', 'Intruso', NOW)).toEqual({ ok: false, error: 'ROOM_FULL' });
    ({ s } = room(2));
    s = ok(E.startGame(s, 'p0', seededRng(1), NOW));
    expect(E.addPlayer(s, 'x', 'Intruso', NOW)).toEqual({ ok: false, error: 'GAME_IN_PROGRESS' });
  });

  it('no se puede empezar hasta que todos (anfitrión incluido) estén listos', () => {
    let s = E.createRoom({ id: 'r', code: 'ABCDE', hostId: 'p0', hostName: 'Ana', now: NOW });
    s = ok(E.addPlayer(s, 'p1', 'Luis', NOW));
    s = ok(E.setLobbyReady(s, 'p1', true, NOW));
    expect(E.startGame(s, 'p0', seededRng(1), NOW)).toEqual({ ok: false, error: 'NOT_ALL_READY' });
    s = ok(E.setLobbyReady(s, 'p0', true, NOW));
    s = ok(E.setLobbyReady(s, 'p1', false, NOW));
    expect(E.startGame(s, 'p0', seededRng(1), NOW)).toEqual({ ok: false, error: 'NOT_ALL_READY' });
    s = ok(E.setLobbyReady(s, 'p1', true, NOW));
    expect(E.startGame(s, 'p0', seededRng(1), NOW).ok).toBe(true);
  });

  it('solo el anfitrión inicia, con al menos 2 jugadores', () => {
    const { s } = room(2);
    expect(E.startGame(s, 'p1', seededRng(1), NOW)).toEqual({ ok: false, error: 'NOT_HOST' });
    const solo = room(1).s;
    expect(E.startGame(solo, 'p0', seededRng(1), NOW)).toEqual({ ok: false, error: 'NOT_ENOUGH_PLAYERS' });
  });

  it('un jugador que no pertenece a la sala no puede actuar', () => {
    let { s } = room(2);
    s = ok(E.startGame(s, 'p0', seededRng(1), NOW));
    expect(E.playCard(s, 'intruso', 5, NOW)).toEqual({ ok: false, error: 'NOT_MEMBER' });
    expect(E.proposeShuriken(s, 'intruso', NOW)).toEqual({ ok: false, error: 'NOT_MEMBER' });
  });

  it('si el anfitrión se va, el rol pasa al siguiente jugador', () => {
    let { s } = room(3);
    s = ok(E.removePlayer(s, 'p0', 'left', seededRng(1), NOW));
    expect(s.hostId).toBe('p1');
    expect(s.status).toBe('lobby');
  });

  it('el anfitrión puede expulsar, pero no a sí mismo', () => {
    let { s } = room(3);
    expect(E.kickPlayer(s, 'p0', 'p0', seededRng(1), NOW)).toEqual({ ok: false, error: 'CANNOT_KICK_SELF' });
    expect(E.kickPlayer(s, 'p1', 'p2', seededRng(1), NOW)).toEqual({ ok: false, error: 'NOT_HOST' });
    s = ok(E.kickPlayer(s, 'p0', 'p2', seededRng(1), NOW));
    expect(s.players.map((p) => p.id)).toEqual(['p0', 'p1']);
  });
});

describe('privacidad', () => {
  it('la vista de un jugador solo contiene sus propias cartas', () => {
    let { s, ids } = room(4);
    s = ok(E.startGame(s, 'p0', seededRng(9), NOW));
    s.level = 5;
    s.hands = { p0: [1, 2, 3, 4, 5], p1: [11, 12, 13, 14, 15], p2: [21, 22, 23, 24, 25], p3: [31, 32, 33, 34, 35] };
    for (const viewer of ids) {
      const snap = E.toSnapshot(s, viewer, NOW);
      expect(snap.myHand).toEqual(s.hands[viewer]);
      expect(JSON.stringify(snap)).not.toContain('"hands"');
      for (const other of ids.filter((x) => x !== viewer)) {
        for (const c of s.hands[other]!) expect(snap.myHand).not.toContain(c);
      }
      expect(snap.players.map((p) => p.cardsLeft)).toEqual([5, 5, 5, 5]);
    }
  });

  it('el shuriken clásico no revela las cartas descartadas en el evento', () => {
    let { s } = room(2);
    s = ok(E.startGame(s, 'p0', seededRng(9), NOW));
    s.level = 2;
    s.hands = { p0: [7, 70], p1: [9, 90] };
    s = ok(E.proposeShuriken(s, 'p0', NOW));
    s = ok(E.voteShuriken(s, 'p1', true, NOW));
    const json = JSON.stringify(E.toSnapshot(s, 'p0', NOW));
    expect(json).not.toMatch(/"c":7\b/);
    expect(json).not.toMatch(/"c":9\b/);
  });
});

describe('votación de shuriken', () => {
  it('caduca a los 15 segundos y no consume el shuriken', () => {
    let { s } = room(2);
    s = ok(E.startGame(s, 'p0', seededRng(3), NOW));
    s = ok(E.proposeShuriken(s, 'p0', NOW));
    const later = NOW + SHURIKEN_VOTE_SECONDS * 1000 + 1;
    const early = E.expireVote(s, NOW + 1000);
    expect(early.ok && early.events).toHaveLength(0);
    s = ok(E.expireVote(s, later));
    expect(s.vote).toBeNull();
    expect(s.shurikens).toBe(1);
    expect(s.lastEvent?.payload).toEqual({ reason: 'expired' });
  });

  it('una votación caducada no bloquea las jugadas', () => {
    let { s } = room(2);
    s = ok(E.startGame(s, 'p0', seededRng(3), NOW));
    s = ok(E.proposeShuriken(s, 'p0', NOW));
    const later = NOW + SHURIKEN_VOTE_SECONDS * 1000 + 1;
    const lowest = Math.min(s.hands.p0![0]!, s.hands.p1![0]!);
    const who = s.hands.p0![0] === lowest ? 'p0' : 'p1';
    s = ok(E.playCard(s, who, lowest, later));
    expect(s.pile.map((x) => x.c)).toEqual([lowest]);
  });

  it('si la votación caduca, quien la propuso queda bloqueado hasta la siguiente carta', () => {
    let { s } = room(2);
    s = ok(E.startGame(s, 'p0', seededRng(3), NOW));
    s.level = 2;
    s.hands = { p0: [10, 60], p1: [20, 70] };
    s = ok(E.proposeShuriken(s, 'p0', NOW));
    const later = NOW + SHURIKEN_VOTE_SECONDS * 1000 + 1;
    s = ok(E.expireVote(s, later));
    expect(s.shurikenBlocked).toEqual(['p0']);
    expect(E.proposeShuriken(s, 'p0', later)).toEqual({ ok: false, error: 'SHURIKEN_BLOCKED' });
    expect(E.toSnapshot(s, 'p1', later).room.shurikenBlocked).toEqual(['p0']);
    s = ok(E.playCard(s, 'p0', 10, later));
    expect(s.shurikenBlocked).toEqual([]);
    expect(E.proposeShuriken(s, 'p0', later).ok).toBe(true);
  });

  it('el bloqueo se borra al usar un shuriken y al empezar un nivel', () => {
    let { s } = room(3);
    s = ok(E.startGame(s, 'p0', seededRng(3), NOW));
    s.level = 2;
    s.shurikens = 2;
    s.hands = { p0: [10, 60], p1: [20, 70], p2: [30, 80] };
    s = ok(E.proposeShuriken(s, 'p0', NOW));
    s = ok(E.voteShuriken(s, 'p1', false, NOW));
    s = ok(E.proposeShuriken(s, 'p1', NOW));
    s = ok(E.voteShuriken(s, 'p0', true, NOW));
    s = ok(E.voteShuriken(s, 'p2', true, NOW));
    expect(s.shurikens).toBe(1);
    expect(s.shurikenBlocked).toEqual([]);
    s.shurikenBlocked = ['p2'];
    for (const c of [60, 70, 80]) s = ok(E.playCard(s, ['p0', 'p1', 'p2'][(c - 60) / 10]!, c, NOW));
    s.shurikenBlocked = ['p2'];
    s = ok(E.readyNextLevel(s, 'p0', 2, true, seededRng(4), NOW));
    expect(s.level).toBe(3);
    expect(s.shurikenBlocked).toEqual([]);
  });

  it('votar dos veces no cuenta doble ni consume dos shurikens', () => {
    let { s } = room(3);
    s = ok(E.startGame(s, 'p0', seededRng(3), NOW));
    s.shurikens = 2;
    s = ok(E.proposeShuriken(s, 'p0', NOW));
    const again = E.voteShuriken(s, 'p0', true, NOW);
    expect(again.ok && again.events.length).toBe(0);
    s = ok(E.voteShuriken(s, 'p1', true, NOW));
    s = ok(E.voteShuriken(s, 'p1', true, NOW));
    expect(s.shurikens).toBe(2);
    s = ok(E.voteShuriken(s, 'p2', true, NOW));
    expect(s.shurikens).toBe(1);
  });
});

describe('progresión de niveles', () => {
  it('pasar de nivel requiere que todos estén listos y reparte una carta más', () => {
    let { s } = room(3);
    s = ok(E.startGame(s, 'p0', seededRng(5), NOW));
    s = playPerfectLevel(s);
    expect(s.status).toBe('level_complete');
    s = ok(E.readyNextLevel(s, 'p0', 1, false, seededRng(6), NOW));
    s = ok(E.readyNextLevel(s, 'p1', 1, false, seededRng(6), NOW));
    expect(s.status).toBe('level_complete');
    s = ok(E.readyNextLevel(s, 'p2', 1, false, seededRng(6), NOW));
    expect(s.status).toBe('playing');
    expect(s.level).toBe(2);
    expect(Object.values(s.hands).map((h) => h.length)).toEqual([2, 2, 2]);
    expect(s.pile).toEqual([]);
  });

  it('una petición de «listo» repetida o tardía no salta niveles', () => {
    let { s } = room(2);
    s = ok(E.startGame(s, 'p0', seededRng(5), NOW));
    s = playPerfectLevel(s);
    s = ok(E.readyNextLevel(s, 'p0', 1, true, seededRng(6), NOW));
    expect(s.level).toBe(2);
    const dup = E.readyNextLevel(s, 'p0', 1, true, seededRng(6), NOW);
    expect(dup.ok && dup.state.level).toBe(2);
    expect(dup.ok && dup.events).toEqual([]);
  });

  it('el anfitrión puede forzar el siguiente nivel; los demás no', () => {
    let { s } = room(2);
    s = ok(E.startGame(s, 'p0', seededRng(5), NOW));
    s = playPerfectLevel(s);
    s = ok(E.readyNextLevel(s, 'p1', 1, true, seededRng(6), NOW));
    expect(s.status).toBe('level_complete');
  });

  it.each([2, 3, 4])('partida completa perfecta con %i jugadores termina en victoria', (n) => {
    let { s } = room(n, { rewardPreset: 'classic' });
    s = ok(E.startGame(s, 'p0', seededRng(n), NOW));
    const maxLevel = PLAYER_PRESETS[n]!.levels;
    expect(s.maxLevel).toBe(maxLevel);
    for (let level = 1; level <= maxLevel; level++) {
      expect(s.level).toBe(level);
      expect(Object.values(s.hands).every((h) => h.length === level)).toBe(true);
      s = playPerfectLevel(s);
      if (level < maxLevel) {
        expect(s.status).toBe('level_complete');
        s = ok(E.readyNextLevel(s, 'p0', level, true, seededRng(level), NOW));
      }
    }
    expect(s.status).toBe('won');
    // Recompensas clásicas con tope: 5 vidas, 3 shurikens.
    expect(s.lives).toBeLessThanOrEqual(5);
    expect(s.shurikens).toBeLessThanOrEqual(3);
  });

  it('las vidas se consumen de una en una hasta la derrota', () => {
    let { s } = room(2);
    s = ok(E.startGame(s, 'p0', seededRng(5), NOW));
    s.level = 3;
    s.hands = { p0: [1, 2, 3], p1: [50, 60, 70] };
    s = ok(E.playCard(s, 'p1', 50, NOW)); // descarta 1, 2, 3 → 1 vida
    expect(s.lives).toBe(1);
    expect(s.status).toBe('playing');
    s.hands.p0 = [55];
    s = ok(E.playCard(s, 'p1', 60, NOW));
    expect(s.lives).toBe(0);
    expect(s.status).toBe('lost');
    expect(s.hands).toEqual({});
  });

  it('revancha: vuelve a la sala con el mismo grupo', () => {
    let { s } = room(2);
    s = ok(E.startGame(s, 'p0', seededRng(5), NOW));
    s = ok(E.removePlayer(s, 'p1', 'left', seededRng(1), NOW));
    expect(s.status).toBe('abandoned');
    expect(E.rematch(s, 'p0', NOW).ok).toBe(true);
    s = ok(E.rematch(s, 'p0', NOW));
    expect(s.status).toBe('lobby');
    expect(s.level).toBe(0);
    s = ok(E.addPlayer(s, 'p9', 'Nuevo', NOW));
    expect(E.startGame(s, 'p0', seededRng(5), NOW)).toEqual({ ok: false, error: 'NOT_ALL_READY' });
    s = readyAll(s);
    s = ok(E.startGame(s, 'p0', seededRng(5), NOW));
    expect(s.gameNo).toBe(2);
  });

  it('un error que cierra el nivel deja ambos eventos en la foto (máximo 8)', () => {
    let { s } = room(2);
    s = ok(E.startGame(s, 'p0', seededRng(5), NOW));
    s.hands = { p0: [30], p1: [50] };
    s = ok(E.playCard(s, 'p1', 50, NOW));
    expect(E.toSnapshot(s, 'p0', NOW).recentEvents!.map((e) => e.kind).slice(-2)).toEqual(['mistake', 'level_complete']);

    // Muchas propuestas rechazadas: la lista no crece por encima del límite.
    s = ok(E.readyNextLevel(s, 'p0', 1, true, seededRng(6), NOW));
    for (let i = 0; i < 6; i++) {
      s = ok(E.proposeShuriken(s, 'p0', NOW));
      s = ok(E.voteShuriken(s, 'p1', false, NOW));
      s.shurikenBlocked = []; // aquí solo se comprueba el límite de eventos
    }
    const recent = E.toSnapshot(s, 'p0', NOW).recentEvents!;
    expect(recent).toHaveLength(E.RECENT_EVENTS);
    expect(recent.at(-1)?.seq).toBe(s.eventSeq);
  });

  it('cada acción incrementa la versión y nunca la reduce', () => {
    let { s } = room(2);
    const v0 = s.version;
    s = ok(E.startGame(s, 'p0', seededRng(5), NOW));
    expect(s.version).toBe(v0 + 1);
    s = ok(E.proposeShuriken(s, 'p0', NOW));
    expect(s.version).toBe(v0 + 2);
  });
});
