/**
 * Tienda (comprar diseños de cartas y títulos con monedas) y Colección (equipar lo que se posee y
 * ver las cartas exclusivas que se ganan con logros). Todo lo decide el servidor: precios, saldo,
 * propiedad y progreso. Aquí solo se muestra y se pide.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { errorMessage, t } from '../../i18n';
import { api, type Achievement, type CatalogItem, type CoinMovement, type Profile } from '../../net/api';
import { onlineAvailable } from '../../net/supabase';
import { Card } from '../components/Card';
import { CardsIcon, CheckIcon, CoinIcon, LockIcon, ShopIcon, TitleIcon, TrophyIcon } from '../components/Icons';
import { Page, Toast } from '../components/Layout';
import { achievementNow, ProgressBar, RarityLabel, TitleTag } from '../components/Progression';
import { CoinBadge } from '../components/Resources';
import { PREVIEW_VALUES } from '../cosmetics';
import { usePrefs } from '../prefs';
import { buyCosmetic, equipCosmetic, equippedCardDesign, refreshProfile, unequipCosmetic, useProfile } from '../profile';
import { rich } from '../rich';

export type CosmeticTab = 'cards' | 'titles';

/** Tres cartas de ejemplo en abanico con un diseño. */
export function DesignFan({ design, size = 'md', className = '' }: { design: string; size?: 'md' | 'lg'; className?: string }) {
  return (
    <div className={`design-fan design-fan-${size} ${className}`} aria-hidden>
      {PREVIEW_VALUES.map((v) => (
        <Card key={v} value={v} size={size} design={design} label="" />
      ))}
    </div>
  );
}

