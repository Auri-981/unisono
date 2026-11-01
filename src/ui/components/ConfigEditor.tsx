import type { ReactNode } from 'react';
import { CONFIG_LIMITS, MAX_PLAYERS, MIN_PLAYERS, normalizeConfig, presetFor, rewardTable, startingResources } from '../../config/gameConfig';
import { t } from '../../i18n';
import { LIFE_SYMBOL, COMODIN_SYMBOL, rewardListText } from '../rewards';
import type { Reward, RoomConfig } from '../../game/types';
import {
  ChatIcon,
  CloseIcon,
  ComodinIcon,
  CrownIcon,
  DifficultyIcon,
  LevelsIcon,
  LifeIcon,
  MinusIcon,
  OrderIcon,
  PlusIcon,
  TimerIcon,
  VistazoIcon,
} from './Icons';

interface Props {
  config: RoomConfig;
  onChange: (config: RoomConfig) => void;
  disabled?: boolean;
  /** Oculta opciones que no tienen sentido (p. ej. chat y jugadores en el modo práctica). */
  practice?: boolean;
  /** Jugadores que habrá en la partida: limita cuántos niveles se pueden elegir. */
  playerCount: number;
}

interface ChoiceOption<T> {
  value: T;
  label: string;
  hint?: string;
}

/** «Concentración (sin chat)» → «Concentración» y «Sin chat». */
function splitHint(text: string): { label: string; hint?: string } {
  const m = /^(.*?)\s*\((.*)\)$/.exec(text);
  if (!m) return { label: text };
  return { label: m[1]!, hint: m[2]!.charAt(0).toUpperCase() + m[2]!.slice(1) };
}

/** Botones de opción (en lugar de un desplegable) con la explicación de la opción elegida debajo. */
function Choice<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled,
  numeric,
}: {
  label: string;
  value: T;
  options: ChoiceOption<T>[];
  onChange: (v: T) => void;
  disabled?: boolean;
  numeric?: boolean;
}) {
  const current = options.find((o) => o.value === value);
  const hasHints = options.some((o) => o.hint);
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className={`segmented ${numeric ? '' : 'segmented-text'} choice`} role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            className={o.value === value ? 'is-on' : ''}
            disabled={disabled}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {hasHints && <p className="choice-hint">{current?.hint ?? ' '}</p>}
    </div>
  );
}

/** Selector numérico con botones − y +. `step` decide el siguiente valor (permite saltarse valores). */
function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  disabled,
  format = String,
  step,
  compact,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  format?: (v: number) => string;
  step?: (v: number, dir: 1 | -1) => number | undefined;
  compact?: boolean;
}) {
  const next = (dir: 1 | -1) => {
    const n = step ? step(value, dir) : value + dir;
    return n !== undefined && n >= min && n <= max ? n : undefined;
  };
  const down = next(-1);
  const up = next(1);
  return (
    <div className="field">
      {/* En la versión compacta la etiqueta va dentro del valor («Nivel 2», «+1 ♥»). */}
      {!compact && <span className="field-label">{label}</span>}
      <div className={`stepper ${compact ? 'stepper-compact' : ''}`} role="group" aria-label={label}>
        <button
          type="button"
          className="stepper-btn"
          aria-label={`${t('config.less')}: ${label}`}
          disabled={disabled || down === undefined}
          onClick={() => down !== undefined && onChange(down)}
        >
          <MinusIcon size={compact ? 16 : 18} />
        </button>
        <output className="stepper-value" aria-live="polite">
          {format(value)}
        </output>
        <button
          type="button"
          className="stepper-btn"
          aria-label={`${t('config.more')}: ${label}`}
          disabled={disabled || up === undefined}
          onClick={() => up !== undefined && onChange(up)}
        >
          <PlusIcon size={compact ? 16 : 18} />
        </button>
      </div>
    </div>
  );
}

/** Interruptor con aspecto de botón deslizante. */
export function Switch({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="toggle">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

const range = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, i) => min + i);

