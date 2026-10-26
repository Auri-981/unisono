import { useEffect, useState } from 'react';
import { CLASSIC_REWARDS, DEFAULT_CONFIG, HARD_REWARDS, PLAYER_PRESETS } from '../../config/gameConfig';
import type { RoomConfig } from '../../game/types';
import { errorMessage, t } from '../../i18n';
import { api, ApiError } from '../../net/api';
import { ConfigEditor } from '../components/ConfigEditor';
import { VistazoIcon } from '../components/Icons';
import { Page } from '../components/Layout';
import { LIFE_SYMBOL, VISTAZO_SYMBOL } from '../rewards';
import { setPrefs, usePrefs } from '../prefs';

export function RulesScreen({ onBack }: { onBack: () => void }) {
  return (
    <Page title={t('rules.title')} onBack={onBack}>
      <article className="prose">
        <p>
          <strong>Unísono</strong> es cooperativo: ganáis o perdéis todos juntos. La baraja tiene 100 cartas, del 1 al
          100.
        </p>
        <h2>El objetivo</h2>
        <p>
          En cada nivel, cada jugador recibe tantas cartas como el número del nivel (nivel 1: una carta; nivel 2: dos…).
          Entre todos debéis jugar <strong>todas</strong> las cartas sobre la mesa en orden ascendente.
        </p>
        <h2>La regla de oro</h2>
        <p>
          No hay turnos y <strong>no se puede decir nada sobre los números</strong>. Cada uno juega su carta más baja
          cuando siente que ha llegado el momento. Si tienes el 12 y nadie juega, quizá sea tu turno… o quizá alguien
          tiene el 5.
        </p>
        <h2>Errores</h2>
        <p>
          Si alguien juega una carta y otro jugador tenía una más baja, el equipo pierde <strong>una vida</strong>. Todas
          las cartas más bajas que la jugada se descartan boca arriba y la partida sigue. Sin vidas, se pierde.
        </p>
        <h2>
          <VistazoIcon size={18} className="rules-icon" /> Vistazos
        </h2>
        <p>
          Cualquiera puede proponer usar un vistazo. Si todos aceptan en 15 segundos, cada jugador descarta la carta que
          le toca. Es una forma de salir de un atasco y de obtener información. Si te lo rechazan, no puedes volver a
          pedirlo hasta que se juegue alguna carta.
        </p>
        <h2>Niveles y recompensas</h2>
        <ul>
          {Object.entries(PLAYER_PRESETS).map(([n, p]) => (
            <li key={n}>
              {n} jugadores: {p.levels} niveles, {p.lives} vidas, {p.shurikens} vistazo.
            </li>
          ))}
        </ul>
        <p>El anfitrión puede elegir jugar menos niveles para una partida más corta (nunca más de los que tocan).</p>
        <p>
          Recompensas clásicas al superar un nivel:{' '}
          {CLASSIC_REWARDS.map((r) => `${r.level} ${r.lives ? LIFE_SYMBOL : VISTAZO_SYMBOL}`).join(' · ')} (máximo{' '}
          {DEFAULT_CONFIG.maxLives} vidas y {DEFAULT_CONFIG.maxShurikens} vistazos). El anfitrión puede personalizarlas.
        </p>
        <h2>Orden descendente</h2>
        <p>
          El anfitrión puede elegir jugar de mayor a menor (del 100 al 1). Todo funciona igual, pero al revés: juegas
          siempre tu carta más alta, es un error si alguien tenía una carta más alta que la jugada, y el vistazo
          descarta la carta más alta de cada uno.
        </p>
        <h2>Dificultad</h2>
        <ul>
          <li>Fácil: una vida y un vistazo más al empezar.</li>
          <li>Clásica: como el juego original.</li>
          <li>
            Difícil: empezáis con 1 sola vida y sin vistazos, y hay menos recompensas (
            {HARD_REWARDS.map((r) => `${r.level} ${r.lives ? LIFE_SYMBOL : VISTAZO_SYMBOL}`).join(' · ')}).
          </li>
        </ul>
        <h2>Consejos</h2>
        <ul>
          <li>Antes de cada nivel, respirad y esperad a que todos estén «listos».</li>
          <li>Contad mentalmente desde la última carta jugada.</li>
          <li>En modo amigos hay chat, pero el reto es no decir números.</li>
        </ul>
      </article>
    </Page>
  );
}

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
