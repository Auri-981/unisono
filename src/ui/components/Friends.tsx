/**
 * Piezas de los amigos que se usan fuera de su pantalla: el aviso de invitación, la lista para
 * invitar desde la sala y el botón para añadir a alguien con quien estás jugando.
 */
import { useEffect, useState } from 'react';
import type { PublicPlayer, RoomSnapshot } from '../../game/types';
import { errorMessage, t } from '../../i18n';
import type { FriendCard } from '../../net/api';
import { acceptInvite, addFriendFromRoom, declineInvite, inviteFriend, liveInvites, refreshFriends, useFriends } from '../friends';
import { CheckIcon, PlusIcon, TeamIcon } from './Icons';
import { TitleTag } from './Progression';

/** Código de amigo tal como se enseña: ABCD-2345. */
export const showCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

export function FriendAvatar({ name, status }: { name: string; status?: FriendCard['status'] }) {
  return (
    <span className="friend-avatar" aria-hidden>
      {(name || '?').charAt(0).toUpperCase()}
      {status && <span className={`friend-dot friend-dot-${status}`} />}
    </span>
  );
}

/** Aviso cuando un amigo te invita a su sala. No sale mientras juegas (`hidden`). */
export function InviteBanner({ hidden, onJoined }: { hidden: boolean; onJoined: (snapshot: RoomSnapshot) => void }) {
  const store = useFriends();
  const invite = liveInvites(store)[0];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Al caducar desaparece aunque no llegue ninguna señal.
  const expiresAt = invite?.expiresAt;
  useEffect(() => {
    if (!expiresAt) return;
    const left = Date.parse(expiresAt) - (Date.now() + store.clockOffset);
    const id = window.setTimeout(() => void refreshFriends(), Math.max(left, 0) + 500);
    return () => window.clearTimeout(id);
  }, [expiresAt, store.clockOffset]);

  useEffect(() => setError(null), [invite?.id]);

  if (hidden || !invite) return null;
  const join = async () => {
    setBusy(true);
    setError(null);
    const res = await acceptInvite(invite.id);
    setBusy(false);
    if (res.snapshot) onJoined(res.snapshot);
    else if (res.error) setError(errorMessage(res.error));
  };
  return (
    <div className="invite-banner" role="alertdialog" aria-labelledby="invite-banner-text">
      <span className="invite-banner-icon" aria-hidden>
        <TeamIcon size={22} />
      </span>
      <p id="invite-banner-text" className="invite-banner-text">
        <strong>{invite.fromName}</strong> {t('friends.invitesYou')}
      </p>
      {error && (
        <p className="invite-banner-error" role="alert">
          {error}
        </p>
      )}
      <div className="invite-banner-actions">
        <button type="button" className="btn btn-ghost btn-small" onClick={() => void declineInvite(invite.id)} disabled={busy}>
          {t('friends.notNow')}
        </button>
        <button type="button" className="btn btn-primary btn-small" onClick={() => void join()} disabled={busy}>
          {t('friends.join')}
        </button>
      </div>
    </div>
  );
}

/** En la sala de espera: los amigos a los que se puede invitar sin pasarles el código. */
export function FriendInvites({ roomId, players }: { roomId: string; players: PublicPlayer[] }) {
  const { data } = useFriends();
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refreshFriends();
  }, []);

  const list = (data?.friends ?? []).filter((f) => !players.some((p) => p.id === f.id));
  if (list.length === 0) return null;

  const invite = async (id: string) => {
    setError(null);
    setSent((s) => ({ ...s, [id]: true }));
    const code = await inviteFriend(roomId, id);
    if (code) {
      setSent((s) => ({ ...s, [id]: false }));
      setError(errorMessage(code));
    } else {
      // Se puede volver a invitar cuando caduque la invitación.
      window.setTimeout(() => setSent((s) => ({ ...s, [id]: false })), 120_000);
    }
  };

  return (
    <section className="panel friend-invites">
      <h2 className="panel-title">{t('friends.inviteTitle')}</h2>
      <ul className="friend-list">
        {list.map((f) => (
          <li key={f.id} className="friend-row">
            <FriendAvatar name={f.name} status={f.status} />
            <span className="friend-info">
              <span className="friend-name">{f.name}</span>
              <span className="friend-status">{t(`friends.status.${f.status ?? 'offline'}`)}</span>
            </span>
            {sent[f.id] ? (
              <span className="badge badge-ready">
                <CheckIcon size={14} /> {t('friends.invited')}
              </span>
            ) : (
              <button type="button" className="btn btn-secondary btn-small" disabled={f.status !== 'online'} onClick={() => void invite(f.id)}>
                {t('friends.invite')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p className="notice notice-danger small" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** Añadir a amigos a quien está contigo en la sala. No sale si ya lo es. */
export function AddFriendButton({ roomId, player }: { roomId: string; player: PublicPlayer }) {
  const { data } = useFriends();
  const [busy, setBusy] = useState(false);
  if (!data || data.friends.some((f) => f.id === player.id)) return null;
  if (data.outgoing.some((f) => f.id === player.id)) {
    return (
      <span className="friend-sent" title={t('friends.requestSent')} aria-label={t('friends.requestSent')}>
        <CheckIcon size={16} />
      </span>
    );
  }
  const add = async () => {
    setBusy(true);
    await addFriendFromRoom(roomId, player.id);
    setBusy(false);
  };
  return (
    <button
      type="button"
      className="icon-btn friend-add"
      onClick={() => void add()}
      disabled={busy}
      aria-label={t('friends.addPlayer', { name: player.name })}
      title={t('friends.addPlayer', { name: player.name })}
    >
      <PlusIcon size={16} />
    </button>
  );
}

export function FriendLine({ friend }: { friend: FriendCard }) {
  return (
    <>
      <FriendAvatar name={friend.name} status={friend.status} />
      <span className="friend-info">
        <span className="friend-name">{friend.name}</span>
        <TitleTag title={friend.title} />
        {friend.status && <span className="friend-status">{t(`friends.status.${friend.status}`)}</span>}
      </span>
    </>
  );
}
