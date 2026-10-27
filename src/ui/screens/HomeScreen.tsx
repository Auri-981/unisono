import { t } from '../../i18n';
import { onlineAvailable } from '../../net/supabase';
import { LogoMark } from '../components/Icons';

interface Props {
  message: string | null;
  onCreate: () => void;
  onJoin: () => void;
  onPractice: () => void;
  onTutorial: () => void;
  onRules: () => void;
  onSettings: () => void;
  onHistory: () => void;
}

export function HomeScreen(p: Props) {
  return (
    <div className="home">
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
        <button type="button" className="btn btn-ghost btn-large" onClick={p.onTutorial}>
          {t('home.tutorial')}
        </button>
      </nav>

      <footer className="home-footer">
        <button type="button" className="link-btn" onClick={p.onRules}>
          {t('home.rules')}
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
  );
}
