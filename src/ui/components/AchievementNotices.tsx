/**
 * Avisos de logros conseguidos, uno detrás de otro (cola). Salen de `profile.unseen`, que da el
 * servidor solo cuando el logro y sus premios ya están guardados. Cada aviso se marca como visto
 * al enseñarlo. Un logro que da una carta exclusiva tiene su propia presentación.
 *
 * No salen a mitad de nivel (la partida los retiene con `useHoldNotices`): aparecen al terminar
 * la partida, en la sala de espera o en el menú.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { errorMessage, t } from '../../i18n';
import type { Achievement, CatalogItem } from '../../net/api';
import { equipCosmetic, markAchievementsSeen, useProfile } from '../profile';
import { DesignFan } from '../screens/ShopScreens';
import { CheckIcon, CoinIcon } from './Icons';
import { CategoryIcon, RarityLabel } from './Progression';

const TOAST_MS = 4200;

// ── Retención (mientras se juega un nivel) ──
let holds = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

/** Mientras `active` sea true y el componente esté en pantalla, no salen avisos de logros. */
export function useHoldNotices(active: boolean) {
  useEffect(() => {
    if (!active) return;
    holds += 1;
    notify();
    return () => {
      holds -= 1;
      notify();
    };
  }, [active]);
}

function useNoticesHeld(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => holds > 0,
  );
}

export function AchievementNotices() {
  const { profile } = useProfile();
  const held = useNoticesHeld();
  const [current, setCurrent] = useState<Achievement | null>(null);

  const unseen = profile?.unseen ?? [];
  const nextId = unseen.find((id) => id !== current?.id);

  // Saca el siguiente de la cola cuando no hay ninguno en pantalla.
  useEffect(() => {
    if (held || current || !nextId || !profile) return;
    const a = profile.achievements?.find((x) => x.id === nextId);
    if (!a) {
      void markAchievementsSeen([nextId]);
      return;
    }
    setCurrent(a);
    void markAchievementsSeen([a.id]);
  }, [held, current, nextId, profile]);

  if (!current || !profile) return null;
  const card = current.rewardCosmetics
    .map((id) => profile.catalog.find((c) => c.id === id))
    .find((c): c is CatalogItem => c?.kind === 'card_design');
  const close = () => setCurrent(null);
  return card ? (
    <DesignUnlock key={current.id} a={current} card={card} onClose={close} />
  ) : (
    <AchievementToast key={current.id} a={current} onClose={close} />
  );
}

function AchievementToast({ a, onClose }: { a: Achievement; onClose: () => void }) {
  useEffect(() => {
    const id = window.setTimeout(onClose, TOAST_MS);
    return () => window.clearTimeout(id);
  }, [onClose]);
  return (
    <div className="ach-toast-layer" role="status" aria-live="polite">
      <button type="button" className={`ach-toast cat-${a.category}`} onClick={onClose} aria-label={`${t('ach.toast.kicker')} ${a.name}`}>
        <span className="ach-badge" aria-hidden>
          <CategoryIcon category={a.category} />
          <span className="ach-badge-mark">
            <CheckIcon size={11} />
          </span>
        </span>
        <span className="ach-toast-text">
          <span className="ach-toast-kicker">{t('ach.toast.kicker')}</span>
          <strong className="ach-toast-name">{a.name}</strong>
          <span className="ach-toast-desc">{a.condition}</span>
        </span>
        {a.rewardCoins > 0 && (
          <span className="ach-toast-coins">
            <CoinIcon size={16} />+{a.rewardCoins}
          </span>
        )}
        <span className="ach-toast-timer" style={{ animationDuration: `${TOAST_MS}ms` }} aria-hidden />
      </button>
    </div>
  );
}

/** Presentación especial: la carta exclusiva aparece desde el brillo del logro. */
function DesignUnlock({ a, card, onClose }: { a: Achievement; card: CatalogItem; onClose: () => void }) {
  const { profile } = useProfile();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const equipped = profile?.equipped.card_design === card.id;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const equip = async () => {
    setBusy(true);
    const err = await equipCosmetic(card.id);
    setBusy(false);
    setMsg(err ? errorMessage(err) : t('ach.unlock.equipped', { name: card.name }));
    if (!err) window.setTimeout(onClose, 1100);
  };

  return (
    <div
      className="overlay overlay-unlock"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unlock-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`overlay-card unlock-card rarity-${card.rarity ?? 'epic'}`}>
        <span className="unlock-rays" aria-hidden />
        <p className="preview-kicker">{t('ach.unlock.kicker')}</p>
        <h2 id="unlock-title" className="overlay-title">
          {card.name}
        </h2>
        <RarityLabel rarity={card.rarity} />
        <div className="unlock-fan">
          <DesignFan design={card.id} size="lg" />
        </div>
        <p className="muted">{t('ach.unlock.text', { name: a.name })}</p>
        {a.rewardCoins > 0 && (
          <p className="unlock-coins">
            <CoinIcon size={18} /> {t('ach.toast.coins', { n: a.rewardCoins })}
          </p>
        )}
        {msg && <p className="small">{msg}</p>}
        <div className="preview-actions">
          {equipped ? (
            <span className="badge badge-equipped">
              <CheckIcon size={14} /> {t('collection.equipped')}
            </span>
          ) : (
            <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => void equip()}>
              {t('ach.unlock.equip')}
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-block" onClick={onClose}>
            {t('ach.unlock.later')}
          </button>
        </div>
      </div>
    </div>
  );
}
