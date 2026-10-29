import { useEffect, useRef, useState } from 'react';
import { isFinalLevel, lightningSeconds } from '../../../config/gameConfig';
import type { RoomController } from '../../../game/controller';
import { COMODIN_KINDS, type MistakePayload, type RoomSnapshot } from '../../../game/types';
import { t } from '../../../i18n';
import { CheckIcon, ComodinKindIcon, CrownIcon, FinalIcon, LifeIcon, LightningIcon, RewindIcon } from '../../components/Icons';
import { rich } from '../../rich';
import { LIFE_SYMBOL, rewardText, upcomingReward } from '../../rewards';

/** Cuenta atrás visual al empezar un nivel. No bloquea: se puede cerrar tocando. */
export function Countdown({
  level,
  reward,
  orderNote,
  onDone,
}: {
  level: number;
  reward: string | null;
  orderNote: string;
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
      <span className="countdown-order">{orderNote}</span>
      {reward && <span className="countdown-reward">{reward}</span>}
      <span className="muted small">{t('game.countdownSkip')}</span>
    </button>
  );
}

/** Segundos que quedan de una votación (con el reloj del servidor). Al llegar a 0 pide cancelarla. */
function useVoteTimer(ctl: RoomController, expiresAt: string) {
  const [now, setNow] = useState(() => Date.now() + ctl.clockOffset);
  const expiredSent = useRef(false);
  const remaining = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));

  useEffect(() => {
    expiredSent.current = false;
  }, [expiresAt]);
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
  return remaining;
}

/** Quién ha aceptado ya, o los botones para votar. */
function VoteControls({
  ctl,
  snap,
  acceptLabel,
  rejectLabel,
}: {
  ctl: RoomController;
  snap: RoomSnapshot;
  acceptLabel: string;
  rejectLabel: string;
}) {
  const vote = snap.vote!;
  if (vote.votes.includes(snap.me)) {
    return (
      <div className="vote-voters">
        {snap.players.map((p) => (
          <span key={p.id} className={`chip ${vote.votes.includes(p.id) ? 'chip-on' : ''}`}>
            {vote.votes.includes(p.id) && <CheckIcon size={14} />} {p.name}
          </span>
        ))}
        <span className="muted small">{t('vote.waiting', { count: vote.votes.length, total: snap.players.length })}</span>
      </div>
    );
  }
  return (
    <div className="vote-actions">
      <button type="button" className="btn btn-secondary" disabled={ctl.busy} onClick={() => void ctl.actions.voteShuriken(false)}>
        {rejectLabel}
      </button>
      <button type="button" className="btn btn-primary" disabled={ctl.busy} onClick={() => void ctl.actions.voteShuriken(true)}>
        {acceptLabel}
      </button>
    </div>
  );
}

/** Votación de vistazo o escudo con tiempo límite (en la línea de avisos). */
export function VoteBanner({ ctl, snap }: { ctl: RoomController; snap: RoomSnapshot }) {
  const vote = snap.vote!;
  const kind = vote.kind ?? 'shuriken';
  const remaining = useVoteTimer(ctl, vote.expiresAt);
  const proposer = snap.players.find((p) => p.id === vote.proposer)?.name ?? '—';
  const mine = vote.proposer === snap.me;
  let title: string;
  let explain: string;
  if (kind === 'shield') {
    title = mine ? t('vote.shieldByMe') : t('vote.shieldQuestion');
    explain = (mine ? '' : `${t('vote.shieldBy', { name: proposer })}. `) + t('vote.explainShield');
  } else {
    title = mine ? t('vote.proposedByMe') : t('vote.proposed', { name: proposer });
    explain = t('vote.explainShuriken');
  }
  return (
    <div className={`vote-banner vote-${kind}`} role="alertdialog" aria-live="assertive">
      <div className="vote-head">
        <ComodinKindIcon kind={kind} size={22} />
        <strong>{title}</strong>
        <span className="vote-timer">{t('vote.seconds', { s: remaining })}</span>
      </div>
      <p className="small muted">{explain}</p>
      <VoteControls ctl={ctl} snap={snap} acceptLabel={t('vote.accept')} rejectLabel={t('vote.reject')} />
    </div>
  );
}

