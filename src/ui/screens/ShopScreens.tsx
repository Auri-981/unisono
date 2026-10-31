/**
 * Tienda (comprar diseños con monedas) y Mis cartas (equipar los que se poseen).
 * Todo lo decide el servidor: precios, saldo y propiedad. Aquí solo se muestra y se pide.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { errorMessage, t } from '../../i18n';
import { api, type CatalogItem, type CoinMovement, type Profile } from '../../net/api';
import { onlineAvailable } from '../../net/supabase';
import { Card } from '../components/Card';
import { CheckIcon, CoinIcon, ShopIcon } from '../components/Icons';
import { Page, Toast } from '../components/Layout';
import { CoinBadge } from '../components/Resources';
import { PREVIEW_VALUES } from '../cosmetics';
import { buyCosmetic, equipCosmetic, equippedCardDesign, refreshProfile, useProfile } from '../profile';
import { rich } from '../rich';

/** Tres cartas de ejemplo en abanico con un diseño. */
export function DesignFan({ design, size = 'md' }: { design: string; size?: 'md' | 'lg' }) {
  return (
    <div className={`design-fan design-fan-${size}`} aria-hidden>
      {PREVIEW_VALUES.map((v) => (
        <Card key={v} value={v} size={size} design={design} label="" />
      ))}
    </div>
  );
}

function useToast() {
  const [toast, setToast] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(id);
  }, [toast]);
  return [toast, setToast] as const;
}

/** Carga inicial y estados vacíos comunes a las dos pantallas. */
function ProfileGate({ children }: { children: (profile: Profile) => ReactNode }) {
  const { profile, loading, error } = useProfile();
  if (!onlineAvailable) return <p className="notice notice-warn">{t('shop.offline')}</p>;
  if (!profile) {
    if (error) {
      return (
        <div className="shop-state">
          <p className="notice notice-danger">{t('shop.loadError')}</p>
          <button type="button" className="btn btn-secondary" onClick={() => void refreshProfile()}>
            {t('common.retry')}
          </button>
        </div>
      );
    }
    return (
      <div className="shop-skeleton" aria-busy="true" aria-label={t('common.loading')}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="shop-skeleton-item" />
        ))}
      </div>
    );
  }
  return <>{children(profile)}{loading && <span className="sr-only">{t('common.loading')}</span>}</>;
}

// ───────────────────────────── Tienda ─────────────────────────────

export function ShopScreen({ onBack, onCollection }: { onBack: () => void; onCollection: () => void }) {
  const { profile, loading } = useProfile();
  const [preview, setPreview] = useState<CatalogItem | null>(null);
  const [toast, setToast] = useToast();

  useEffect(() => {
    void refreshProfile();
  }, []);

  return (
    <Page title={t('shop.title')} onBack={onBack} actions={<CoinBadge coins={profile?.coins ?? null} loading={loading} />} className="page-shop">
      <ProfileGate>
        {(p) => (
          <>
            <ShopIntro profile={p} />
            <ul className="shop-grid">
              {p.catalog
                .filter((c) => c.unlock === 'coins')
                .map((item) => (
                  <ShopItem key={item.id} item={item} profile={p} onOpen={() => setPreview(item)} />
                ))}
            </ul>
            <button type="button" className="btn btn-ghost btn-block" onClick={onCollection}>
              {t('shop.toCollection')}
            </button>
            <Movements coins={p.coins} />
          </>
        )}
      </ProfileGate>
      {preview && profile && (
        <PreviewDialog
          item={preview}
          profile={profile}
          onClose={() => setPreview(null)}
          onError={(code) => setToast({ tone: 'danger', text: errorMessage(code) })}
          onEquipped={(name) => {
            setPreview(null);
            setToast({ tone: 'success', text: t('collection.equippedToast', { name }) });
          }}
        />
      )}
      {toast && (
        <div className="toast-layer">
          <Toast tone={toast.tone} title={toast.text} />
        </div>
      )}
    </Page>
  );
}

