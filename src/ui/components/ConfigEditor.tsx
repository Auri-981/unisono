import { CONFIG_LIMITS, MAX_PLAYERS, MIN_PLAYERS, levelsToPlay, normalizeConfig, presetFor } from '../../config/gameConfig';
import { t } from '../../i18n';
import { rewardPresetLabel } from '../rewards';
import type { Reward, RoomConfig } from '../../game/types';

interface Props {
  config: RoomConfig;
  onChange: (config: RoomConfig) => void;
  disabled?: boolean;
  /** Oculta opciones que no tienen sentido (p. ej. chat y jugadores en el modo práctica). */
  practice?: boolean;
  /** Jugadores que habrá en la partida: limita cuántos niveles se pueden elegir. */
  playerCount: number;
}

function Select<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select
        className="input"
        value={String(value)}
        disabled={disabled}
        onChange={(e) => {
          const opt = options.find((o) => String(o.value) === e.target.value);
          if (opt) onChange(opt.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const range = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, i) => min + i);

export function ConfigEditor({ config, onChange, disabled, practice, playerCount }: Props) {
  const maxLevels = presetFor(playerCount).levels;
  // Si se eligieron más niveles de los que permiten los jugadores actuales, cuenta como «todos».
  const levelsValue = config.levels >= 1 && config.levels < maxLevels ? config.levels : 0;
  const set = (patch: Partial<RoomConfig>) => onChange(normalizeConfig({ ...config, ...patch }));
  const setReward = (i: number, patch: Partial<Reward>) =>
    set({ customRewards: config.customRewards.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const freeLevel = range(1, CONFIG_LIMITS.rewardLevel.max).find((l) => !config.customRewards.some((r) => r.level === l));

  return (
    <div className="config-editor">
      {!practice && (
        <>
          <Select
            label={t('config.maxPlayers')}
            value={config.maxPlayers}
            disabled={disabled}
            options={range(MIN_PLAYERS, MAX_PLAYERS).map((n) => ({ value: n, label: String(n) }))}
            onChange={(maxPlayers) => set({ maxPlayers })}
          />
          <Select
            label={t('config.mode')}
            value={config.mode}
            disabled={disabled}
            options={[
              { value: 'concentration', label: t('config.mode.concentration') },
              { value: 'friends', label: t('config.mode.friends') },
            ]}
            onChange={(mode) => set({ mode })}
          />
        </>
      )}
      <Select
        label={t('config.levels')}
        value={levelsValue}
        disabled={disabled}
        options={[
          { value: 0, label: t('config.levels.all', { n: maxLevels }) },
          ...range(1, maxLevels - 1).map((n) => ({ value: n, label: String(n) })),
        ]}
        onChange={(levels) => set({ levels })}
      />
      <Select
        label={t('config.difficulty')}
        value={config.difficulty}
        disabled={disabled}
        options={(['easy', 'classic', 'hard'] as const).map((d) => ({ value: d, label: t(`config.difficulty.${d}`) }))}
        onChange={(difficulty) => set({ difficulty })}
      />
      <Select
        label={t('config.shurikenVariant')}
        value={config.shurikenVariant}
        disabled={disabled}
        options={(['classic', 'reveal'] as const).map((v) => ({ value: v, label: t(`config.shurikenVariant.${v}`) }))}
        onChange={(shurikenVariant) => set({ shurikenVariant })}
      />
      <Select
        label={t('config.rewards')}
        value={config.rewardPreset}
        disabled={disabled}
        options={(['classic', 'custom', 'none'] as const).map((v) => ({ value: v, label: rewardPresetLabel(config, v) }))}
        onChange={(rewardPreset) => set({ rewardPreset })}
      />

      {config.rewardPreset === 'custom' && (
        <div className="reward-table" role="group" aria-label={t('config.rewards')}>
          {config.customRewards.map((r, i) => (
            <div className="reward-row" key={`${r.level}-${i}`}>
              <label className="reward-cell">
                <span className="field-label">{t('config.rewardLevel')}</span>
                <select className="input" value={r.level} disabled={disabled} onChange={(e) => setReward(i, { level: Number(e.target.value) })}>
                  {range(1, CONFIG_LIMITS.rewardLevel.max).map((l) => (
                    <option key={l} value={l} disabled={l !== r.level && config.customRewards.some((x) => x.level === l)}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="reward-cell">
                <span className="field-label">♥</span>
                <select className="input" value={r.lives} disabled={disabled} onChange={(e) => setReward(i, { lives: Number(e.target.value) })}>
                  {range(0, CONFIG_LIMITS.rewardAmount.max).map((n) => (
                    <option key={n} value={n}>
                      +{n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="reward-cell">
                <span className="field-label">★</span>
                <select className="input" value={r.shurikens} disabled={disabled} onChange={(e) => setReward(i, { shurikens: Number(e.target.value) })}>
                  {range(0, CONFIG_LIMITS.rewardAmount.max).map((n) => (
                    <option key={n} value={n}>
                      +{n}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                disabled={disabled}
                onClick={() => set({ customRewards: config.customRewards.filter((_, j) => j !== i) })}
              >
                {t('config.remove')}
              </button>
            </div>
          ))}
          {freeLevel !== undefined && config.customRewards.length < CONFIG_LIMITS.maxRewardRows && (
            <button
              type="button"
              className="btn btn-ghost btn-small"
              disabled={disabled}
              onClick={() => set({ customRewards: [...config.customRewards, { level: freeLevel, lives: 1, shurikens: 0 }] })}
            >
              + {t('config.addReward')}
            </button>
          )}
        </div>
      )}

      <div className="field-row">
        <Select
          label={t('config.maxLives')}
          value={config.maxLives}
          disabled={disabled}
          options={range(CONFIG_LIMITS.maxLives.min, CONFIG_LIMITS.maxLives.max).map((n) => ({ value: n, label: String(n) }))}
          onChange={(maxLives) => set({ maxLives })}
        />
        <Select
          label={t('config.maxShurikens')}
          value={config.maxShurikens}
          disabled={disabled}
          options={range(CONFIG_LIMITS.maxShurikens.min, CONFIG_LIMITS.maxShurikens.max).map((n) => ({ value: n, label: String(n) }))}
          onChange={(maxShurikens) => set({ maxShurikens })}
        />
      </div>

      <label className="toggle">
        <input type="checkbox" checked={config.countdown} disabled={disabled} onChange={(e) => set({ countdown: e.target.checked })} />
        <span>{t('config.countdown')}</span>
      </label>
    </div>
  );
}

/** Resumen legible de la configuración (para quien no es anfitrión). */
export function ConfigSummary({ config, playerCount }: { config: RoomConfig; playerCount: number }) {
  const levels = levelsToPlay(config, playerCount);
  const allLevels = levels === presetFor(playerCount).levels;
  const rewards =
    config.rewardPreset === 'custom'
      ? config.customRewards
          .map((r) => `${r.level}:${r.lives ? ` +${r.lives}♥` : ''}${r.shurikens ? ` +${r.shurikens}★` : ''}`)
          .join(' · ') || t('config.rewards.none')
      : rewardPresetLabel(config);
  return (
    <dl className="config-summary">
      <dt>{t('config.levels')}</dt>
      <dd>{allLevels ? t('config.levels.all', { n: levels }) : levels}</dd>
      <dt>{t('config.mode')}</dt>
      <dd>{t(`config.mode.${config.mode}`)}</dd>
      <dt>{t('config.difficulty')}</dt>
      <dd>{t(`config.difficulty.${config.difficulty}`)}</dd>
      <dt>{t('config.shurikenVariant')}</dt>
      <dd>{t(`config.shurikenVariant.${config.shurikenVariant}`)}</dd>
      <dt>{t('config.rewards')}</dt>
      <dd>{rewards}</dd>
      <dt>{t('config.maxLives')} / {t('config.maxShurikens')}</dt>
      <dd>
        {config.maxLives} / {config.maxShurikens}
      </dd>
    </dl>
  );
}