/** «¿Queréis utilizar el comodín Rebobinar?»: aparece sola al perder una vida. */
export function RewindVote({ ctl, snap }: { ctl: RoomController; snap: RoomSnapshot }) {
  const vote = snap.vote!;
  const remaining = useVoteTimer(ctl, vote.expiresAt);
  const events = snap.recentEvents?.length ? snap.recentEvents : snap.lastEvent ? [snap.lastEvent] : [];
  const mistake = [...events].reverse().find((e) => e.kind === 'mistake');
  const m = mistake?.payload as MistakePayload | undefined;
  const who = mistake
    ? mistake.actor === snap.me
      ? t('common.you')
      : (snap.players.find((p) => p.id === mistake.actor)?.name ?? '—')
    : null;
  return (
    <div className="overlay overlay-rewind" role="alertdialog" aria-modal="true" aria-labelledby="rewind-title">
      <div className="overlay-card">
        <div className="rewind-badge" aria-hidden>
          <RewindIcon size={34} />
        </div>
        <h2 id="rewind-title" className="overlay-title rewind-title">
          {t('vote.rewindQuestion')}
        </h2>
        {m && who && (
          <p className="rewind-mistake">
            {t('vote.rewindMistake', { name: who, card: m.card })} · {LIFE_SYMBOL} {snap.room.lives}
          </p>
        )}
        <p className="muted">{t('vote.explainRewind')}</p>
        {snap.room.lives <= 0 && <p className="rewind-warning">{t('vote.rewindLastLife')}</p>}
        <p className="small muted">
          {t('vote.rewindLeft', { n: snap.room.rewinds ?? 0 })} ·{' '}
          <span className="vote-timer">{t('vote.seconds', { s: remaining })}</span>
        </p>
        <VoteControls ctl={ctl} snap={snap} acceptLabel={t('vote.use')} rejectLabel={t('vote.dontUse')} />
      </div>
    </div>
  );
}

