import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../config/gameConfig';
import type { PublicRoom } from '../game/types';
import { rewardText, upcomingReward } from './rewards';

const room = (patch: Partial<PublicRoom> = {}): PublicRoom => ({
  id: 'r',
  code: 'ABCDE',
  status: 'playing',
  hostId: 'a',
  config: { ...DEFAULT_CONFIG, rewardPreset: 'classic' },
  gameNo: 1,
  level: 2,
  maxLevel: 12,
  lives: 2,
  shurikens: 1,
  version: 1,
  ...patch,
});

describe('premio anunciado del nivel', () => {
  it('anuncia el premio clásico del nivel actual', () => {
    expect(upcomingReward(room({ level: 2 }), 2)).toEqual({ lives: 0, shurikens: 1, livesFull: false, shurikensFull: false });
    expect(rewardText(upcomingReward(room({ level: 3 }), 2)!)).toBe('+1 vida');
  });

  it('no anuncia nada en niveles sin premio ni en el último nivel', () => {
    expect(upcomingReward(room({ level: 4 }), 2)).toBeNull();
    expect(upcomingReward(room({ level: 2, maxLevel: 2 }), 2)).toBeNull();
    expect(upcomingReward(room({ config: { ...DEFAULT_CONFIG, rewardPreset: 'none' } }), 2)).toBeNull();
  });

  it('avisa si ya tenéis el máximo', () => {
    const r = upcomingReward(room({ level: 3, lives: 5 }), 2)!;
    expect(r.livesFull).toBe(true);
    expect(rewardText(r)).toBe('+1 vida (ya tenéis el máximo)');
  });

  it('combina vidas y shurikens en recompensas personalizadas', () => {
    const config = { ...DEFAULT_CONFIG, rewardPreset: 'custom' as const, customRewards: [{ level: 1, lives: 2, shurikens: 1 }] };
    expect(rewardText(upcomingReward(room({ level: 1, config }), 2)!)).toBe('+2 vidas y +1 shuriken');
  });
});
