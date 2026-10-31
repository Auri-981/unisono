import { useEffect } from 'react';
import { t } from '../../i18n';
import { onlineAvailable } from '../../net/supabase';
import { Card } from '../components/Card';
import { CardsIcon, ComodinIcon, LifeIcon, LinkIcon, LogoMark, ShopIcon } from '../components/Icons';
import { CoinBadge } from '../components/Resources';
import { equippedCardDesign, refreshProfile, useProfile } from '../profile';

interface Props {
  message: string | null;
  onCreate: () => void;
  onJoin: () => void;
  onPractice: () => void;
  onTutorial: () => void;
  onSettings: () => void;
  onHistory: () => void;
  onShop: () => void;
  onCollection: () => void;
}

export function HomeScreen(p: Props) {
  const { profile, loading } = useProfile();
  const design = equippedCardDesign(profile);
  useEffect(() => {
    void refreshProfile();
  }, []);
  return (
    <div className="home">
      {/* En el móvil este contenedor no existe a efectos de diseño (display: contents). */}
      <div className="home-main">
        {onlineAvailable && (
          <div className="home-topbar">
            <button type="button" className="coin-link" onClick={p.onShop} aria-label={t('home.shop')}>
              <CoinBadge coins={profile?.coins ?? null} loading={loading} />
            </button>
          </div>
        )}
        <div className="home-hero">
          <LogoMark size={88} className="home-logo" />
          <h1 className="home-title">{t('app.name')}</h1>
          <p className="home-tagline">{t('app.tagline')}</p>
          <p className="home-subtitle">{t('app.subtitle')}</p>
        </div>

        {p.message && (
          <p className="notice notice-info" role="status">
            {p.message}
          </p>
        )}

        <nav className="home-actions">
          <button type="button" className="btn btn-large btn-primary" onClick={p.onCreate} disabled={!onlineAvailable}>
            {t('home.create')}
          </button>
          <button type="button" className="btn btn-secondary btn-large" onClick={p.onJoin} disabled={!onlineAvailable}>
            {t('home.join')}
          </button>
          {!onlineAvailable && <p className="notice notice-warn">{t('home.offlineNotice')}</p>}
          <button type="button" className="btn btn-ghost btn-large" onClick={p.onPractice}>
            {t('home.practice')}
          </button>
          <div className="home-shop-row">
            <button type="button" className="btn btn-secondary home-shop-btn" onClick={p.onShop} disabled={!onlineAvailable}>
              <ShopIcon size={20} />
              {t('home.shop')}
            </button>
            <button type="button" className="btn btn-secondary home-shop-btn" onClick={p.onCollection} disabled={!onlineAvailable}>
              <CardsIcon size={20} />
              {t('home.collection')}
            </button>
          </div>
        </nav>

        <footer className="home-footer">
          <button type="button" className="link-btn" onClick={p.onTutorial}>
            {t('home.tutorial')}
          </button>
          <span aria-hidden>·</span>
          <button type="button" className="link-btn" onClick={p.onSettings}>
            {t('home.settings')}
          </button>
          {onlineAvailable && (
            <>
              <span aria-hidden>·</span>
              <button type="button" className="link-btn" onClick={p.onHistory}>
                {t('home.history')}
              </button>
            </>
          )}
        </footer>
      </div>

      {/* Solo en pantallas anchas (ordenador): presentación del juego para llenar el espacio. */}
      <aside className="home-showcase" aria-label={t('home.showcase')}>
        <div className="home-showcase-table" aria-hidden>
          <Card value={23} size="lg" design={design} />
          <Card value={48} size="lg" design={design} />
          <Card value={77} size="lg" design={design} />
        </div>
        <ul className="home-features">
          <li>
            <LinkIcon size={22} className="home-feature-icon" />
            <span>{t('home.feature.rooms')}</span>
          </li>
          <li>
            <LifeIcon size={22} className="home-feature-icon home-feature-life" />
            <span>{t('home.feature.lives')}</span>
          </li>
          <li>
            <ComodinIcon size={22} className="home-feature-icon home-feature-comodin" />
            <span>{t('home.feature.comodines')}</span>
          </li>
        </ul>
        <button type="button" className="btn btn-secondary" onClick={p.onTutorial}>
          {t('home.firstTime')}
        </button>
      </aside>
    </div>
  );
}