function ShopIntro({ profile }: { profile: Profile }) {
  const r = profile.rewards;
  return (
    <section className="shop-intro">
      <ShopIcon size={26} className="shop-intro-icon" />
      <div>
        <p>{t('shop.intro')}</p>
        <details className="shop-how">
          <summary>{t('shop.how')}</summary>
          <ul>
            <li>{rich(t('shop.how.levels', { perLevel: r.perLevel, cards: r.cardsPerCoin }))}</li>
            <li>{rich(t('shop.how.participation', { n: r.participation }))}</li>
            <li>{rich(t('shop.how.victory', { cards: r.victoryCardsPerCoin }))}</li>
            <li className="muted">{t('shop.how.practice')}</li>
          </ul>
        </details>
      </div>
    </section>
  );
}

function ShopItem({ item, profile, onOpen }: { item: CatalogItem; profile: Profile; onOpen: () => void }) {
  const owned = profile.owned.includes(item.id);
  const price = item.price ?? 0;
  const missing = Math.max(0, price - profile.coins);
  return (
    <li className={`shop-item ${owned ? 'is-owned' : ''}`}>
      <button type="button" className="shop-item-preview" onClick={onOpen} aria-label={t('shop.preview', { name: item.name })}>
        <DesignFan design={item.id} />
      </button>
      <div className="shop-item-body">
        <div className="shop-item-head">
          <h2 className="shop-item-name">{item.name}</h2>
          {!owned && (
            <span className="price">
              <CoinIcon size={18} />
              {price}
            </span>
          )}
        </div>
        <p className="muted small">{item.description}</p>
        {owned ? (
          <span className="badge badge-owned">
            <CheckIcon size={14} /> {t('shop.owned')}
          </span>
        ) : (
          <button type="button" className={`btn ${missing ? 'btn-secondary' : 'btn-primary'} btn-block shop-buy`} onClick={onOpen}>
            {missing ? t('shop.missing', { n: missing }) : t('shop.buy')}
          </button>
        )}
      </div>
    </li>
  );
}

