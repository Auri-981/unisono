import { useEffect, useState, type ReactNode } from 'react';
import { DEFAULT_CONFIG } from '../../config/gameConfig';
import type { RoomConfig } from '../../game/types';
import { errorMessage, t } from '../../i18n';
import { api, ApiError } from '../../net/api';
import { onlineAvailable } from '../../net/supabase';
import { deleteAccount, signOut, useAccount } from '../account';
import { AccountCard } from '../components/Account';
import { ConfigEditor, Switch } from '../components/ConfigEditor';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { BackIcon, CloudIcon, LockIcon, MotionIcon, SoundIcon, TrashIcon, VibrationIcon } from '../components/Icons';
import { Page } from '../components/Layout';
import { setPrefs, usePrefs } from '../prefs';

/** «1 nov, 18:03»: para saber si el móvil ya ha cargado la última publicación. */
const buildDate = new Date(__BUILD_TIME__).toLocaleString('es-ES', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** Bloque de Ajustes: un título corto y su contenido. */
function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-group">
      <h2 className="section-title">{title}</h2>
      {children}
    </section>
  );
}

export function SettingsScreen({ onBack, onPrivacy }: { onBack: () => void; onPrivacy: () => void }) {
  const prefs = usePrefs();
  return (
    <Page title={t('settings.title')} onBack={onBack} className="page-settings">
      <div className="settings">
        <div className="settings-col">
          {onlineAvailable && <AccountGroup />}
          <SettingsGroup title={t('settings.player')}>
            <label className="settings-card settings-name">
              <span className="field-label">{t('settings.name')}</span>
              <input
                className="input input-large"
                value={prefs.name}
                maxLength={20}
                onChange={(e) => setPrefs({ name: e.target.value })}
                autoComplete="nickname"
              />
              <span className="muted small">{t('settings.nameHint')}</span>
            </label>
          </SettingsGroup>
        </div>
        <div className="settings-col">
          <SettingsGroup title={t('settings.experience')}>
            <div className="settings-card settings-list">
              <Switch icon={<SoundIcon size={20} />} label={t('settings.sound')} checked={prefs.sound} onChange={(sound) => setPrefs({ sound })} />
              <Switch icon={<VibrationIcon size={20} />} label={t('settings.vibration')} checked={prefs.vibration} onChange={(vibration) => setPrefs({ vibration })} />
              <Switch
                icon={<MotionIcon size={20} />}
                label={t('settings.reducedMotion')}
                hint={t('settings.reducedMotionHint')}
                checked={prefs.reducedMotion}
                onChange={(reducedMotion) => setPrefs({ reducedMotion })}
              />
            </div>
          </SettingsGroup>
          <DataGroup onPrivacy={onPrivacy} />
        </div>
        <p className="muted small settings-version">{t('settings.version', { v: __APP_VERSION__, date: buildDate })}</p>
      </div>
    </Page>
  );
}

function AccountGroup() {
  const { kind } = useAccount();
  const [confirm, setConfirm] = useState(false);
  if (kind === 'unknown') return null;
  return (
    <SettingsGroup title={t('settings.account')}>
      <AccountCard onSignOut={() => setConfirm(true)} />
      {confirm && (
        <ConfirmDialog
          icon={<CloudIcon saved size={30} />}
          title={t('account.signOutTitle')}
          text={t('account.signOutText')}
          confirmLabel={t('account.signOut')}
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            void signOut();
          }}
        />
      )}
    </SettingsGroup>
  );
}

function DataGroup({ onPrivacy }: { onPrivacy: () => void }) {
  const { kind, busy } = useAccount();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <SettingsGroup title={t('settings.data')}>
      <div className="settings-card settings-list">
        <button type="button" className="settings-link" onClick={onPrivacy}>
          <LockIcon size={20} className="settings-icon" />
          <span>{t('settings.privacy')}</span>
          <BackIcon size={18} className="settings-chevron" />
        </button>
        {onlineAvailable && kind !== 'unknown' && (
          <button type="button" className="settings-link settings-link-danger" onClick={() => setConfirm(true)} disabled={busy}>
            <TrashIcon size={20} className="settings-icon" />
            <span>{t('settings.delete')}</span>
            <BackIcon size={18} className="settings-chevron" />
          </button>
        )}
      </div>
      {error && (
        <p className="notice notice-danger small" role="alert">
          {error}
        </p>
      )}
      {confirm && (
        <ConfirmDialog
          icon={<TrashIcon size={30} />}
          title={t('account.deleteTitle')}
          text={kind === 'google' ? t('account.deleteTextGoogle') : t('account.deleteTextGuest')}
          confirmLabel={t('account.deleteConfirm')}
          onCancel={() => setConfirm(false)}
          onConfirm={async () => {
            setConfirm(false);
            setError(null);
            const code = await deleteAccount();
            if (code) setError(errorMessage(code));
          }}
        />
      )}
    </SettingsGroup>
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
