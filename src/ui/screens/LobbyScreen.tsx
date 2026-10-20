import { useEffect, useState } from 'react';
import { startingResources } from '../../config/gameConfig';
import type { RoomController } from '../../game/controller';
import type { RoomConfig } from '../../game/types';
import { errorMessage, t } from '../../i18n';
import { ConfigEditor, ConfigSummary } from '../components/ConfigEditor';
import { CheckIcon, CopyIcon, CrownIcon, LinkIcon, ShareIcon } from '../components/Icons';
import { Page, Toast } from '../components/Layout';
import { ConnectionDot } from '../components/Resources';

export function inviteLink(code: string): string {
  const url = new URL(window.location.href);
  url.search = `?sala=${code}`;
  url.hash = '';
  return url.toString();
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Alternativa para navegadores sin API de portapapeles.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function LobbyScreen({ ctl }: { ctl: RoomController }) {
  const snap = ctl.snapshot!;
  const { room, players, me } = snap;
  const isHost = room.hostId === me;
  const meP = players.find((p) => p.id === me);
  const host = players.find((p) => p.id === room.hostId);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const [draft, setDraft] = useState<RoomConfig>(room.config);
  const [noticeVisible, setNoticeVisible] = useState(false);

  // La configuración del servidor manda: si cambia (o la normaliza), se refleja aquí.
  useEffect(() => setDraft(room.config), [room.config]);

  useEffect(() => {
    if (!ctl.notice) return;
    setNoticeVisible(true);
    const id = window.setTimeout(() => setNoticeVisible(false), 3500);
    return () => window.clearTimeout(id);
  }, [ctl.notice]);

  const link = inviteLink(room.code);
  const canShare = typeof navigator.share === 'function';
  const doCopy = async (what: 'code' | 'link') => {
    if (await copy(what === 'code' ? room.code : link)) {
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1800);
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: t('app.name'), text: t('lobby.shareText', { code: room.code }), url: link });
    } catch {
      // El usuario canceló o no se pudo: no es un error.
    }
  };
  const changeConfig = (config: RoomConfig) => {
    setDraft(config);
    void ctl.actions.updateConfig(config);
  };

  const res = startingResources(room.config, Math.max(2, players.length));

  return (
    <Page
      title={t('lobby.title')}
      actions={<ConnectionDot state={ctl.connection} />}
    >
      <section className="panel invite">
        <p className="field-label">{t('lobby.code')}</p>
        <p className="invite-code" aria-label={room.code.split('').join(' ')}>
          {room.code.split('').map((ch, i) => (
            <span key={i}>{ch}</span>
          ))}
        </p>
        <div className="invite-actions">
          <button type="button" className="btn btn-secondary" onClick={() => void doCopy('code')}>
            {copied === 'code' ? <CheckIcon /> : <CopyIcon />} {copied === 'code' ? t('lobby.copied') : t('lobby.copyCode')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void doCopy('link')}>
            {copied === 'link' ? <CheckIcon /> : <LinkIcon />} {copied === 'link' ? t('lobby.copied') : t('lobby.copyLink')}
          </button>
          {canShare && (
            <button type="button" className="btn btn-primary invite-share" onClick={() => void share()}>
              <ShareIcon /> {t('lobby.share')}
            </button>
          )}
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-title">{t('lobby.players', { count: players.length, max: room.config.maxPlayers })}</h2>
        <ul className="lobby-players">
          {players.map((p) => {
            const online = ctl.onlineIds.has(p.id);
            return (
              <li key={p.id} className="lobby-player">
                <span className={`presence ${online ? 'presence-on' : ''}`} title={online ? t('conn.online') : t('game.offline')} />
                <span className="lobby-player-name">
                  {p.name}
                  {p.id === me && <span className="muted"> ({t('common.you')})</span>}
                </span>
                {p.id === room.hostId && (
                  <span className="badge badge-host" title={t('lobby.host')}>
                    <CrownIcon size={14} /> {t('lobby.host')}
                  </span>
                )}
                <span className={`badge ${p.ready ? 'badge-ready' : 'badge-muted'}`}>
                  {p.ready ? t('lobby.ready') : t('lobby.notReady')}
                </span>
                {isHost && p.id !== me && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    onClick={() => {
                      if (window.confirm(t('lobby.kickConfirm', { name: p.name }))) void ctl.actions.kick(p.id);
                    }}
                  >
                    {t('lobby.kick')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          className={`btn ${meP?.ready ? 'btn-secondary' : 'btn-primary'} btn-block`}
          onClick={() => void ctl.actions.setLobbyReady(!meP?.ready)}
          disabled={ctl.busy}
        >
          {meP?.ready ? t('lobby.imNotReady') : t('lobby.imReady')}
        </button>
      </section>

      <section className="panel">
        <h2 className="panel-title">{t('lobby.config')}</h2>
        <p className="muted small">{t('lobby.summary', { levels: res.maxLevel, lives: res.lives, shurikens: res.shurikens })}</p>
        {isHost ? (
          <ConfigEditor config={draft} onChange={changeConfig} disabled={ctl.busy} playerCount={Math.max(2, players.length)} />
        ) : (
          <ConfigSummary config={room.config} playerCount={Math.max(2, players.length)} />
        )}
      </section>

      <div className="lobby-footer">
        {isHost ? (
          <button
            type="button"
            className="btn btn-primary btn-large btn-block"
            disabled={players.length < 2 || ctl.busy}
            onClick={() => void ctl.actions.startGame()}
          >
            {players.length < 2 ? t('lobby.needPlayers') : t('lobby.start')}
          </button>
        ) : (
          <p className="muted center">{t('lobby.waitingHost', { name: host?.name ?? '' })}</p>
        )}
        <button type="button" className="btn btn-ghost btn-block" onClick={() => void ctl.actions.leave()}>
          {t('lobby.leave')}
        </button>
      </div>

      {noticeVisible && ctl.notice && (
        <div className="toast-layer">
          <Toast tone="danger" title={errorMessage(ctl.notice.code)} />
        </div>
      )}
    </Page>
  );
}
