import { useEffect, useRef, useState } from 'react';
import type { RoomController } from '../../../game/controller';
import type { RoomSnapshot } from '../../../game/types';
import { t } from '../../../i18n';
import { CheckIcon, CrownIcon, LifeIcon, ShurikenIcon } from '../../components/Icons';
import { rewardText, upcomingReward } from '../../rewards';

/** Cuenta atrás visual al empezar un nivel. No bloquea: se puede cerrar tocando. */
export function Countdown({
  level,
  reward,
  orderNote,
  onDone,
}: {
  level: number;
  reward: string | null;
  orderNote: string | null;
  onDone: () => void;
}) {
  const [n, setN] = useState(3);
  useEffect(() => {
    if (n <= 0) {
      onDone();
      return;
    }
    const id = window.setTimeout(() => setN((x) => x - 1), 1000);
    return () => window.clearTimeout(id);
  }, [n, onDone]);
  return (
    <button type="button" className="overlay overlay-countdown" onClick={onDone} aria-label={t('game.countdownSkip')}>
      <span className="countdown-level">{t('event.levelStart', { level })}</span>
      <span className="countdown-number" key={n}>
        {n > 0 ? n : ''}
      </span>
      <span className="countdown-hint">{t('game.concentrate')}</span>
      {orderNote && <span className="countdown-order">{orderNote}</span>}
      {reward && <span className="countdown-reward">{reward}</span>}
      <span className="muted small">{t('game.countdownSkip')}</span>
    </button>
  );
}

/** Votación de shuriken con tiempo límite. */
export function VoteBanner({ ctl, snap }: { ctl: RoomController; snap: RoomSnapshot }) {
  const vote = snap.vote!;
  const [now, setNow] = useState(() => Date.now() + ctl.clockOffset);
  const expiredSent = useRef(false);
  const remaining = Math.max(0, Math.ceil((Date.parse(vote.expiresAt) - now) / 1000));

  useEffect(() => {
    expiredSent.current = false;
  }, [vote.expiresAt]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() + ctl.clockOffset), 250);
    return () => window.clearInterval(id);
  }, [ctl.clockOffset]);
  useEffect(() => {
    if (remaining <= 0 && !expiredSent.current) {
      expiredSent.current = true;
      void ctl.actions.expireVote();
    }
  }, [remaining, ctl.actions]);

  const proposer = snap.players.find((p) => p.id === vote.proposer)?.name ?? '—';
  const voted = vote.votes.includes(snap.me);
  return (
    <div className="vote-banner" role="alertdialog" aria-live="assertive">
      <div className="vote-head">
        <ShurikenIcon size={22} />
        <strong>{vote.proposer === snap.me ? t('vote.proposedByMe') : t('vote.proposed', { name: proposer })}</strong>
        <span className="vote-timer">{t('vote.seconds', { s: remaining })}</span>
      </div>
      <p className="small muted">
        {t(snap.room.config.shurikenVariant === 'reveal' ? 'vote.explainReveal' : 'vote.explainClassic')}
      </p>
      {voted ? (
        <div className="vote-voters">
          {snap.players.map((p) => (
            <span key={p.id} className={`chip ${vote.votes.includes(p.id) ? 'chip-on' : ''}`}>
              {vote.votes.includes(p.id) && <CheckIcon size={14} />} {p.name}
            </span>
          ))}
          <span className="muted small">{t('vote.waiting', { count: vote.votes.length, total: snap.players.length })}</span>
        </div>
      ) : (
        <div className="vote-actions">
          <button type="button" className="btn btn-secondary" disabled={ctl.busy} onClick={() => void ctl.actions.voteShuriken(false)}>
            {t('vote.reject')}
          </button>
          <button type="button" className="btn btn-primary" disabled={ctl.busy} onClick={() => void ctl.actions.voteShuriken(true)}>
            {t('vote.accept')}
          </button>
        </div>
      )}
    </div>
  );
}