/** Vista ampliada (7, 42 y 96) con la compra confirmada desde aquí; tras comprar, «Desbloqueado». */
function PreviewDialog({
  item,
  profile,
  onClose,
  onError,
  onEquipped,
}: {
  item: CatalogItem;
  profile: Profile;
  onClose: () => void;
  onError: (code: string) => void;
  onEquipped: (name: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const owned = profile.owned.includes(item.id);
  const equipped = equippedCardDesign(profile) === item.id;
  const price = item.price ?? 0;
  const missing = Math.max(0, price - profile.coins);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const buy = async () => {
    setBusy(true);
    const err = await buyCosmetic(item.id);
    setBusy(false);
    if (err) onError(err);
    else setUnlocked(true);
  };
  const equip = async () => {
    setBusy(true);
    const err = await equipCosmetic(item.id);
    setBusy(false);
    if (err) onError(err);
    else onEquipped(item.name);
  };

  return (
    <div
      className="overlay overlay-preview"
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className={`overlay-card preview-card ${unlocked ? 'is-unlocked' : ''}`}>
        {unlocked && <div className="burst" aria-hidden />}
        {unlocked && <p className="preview-kicker">{t('shop.unlocked')}</p>}
        <h2 id="preview-title" className="overlay-title">
          {item.name}
        </h2>
        <DesignFan design={item.id} size="lg" />
        <p className="muted">{unlocked ? t('shop.unlockedText', { name: item.name }) : item.description}</p>
        {unlocked || owned ? (
          <div className="preview-actions">
            {equipped ? (
              <span className="badge badge-equipped">
                <CheckIcon size={14} /> {t('collection.equipped')}
              </span>
            ) : (
              <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => void equip()}>
                {t('shop.equipNow')}
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-block" disabled={busy} onClick={onClose}>
              {t('shop.keepLooking')}
            </button>
          </div>
        ) : (
          <div className="preview-actions">
            {missing > 0 ? (
              <p className="shop-missing">{t('shop.missingLong', { n: missing })}</p>
            ) : (
              <button type="button" className="btn btn-primary btn-large btn-block" disabled={busy} onClick={() => void buy()}>
                {busy ? (
                  t('shop.buying')
                ) : (
                  <>
                    {t('shop.buyFor')} <CoinIcon size={20} /> {price}
                  </>
                )}
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-block" disabled={busy} onClick={onClose}>
              {t('common.close')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Últimos movimientos de monedas (se recargan cuando cambia el saldo). */
function Movements({ coins }: { coins: number }) {
  const [list, setList] = useState<CoinMovement[] | null>(null);
  useEffect(() => {
    api.coinHistory().then(setList, () => setList(null));
  }, [coins]);
  if (!list) return null;
  return (
    <section className="movements">
      <h2 className="field-label">{t('shop.movements')}</h2>
      {list.length === 0 ? (
        <p className="muted small">{t('shop.noMovements')}</p>
      ) : (
        <ul>
          {list.slice(0, 8).map((m, i) => (
            <li key={i}>
              <span className={`movement-amount ${m.amount > 0 ? 'is-plus' : 'is-minus'}`}>
                {m.amount > 0 ? `+${m.amount}` : m.amount}
              </span>
              <span className="movement-reason">{m.reason}</span>
              <span className="muted small">{new Date(m.at).toLocaleDateString('es-ES')}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ───────────────────────────── Mis cartas ─────────────────────────────

export function CollectionScreen({ onBack, onShop }: { onBack: () => void; onShop: () => void }) {
  const { profile, loading } = useProfile();
  const [busy, setBusy] = useState<string | null>(null);
  const [justEquipped, setJustEquipped] = useState<string | null>(null);
  const [toast, setToast] = useToast();

  useEffect(() => {
    void refreshProfile();
  }, []);

  const equip = async (item: CatalogItem) => {
    setBusy(item.id);
    const err = await equipCosmetic(item.id);
    setBusy(null);
    if (err) setToast({ tone: 'danger', text: errorMessage(err) });
    else {
      setJustEquipped(item.id);
      setToast({ tone: 'success', text: t('collection.equippedToast', { name: item.name }) });
    }
  };

  return (
    <Page title={t('collection.title')} onBack={onBack} actions={<CoinBadge coins={profile?.coins ?? null} loading={loading} />} className="page-shop">
      <ProfileGate>
        {(p) => {
          const designs = p.catalog.filter((c) => c.kind === 'card_design');
          const owned = designs.filter((c) => p.owned.includes(c.id));
          const locked = designs.length - owned.length;
          const current = equippedCardDesign(p);
          return (
            <>
              <p className="muted">{t('collection.intro')}</p>
              <ul className="collection-grid">
                {owned.map((item) => {
                  const on = item.id === current;
                  return (
                    <li key={item.id} className={`collection-item ${on ? 'is-equipped' : ''} ${justEquipped === item.id ? 'just-equipped' : ''}`}>
                      <DesignFan design={item.id} />
                      <div className="collection-item-body">
                        <h2 className="shop-item-name">{item.name}</h2>
                        {on ? (
                          <span className="badge badge-equipped">
                            <CheckIcon size={14} /> {t('collection.equipped')}
                          </span>
                        ) : (
                          <button type="button" className="btn btn-secondary btn-block" disabled={busy !== null} onClick={() => void equip(item)}>
                            {busy === item.id ? t('common.loading') : t('collection.equip')}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {locked > 0 && (
                <button type="button" className="collection-more" onClick={onShop}>
                  <ShopIcon size={22} />
                  <span>{locked === 1 ? t('collection.moreOne') : t('collection.more', { n: locked })}</span>
                </button>
              )}
            </>
          );
        }}
      </ProfileGate>
      {toast && (
        <div className="toast-layer">
          <Toast tone={toast.tone} title={toast.text} />
        </div>
      )}
    </Page>
  );
}
