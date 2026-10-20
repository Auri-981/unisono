import { useEffect, useState } from 'react';
import type { RoomController } from '../../../game/controller';
import { errorMessage, t } from '../../../i18n';
import { Card, CardBacks } from '../../components/Card';
import { ChatIcon, CrownIcon, ExitIcon, ShurikenIcon } from '../../components/Icons';
import { Toast } from '../../components/Layout';
import { ConnectionDot, Lives, Shurikens } from '../../components/Resources';
import { ChatSheet } from './ChatSheet';
import { Countdown, EndScreen, LevelComplete, VoteBanner } from './Overlays';
import { useEventFeed } from './useEventFeed';

export function GameScreen({ ctl, onExit }: { ctl: RoomController; onExit: () => void }) {
  const snap = ctl.snapshot!;
  const { room, players, me, pile, revealed, myHand, vote } = snap;
  const others = players.filter((p) => p.id !== me);
  const feed = useEventFeed(snap, ctl.clockOffset);
  const [pendingCard, setPendingCard] = useState<number | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [seenChat, setSeenChat] = useState(ctl.chat.length);
  const [errorToast, setErrorToast] = useState<string | null>(null);

  const playing = room.status === 'playing';
  const lowest = myHand[0];
  const top = pile.at(-1);
  const previous = pile.at(-2);
  const chatEnabled = ctl.kind === 'online' && room.config.mode === 'friends';
  const unread = chatOpen ? 0 : Math.max(0, ctl.chat.length - seenChat);

  useEffect(() => {
    if (chatOpen) setSeenChat(ctl.chat.length);
  }, [chatOpen, ctl.chat.length]);

  useEffect(() => {
    if (!ctl.notice) return;
    // Errores esperables por la carrera entre jugadores no merecen un aviso.
    if (ctl.notice.code === 'NOT_IN_HAND' || ctl.notice.code === 'NOT_PLAYING') return;
    setErrorToast(errorMessage(ctl.notice.code));
    const id = window.setTimeout(() => setErrorToast(null), 3000);
    return () => window.clearTimeout(id);
  }, [ctl.notice]);

  // Si la carta pendiente ya no está en la mano, la jugada ha terminado.
  useEffect(() => {
    if (pendingCard !== null && !myHand.includes(pendingCard)) setPendingCard(null);
  }, [myHand, pendingCard]);

  const play = async () => {
    if (lowest === undefined || pendingCard !== null || !playing || vote) return;
    setPendingCard(lowest);
    try {
      await ctl.actions.playCard(lowest);
    } finally {
      setPendingCard(null);
    }
  };

  const leave = () => {
    if (room.status === 'playing' || room.status === 'level_complete') {
      if (!window.confirm(t('game.leaveConfirm'))) return;
    }
    void ctl.actions.leave();
  };

  const canPropose = playing && !vote && room.shurikens > 0 && myHand.length + others.reduce((n, p) => n + p.cardsLeft, 0) > 0;

  return (
    <div className={`game ${feed.shake ? 'game-shake' : ''}`}>
      <header className="game-header">
        <button type="button" className="icon-btn" onClick={leave} aria-label={t('game.leave')}>
          <ExitIcon />
        </button>
        <div className="game-level">
          <span className="game-level-label">{t('common.level')}</span>
          <span className="game-level-value">
            {room.level}
            <span className="muted">/{room.maxLevel}</span>
          </span>
        </div>
        <div className="game-resources">
          <Lives count={room.lives} />
          <Shurikens count={room.shurikens} />
        </div>
        {ctl.kind === 'online' && <ConnectionDot state={ctl.connection} />}
      </header>

      <ul className="opponents" aria-label={t('common.players')}>
        {others.map((p) => {
          const online = ctl.onlineIds.has(p.id);
          return (
            <li key={p.id} className={`opponent ${online ? '' : 'opponent-offline'}`}>
              <div className="opponent-name">
                <span className={`presence ${online ? 'presence-on' : ''}`} aria-hidden />
                <span className="truncate">{p.name}</span>
                {p.id === room.hostId && <CrownIcon size={13} className="host-crown" />}
              </div>
              <CardBacks count={p.cardsLeft} />
              <span className="opponent-count">
                {p.cardsLeft === 1 ? t('game.cardsLeftOne') : t('game.cardsLeft', { count: p.cardsLeft })}
                {!online && ` · ${t('game.offline')}`}
              </span>
            </li>
          );
        })}
      </ul>

      <section className="table" aria-live="polite">
        {feed.item && (
          <div className="toast-layer toast-layer-table">
            <Toast tone={feed.item.tone} title={feed.item.title} detail={feed.item.detail} />
          </div>
        )}
        <div className="pile">
          {previous && <Card value={previous.c} size="lg" className="pile-previous" muted />}
          {top ? (
            <div className="pile-top" key={`${room.level}-${pile.length}`}>
              <Card value={top.c} size="xl" />
              <span className="pile-owner">{players.find((p) => p.id === top.p)?.name ?? ''}</span>
            </div>
          ) : (
            <div className="pile-empty">{t('game.tableEmpty')}</div>
          )}
        </div>
        {revealed.length > 0 && (
          <div className="revealed">
            <span className="field-label">{t('game.discarded')}</span>
            <div className="revealed-cards">
              {revealed.map((r) => (
                <Card key={`${r.c}`} value={r.c} size="sm" muted className={`revealed-${r.r}`} />
              ))}
            </div>
          </div>
        )}
        {playing && !vote && <p className="table-hint">{t('game.hint')}</p>}
      </section>

      {vote && playing && <VoteBanner ctl={ctl} snap={snap} />}

      <section className="hand" aria-label={t('game.yourCards')}>
        {lowest !== undefined ? (
          <>
            <button
              type="button"
              className={`play-card ${pendingCard !== null ? 'is-pending' : ''}`}
              onClick={() => void play()}
              disabled={!playing || Boolean(vote) || pendingCard !== null}
              aria-label={`${t('game.play')} ${lowest}`}
            >
              <Card value={lowest} size="xl" key={lowest} className="hand-lowest" />
            </button>
            {myHand.length > 1 && (
              <div className="hand-rest" aria-label={t('game.yourCards')}>
                {myHand.slice(1).map((c) => (
                  <Card key={c} value={c} size="sm" />
                ))}
              </div>
            )}
          </>
        ) : (
          playing && <p className="hand-empty">{t('game.noCards')}</p>
        )}
      </section>

      <footer className="game-footer">
        <button
          type="button"
          className="btn btn-secondary shuriken-btn"
          disabled={!canPropose || ctl.busy}
          onClick={() => void ctl.actions.proposeShuriken()}
        >
          <ShurikenIcon size={18} /> {t('game.useShuriken')}
        </button>
        {chatEnabled && (
          <button type="button" className="btn btn-secondary chat-btn" onClick={() => setChatOpen(true)} aria-label={t('game.chat')}>
            <ChatIcon size={18} />
            {unread > 0 && <span className="unread">{unread}</span>}
          </button>
        )}
      </footer>

      {errorToast && (
        <div className="toast-layer">
          <Toast tone="danger" title={errorToast} />
        </div>
      )}

      {chatEnabled && chatOpen && <ChatSheet ctl={ctl} onClose={() => setChatOpen(false)} />}
      {playing && room.config.countdown && feed.countdownSeq !== null && (
        <Countdown level={room.level} onDone={feed.clearCountdown} />
      )}
      {room.status === 'level_complete' && <LevelComplete ctl={ctl} snap={snap} />}
      {(room.status === 'won' || room.status === 'lost' || room.status === 'abandoned') && (
        <EndScreen ctl={ctl} snap={snap} onExit={onExit} />
      )}
    </div>
  );
}