export function ConfigEditor({ config, onChange, disabled, practice, playerCount }: Props) {
  const maxLevels = presetFor(playerCount).levels;
  // Si se eligieron más niveles de los que permiten los jugadores actuales, cuenta como «todos».
  const levelsShown = config.levels >= 1 && config.levels < maxLevels ? config.levels : maxLevels;
  const set = (patch: Partial<RoomConfig>) => onChange(normalizeConfig({ ...config, ...patch }));
  const setReward = (i: number, patch: Partial<Reward>) =>
    set({ customRewards: config.customRewards.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const freeLevel = range(1, CONFIG_LIMITS.rewardLevel.max).find((l) => !config.customRewards.some((r) => r.level === l));
  const classicList = rewardListText(rewardTable({ ...config, rewardPreset: 'classic' }));

  return (
    <div className="config-editor">
      {!practice && (
        <>
          <Choice
            label={t('config.maxPlayers')}
            value={config.maxPlayers}
            disabled={disabled}
            numeric
            options={range(MIN_PLAYERS, MAX_PLAYERS).map((n) => ({ value: n, label: String(n) }))}
            onChange={(maxPlayers) => set({ maxPlayers })}
          />
          <Choice
            label={t('config.mode')}
            value={config.mode}
            disabled={disabled}
            options={(['concentration', 'friends'] as const).map((m) => ({ value: m, ...splitHint(t(`config.mode.${m}`)) }))}
            onChange={(mode) => set({ mode })}
          />
        </>
      )}
      <Choice
        label={t('config.order')}
        value={config.order}
        disabled={disabled}
        options={(['asc', 'desc'] as const).map((o) => {
          // Los números se entienden de un vistazo: «1 → 100» en el botón y «Ascendente» debajo.
          const { label, hint } = splitHint(t(`config.order.${o}`));
          return { value: o, label: hint ?? label, hint: label };
        })}
        onChange={(order) => set({ order })}
      />
      <Stepper
        label={t('config.levels')}
        value={levelsShown}
        min={1}
        max={maxLevels}
        disabled={disabled}
        format={(n) => (n === maxLevels ? t('config.levels.all', { n }) : String(n))}
        onChange={(n) => set({ levels: n === maxLevels ? 0 : n })}
      />
      <Choice
        label={t('config.difficulty')}
        value={config.difficulty}
        disabled={disabled}
        options={(['easy', 'classic', 'hard'] as const).map((d) => {
          const o = splitHint(t(`config.difficulty.${d}`));
          return { value: d, label: o.label, hint: o.hint ?? t('config.difficulty.classicHint') };
        })}
        onChange={(difficulty) => set({ difficulty })}
      />
      <Choice
        label={t('config.rewards')}
        value={config.rewardPreset}
        disabled={disabled}
        options={(['classic', 'custom', 'none'] as const).map((v) => ({
          value: v,
          label: t(`config.rewards.${v}Short`),
          hint: t(`config.rewards.${v}Hint`, { list: classicList }),
        }))}
        onChange={(rewardPreset) => set({ rewardPreset })}
      />

      {config.rewardPreset === 'custom' && (
        <div className="reward-table" role="group" aria-label={t('config.rewards')}>
          {config.customRewards.map((r, i) => {
            const taken = (l: number) => l !== r.level && config.customRewards.some((x) => x.level === l);
            // Al cambiar de nivel se saltan los que ya tienen recompensa.
            const stepLevel = (l: number, dir: 1 | -1) => {
              for (let n = l + dir; n >= 1 && n <= CONFIG_LIMITS.rewardLevel.max; n += dir) if (!taken(n)) return n;
              return undefined;
            };
            return (
              <div className="reward-row" key={`${r.level}-${i}`}>
                <Stepper
                  compact
                  label={t('config.rewardLevelShort')}
                  format={(n) => `${t('config.rewardLevelShort')} ${n}`}
                  value={r.level}
                  min={1}
                  max={CONFIG_LIMITS.rewardLevel.max}
                  step={stepLevel}
                  disabled={disabled}
                  onChange={(level) => setReward(i, { level })}
                />
                <Stepper
                  compact
                  label={LIFE_SYMBOL}
                  value={r.lives}
                  min={0}
                  max={CONFIG_LIMITS.rewardAmount.max}
                  format={(n) => `+${n} ${LIFE_SYMBOL}`}
                  disabled={disabled}
                  onChange={(lives) => setReward(i, { lives })}
                />
                <Stepper
                  compact
                  label={COMODIN_SYMBOL}
                  value={r.shurikens}
                  min={0}
                  max={CONFIG_LIMITS.rewardAmount.max}
                  format={(n) => `+${n} ${COMODIN_SYMBOL}`}
                  disabled={disabled}
                  onChange={(shurikens) => setReward(i, { shurikens })}
                />
                <button
                  type="button"
                  className="reward-remove"
                  aria-label={`${t('config.remove')}: ${t('config.rewardLevelShort')} ${r.level}`}
                  disabled={disabled}
                  onClick={() => set({ customRewards: config.customRewards.filter((_, j) => j !== i) })}
                >
                  <CloseIcon size={16} />
                </button>
              </div>
            );
          })}
          <p className="muted small">{t('config.comodinLegend', { symbol: COMODIN_SYMBOL })}</p>
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
        <Stepper
          label={t('config.maxLives')}
          value={config.maxLives}
          min={CONFIG_LIMITS.maxLives.min}
          max={CONFIG_LIMITS.maxLives.max}
          disabled={disabled}
          onChange={(maxLives) => set({ maxLives })}
        />
        <Stepper
          label={t('config.maxShurikens')}
          value={config.maxShurikens}
          min={CONFIG_LIMITS.maxShurikens.min}
          max={CONFIG_LIMITS.maxShurikens.max}
          disabled={disabled}
          onChange={(maxShurikens) => set({ maxShurikens })}
        />
      </div>

      <Switch label={t('config.countdown')} checked={config.countdown} disabled={disabled} onChange={(countdown) => set({ countdown })} />
    </div>
  );
}

/** Resumen legible de la configuración (para quien no es anfitrión). */
/**
 * Vista de la configuración para quien NO es anfitrión: lo mismo que ve el anfitrión al editarla,
 * pero en fichas de solo lectura (los números grandes arriba, cada opción con su icono y las
 * recompensas nivel a nivel).
 */
export function ConfigSummary({ config, playerCount, hostName }: { config: RoomConfig; playerCount: number; hostName: string }) {
  const res = startingResources(config, playerCount);
  const rewards = rewardTable(config);
  const mode = splitHint(t(`config.mode.${config.mode}`));
  const difficulty = splitHint(t(`config.difficulty.${config.difficulty}`));
  return (
    <div className="config-view">
      <div className="config-stats">
        <div className="config-stat">
          <LevelsIcon size={22} className="config-stat-icon stat-levels" />
          <span className="config-stat-value">{res.maxLevel}</span>
          <span className="config-stat-label">{t('config.view.levels')}</span>
        </div>
        <div className="config-stat">
          <LifeIcon size={22} className="config-stat-icon stat-lives" />
          <span className="config-stat-value">{res.lives}</span>
          <span className="config-stat-label">{t('common.lives')}</span>
        </div>
        <div className="config-stat">
          <VistazoIcon size={22} className="config-stat-icon stat-vistazos" />
          <span className="config-stat-value">{res.shurikens}</span>
          <span className="config-stat-label">{t('common.shurikens')}</span>
        </div>
      </div>

      <ul className="config-tiles">
        <ConfigTile icon={<OrderIcon size={16} />} label={t('config.order')} value={config.order === 'asc' ? '1 → 100' : '100 → 1'} hint={t(`config.order.view.${config.order}`)} />
        <ConfigTile icon={<ChatIcon size={16} />} label={t('config.mode')} value={mode.label} hint={mode.hint} />
        <ConfigTile icon={<DifficultyIcon size={16} level={config.difficulty} />} label={t('config.difficulty')} value={difficulty.label} hint={difficulty.hint ?? t('config.difficulty.classicHint')} />
        <ConfigTile icon={<TimerIcon size={16} />} label={t('config.view.countdown')} value={t(config.countdown ? 'config.view.yes' : 'config.view.no')} hint={t('config.view.countdownHint')} />
        <ConfigTile
          icon={<ComodinIcon size={16} />}
          label={t('config.view.caps')}
          value={
            <>
              {res.livesCap}
              <LifeIcon size={15} className="tile-inline-life" /> · {res.shurikensCap}
              <ComodinIcon size={15} className="tile-inline-comodin" />
            </>
          }
          hint={t('config.view.capsHint')}
        />
      </ul>

      <div className="config-rewards">
        <span className="field-label">{t('config.rewards')}</span>
        {rewards.length === 0 ? (
          <p className="muted small">{t('config.rewards.noneHint')}</p>
        ) : (
          <ul className="reward-chips">
            {rewards.map((r) => (
              <li key={r.level} className={`reward-chip ${r.level >= res.maxLevel ? 'is-out' : ''}`}>
                <span className="reward-chip-level">{t('config.view.level', { n: r.level })}</span>
                <span className="reward-chip-prize">
                  {r.lives > 0 && (
                    <span className="resource resource-life">
                      <LifeIcon size={14} />+{r.lives}
                    </span>
                  )}
                  {r.shurikens > 0 && (
                    <span className="resource resource-comodin">
                      <ComodinIcon size={14} />+{r.shurikens}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="config-lock">
        <CrownIcon size={15} />
        {t('config.view.onlyHost', { name: hostName })}
      </p>
    </div>
  );
}

function ConfigTile({ icon, label, value, hint }: { icon: ReactNode; label: string; value: ReactNode; hint?: string }) {
  return (
    <li className="config-tile">
      <span className="config-tile-icon" aria-hidden>
        {icon}
      </span>
      <span className="config-tile-label">{label}</span>
      <span className="config-tile-value">{value}</span>
      {hint && <span className="config-tile-hint">{hint}</span>}
    </li>
  );
}