/** Cómo se verá un título: el nombre del jugador y, debajo, el título. */
export function TitlePlate({ item, name, size = 'md' }: { item: CatalogItem; name?: string; size?: 'md' | 'lg' }) {
  const prefs = usePrefs();
  return (
    <div className={`title-plate title-plate-${size} rarity-${item.rarity ?? 'common'}`} aria-hidden>
      <span className="title-plate-name">{name ?? (prefs.name.trim() || t('shop.yourName'))}</span>
      <TitleTag title={item} />
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

/** Pestañas Cartas / Títulos (se cambia sin salir de la pantalla). */
function Tabs({ tab, onTab, labels }: { tab: CosmeticTab; onTab: (t: CosmeticTab) => void; labels: Record<CosmeticTab, string> }) {
  return (
    <div className="tabs" role="tablist" aria-label={t('shop.tabs')}>
      {(['cards', 'titles'] as const).map((k) => (
        <button key={k} type="button" role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'is-active' : ''}`} onClick={() => onTab(k)}>
          {k === 'cards' ? <CardsIcon size={18} /> : <TitleIcon size={18} />}
          {labels[k]}
        </button>
      ))}
    </div>
  );
}

/** Carga inicial y estados vacíos comunes a las pantallas del perfil. */
export function ProfileGate({ children, offline = t('shop.offline') }: { children: (profile: Profile) => ReactNode; offline?: string }) {
  const { profile, loading, error } = useProfile();
  if (!onlineAvailable) return <p className="notice notice-warn">{offline}</p>;
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

export function ShopScreen({
  onBack,
  onCollection,
  onAchievements,
  initialTab = 'cards',
}: {
  onBack: () => void;
  onCollection: () => void;
  onAchievements: () => void;
  initialTab?: CosmeticTab;
}) {
  const { profile, loading } = useProfile();
  const [tab, setTab] = useState<CosmeticTab>(initialTab);
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
            <Tabs tab={tab} onTab={setTab} labels={{ cards: t('shop.tab.cards'), titles: t('shop.tab.titles') }} />
            {tab === 'cards' ? (
              <>
                <ShopIntro profile={p} />
                <ul className="shop-grid">
                  {p.catalog
                    .filter((c) => c.kind === 'card_design' && c.unlock === 'coins')
                    .map((item) => (
                      <ShopItem key={item.id} item={item} profile={p} onOpen={() => setPreview(item)} />
                    ))}
                </ul>
                <ExclusiveTeaser profile={p} onAchievements={onAchievements} />
              </>
            ) : (
              <>
                <p className="muted shop-titles-intro">{t('shop.titlesIntro')}</p>
                <ul className="title-shop-list">
                  {p.catalog
                    .filter((c) => c.kind === 'title' && c.unlock === 'coins')
                    .map((item) => (
                      <TitleShopItem key={item.id} item={item} profile={p} onOpen={() => setPreview(item)} />
                    ))}
                </ul>
              </>
            )}
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
          onEquipped={(item) => {
            setPreview(null);
            setToast({
              tone: 'success',
              text: item.kind === 'title' ? t('collection.titleOn', { name: item.name }) : t('collection.equippedToast', { name: item.name }),
            });
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

/** Las cartas exclusivas no se venden: aquí solo se anuncian y se lleva a los logros. */
function ExclusiveTeaser({ profile, onAchievements }: { profile: Profile; onAchievements: () => void }) {
  const exclusive = profile.catalog.filter((c) => c.kind === 'card_design' && c.unlock === 'achievement');
  if (exclusive.length === 0) return null;
  return (
    <button type="button" className="exclusive-teaser" onClick={onAchievements}>
      <span className="exclusive-teaser-cards" aria-hidden>
        {exclusive.slice(0, 3).map((c, i) => (
          <Card key={c.id} value={[13, 58, 91][i]!} size="sm" design={c.id} label="" className={profile.owned.includes(c.id) ? '' : 'is-veiled'} />
        ))}
      </span>
      <span className="exclusive-teaser-text">
        <strong>{t('shop.exclusive')}</strong>
        <span className="muted small">{t('shop.exclusiveText', { n: exclusive.length })}</span>
      </span>
      <span className="exclusive-teaser-go">
        <TrophyIcon size={18} />
        {t('shop.toAchievements')}
      </span>
    </button>
  );
}

function PriceOrOwned({ item, profile, onOpen }: { item: CatalogItem; profile: Profile; onOpen: () => void }) {
  const owned = profile.owned.includes(item.id);
  const missing = Math.max(0, (item.price ?? 0) - profile.coins);
  return owned ? (
    <span className="badge badge-owned">
      <CheckIcon size={14} /> {t('shop.owned')}
    </span>
  ) : (
    <button type="button" className={`btn ${missing ? 'btn-secondary' : 'btn-primary'} btn-block shop-buy`} onClick={onOpen}>
      {missing ? t('shop.missing', { n: missing }) : t('shop.buy')}
    </button>
  );
}

function Price({ item }: { item: CatalogItem }) {
  return (
    <span className="price">
      <CoinIcon size={18} />
      {item.price ?? 0}
    </span>
  );
}

function ShopItem({ item, profile, onOpen }: { item: CatalogItem; profile: Profile; onOpen: () => void }) {
  const owned = profile.owned.includes(item.id);
  return (
    <li className={`shop-item ${owned ? 'is-owned' : ''}`}>
      <button type="button" className="shop-item-preview" onClick={onOpen} aria-label={t('shop.preview', { name: item.name })}>
        <DesignFan design={item.id} />
      </button>
      <div className="shop-item-body">
        <div className="shop-item-head">
          <h2 className="shop-item-name">{item.name}</h2>
          {!owned && <Price item={item} />}
        </div>
        <p className="muted small">{item.description}</p>
        <PriceOrOwned item={item} profile={profile} onOpen={onOpen} />
      </div>
    </li>
  );
}

function TitleShopItem({ item, profile, onOpen }: { item: CatalogItem; profile: Profile; onOpen: () => void }) {
  const owned = profile.owned.includes(item.id);
  return (
    <li className={`title-shop-item rarity-${item.rarity ?? 'common'} ${owned ? 'is-owned' : ''}`}>
      <button type="button" className="title-shop-preview" onClick={onOpen} aria-label={t('shop.preview', { name: item.name })}>
        <TitlePlate item={item} />
      </button>
      {!owned && <Price item={item} />}
      <p className="title-shop-desc muted small">{item.description}</p>
      <RarityLabel rarity={item.rarity} />
      <div className="title-shop-action">
        <PriceOrOwned item={item} profile={profile} onOpen={onOpen} />
      </div>
    </li>
  );
}

/** Vista ampliada con la compra confirmada desde aquí; tras comprar, «Desbloqueado». */
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
  onEquipped: (item: CatalogItem) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const isTitle = item.kind === 'title';
  const owned = profile.owned.includes(item.id);
  const equipped = profile.equipped[item.kind] === item.id;
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
    else onEquipped(item);
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
        {isTitle ? <TitlePlate item={item} size="lg" /> : <DesignFan design={item.id} size="lg" />}
        {isTitle && <RarityLabel rarity={item.rarity} />}
        <p className="muted">
          {unlocked ? t(isTitle ? 'shop.unlockedTitleText' : 'shop.unlockedText', { name: item.name }) : item.description}
        </p>
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

// ───────────────────────────── Colección ─────────────────────────────

/** Cómo se consiguió un cosmético (comprado, por un logro, el clásico…). */
function SourceBadge({ item, profile }: { item: CatalogItem; profile: Profile }) {
  const known = ['default', 'purchase', 'achievement', 'reward', 'event'] as const;
  const raw = profile.sources?.[item.id] ?? (item.unlock === 'default' ? 'default' : item.unlock === 'achievement' ? 'achievement' : 'purchase');
  const source = (known as readonly string[]).includes(raw) ? (raw as (typeof known)[number]) : 'reward';
  if (source === 'achievement') {
    const a = profile.achievements?.find((x) => x.id === item.achievement);
    return (
      <span className="source-badge source-achievement">
        <TrophyIcon size={13} />
        {t('collection.source.achievement', { name: a?.name ?? '' })}
      </span>
    );
  }
  return (
    <span className={`source-badge source-${source}`}>
      {source === 'purchase' && <CoinIcon size={13} />}
      {t(`collection.source.${source}`)}
    </span>
  );
}

export function CollectionScreen({
  onBack,
  onShop,
  onAchievements,
  initialTab = 'cards',
}: {
  onBack: () => void;
  onShop: (tab?: CosmeticTab) => void;
  onAchievements: () => void;
  initialTab?: CosmeticTab;
}) {
  const { profile, loading } = useProfile();
  const [tab, setTab] = useState<CosmeticTab>(initialTab);
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
      setToast({
        tone: 'success',
        text: item.kind === 'title' ? t('collection.titleOn', { name: item.name }) : t('collection.equippedToast', { name: item.name }),
      });
    }
  };
  const removeTitle = async () => {
    setBusy('none');
    const err = await unequipCosmetic('title');
    setBusy(null);
    if (err) setToast({ tone: 'danger', text: errorMessage(err) });
    else {
      setJustEquipped('none');
      setToast({ tone: 'success', text: t('collection.titleOff') });
    }
  };

  return (
    <Page title={t('collection.title')} onBack={onBack} actions={<CoinBadge coins={profile?.coins ?? null} loading={loading} />} className="page-shop">
      <ProfileGate>
        {(p) => (
          <>
            <Tabs tab={tab} onTab={setTab} labels={{ cards: t('collection.tab.cards'), titles: t('collection.tab.titles') }} />
            {tab === 'cards' ? (
              <CollectionCards profile={p} busy={busy} justEquipped={justEquipped} onEquip={equip} onShop={() => onShop('cards')} onAchievements={onAchievements} />
            ) : (
              <CollectionTitles
                profile={p}
                busy={busy}
                justEquipped={justEquipped}
                onEquip={equip}
                onRemove={removeTitle}
                onShop={() => onShop('titles')}
              />
            )}
          </>
        )}
      </ProfileGate>
      {toast && (
        <div className="toast-layer">
          <Toast tone={toast.tone} title={toast.text} />
        </div>
      )}
    </Page>
  );
}

function EquipButton({ on, busy, onClick, label = t('collection.equip') }: { on: boolean; busy: boolean; onClick: () => void; label?: string }) {
  return on ? (
    <span className="badge badge-equipped">
      <CheckIcon size={14} /> {t('collection.equipped')}
    </span>
  ) : (
    <button type="button" className="btn btn-secondary btn-block" disabled={busy} onClick={onClick}>
      {busy ? t('common.loading') : label}
    </button>
  );
}

function CollectionCards({
  profile: p,
  busy,
  justEquipped,
  onEquip,
  onShop,
  onAchievements,
}: {
  profile: Profile;
  busy: string | null;
  justEquipped: string | null;
  onEquip: (item: CatalogItem) => void;
  onShop: () => void;
  onAchievements: () => void;
}) {
  const designs = p.catalog.filter((c) => c.kind === 'card_design');
  const owned = designs.filter((c) => p.owned.includes(c.id));
  const locked = designs.filter((c) => !p.owned.includes(c.id) && c.unlock === 'achievement');
  const inShop = designs.filter((c) => !p.owned.includes(c.id) && c.unlock === 'coins').length;
  const current = equippedCardDesign(p);
  return (
    <>
      <p className="muted">{t('collection.intro')}</p>
      <h2 className="section-title">{t('collection.yours')}</h2>
      <ul className="collection-grid">
        {owned.map((item) => {
          const on = item.id === current;
          return (
            <li key={item.id} className={`collection-item rarity-${item.rarity ?? 'common'} ${on ? 'is-equipped' : ''} ${justEquipped === item.id ? 'just-equipped' : ''}`}>
              <DesignFan design={item.id} />
              <div className="collection-item-body">
                <h3 className="shop-item-name">{item.name}</h3>
                <SourceBadge item={item} profile={p} />
                <EquipButton on={on} busy={busy === item.id} onClick={() => onEquip(item)} />
              </div>
            </li>
          );
        })}
      </ul>
      {inShop > 0 && (
        <button type="button" className="collection-more" onClick={onShop}>
          <ShopIcon size={22} />
          <span>{inShop === 1 ? t('collection.moreOne') : t('collection.more', { n: inShop })}</span>
        </button>
      )}
      {locked.length > 0 && (
        <>
          <h2 className="section-title">{t('collection.locked')}</h2>
          <p className="muted small">{t('collection.lockedIntro')}</p>
          <ul className="locked-grid">
            {locked.map((item) => (
              <LockedDesign key={item.id} item={item} achievement={p.achievements?.find((a) => a.id === item.achievement)} onAchievements={onAchievements} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/** Diseño exclusivo aún sin conseguir: se intuye (oscurecido), con su requisito y el progreso. */
function LockedDesign({ item, achievement: a, onAchievements }: { item: CatalogItem; achievement?: Achievement; onAchievements: () => void }) {
  const now = a ? achievementNow(a) : null;
  return (
    <li className={`locked-item rarity-${item.rarity ?? 'common'}`}>
      <button type="button" className="locked-preview" onClick={onAchievements} aria-label={t('collection.unlockWith', { condition: a?.condition ?? '' })}>
        <DesignFan design={item.id} className="is-locked" />
        <span className="locked-lock" aria-hidden>
          <LockIcon size={22} />
        </span>
      </button>
      <div className="locked-body">
        <div className="shop-item-head">
          <h3 className="shop-item-name">{item.name}</h3>
          <RarityLabel rarity={item.rarity} />
        </div>
        <p className="muted small">{item.description}</p>
        {a && now && (
          <>
            <p className="locked-req">
              <TrophyIcon size={15} />
              <span>{t('collection.unlockWith', { condition: a.condition.charAt(0).toLowerCase() + a.condition.slice(1) })}</span>
            </p>
            <div className="ach-progress">
              <ProgressBar value={now.value} max={a.target} label={t('collection.progressAria', { n: now.value, target: a.target })} />
              <span className="ach-progress-text">
                {now.value}/{a.target}
              </span>
            </div>
          </>
        )}
      </div>
    </li>
  );
}

function CollectionTitles({
  profile: p,
  busy,
  justEquipped,
  onEquip,
  onRemove,
  onShop,
}: {
  profile: Profile;
  busy: string | null;
  justEquipped: string | null;
  onEquip: (item: CatalogItem) => void;
  onRemove: () => void;
  onShop: () => void;
}) {
  const titles = p.catalog.filter((c) => c.kind === 'title' && p.owned.includes(c.id));
  const current = p.equipped.title ?? null;
  return (
    <>
      <p className="muted">{t('collection.titlesIntro')}</p>
      {titles.length === 0 ? (
        <div className="empty-titles">
          <TitleIcon size={34} />
          <p>{t('collection.noTitles')}</p>
          <button type="button" className="btn btn-primary" onClick={onShop}>
            {t('collection.toShopTitles')}
          </button>
        </div>
      ) : (
        <>
          <h2 className="section-title">{t('collection.yourTitles')}</h2>
          <ul className="title-owned-list">
            <li className={`title-owned none ${current === null ? 'is-equipped' : ''} ${justEquipped === 'none' ? 'just-equipped' : ''}`}>
              <div className="title-owned-main">
                <span className="title-owned-name">{t('collection.noTitle')}</span>
                <span className="muted small">{t('collection.noTitleHint')}</span>
              </div>
              <EquipButton on={current === null} busy={busy === 'none'} onClick={onRemove} label={t('collection.unequip')} />
            </li>
            {titles.map((item) => (
              <li
                key={item.id}
                className={`title-owned rarity-${item.rarity ?? 'common'} ${current === item.id ? 'is-equipped' : ''} ${justEquipped === item.id ? 'just-equipped' : ''}`}
              >
                <div className="title-owned-main">
                  <TitlePlate item={item} />
                  <span className="muted small">{item.description}</span>
                  <SourceBadge item={item} profile={p} />
                </div>
                <EquipButton on={current === item.id} busy={busy === item.id} onClick={() => onEquip(item)} />
              </li>
            ))}
          </ul>
          <button type="button" className="collection-more" onClick={onShop}>
            <ShopIcon size={22} />
            <span>{t('collection.toShopTitles')}</span>
          </button>
        </>
      )}
    </>
  );
}
