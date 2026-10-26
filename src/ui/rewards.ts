/** Recompensa que se obtendrá al superar un nivel (para anunciarla antes de jugarlo). */
import { rewardFor, rewardTable, startingResources } from '../config/gameConfig';
import type { PublicRoom, Reward, RoomConfig } from '../game/types';
import { t } from '../i18n';

export interface UpcomingReward {
  lives: number;
  shurikens: number;
  /** Ya tenéis el máximo: esa parte del premio no se sumará. */
  livesFull: boolean;
  shurikensFull: boolean;
}

/**
 * Premio por superar `level` (por defecto, el nivel actual), o null si no hay.
 * El último nivel no da premio útil (la partida termina), así que tampoco se anuncia.
 */
export function upcomingReward(room: PublicRoom, players: number, level = room.level): UpcomingReward | null {
  if (level < 1 || level >= room.maxLevel) return null;
  const r = rewardFor(room.config, level);
  if (r.lives === 0 && r.shurikens === 0) return null;
  // Mismo tope que el servidor: nunca por debajo de los recursos iniciales.
  const start = startingResources(room.config, Math.max(2, players));
  return {
    ...r,
    livesFull: r.lives > 0 && room.lives >= start.livesCap,
    shurikensFull: r.shurikens > 0 && room.shurikens >= start.shurikensCap,
  };
}

/** Símbolos para textos sencillos (listas en desplegables, reglas). */
export const LIFE_SYMBOL = '♥';
export const VISTAZO_SYMBOL = '👁';

/** «2👁 3♥ 5👁…»: lista compacta de una tabla de recompensas. */
export function rewardListText(rewards: Reward[]): string {
  return rewards
    .map((r) => `${r.level}${LIFE_SYMBOL.repeat(r.lives)}${VISTAZO_SYMBOL.repeat(r.shurikens)}`)
    .join(' ');
}

/** Nombre de la opción de recompensas tal y como se aplicará con esta configuración. */
export function rewardPresetLabel(config: RoomConfig, preset = config.rewardPreset): string {
  if (preset === 'classic') return t('config.rewards.classic', { list: rewardListText(rewardTable({ ...config, rewardPreset: 'classic' })) });
  return t(`config.rewards.${preset}`);
}

/** «+1 vida y +1 shuriken», indicando lo que no se sumará por estar al máximo. */
export function rewardText(r: UpcomingReward): string {
  const parts: string[] = [];
  if (r.lives > 0) {
    parts.push(t(r.lives === 1 ? 'reward.life' : 'reward.lives', { n: r.lives }) + (r.livesFull ? ` ${t('reward.full')}` : ''));
  }
  if (r.shurikens > 0) {
    parts.push(
      t(r.shurikens === 1 ? 'reward.shuriken' : 'reward.shurikens', { n: r.shurikens }) +
        (r.shurikensFull ? ` ${t('reward.full')}` : ''),
    );
  }
  return parts.join(` ${t('reward.and')} `);
}
