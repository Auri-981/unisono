import { useEffect, useState } from 'react';
import type { RoomController } from '../../../game/controller';
import { errorMessage, t } from '../../../i18n';
import { Card, CardBacks } from '../../components/Card';
import { ChatIcon, CrownIcon, ExitIcon, LifeIcon, VistazoIcon } from '../../components/Icons';
import { rewardText, upcomingReward } from '../../rewards';
import { Toast } from '../../components/Layout';
import { ConnectionDot, Lives, Vistazos } from '../../components/Resources';
import { ChatSheet } from './ChatSheet';
import { Countdown, EndScreen, LevelComplete, VoteBanner } from './Overlays';
import { useAfterPause } from './useAfterPause';
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
  // Orden descendente (100 → 1): la mano ya llega ordenada «en orden de juego» desde el servidor.
  const desc = room.config.order === 'desc';
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

  // Si te rechazaron (o caducó) tu shuriken, no puedes repetirlo hasta que se juegue una carta.
  const shurikenBlocked = room.shurikenBlocked?.includes(me) ?? false;
  const canPropose =
    playing && !vote && !shurikenBlocked && room.shurikens > 0 && myHand.length + others.reduce((n, p) => n + p.cardsLeft, 0) > 0;

  // Premio que se obtendrá al superar el nivel actual (se anuncia durante la ronda).
  const reward = upcomingReward(room, players.length);

  // Tras la última carta, unos segundos para verla antes de «nivel superado» / fin de partida.
  const ended = room.status === 'won' || room.status === 'lost' || room.status === 'abandoned';
  const resultAt =
    snap.lastEvent && ['level_complete', 'won', 'lost'].includes(snap.lastEvent.kind) ? snap.lastEvent.at : undefined;
  const showLevelComplete = useAfterPause(room.status === 'level_complete', resultAt, ctl.clockOffset);
  const showEnd = useAfterPause(ended, room.status === 'abandoned' ? undefined : resultAt, ctl.clockOffset);

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
        {playing && reward && (
          <div className="level-reward" role="note" aria-label={t('reward.aria', { reward: rewardText(reward) })}>
            <span className="game-level-label">{t('reward.label')}</span>
            <span className="level-reward-value">
              {reward.lives > 0 && (
                <span className={`resource resource-life ${reward.livesFull ? 'is-full' : ''}`}>
                  <LifeIcon size={15} />+{reward.lives}
                </span>
              )}
              {reward.shurikens > 0 && (
                <span className={`resource resource-shuriken ${reward.shurikensFull ? 'is-full' : ''}`}>
                  <VistazoIcon size={15} />+{reward.shurikens}
                </span>
              )}
            </span>
          </div>
        )}
        <div className="game-resources">
          <Lives count={room.lives} />
          <Vistazos count={room.shurikens} />
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

      <section className="table">
        {/* Avisos en su propia línea: nunca tapan cartas. Prioridad: error propio, evento, pista. */}
        <div className="status-line" aria-live="polite">
          {vote && playing ? (
            <VoteBanner ctl={ctl} snap={snap} />
          ) : errorToast ? (
            <Toast tone="danger" title={errorToast} />
          ) : feed.item ? (
            <Toast tone={feed.item.tone} title={feed.item.title} detail={feed.item.detail} />
          ) : (
            playing && !vote && <p className="table-hint">{t(desc ? 'game.hintDesc' : 'game.hint')}</p>
          )}
        </div>
        <div className="pile">
          {previous && <Card value={previous.c} size="xl" className="pile-previous" muted />}
          {top ? (
            <div className="pile-top" key={`${room.level}-${pile.length}`}>
              <Card value={top.c} size="xl" />
              <span className="pile-owner">{players.find((p) => p.id === top.p)?.name ?? ''}</span>
            </div>
          ) : (
            <div className="pile-empty">{t(desc ? 'game.tableEmptyDesc' : 'game.tableEmpty')}</div>
          )}
        </div>
        {revealed.length > 0 && (
          <div className="revealed">
            <span className="field-label">{t('game.discarded')}</span>
            <div className="revealed-cards">
              {revealed.map((r) => (
                <Card key={`${r.c}`} value={r.c} size="xs" muted className={`revealed-${r.r}`} />
              ))}
            </div>
          </div>
        )}
      </section>

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
                  <Card key={c} value={c} size={myHand.length > 7 ? 'xs' : 'sm'} />
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
          <VistazoIcon size={18} /> {playing && shurikenBlocked && !vote ? t('game.shurikenBlocked') : t('game.useShuriken')}
        </button>
        {chatEnabled && (
          <button type="button" className="btn btn-secondary chat-btn" onClick={() => setChatOpen(true)} aria-label={t('game.chat')}>
            <ChatIcon size={18} />
            {unread > 0 && <span className="unread">{unread}</span>}
          </button>
        )}
      </footer>

      {chatEnabled && chatOpen && <ChatSheet ctl={ctl} onClose={() => setChatOpen(false)} />}
      {playing && room.config.countdown && feed.countdownSeq !== null && (
        <Countdown
          level={room.level}
          reward={reward ? t('reward.ifPass', { reward: rewardText(reward) }) : null}
          orderNote={desc ? t('game.orderDesc') : null}
          onDone={feed.clearCountdown}
        />
      )}
      {room.status === 'level_complete' && showLevelComplete && <LevelComplete ctl={ctl} snap={snap} />}
      {ended && showEnd && (
        <EndScreen ctl={ctl} snap={snap} onExit={onExit} />
      )}
    </div>
  );
}
