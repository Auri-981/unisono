import { describe, expect, it } from 'vitest';
import { SCENARIOS, type Scenario } from '../../tests/scenarios';
import * as E from './engine';
import { seededRng } from './testing';

const NOW = Date.parse('2026-10-19T12:00:00Z');

function setup(sc: Scenario) {
  const ids = Array.from({ length: sc.players }, (_, i) => `p${i}`);
  let s = E.createRoom({ id: 'room', code: 'ABCDE', hostId: ids[0]!, hostName: 'P0', config: sc.config, now: NOW });
  for (const id of ids.slice(1)) {
    const r = E.addPlayer(s, id, id.toUpperCase(), NOW);
    if (!r.ok) throw new Error(r.error);
    s = r.state;
  }
  for (const id of ids) {
    const ready = E.setLobbyReady(s, id, true, NOW);
    if (ready.ok) s = ready.state;
  }
  const r = E.startGame(s, ids[0]!, seededRng(1), NOW);
  if (!r.ok) throw new Error(r.error);
  s = structuredClone(r.state);
  s.level = sc.level;
  if (sc.lives !== undefined) s.lives = sc.lives;
  if (sc.shurikens !== undefined) s.shurikens = sc.shurikens;
  if (sc.rewinds !== undefined) s.rewinds = sc.rewinds;
  if (sc.shields !== undefined) s.shields = sc.shields;
  if (sc.shieldActive !== undefined) s.shieldActive = sc.shieldActive;
  // Las manos del motor van en orden de juego (de mayor a menor en descendente).
  const desc = sc.config?.order === 'desc';
  s.hands = Object.fromEntries(ids.map((id, i) => [id, [...sc.hands[i]!].sort((a, b) => (desc ? b - a : a - b))]));
  return { s, ids };
}

describe('escenarios compartidos (motor TypeScript)', () => {
  for (const sc of SCENARIOS) {
    it(sc.name, () => {
      let { s, ids } = setup(sc);
      const present = [...ids];
      for (const step of sc.steps) {
        let r: E.EngineResult;
        if ('play' in step) r = E.playCard(s, ids[step.play[0]]!, step.play[1], NOW);
        else if ('propose' in step) r = E.proposeShuriken(s, ids[step.propose]!, NOW);
        else if ('vote' in step) r = E.voteShuriken(s, ids[step.vote[0]]!, step.vote[1], NOW);
        else if ('shield' in step) r = E.proposeShield(s, ids[step.shield]!, NOW);
        else if ('pick' in step) r = E.pickComodin(s, ids[step.pick[0]]!, s.level, step.pick[1], seededRng(3), NOW);
        else if ('ready' in step) r = E.readyNextLevel(s, ids[step.ready]!, s.level, false, seededRng(4), NOW);
        else {
          r = E.removePlayer(s, ids[step.leave]!, 'left', seededRng(2), NOW);
          present.splice(present.indexOf(ids[step.leave]!), 1);
        }
        const expected = 'error' in step ? step.error : undefined;
        if (expected) {
          expect(r.ok ? 'OK' : r.error).toBe(expected);
        } else {
          expect(r.ok ? 'OK' : r.error).toBe('OK');
        }
        if (r.ok) s = r.state;
      }
      const ex = sc.expect;
      expect(s.status).toBe(ex.status);
      if (ex.level !== undefined) expect(s.level).toBe(ex.level);
      if (ex.lives !== undefined) expect(s.lives).toBe(ex.lives);
      if (ex.shurikens !== undefined) expect(s.shurikens).toBe(ex.shurikens);
      if (ex.rewinds !== undefined) expect(s.rewinds).toBe(ex.rewinds);
      if (ex.shields !== undefined) expect(s.shields).toBe(ex.shields);
      if (ex.shieldActive !== undefined) expect(s.shieldActive).toBe(ex.shieldActive);
      if (ex.vote !== undefined) expect(s.vote ? (s.vote.kind ?? 'shuriken') : null).toBe(ex.vote);
      if (ex.offer !== undefined) expect(s.offer ? [...s.offer.choices].sort() : null).toEqual(ex.offer);
      if (ex.hands) expect(present.map((id) => [...(s.hands[id] ?? [])].sort((a, b) => a - b))).toEqual(ex.hands);
      if (ex.pile) expect(s.pile.map((x) => x.c)).toEqual(ex.pile);
      if (ex.revealed) expect(s.revealed.map((x) => x.c).sort((a, b) => a - b)).toEqual(ex.revealed);
      if (ex.reward !== undefined) {
        const r = s.lastReward;
        expect(r ? { lives: r.lives, shurikens: r.shurikens, rewinds: r.rewinds ?? 0, shields: r.shields ?? 0 } : null).toEqual(ex.reward);
      }
    });
  }
});
