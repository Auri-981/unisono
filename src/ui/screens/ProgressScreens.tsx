/**
 * Logros (todos, con su progreso, por categorías) y Perfil (nombre, título, diseño y
 * estadísticas). Los datos son los del servidor: aquí solo se ordenan y se muestran.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { t } from '../../i18n';
import type { Achievement, AchievementCategory, Profile } from '../../net/api';
import { AccountCard } from '../components/Account';
import { CheckIcon, TitleIcon, TrophyIcon } from '../components/Icons';
import { Page } from '../components/Layout';
import {
  ACHIEVEMENT_CATEGORIES,
  AchievementCard,
  AchievementRewards,
  achievementNow,
  CategoryIcon,
  leftText,
  ProgressBar,
  TitleTag,
} from '../components/Progression';
import { CoinBadge } from '../components/Resources';
import { useAccount } from '../account';
import { usePrefs } from '../prefs';
import { equippedCardDesign, equippedTitle, refreshProfile, useProfile } from '../profile';
import { DesignFan, ProfileGate, type CosmeticTab } from './ShopScreens';

const doneCount = (list: Achievement[]) => list.filter((a) => a.unlockedAt).length;

/** Los pendientes más avanzados (lo que «casi tienes»). */
function closest(list: Achievement[], n: number): Achievement[] {
  return list
    .filter((a) => !a.unlockedAt)
    .map((a) => ({ a, ratio: achievementNow(a).value / a.target }))
    .filter((x) => x.ratio > 0)
    .sort((x, y) => y.ratio - x.ratio || x.a.target - y.a.target)
    .slice(0, n)
    .map((x) => x.a);
}

// ───────────────────────────── Logros ─────────────────────────────

export function AchievementsScreen({ onBack }: { onBack: () => void }) {
  const { profile, loading } = useProfile();
  const [filter, setFilter] = useState<AchievementCategory | 'all'>('all');
  useEffect(() => {
    void refreshProfile();
  }, []);
  return (
    <Page title={t('ach.title')} onBack={onBack} actions={<CoinBadge coins={profile?.coins ?? null} loading={loading} />} className="page-achievements">
      <ProfileGate offline={t('ach.offline')}>{(p) => <AchievementsBody profile={p} filter={filter} onFilter={setFilter} />}</ProfileGate>
    </Page>
  );
}