export function LevelComplete({ ctl, snap }: { ctl: RoomController; snap: RoomSnapshot }) {
  const { room, players, me, lastReward } = snap;
  const meReady = players.find((p) => p.id === me)?.ready;
  const readyCount = players.filter((p) => p.ready).length;
  const reward = lastReward;
  const isHost = room.hostId === me;
  const nextReward = upcomingReward(room, players.length, room.level + 1);
  return (
    <div className="overlay overlay-level" role="dialog" aria-modal="true" aria-labelledby="lvl-title">
      <div className="overlay-card">
        <div className="burst" aria-hidden />
        <h2 id="lvl-title" className="overlay-title">
          {t('level.complete', { level: room.level })}
        </h2>
        <div className="reward">
          <p className="field-label">{t('level.reward')}</p>
          {reward && (reward.lives > 0 || reward.shurikens > 0) ? (
            <div className="reward-items">
              {reward.lives > 0 && (
                <span className="reward-item reward-life">
                  <LifeIcon size={26} /> {t('level.rewardLife', { n: reward.lives })}
                </span>
              )}
              {reward.shurikens > 0 && (
                <span className="reward-item reward-shuriken">
                  <ShurikenIcon size={26} /> {t('level.rewardShuriken', { n: reward.shurikens })}
                </span>
              )}
            </div>
          ) : (
            <p className="muted">{t('level.noReward')}</p>
          )}
        </div>
        <p className="muted">{t('level.next', { level: room.level + 1 })}</p>
        {nextReward && (
          <p className="next-reward">{t('reward.next', { level: room.level + 1, reward: rewardText(nextReward) })}</p>
        )}
        <ul className="ready-list">
          {players.map((p) => (
            <li key={p.id} className={p.ready ? 'is-ready' : ''}>
              {p.ready ? <CheckIcon size={16} /> : <span className="dot-wait" aria-hidden />} {p.name}
              {p.id === room.hostId && <CrownIcon size={14} className="host-crown" />}
            </li>
          ))}
        </ul>
        {meReady ? (
          <p className="muted">{t('level.waiting', { ready: readyCount, total: players.length })}</p>
        ) : (
          <button type="button" className="btn btn-primary btn-large btn-block" disabled={ctl.busy} onClick={() => void ctl.actions.readyNextLevel(false)}>
            {t('level.ready')}
          </button>
        )}
        {isHost && meReady && readyCount < players.length && (
          <button type="button" className="btn btn-ghost btn-block" disabled={ctl.busy} onClick={() => void ctl.actions.readyNextLevel(true)}>
            {t('level.force')}
          </button>
        )}
      </div>
    </div>
  );
}

export function EndScreen({ ctl, snap, onExit }: { ctl: RoomController; snap: RoomSnapshot; onExit: () => void }) {
  const { room, me } = snap;
  const status = room.status as 'won' | 'lost' | 'abandoned';
  const isHost = room.hostId === me;
  const text =
    status === 'won'
      ? t('end.wonText', { levels: room.maxLevel })
      : status === 'lost'
        ? t('end.lostText', { level: room.level })
        : t('end.abandonedText');
  return (
    <div className={`overlay overlay-end end-${status}`} role="dialog" aria-modal="true" aria-labelledby="end-title">
      <div className="overlay-card">
        {status === 'won' && <div className="burst burst-big" aria-hidden />}
        <h2 id="end-title" className="overlay-title end-title">
          {t(status === 'won' ? 'end.won' : status === 'lost' ? 'end.lost' : 'end.abandoned')}
        </h2>
        <p>{text}</p>
        {snap.revealed.length > 0 && status === 'lost' && (
          <p className="muted small">
            {t('game.discarded')}: {snap.revealed.map((r) => r.c).join(', ')}
          </p>
        )}
        {isHost || ctl.kind === 'practice' ? (
          <button type="button" className="btn btn-primary btn-large btn-block" disabled={ctl.busy} onClick={() => void ctl.actions.rematch()}>
            {t('end.rematch')}
          </button>
        ) : (
          <p className="muted small">{t('end.waitHost')}</p>
        )}
        <button type="button" className="btn btn-ghost btn-block" onClick={onExit}>
          {t('end.exit')}
        </button>
      </div>
    </div>
  );
}
