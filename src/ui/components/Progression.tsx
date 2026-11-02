/**
 * Piezas visuales de la progresión: la etiqueta del título (bajo el nombre), la rareza, el icono
 * de cada categoría de logros, la barra de progreso y la tarjeta de un logro.
 */
import type { ReactNode } from 'react';
import type { Rarity } from '../../game/types';
import { t } from '../../i18n';
import type { Achievement, AchievementCategory, CatalogItem } from '../../net/api';
import { Card } from './Card';
import { CardsIcon, CheckIcon, CoinIcon, LevelsIcon, LockIcon, SparkIcon, TargetIcon, TeamIcon, TitleIcon, TrophyIcon } from './Icons';

/** El título de un jugador, en pequeño (null: no se muestra nada). */
export function TitleTag({
  title,
  className = '',
}: {
  title: { name: string; rarity?: Rarity } | null | undefined;
  className?: string;
}) {
  if (!title) return null;
  return <span className={`title-tag rarity-${title.rarity ?? 'common'} ${className}`}>{title.name}</span>;
}

export function RarityLabel({ rarity = 'common' }: { rarity?: Rarity }) {
  return <span className={`rarity-label rarity-${rarity}`}>{t(`rarity.${rarity}`)}</span>;
}

export const ACHIEVEMENT_CATEGORIES: AchievementCategory[] = ['games', 'wins', 'progress', 'skill', 'team', 'special'];

export function CategoryIcon({ category, size = 22 }: { category: AchievementCategory; size?: number }) {
  switch (category) {
    case 'games':
      return <CardsIcon size={size} />;
    case 'wins':
      return <TrophyIcon size={size} />;
    case 'progress':
      return <LevelsIcon size={size} />;
    case 'skill':
      return <TargetIcon size={size} />;
    case 'team':
      return <TeamIcon size={size} />;
    default:
      return <SparkIcon size={size} />;
  }
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <span className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <span className="progress-fill" style={{ width: `${pct}%` }} />
    </span>
  );
}

/** Lo que se lleva (racha en curso en los logros de racha) y cuánto falta. */
export function achievementNow(a: Achievement): { value: number; left: number } {
  const value = a.unlockedAt ? a.target : Math.min(a.target, a.streak ?? a.progress);
  return { value, left: Math.max(0, a.target - value) };
}

export const leftText = (left: number) => (left === 1 ? t('ach.leftOne') : t('ach.left', { n: left }));

/** Premios de un logro: monedas y cosméticos (con una miniatura si es una carta). */
export function AchievementRewards({ a, catalog }: { a: Achievement; catalog: CatalogItem[] }) {
  if (a.rewardCoins === 0 && a.rewardCosmetics.length === 0) return null;
  return (
    <span className="ach-rewards">
      {a.rewardCoins > 0 && (
        <span className="ach-reward ach-reward-coins">
          <CoinIcon size={15} />
          {t('ach.rewardCoins', { n: a.rewardCoins })}
        </span>
      )}
      {a.rewardCosmetics.map((id) => {
        const item = catalog.find((c) => c.id === id);
        if (!item) return null;
        return item.kind === 'card_design' ? (
          <span key={id} className={`ach-reward ach-reward-card rarity-${item.rarity ?? 'common'}`}>
            <Card value={42} size="xs" design={id} label="" className={a.unlockedAt ? "" : "is-veiled"} />
            {t('ach.rewardCard', { name: item.name })}
          </span>
        ) : (
          <span key={id} className="ach-reward">
            <TitleIcon size={15} />
            {t('ach.rewardTitle', { name: item.name })}
          </span>
        );
      })}
    </span>
  );
}

/** Tarjeta de un logro: icono de su categoría, textos, progreso o fecha, y premios. */
export function AchievementCard({ a, catalog, extra }: { a: Achievement; catalog: CatalogItem[]; extra?: ReactNode }) {
  const done = Boolean(a.unlockedAt);
  const { value, left } = achievementNow(a);
  return (
    <li className={`ach-card cat-${a.category} ${done ? 'is-done' : 'is-pending'}`}>
      <span className="ach-badge" aria-hidden>
        <CategoryIcon category={a.category} />
        {done ? (
          <span className="ach-badge-mark">
            <CheckIcon size={11} />
          </span>
        ) : (
          <span className="ach-badge-mark is-lock">
            <LockIcon size={11} />
          </span>
        )}
      </span>
      <div className="ach-body">
        <h3 className="ach-name">{a.name}</h3>
        <p className="ach-desc">{a.description}</p>
        <p className="ach-condition">{a.condition}</p>
        {done ? (
          <p className="ach-date">{t('ach.unlockedOn', { date: new Date(a.unlockedAt!).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) })}</p>
        ) : (
          <div className="ach-progress">
            <ProgressBar value={value} max={a.target} label={t('collection.progressAria', { n: value, target: a.target })} />
            <span className="ach-progress-text">
              {value}/{a.target}
              <span className="muted"> · {leftText(left)}</span>
            </span>
            {a.streak !== null && a.progress > value && <span className="ach-best">{t('ach.best', { n: a.progress })}</span>}
          </div>
        )}
        <AchievementRewards a={a} catalog={catalog} />
        {extra}
      </div>
    </li>
  );
}