function AchievementsBody({
  profile: p,
  filter,
  onFilter,
}: {
  profile: Profile;
  filter: AchievementCategory | 'all';
  onFilter: (f: AchievementCategory | 'all') => void;
}) {
  const list = p.achievements ?? [];
  const done = doneCount(list);
  const pct = list.length ? Math.round((done / list.length) * 100) : 0;
  const near = useMemo(() => closest(list, 2), [list]);
  const cats = ACHIEVEMENT_CATEGORIES.filter((c) => filter === 'all' || c === filter);
  if (list.length === 0) return <p className="notice notice-danger">{t('ach.loadError')}</p>;
  return (
    <>
      <section className="ach-summary">
        <span className="ach-summary-ring" style={{ '--pct': pct } as CSSProperties} aria-hidden>
          <TrophyIcon size={30} />
        </span>
        <div className="ach-summary-text">
          <strong className="ach-summary-count">
            {done}
            <span className="muted">/{list.length}</span>
          </strong>
          <span>{t('ach.summary', { n: done, total: list.length })} · {pct} %</span>
          <ProgressBar value={done} max={list.length} />
        </div>
      </section>
      <p className="muted small ach-note">{done === list.length ? t('ach.allDone') : t('ach.onlineOnly')}</p>

      {near.length > 0 && (
        <section className="ach-near">
          <h2 className="section-title">{t('ach.closest')}</h2>
          <ul>
            {near.map((a) => {
              const now = achievementNow(a);
              return (
                <li key={a.id} className={`ach-near-item cat-${a.category}`}>
                  <span className="ach-badge ach-badge-sm" aria-hidden>
                    <CategoryIcon category={a.category} size={18} />
                  </span>
                  <div className="ach-near-body">
                    <span className="ach-near-head">
                      <strong>{a.name}</strong>
                      <span className="ach-near-left">{leftText(now.left)}</span>
                    </span>
                    <span className="muted small">{a.condition}</span>
                    <ProgressBar value={now.value} max={a.target} />
                    <AchievementRewards a={a} catalog={p.catalog} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="chips ach-filters" role="tablist" aria-label={t('ach.filter')}>
        {(['all', ...ACHIEVEMENT_CATEGORIES] as const).map((c) => {
          const inCat = c === 'all' ? list : list.filter((a) => a.category === c);
          return (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={filter === c}
              className={`chip ${filter === c ? 'is-active' : ''} ${c !== 'all' ? `cat-${c}` : ''}`}
              onClick={() => onFilter(c)}
            >
              {c !== 'all' && <CategoryIcon category={c} size={15} />}
              {c === 'all' ? t('ach.all') : t(`ach.cat.${c}`)}
              <span className="chip-count">
                {doneCount(inCat)}/{inCat.length}
              </span>
            </button>
          );
        })}
      </div>

      {cats.map((c) => {
        const inCat = list.filter((a) => a.category === c);
        if (inCat.length === 0) return null;
        return (
          <section key={c} className={`ach-section cat-${c}`}>
            <h2 className="ach-section-title">
              <CategoryIcon category={c} size={20} />
              {t(`ach.cat.${c}`)}
              <span className="muted">
                {doneCount(inCat)}/{inCat.length}
              </span>
            </h2>
            <ul className="ach-list">
              {inCat.map((a) => (
                <AchievementCard key={a.id} a={a} catalog={p.catalog} />
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

// ───────────────────────────── Perfil ─────────────────────────────

export function ProfileScreen({
  onBack,
  onCollection,
  onAchievements,
  onSettings,
}: {
  onBack: () => void;
  onCollection: (tab: CosmeticTab) => void;
  onAchievements: () => void;
  onSettings: () => void;
}) {
  const { profile, loading } = useProfile();
  useEffect(() => {
    void refreshProfile();
  }, []);
  return (
    <Page title={t('profile.title')} onBack={onBack} actions={<CoinBadge coins={profile?.coins ?? null} loading={loading} />} className="page-profile">
      <ProfileGate>
        {(p) => <ProfileBody profile={p} onCollection={onCollection} onAchievements={onAchievements} onSettings={onSettings} />}
      </ProfileGate>
    </Page>
  );
}

function ProfileBody({
  profile: p,
  onCollection,
  onAchievements,
  onSettings,
}: {
  profile: Profile;
  onCollection: (tab: CosmeticTab) => void;
  onAchievements: () => void;
  onSettings: () => void;
}) {
  const prefs = usePrefs();
  const guest = useAccount().kind === 'guest';
  const name = prefs.name.trim();
  const title = equippedTitle(p);
  const design = equippedCardDesign(p);
  const designName = p.catalog.find((c) => c.id === design)?.name ?? '';
  const list = p.achievements ?? [];
  const done = doneCount(list);
  const pct = list.length ? Math.round((done / list.length) * 100) : 0;
  const s = p.stats ?? { games: 0, wins: 0, levels: 0, bestWinStreak: 0, bestCleanStreak: 0 };
  const recent = list
    .filter((a) => a.unlockedAt)
    .sort((a, b) => Date.parse(b.unlockedAt!) - Date.parse(a.unlockedAt!))
    .slice(0, 3);
  return (
    <>
      <section className={`profile-card rarity-${title?.rarity ?? 'none'}`}>
        <span className="profile-avatar" aria-hidden>
          {(name || '?').charAt(0).toUpperCase()}
        </span>
        <div className="profile-id">
          <h2 className="profile-name">{name || t('profile.noName')}</h2>
          {title ? <TitleTag title={title} className="title-tag-lg" /> : <span className="muted small">{t('profile.noTitle')}</span>}
          <div className="profile-id-actions">
            <button type="button" className="link-btn" onClick={() => onCollection('titles')}>
              <TitleIcon size={15} /> {title ? t('profile.changeTitle') : t('profile.chooseTitle')}
            </button>
            <span aria-hidden>·</span>
            <button type="button" className="link-btn" onClick={onSettings}>
              {t('profile.changeName')}
            </button>
          </div>
        </div>
      </section>
      {/* Al invitado se le enseña arriba: es lo que puede perder. */}
      {guest && <AccountCard />}

      <button type="button" className="profile-design" onClick={() => onCollection('cards')}>
        <DesignFan design={design} />
        <span className="profile-design-text">
          <span className="field-label">{t('profile.design')}</span>
          <strong>{designName}</strong>
          <span className="link-like small">{t('profile.changeDesign')}</span>
        </span>
      </button>

      <section className="profile-stats">
        <h2 className="section-title">{t('profile.stats')}</h2>
        <ul className="stat-grid">
          <li>
            <strong>{s.games}</strong>
            <span>{t('profile.games')}</span>
          </li>
          <li>
            <strong>{s.wins}</strong>
            <span>{t('profile.wins')}</span>
          </li>
          <li>
            <strong>{s.levels}</strong>
            <span>{t('profile.levels')}</span>
          </li>
          <li>
            <strong>{s.bestWinStreak}</strong>
            <span>{t('profile.bestWinStreak')}</span>
          </li>
          <li>
            <strong>{s.bestCleanStreak}</strong>
            <span>{t('profile.bestClean')}</span>
          </li>
          <li className="stat-ach">
            <strong>
              {done}
              <span className="muted">/{list.length}</span>
            </strong>
            <span>
              {t('profile.achievements')} · {pct} %
            </span>
            <ProgressBar value={done} max={list.length || 1} />
          </li>
        </ul>
      </section>

      {recent.length > 0 && (
        <ul className="profile-recent">
          {recent.map((a) => (
            <li key={a.id} className={`cat-${a.category}`}>
              <span className="ach-badge ach-badge-sm" aria-hidden>
                <CategoryIcon category={a.category} size={16} />
                <span className="ach-badge-mark">
                  <CheckIcon size={9} />
                </span>
              </span>
              <span>{a.name}</span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn btn-secondary btn-block" onClick={onAchievements}>
        <TrophyIcon size={20} /> {t('profile.seeAchievements')}
      </button>
      {!guest && <AccountCard />}
    </>
  );
}
