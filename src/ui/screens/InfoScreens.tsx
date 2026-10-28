import { useEffect, useState } from 'react';
import { DEFAULT_CONFIG } from '../../config/gameConfig';
import type { RoomConfig } from '../../game/types';
import { errorMessage, t } from '../../i18n';
import { api, ApiError } from '../../net/api';
import { ConfigEditor } from '../components/ConfigEditor';
import { Page } from '../components/Layout';
import { setPrefs, usePrefs } from '../prefs';

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const prefs = usePrefs();
  return (
    <Page title={t('settings.title')} onBack={onBack}>
      <div className="form">
        <label className="field">
          <span className="field-label">{t('settings.name')}</span>
          <input
            className="input input-large"
            value={prefs.name}
            maxLength={20}
            onChange={(e) => setPrefs({ name: e.target.value })}
            autoComplete="nickname"
          />
        </label>
        <label className="toggle">
          <input type="checkbox" checked={prefs.sound} onChange={(e) => setPrefs({ sound: e.target.checked })} />
          <span>{t('settings.sound')}</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={prefs.vibration} onChange={(e) => setPrefs({ vibration: e.target.checked })} />
          <span>{t('settings.vibration')}</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={prefs.reducedMotion} onChange={(e) => setPrefs({ reducedMotion: e.target.checked })} />
          <span>{t('settings.reducedMotion')}</span>
        </label>
        <p className="muted small">{t('settings.version', { v: __APP_VERSION__ })}</p>
      </div>
    </Page>
  );
}

type History = Awaited<ReturnType<typeof api.history>>;

export function HistoryScreen({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.history().then(setData, (e) => setError(errorMessage(e instanceof ApiError ? e.code : 'NETWORK')));
  }, []);
  return (
    <Page title={t('history.title')} onBack={onBack}>
      {error && <p className="notice notice-danger">{error}</p>}
      {!data && !error && <p className="muted">{t('common.loading')}</p>}
      {data && (
        <>
          <div className="stats">
            <div className="stat">
              <span className="stat-value">{data.stats.played}</span>
              <span className="stat-label">{t('history.played')}</span>
            </div>
            <div className="stat">
              <span className="stat-value">{data.stats.won}</span>
              <span className="stat-label">{t('history.won')}</span>
            </div>
            <div className="stat">
              <span className="stat-value">{data.stats.bestLevel}</span>
              <span className="stat-label">{t('history.best')}</span>
            </div>
          </div>
          {data.games.length === 0 ? (
            <p className="muted">{t('history.empty')}</p>
          ) : (
            <ul className="history-list">
              {data.games.map((g, i) => (
                <li key={i} className={`history-item history-${g.result}`}>
                  <strong>{t(`history.result.${g.result}`)}</strong>
                  <span>{t('history.levelOf', { level: g.level, max: g.maxLevel })}</span>
                  <span className="muted small">{g.players.join(', ')}</span>
                  <span className="muted small">{new Date(g.finishedAt).toLocaleString('es-ES')}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Page>
  );
}

export function PracticeSetup({ onBack, onStart }: { onBack: () => void; onStart: (bots: number, config: RoomConfig) => void }) {
  const [bots, setBots] = useState(2);
  const [config, setConfig] = useState<RoomConfig>(DEFAULT_CONFIG);
  return (
    <Page title={t('practice.title')} onBack={onBack}>
      <div className="form">
        <p className="muted">{t('practice.intro')}</p>
        <div className="field">
          <span className="field-label">{t('practice.bots')}</span>
          <div className="segmented" role="radiogroup" aria-label={t('practice.bots')}>
            {[1, 2, 3].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={bots === n} className={bots === n ? 'is-on' : ''} onClick={() => setBots(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <ConfigEditor config={config} onChange={setConfig} practice playerCount={bots + 1} />
        <button type="button" className="btn btn-primary btn-large" onClick={() => onStart(bots, config)}>
          {t('practice.start')}
        </button>
      </div>
    </Page>
  );
}