/** Las dos tarjetas de comodín para elegir al superar un nivel. */
function ComodinChoice({ ctl, snap }: { ctl: RoomController; snap: RoomSnapshot }) {
  const offer = snap.room.offer!;
  const myVote = offer.votes[snap.me];
  return (
    <div className="choose">
      <p className="choose-title">{t('level.chooseTitle')}</p>
      <div className="choose-cards">
        {offer.choices.map((kind) => {
          const voters = snap.players.filter((p) => offer.votes[p.id] === kind);
          return (
            <button
              key={kind}
              type="button"
              className={`choose-card comodin-${kind} ${myVote === kind ? 'is-picked' : ''}`}
              aria-pressed={myVote === kind}
              disabled={ctl.busy}
              onClick={() => void ctl.actions.pickComodin(kind)}
            >
              <ComodinKindIcon kind={kind} size={36} className="choose-icon" />
              <span className="choose-name">{t(`comodin.${kind}`)}</span>
              <span className="choose-desc">{t(`comodin.desc.${kind}`)}</span>
              <span className="choose-voters">
                {voters.map((p) => (
                  <span key={p.id} className="chip chip-on">
                    {p.id === snap.me ? t('level.myPick') : p.name}
                  </span>
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <p className="small muted">{t(ctl.kind === 'practice' ? 'level.chooseHintPractice' : 'level.chooseHint')}</p>
      {offer.left > 1 && <p className="small muted">{t('level.chooseMore', { n: offer.left })}</p>}
    </div>
  );
}

export function LevelComplete({ ctl, snap }: { ctl: RoomController; snap: RoomSnapshot }) {
  const { room, players, me, lastReward } = snap;
  const meReady = players.find((p) => p.id === me)?.ready;
  const readyCount = players.filter((p) => p.ready).length;
  const reward = lastReward;
  const isHost = room.hostId === me;
  const offer = room.offer ?? null;
  const nextReward = upcomingReward(room, players.length, room.level + 1);
  const gained = reward
    ? COMODIN_KINDS.map((kind) => ({
        kind,
        n: (kind === 'shuriken' ? reward.shurikens : kind === 'rewind' ? reward.rewinds : reward.shields) ?? 0,
      })).filter((x) => x.n > 0)
    : [];
  const hasReward = Boolean(reward && (reward.lives > 0 || gained.length > 0));
  return (
    <div className="overlay overlay-level" role="dialog" aria-modal="true" aria-labelledby="lvl-title">
      <div className="overlay-card">
        <div className="burst" aria-hidden />
        <h2 id="lvl-title" className="overlay-title">
          {t('level.complete', { level: room.level })}
        </h2>
        {(hasReward || !offer) && (
          <div className="reward">
            <p className="field-label">{t('level.reward')}</p>
            {hasReward ? (
              <div className="reward-items">
                {reward!.lives > 0 && (
                  <span className="reward-item reward-life">
                    <LifeIcon size={26} /> {t('level.rewardLife', { n: reward!.lives })}
                  </span>
                )}
                {gained.map(({ kind, n }) => (
                  <span key={kind} className={`reward-item reward-${kind}`}>
                    <ComodinKindIcon kind={kind} size={26} /> {t('level.rewardComodin', { n, name: t(`comodin.${kind}`) })}
                  </span>
                ))}
              </div>
            ) : (
              <p className="muted">{t('level.noReward')}</p>
            )}
          </div>
        )}
        {offer && <ComodinChoice ctl={ctl} snap={snap} />}
        <p className="muted">{t('level.next', { level: room.level + 1 })}</p>
        {room.lightningLevel === room.level + 1 && (
          <p className="next-lightning" role="note">
            <LightningIcon size={18} />
            {t('lightning.next', { level: room.level + 1, s: lightningSeconds(room.level + 1) })}
          </p>
        )}
        {isFinalLevel(room.level + 1, room.maxLevel) && (
          <p className="next-final" role="note">
            <FinalIcon size={20} />
            <span>{rich(t('final.next', { level: room.level + 1 }))}</span>
          </p>
        )}
        {nextReward && (
          <p className="next-reward">{t('reward.next', { level: room.level + 1, reward: rewardText(nextReward) })}</p>
        )}
        {!offer && (
          <ul className="ready-list">
            {players.map((p) => (
              <li key={p.id} className={p.ready ? 'is-ready' : ''}>
                {p.ready ? <CheckIcon size={16} /> : <span className="dot-wait" aria-hidden />} {p.name}
                {p.id === room.hostId && <CrownIcon size={14} className="host-crown" />}
              </li>
            ))}
          </ul>
        )}
        {offer ? (
          <p className="muted small">{t('level.chooseFirst')}</p>
        ) : meReady ? (
          <p className="muted">{t('level.waiting', { ready: readyCount, total: players.length })}</p>
        ) : (
          <button type="button" className="btn btn-primary btn-large btn-block" disabled={ctl.busy} onClick={() => void ctl.actions.readyNextLevel(false)}>
            {t('level.ready')}
          </button>
        )}
        {/* El anfitrión puede desbloquear la sala si alguien no responde (p. ej. se ha desconectado). */}
        {isHost && (offer ? ctl.kind === 'online' && offer.votes[me] !== undefined : meReady && readyCount < players.length) && (
          <button type="button" className="btn btn-ghost btn-block" disabled={ctl.busy} onClick={() => void ctl.actions.readyNextLevel(true)}>
            {t(offer ? 'level.chooseForce' : 'level.force')}
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
  const events = snap.recentEvents?.length ? snap.recentEvents : snap.lastEvent ? [snap.lastEvent] : [];
  const outOfTime = status === 'lost' && events.some((e) => e.kind === 'lightning_timeout');
  const text =
    status === 'won'
      ? t(room.maxLevel === 1 ? 'end.wonTextOne' : 'end.wonText', { levels: room.maxLevel })
      : outOfTime
        ? t('end.lightningText', { level: room.level })
        : status === 'lost'
          ? t(isFinalLevel(room.level, room.maxLevel) && room.maxLevel > 1 ? 'end.finalLostText' : 'end.lostText', { level: room.level })
          : t('end.abandonedText');
  return (
    <div className={`overlay overlay-end end-${status}`} role="dialog" aria-modal="true" aria-labelledby="end-title">
      <div className="overlay-card">
        {status === 'won' && <div className="burst burst-big" aria-hidden />}
        {outOfTime && <LightningIcon size={44} className="end-lightning-icon" />}
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
