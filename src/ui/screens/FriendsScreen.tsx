/**
 * Amigos: tu código, añadir a alguien, invitaciones y solicitudes pendientes y la lista.
 * Se llega también con el enlace `?amigo=CODIGO`, que deja el código ya escrito.
 */
import { useEffect, useState, type FormEvent } from 'react';
import type { RoomSnapshot } from '../../game/types';
import { errorMessage, t } from '../../i18n';
import type { FriendCard, FriendsState } from '../../net/api';
import { useAccount } from '../account';
import { AccountCard } from '../components/Account';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FriendAvatar, FriendLine, showCode } from '../components/Friends';
import { CheckIcon, CloseIcon, CopyIcon, ShareIcon, TeamIcon } from '../components/Icons';
import { Page, Toast } from '../components/Layout';
import {
  acceptInvite,
  addFriendByCode,
  cancelRequest,
  declineInvite,
  liveInvites,
  refreshFriends,
  removeFriend,
  respondRequest,
  useFriends,
} from '../friends';
import { copyText } from './LobbyScreen';

function friendLink(code: string): string {
  const url = new URL(window.location.href);
  url.search = `?amigo=${code}`;
  url.hash = '';
  return url.toString();
}

export function FriendsScreen({
  initialCode = '',
  onBack,
  onJoined,
}: {
  initialCode?: string;
  onBack: () => void;
  onJoined: (snapshot: RoomSnapshot) => void;
}) {
  const store = useFriends();
  const { data, error } = store;
  const guest = useAccount().kind === 'guest';
  const [toast, setToast] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);

  useEffect(() => {
    void refreshFriends();
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const fail = (code: string | null) => {
    if (code) setToast({ tone: 'danger', text: errorMessage(code) });
  };
  const invites = liveInvites(store);

  return (
    <Page title={t('friends.title')} onBack={onBack} className="page-friends">
      {!data ? (
        error ? (
          <p className="notice notice-danger">{errorMessage(error)}</p>
        ) : (
          <p className="muted">{t('common.loading')}</p>
        )
      ) : (
        <div className="friends">
          <MyCode code={data.code} />
          <AddForm initialCode={initialCode} own={data.code} onResult={setToast} />

          {invites.length > 0 && (
            <section className="settings-group">
              <h2 className="section-title">{t('friends.invites')}</h2>
              <ul className="settings-card friend-list friend-list-card">
                {invites.map((i) => (
                  <li key={i.id} className="friend-row friend-row-wide">
                    <FriendAvatar name={i.fromName} />
                    <span className="friend-info">
                      <span className="friend-name">{i.fromName}</span>
                      <span className="friend-status">{t('friends.invitesYou')}</span>
                    </span>
                    <span className="friend-actions">
                      <button type="button" className="btn btn-ghost btn-small" onClick={() => void declineInvite(i.id).then(fail)}>
                        {t('friends.notNow')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-small"
                        onClick={async () => {
                          const res = await acceptInvite(i.id);
                          if (res.snapshot) onJoined(res.snapshot);
                          else fail(res.error ?? null);
                        }}
                      >
                        {t('friends.join')}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <Requests data={data} onError={fail} />
          <FriendList friends={data.friends} onError={fail} />
          {guest && <AccountCard />}
        </div>
      )}
      {toast && (
        <div className="toast-layer">
          <Toast tone={toast.tone} title={toast.text} />
        </div>
      )}
    </Page>
  );
}

function MyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator.share === 'function';
  const copy = async () => {
    if (await copyText(showCode(code))) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: t('app.name'), text: t('friends.shareText', { code: showCode(code) }), url: friendLink(code) });
    } catch {
      // El usuario canceló o no se pudo: no es un error.
    }
  };
  return (
    <section className="settings-card friend-code">
      <span className="field-label">{t('friends.myCode')}</span>
      <p className="friend-code-value">{showCode(code)}</p>
      <span className="muted small">{t('friends.myCodeHint')}</span>
      <div className="friend-code-actions">
        <button type="button" className="btn btn-secondary" onClick={() => void copy()}>
          {copied ? <CheckIcon /> : <CopyIcon />} {copied ? t('lobby.copied') : t('friends.copy')}
        </button>
        {canShare && (
          <button type="button" className="btn btn-primary" onClick={() => void share()}>
            <ShareIcon /> {t('lobby.share')}
          </button>
        )}
      </div>
    </section>
  );
}

function AddForm({
  initialCode,
  own,
  onResult,
}: {
  initialCode: string;
  own: string;
  onResult: (toast: { tone: 'danger' | 'success'; text: string }) => void;
}) {
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || clean.length !== own.length) return;
    setBusy(true);
    const res = await addFriendByCode(clean);
    setBusy(false);
    if (res.error) {
      onResult({ tone: 'danger', text: errorMessage(res.error) });
      return;
    }
    setCode('');
    onResult({ tone: 'success', text: t(res.result === 'friends' ? 'friends.nowFriends' : 'friends.requestSent') });
  };

  return (
    <form className="settings-group" onSubmit={submit} noValidate>
      <label className="section-title" htmlFor="friend-code-input">
        {t('friends.add')}
      </label>
      <div className="friend-add-form">
        <input
          id="friend-code-input"
          className="input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t('friends.addPlaceholder')}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={12}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || clean.length !== own.length}>
          {t('friends.addButton')}
        </button>
      </div>
    </form>
  );
}

function Requests({ data, onError }: { data: FriendsState; onError: (code: string | null) => void }) {
  if (data.incoming.length === 0 && data.outgoing.length === 0) return null;
  return (
    <section className="settings-group">
      <h2 className="section-title">{t('friends.requests')}</h2>
      <ul className="settings-card friend-list friend-list-card">
        {data.incoming.map((f) => (
          <li key={f.id} className="friend-row friend-row-wide">
            <FriendLine friend={f} />
            <span className="friend-actions">
              <button type="button" className="btn btn-ghost btn-small" onClick={() => void respondRequest(f.id, false).then(onError)}>
                {t('friends.decline')}
              </button>
              <button type="button" className="btn btn-primary btn-small" onClick={() => void respondRequest(f.id, true).then(onError)}>
                {t('friends.accept')}
              </button>
            </span>
          </li>
        ))}
        {data.outgoing.map((f) => (
          <li key={f.id} className="friend-row">
            <FriendAvatar name={f.name} />
            <span className="friend-info">
              <span className="friend-name">{f.name}</span>
              <span className="friend-status">{t('friends.waiting')}</span>
            </span>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => void cancelRequest(f.id).then(onError)}>
              {t('common.cancel')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FriendList({ friends, onError }: { friends: FriendCard[]; onError: (code: string | null) => void }) {
  const [removing, setRemoving] = useState<FriendCard | null>(null);
  return (
    <section className="settings-group">
      <h2 className="section-title">{t('friends.list', { n: friends.length })}</h2>
      {friends.length === 0 ? (
        <div className="settings-card friend-empty">
          <TeamIcon size={30} />
          <p className="muted">{t('friends.empty')}</p>
        </div>
      ) : (
        <ul className="settings-card friend-list friend-list-card">
          {friends.map((f) => (
            <li key={f.id} className="friend-row">
              <FriendLine friend={f} />
              <button
                type="button"
                className="icon-btn friend-remove"
                onClick={() => setRemoving(f)}
                aria-label={t('friends.remove', { name: f.name })}
                title={t('friends.remove', { name: f.name })}
              >
                <CloseIcon size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {removing && (
        <ConfirmDialog
          icon={<CloseIcon size={30} />}
          title={t('friends.remove', { name: removing.name })}
          text={t('friends.removeText')}
          confirmLabel={t('friends.removeConfirm')}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const id = removing.id;
            setRemoving(null);
            void removeFriend(id).then(onError);
          }}
        />
      )}
    </section>
  );
}
