/**
 * Piezas de la cuenta: el botón de Google, la tarjeta «dónde está tu progreso», el aviso del
 * inicio para guardarlo y la ventana que cuenta qué ha pasado al volver de Google.
 */
import { useEffect, useRef, useState } from 'react';
import { errorMessage, t, type MessageKey } from '../../i18n';
import type { MergeSummary } from '../../net/api';
import { clearAccountNotice, dismissNudge, nudgeDismissed, signInWithGoogle, useAccount, type AccountNotice } from '../account';
import { useProfile } from '../profile';
import { CloseIcon, CloudIcon, GoogleIcon } from './Icons';

export function GoogleButton({ compact = false }: { compact?: boolean }) {
  const { busy } = useAccount();
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setError(null);
    const code = await signInWithGoogle();
    if (code) setError(errorMessage(code));
  };
  return (
    <>
      <button type="button" className={`btn btn-google${compact ? ' btn-google-sm' : ''}`} onClick={go} disabled={busy} aria-busy={busy}>
        <GoogleIcon size={compact ? 18 : 20} />
        {busy ? t('account.going') : compact ? t('account.nudgeSave') : t('account.google')}
      </button>
      {error && (
        <p className="notice notice-danger small" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/** Dónde está tu progreso: en este móvil (con el botón para guardarlo) o en tu cuenta. */
export function AccountCard({ onSignOut }: { onSignOut?: () => void }) {
  const { kind, email, googleReady } = useAccount();
  if (kind === 'unknown') return null;
  if (kind === 'google') {
    return (
      <section className="account-card account-saved">
        <div className="account-head">
          <CloudIcon saved size={26} className="account-icon" />
          <div className="account-text">
            <strong>{t('account.savedTitle')}</strong>
            {email && <span className="account-email">{email}</span>}
            <span className="muted small">{t('account.savedText')}</span>
          </div>
        </div>
        {onSignOut && (
          <button type="button" className="link-btn account-signout" onClick={onSignOut}>
            {t('account.signOut')}
          </button>
        )}
      </section>
    );
  }
  return (
    <section className="account-card account-guest">
      <div className="account-head">
        <CloudIcon size={26} className="account-icon" />
        <div className="account-text">
          <strong>{t('account.guestTitle')}</strong>
          <span className="muted small">{googleReady === false ? t('account.guestSoon') : t('account.guestText')}</span>
        </div>
      </div>
      {googleReady && <GoogleButton />}
    </section>
  );
}

/** En el inicio, para el invitado que ya tiene algo que perder. Se puede cerrar. */
export function SaveNudge() {
  const { kind, googleReady } = useAccount();
  const { profile } = useProfile();
  const [hidden, setHidden] = useState(nudgeDismissed);
  const hasProgress = Boolean(profile && (profile.coins > 0 || profile.achievements?.some((a) => a.unlockedAt)));
  if (hidden || kind !== 'guest' || !googleReady || !hasProgress) return null;
  return (
    <div className="save-nudge" role="note">
      <CloudIcon size={22} className="save-nudge-icon" />
      <span className="save-nudge-text">{t('account.nudge')}</span>
      <GoogleButton compact />
      <button
        type="button"
        className="icon-btn save-nudge-close"
        aria-label={t('account.nudgeClose')}
        onClick={() => {
          dismissNudge();
          setHidden(true);
        }}
      >
        <CloseIcon size={16} />
      </button>
    </div>
  );
}

function mergedLines(m: MergeSummary): string[] {
  const line = (n: number, one: MessageKey, many: MessageKey) => (n === 1 ? t(one) : t(many, { n }));
  const lines: string[] = [];
  if (m.coins > 0) lines.push(t('account.mergedCoins', { n: m.coins }));
  if (m.cards > 0) lines.push(line(m.cards, 'account.mergedCard', 'account.mergedCards'));
  if (m.titles > 0) lines.push(line(m.titles, 'account.mergedTitle', 'account.mergedTitles'));
  if (m.achievements > 0) lines.push(line(m.achievements, 'account.mergedAchievement', 'account.mergedAchievements'));
  if (m.games > 0) lines.push(line(m.games, 'account.mergedGame', 'account.mergedGames'));
  return lines;
}

const NOTICE_TEXT: Record<Exclude<AccountNotice['kind'], 'signedIn'>, [MessageKey, MessageKey]> = {
  cancelled: ['account.noticeCancelled', 'account.noticeCancelledText'],
  failed: ['account.noticeFailed', 'account.noticeFailedText'],
  signedOut: ['account.noticeSignedOut', 'account.noticeSignedOutText'],
  deleted: ['account.noticeDeleted', 'account.noticeDeletedText'],
};

/** Lo que ha pasado al volver de Google (o al cerrar sesión / borrar la cuenta). */
export function AccountNoticeDialog() {
  const { notice } = useAccount();
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!notice) return;
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearAccountNotice();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [notice]);
  if (!notice) return null;

  const good = notice.kind === 'signedIn';
  const [title, text] = good ? (['account.noticeSignedIn', null] as const) : NOTICE_TEXT[notice.kind];
  const lines = notice.kind === 'signedIn' && notice.merged ? mergedLines(notice.merged) : [];
  return (
    <div
      className="overlay overlay-confirm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-notice-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) clearAccountNotice();
      }}
    >
      <div className="overlay-card account-notice">
        <div className={`confirm-badge ${good ? 'account-badge-ok' : 'account-badge-info'}`} aria-hidden>
          <CloudIcon saved={good || notice.kind === 'signedOut'} size={30} />
        </div>
        <h2 id="account-notice-title" className="overlay-title confirm-title">
          {t(title)}
        </h2>
        {good ? (
          lines.length > 0 ? (
            <>
              <p className="muted">{t('account.noticeMerged')}</p>
              <ul className="account-merged">
                {lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="muted">{t('account.noticeSaved')}</p>
          )
        ) : (
          <p className="muted">{t(text!)}</p>
        )}
        <button ref={okRef} type="button" className="btn btn-primary btn-block" onClick={clearAccountNotice}>
          {t('account.ok')}
        </button>
      </div>
    </div>
  );
}
