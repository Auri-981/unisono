import { useCallback, useEffect, useState } from 'react';
import { isFinalLevel } from '../../../config/gameConfig';
import type { RoomController } from '../../../game/controller';
import type { ComodinKind } from '../../../game/types';
import { errorMessage, t } from '../../../i18n';
import { Card, CardBacks } from '../../components/Card';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ChatIcon, ComodinIcon, ComodinKindIcon, CrownIcon, ExitIcon, HiddenHandIcon, LifeIcon } from '../../components/Icons';
import { rewardText, upcomingReward } from '../../rewards';
import { Toast } from '../../components/Layout';
import { ConnectionDot, Lives, ShieldOn } from '../../components/Resources';
import { ChatSheet } from './ChatSheet';
import { BlindPile, FinalAlert, FinalBadge } from './FinalRound';
import { LightningAlert, LightningTimer } from './Lightning';
import { Countdown, EndScreen, LevelComplete, RewindVote, VoteBanner } from './Overlays';
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
  const [infoToast, setInfoToast] = useState<string | null>(null);

  const playing = room.status === 'playing';
  // Ronda final (el último nivel): sin comodines, mesa a ciegas y manos ocultas.
  const final = playing && isFinalLevel(room.level, room.maxLevel);
  // La mano ya llega ordenada «en orden de juego» desde el servidor (también en 100 → 1).
  const order = room.config.order;
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

  useEffect(() => {
    if (!infoToast) return;
    const id = window.setTimeout(() => setInfoToast(null), 3000);
    return () => window.clearTimeout(id);
  }, [infoToast]);

  // En mitad de la partida se pide confirmación (con la ventana propia del juego).
  const [confirmLeave, setConfirmLeave] = useState(false);
  const closeConfirmLeave = useCallback(() => setConfirmLeave(false), []);
  const leave = () => {
    if (room.status === 'playing' || room.status === 'level_complete') setConfirmLeave(true);
    else void ctl.actions.leave();
  };

  // Si te rechazaron (o caducó) un comodín, no puedes proponer otro hasta que se juegue una carta.
  const blocked = room.shurikenBlocked?.includes(me) ?? false;
  const cardsOnTable = myHand.length + others.reduce((n, p) => n + (p.cardsLeft ?? 0), 0);
  const canPropose = playing && !final && !vote && !blocked && cardsOnTable > 0 && !ctl.busy;
  const shields = room.shields ?? 0;
  const rewinds = room.rewinds ?? 0;
  const shieldActive = room.shieldActive ?? false;
  // Rebobinar se pregunta en una ventana propia (lo propone el juego al perder una vida).
  const rewindVote = playing && vote?.kind === 'rewind';

  // Premio que se obtendrá al superar el nivel actual (se anuncia durante la ronda).
  const reward = upcomingReward(room, players.length);

  // Ronda relámpago: reloj del equipo. Al empezar ese nivel o la ronda final, un aviso antes de la
  // cuenta atrás (una sola vez por inicio de nivel).
  const lightning = playing && Boolean(room.lightningEndsAt);
  const [alertSeenSeq, setAlertSeenSeq] = useState<number | null>(null);
  const showIntroAlert = (lightning || final) && feed.countdownSeq !== null && alertSeenSeq !== feed.countdownSeq;
  const closeIntroAlert = useCallback(() => setAlertSeenSeq(feed.countdownSeq), [feed.countdownSeq]);

  // Tras la última carta, unos segundos para verla antes de «nivel superado» / fin de partida.
  const ended = room.status === 'won' || room.status === 'lost' || room.status === 'abandoned';
  // (Tras «nivel superado» puede llegar otro evento, p. ej. el comodín dado directamente.)
  const recent = snap.recentEvents?.length ? snap.recentEvents : snap.lastEvent ? [snap.lastEvent] : [];
  const resultAt = [...recent].reverse().find((e) => ['level_complete', 'won', 'lost'].includes(e.kind))?.at;
  const showLevelComplete = useAfterPause(room.status === 'level_complete', resultAt, ctl.clockOffset);
  const showEnd = useAfterPause(ended, room.status === 'abandoned' ? undefined : resultAt, ctl.clockOffset);

  return (
    <div className={`game ${feed.shake ? 'game-shake' : ''} ${lightning ? 'game-lightning' : ''} ${final ? 'game-final' : ''}`}>
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
        {/* En la ronda relámpago, el reloj ocupa el sitio del premio (que ya se anunció al empezar). */}
        {final ? (
          <FinalBadge />
        ) : lightning ? (
          <LightningTimer ctl={ctl} snap={snap} />
        ) : (
          playing &&
          reward && (
            <div className="level-reward" role="note" aria-label={t('reward.aria', { reward: rewardText(reward) })}>
              <span className="game-level-label">{t('reward.label')}</span>
              <span className="level-reward-value">
                {reward.lives > 0 && (
                  <span className={`resource resource-life ${reward.livesFull ? 'is-full' : ''}`}>
                    <LifeIcon size={15} />+{reward.lives}
                  </span>
                )}
                {reward.shurikens > 0 && (
                  <span className={`resource resource-comodin ${reward.shurikensFull ? 'is-full' : ''}`}>
                    <ComodinIcon size={15} />+{reward.shurikens}
                  </span>
                )}
              </span>
            </div>
          )
        )}
        <div className="game-resources">
          <Lives count={room.lives} />
          {shieldActive && <ShieldOn />}
        </div>
        {ctl.kind === 'online' && <ConnectionDot state={ctl.connection} />}
      </header>

      {/* En el ordenador, columna izquierda con su título; en el móvil el contenedor no cuenta. */}
      <div className="game-players">
        <p className="game-side-label">{t('common.players')}</p>
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
                {p.cardsLeft === null ? (
                  <span className="card-backs card-backs-hidden" aria-hidden>
                    <HiddenHandIcon size={20} />
                  </span>
                ) : (
                  <CardBacks count={p.cardsLeft} />
                )}
                <span className="opponent-count">
                  {p.cardsLeft === null
                    ? t('final.hiddenCards')
                    : p.cardsLeft === 1
                      ? t('game.cardsLeftOne')
                      : t('game.cardsLeft', { count: p.cardsLeft })}
                  {!online && ` · ${t('game.offline')}`}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <section className="table">
        {/* Avisos en su propia línea: nunca tapan cartas. Prioridad: error propio, evento, pista. */}
        <div className="status-line" aria-live="polite">
          {vote && playing && !rewindVote ? (
            <VoteBanner ctl={ctl} snap={snap} />
          ) : errorToast ? (
            <Toast tone="danger" title={errorToast} />
          ) : infoToast ? (
            <Toast tone="info" title={infoToast} />
          ) : feed.item ? (
            <Toast tone={feed.item.tone} title={feed.item.title} detail={feed.item.detail} />
          ) : (
            playing &&
            !vote && (
              <p className={`table-hint ${shieldActive ? 'table-hint-shield' : ''}`}>
                {blocked ? t('comodin.blocked') : shieldActive ? t('comodin.shieldOnHint') : t(final ? `final.hint.${order}` : `game.hint.${order}`)}
              </p>
            )
          )}
        </div>
        <div className="pile">
          {final ? (
            <BlindPile snap={snap} clockOffset={ctl.clockOffset} />
          ) : (
            <>
              {previous && <Card value={previous.c} size="xl" className="pile-previous" muted />}
              {top ? (
                <div className="pile-top" key={`${room.level}-${pile.length}`}>
                  <Card value={top.c} size="xl" />
                  <span className="pile-owner">{players.find((p) => p.id === top.p)?.name ?? ''}</span>
                </div>
              ) : (
                <div className="pile-empty">{t(`game.tableEmpty.${order}`)}</div>
              )}
            </>
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
        <p className="game-side-label">{t('common.comodines')}</p>
        {/* Ronda final: los comodines se ven (con su número) pero bloqueados, con el aviso encima. */}
        <div
          className={`comodin-bar ${final ? 'is-locked' : ''}`}
          role="group"
          aria-label={final ? t('final.noComodines') : t('common.comodines')}
          data-locked={final ? t('final.noComodines') : undefined}
        >
          <ComodinButton
            kind="shuriken"
            count={room.shurikens}
            disabled={!canPropose || room.shurikens <= 0}
            onClick={() => void ctl.actions.proposeShuriken()}
          />
          <ComodinButton
            kind="shield"
            count={shields}
            active={shieldActive}
            disabled={!canPropose || shields <= 0 || shieldActive}
            onClick={() => void ctl.actions.proposeShield()}
          />
          {/* Rebobinar no se propone: se ofrece solo al perder una vida. Al tocarlo se explica. */}
          <ComodinButton
            kind="rewind"
            count={rewinds}
            passive
            disabled={final}
            onClick={() => setInfoToast(t('comodin.rewindInfo'))}
          />
        </div>
        {chatEnabled && (
          <button type="button" className="btn btn-secondary chat-btn" onClick={() => setChatOpen(true)} aria-label={t('game.chat')}>
            <ChatIcon size={18} />
            <span className="chat-btn-label">{t('game.chat')}</span>
            {unread > 0 && <span className="unread">{unread}</span>}
          </button>
        )}
      </footer>

      {chatEnabled && chatOpen && <ChatSheet ctl={ctl} onClose={() => setChatOpen(false)} />}
      {showIntroAlert &&
        (final ? <FinalAlert onDone={closeIntroAlert} /> : <LightningAlert level={room.level} onDone={closeIntroAlert} />)}
      {playing && room.config.countdown && feed.countdownSeq !== null && !showIntroAlert && (
        <Countdown
          level={room.level}
          reward={reward ? t('reward.ifPass', { reward: rewardText(reward) }) : null}
          orderNote={t(`game.order.${order}`)}
          onDone={feed.clearCountdown}
        />
      )}
      {rewindVote && <RewindVote ctl={ctl} snap={snap} />}
      {room.status === 'level_complete' && showLevelComplete && <LevelComplete ctl={ctl} snap={snap} />}
      {ended && showEnd && <EndScreen ctl={ctl} snap={snap} onExit={onExit} />}
      {confirmLeave && !ended && (
        <ConfirmDialog
          icon={<ExitIcon size={30} />}
          title={t('game.leaveTitle')}
          text={t('game.leaveText')}
          confirmLabel={t('game.leaveConfirm')}
          onConfirm={() => {
            setConfirmLeave(false);
            void ctl.actions.leave();
          }}
          onCancel={closeConfirmLeave}
        />
      )}
    </div>
  );
}

/** Botón de un comodín con su número. */
function ComodinButton({
  kind,
  count,
  disabled,
  active,
  passive,
  onClick,
}: {
  kind: ComodinKind;
  count: number;
  disabled?: boolean;
  active?: boolean;
  passive?: boolean;
  onClick: () => void;
}) {
  const name = t(`comodin.${kind}`);
  return (
    <button
      type="button"
      className={`comodin-btn comodin-${kind} ${active ? 'is-active' : ''} ${passive ? 'is-passive' : ''}`}
      disabled={disabled}
      onClick={onClick}
      aria-label={`${name}: ${count}${active ? ` · ${t('comodin.shieldOn')}` : ''}`}
    >
      <span className="comodin-btn-top">
        <ComodinKindIcon kind={kind} size={20} />
        <span className="comodin-btn-count" key={count}>
          {count}
        </span>
      </span>
      <span className="comodin-btn-name">{active ? t('comodin.shieldOn') : name}</span>
      {/* Solo en el ordenador, donde hay sitio. */}
      <span className="comodin-btn-desc">{active ? t('comodin.shieldOnHint') : t(`comodin.desc.${kind}`)}</span>
    </button>
  );
}
