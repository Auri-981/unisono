/**
 * Tutorial por pasos para quien no ha jugado nunca: explica las reglas con ejemplos visuales,
 * sin necesidad de jugar. El selector de orden (1 → 100 / 100 → 1) adapta los ejemplos.
 */
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { CLASSIC_REWARDS, PLAYER_PRESETS } from '../../config/gameConfig';
import type { CardOrder, ComodinKind } from '../../game/types';
import { t, type MessageKey } from '../../i18n';
import { Card } from '../components/Card';
import { ComodinIcon, ComodinKindIcon, LifeIcon, LogoMark } from '../components/Icons';
import { Page } from '../components/Layout';
import { COMODIN_SYMBOL, LIFE_SYMBOL } from '../rewards';

/** Convierte «**texto**» en negrita (los textos del tutorial lo usan para destacar). */
function rich(text: string): ReactNode {
  return text.split('**').map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : <Fragment key={i}>{part}</Fragment>));
}

/** Texto que cambia según el orden (`clave.asc` / `clave.desc`). */
const byOrder = (key: string, order: CardOrder) => t(`${key}.${order}` as MessageKey);

// ───── Ejemplos ─────

/** Manos del ejemplo animado (en el orden en que se juegan). */
const GOAL_HANDS: Record<CardOrder, { name: string; cards: number[] }[]> = {
  asc: [
    { name: 'tutorial.you', cards: [18, 52] },
    { name: 'Lucía', cards: [25] },
    { name: 'Marcos', cards: [40] },
  ],
  desc: [
    { name: 'tutorial.you', cards: [75, 30] },
    { name: 'Lucía', cards: [52] },
    { name: 'Marcos', cards: [40] },
  ],
};

const playerName = (name: string) => (name.startsWith('tutorial.') ? t(name as MessageKey) : name);

/** Las cartas se van jugando en orden, una por segundo; se puede repetir. */
function GoalDemo({ order }: { order: CardOrder }) {
  const hands = GOAL_HANDS[order];
  const sequence = hands.flatMap((h) => h.cards).sort((a, b) => (order === 'asc' ? a - b : b - a));
  const [played, setPlayed] = useState(0);
  const [run, setRun] = useState(0);

  useEffect(() => {
    setPlayed(0);
    const id = window.setInterval(() => setPlayed((n) => (n >= sequence.length ? n : n + 1)), 1100);
    return () => window.clearInterval(id);
  }, [order, run, sequence.length]);

  const onTable = sequence.slice(0, played);
  return (
    <div className="tut-demo">
      <div className="tut-players">
        {hands.map((h) => (
          <div key={h.name} className="tut-player">
            <span className="tut-player-name">{playerName(h.name)}</span>
            <div className="tut-player-cards">
              {h.cards
                .filter((c) => !onTable.includes(c))
                .map((c) => (
                  <Card key={c} value={c} size="xs" />
                ))}
              {h.cards.every((c) => onTable.includes(c)) && <span className="tut-done">✓</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="tut-table">
        <span className="field-label">{t('tutorial.goal.table')}</span>
        <div className="tut-table-cards">
          {onTable.map((c, i) => (
            <Fragment key={c}>
              {i > 0 && <span className="tut-arrow">→</span>}
              <Card value={c} size="sm" className="tut-pop" />
            </Fragment>
          ))}
        </div>
      </div>
      <button type="button" className="btn btn-ghost btn-small" onClick={() => setRun((n) => n + 1)} disabled={played < sequence.length}>
        {t('tutorial.replay')}
      </button>
    </div>
  );
}

function HandDemo({ order }: { order: CardOrder }) {
  const hand = order === 'asc' ? [12, 31, 56, 90] : [88, 64, 20, 7];
  return (
    <div className="tut-hand">
      <div className="tut-hand-main">
        <Card value={hand[0]!} size="lg" className="hand-lowest" />
        <span className="tut-tap">{t('tutorial.hand.tap')}</span>
      </div>
      <div className="tut-hand-rest">
        {hand.slice(1).map((c) => (
          <Card key={c} value={c} size="sm" />
        ))}
      </div>
    </div>
  );
}

function MistakeDemo({ order }: { order: CardOrder }) {
  const discarded = order === 'asc' ? [18, 25] : [75, 52];
  return (
    <div className="tut-mistake">
      <div className="tut-mistake-col">
        <span className="field-label">{t('tutorial.mistake.played')}</span>
        <Card value={40} size="md" className="tut-shake" />
      </div>
      <div className="tut-mistake-col">
        <span className="field-label">{t('tutorial.mistake.discarded')}</span>
        <div className="tut-row">
          {discarded.map((c) => (
            <Card key={c} value={c} size="sm" muted />
          ))}
        </div>
      </div>
      <div className="tut-mistake-col tut-lives">
        <span className="field-label">{t('common.lives')}</span>
        <span className="tut-lives-row">
          <LifeIcon size={24} className="tut-life" />
          <LifeIcon size={24} className="tut-life tut-life-lost" />
          <span className="tut-minus">−1</span>
        </span>
      </div>
    </div>
  );
}

// ───── Pasos ─────

interface Step {
  title: MessageKey;
  body: (order: CardOrder) => ReactNode;
}

const COMODINES: ComodinKind[] = ['shuriken', 'shield', 'rewind'];

const STEPS: Step[] = [
  {
    title: 'tutorial.intro.title',
    body: () => (
      <>
        <div className="tut-visual tut-intro">
          <LogoMark size={64} />
          <div className="tut-fan">
            <Card value={1} size="md" />
            <Card value={50} size="md" />
            <Card value={100} size="md" />
          </div>
        </div>
        <p>{rich(t('tutorial.intro.text'))}</p>
        <p>{rich(t('tutorial.intro.text2'))}</p>
      </>
    ),
  },
  {
    title: 'tutorial.levels.title',
    body: () => (
      <>
        <p>{rich(t('tutorial.levels.text'))}</p>
        <table className="tut-levels">
          <thead>
            <tr>
              <th>{t('tutorial.levels.players')}</th>
              <th>{t('tutorial.levels.levels')}</th>
              <th>{t('tutorial.levels.lives')}</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(PLAYER_PRESETS).map(([n, p]) => (
              <tr key={n}>
                <td>{n}</td>
                <td>{p.levels}</td>
                <td>
                  <span className="resource resource-life">
                    <LifeIcon size={16} /> {p.lives}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">{t('tutorial.levels.note')}</p>
      </>
    ),
  },
  {
    title: 'tutorial.goal.title',
    body: (order) => (
      <>
        <p>{rich(byOrder('tutorial.goal.text', order))}</p>
        <GoalDemo order={order} />
        <p className="muted small">{t('tutorial.goal.note')}</p>
      </>
    ),
  },
  {
    title: 'tutorial.rule.title',
    body: (order) => (
      <>
        <div className="tut-visual">
          <div className="tut-bubble">
            <span>{t('tutorial.rule.bubble')}</span>
            <span className="tut-forbidden">{t('tutorial.rule.forbidden')}</span>
          </div>
        </div>
        <p>{rich(t('tutorial.rule.text'))}</p>
        <p className="tut-tip">{rich(byOrder('tutorial.rule.tip', order))}</p>
      </>
    ),
  },
  {
    title: 'tutorial.hand.title',
    body: (order) => (
      <>
        <HandDemo order={order} />
        <p>{rich(byOrder('tutorial.hand.text', order))}</p>
        <p className="muted small">{t('tutorial.hand.rest')}</p>
      </>
    ),
  },
  {
    title: 'tutorial.mistake.title',
    body: (order) => (
      <>
        <MistakeDemo order={order} />
        <p>{rich(byOrder('tutorial.mistake.text', order))}</p>
        <p>{rich(t('tutorial.mistake.text2'))}</p>
      </>
    ),
  },
  {
    title: 'tutorial.comodines.title',
    body: () => (
      <>
        <p>{rich(t('tutorial.comodines.text'))}</p>
        <ul className="tut-comodines">
          {COMODINES.map((kind) => (
            <li key={kind} className={`tut-comodin comodin-${kind}`}>
              <ComodinKindIcon kind={kind} size={30} />
              <div>
                <strong>{t(`comodin.${kind}`)}</strong>
                <span>{t(`tutorial.comodines.${kind}`)}</span>
              </div>
            </li>
          ))}
        </ul>
        <p className="muted small">{t('tutorial.comodines.how')}</p>
      </>
    ),
  },
  {
    title: 'tutorial.rewards.title',
    body: () => (
      <>
        <p>{rich(t('tutorial.rewards.text', { life: LIFE_SYMBOL, star: COMODIN_SYMBOL }))}</p>
        <p className="field-label">{t('tutorial.rewards.list')}</p>
        <div className="tut-rewards">
          {CLASSIC_REWARDS.map((r) => (
            <span key={r.level} className={`tut-reward ${r.lives ? 'tut-reward-life' : 'tut-reward-comodin'}`}>
              <span className="tut-reward-level">{r.level}</span>
              {r.lives ? <LifeIcon size={18} /> : <ComodinIcon size={18} />}
            </span>
          ))}
        </div>
        <p>{rich(t('tutorial.rewards.choose', { star: COMODIN_SYMBOL }))}</p>
        <div className="choose-cards tut-choose">
          {(['shield', 'rewind'] as const).map((kind) => (
            <div key={kind} className={`choose-card comodin-${kind}`}>
              <ComodinKindIcon kind={kind} size={28} className="choose-icon" />
              <span className="choose-name">{t(`comodin.${kind}`)}</span>
            </div>
          ))}
        </div>
        <p className="muted small">{t('tutorial.rewards.announce')}</p>
      </>
    ),
  },
  {
    title: 'tutorial.options.title',
    body: () => (
      <>
        <p>{t('tutorial.options.text')}</p>
        <ul className="tut-options">
          {(['order', 'difficulty', 'mode', 'variant', 'levels'] as const).map((k) => (
            <li key={k}>{rich(t(`tutorial.options.${k}`))}</li>
          ))}
        </ul>
      </>
    ),
  },
  {
    title: 'tutorial.end.title',
    body: () => (
      <>
        <div className="tut-visual">
          <LogoMark size={80} />
        </div>
        <p>{rich(t('tutorial.end.text'))}</p>
      </>
    ),
  },
];

export function TutorialScreen({
  onBack,
  onPractice,
  onCreate,
  canCreate,
}: {
  onBack: () => void;
  onPractice: () => void;
  onCreate: () => void;
  canCreate: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [order, setOrder] = useState<CardOrder>('asc');
  const touchX = useRef<number | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const step = STEPS[index]!;
  const last = index === STEPS.length - 1;
  const go = (i: number) => setIndex(Math.max(0, Math.min(STEPS.length - 1, i)));

  // Al cambiar de paso, se vuelve arriba del texto.
  useEffect(() => {
    bodyRef.current?.scrollIntoView({ block: 'nearest' });
    window.scrollTo({ top: 0 });
  }, [index]);

  // Flechas del teclado (ordenador).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(STEPS.length - 1, i + 1));
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Page title={t('tutorial.title')} onBack={onBack}>
      <div className="tutorial">
        <div className="field">
          <span className="field-label">{t('tutorial.order')}</span>
          <div className="segmented segmented-text" role="radiogroup" aria-label={t('tutorial.order')}>
            {(['asc', 'desc'] as const).map((o) => (
              <button key={o} type="button" role="radio" aria-checked={order === o} className={order === o ? 'is-on' : ''} onClick={() => setOrder(o)}>
                {o === 'asc' ? '1 → 100' : '100 → 1'}
              </button>
            ))}
          </div>
        </div>

        <div className="tut-dots" role="tablist" aria-label={t('tutorial.step', { n: index + 1, total: STEPS.length })}>
          {STEPS.map((s, i) => (
            <button
              key={s.title}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={t('tutorial.goTo', { n: i + 1 })}
              className={`tut-dot ${i === index ? 'is-on' : ''} ${i < index ? 'is-done' : ''}`}
              onClick={() => go(i)}
            />
          ))}
        </div>

        <section
          ref={bodyRef}
          className="tut-step"
          key={index}
          aria-live="polite"
          onTouchStart={(e) => (touchX.current = e.touches[0]?.clientX ?? null)}
          onTouchEnd={(e) => {
            const start = touchX.current;
            const end = e.changedTouches[0]?.clientX;
            touchX.current = null;
            if (start === null || end === undefined || Math.abs(end - start) < 60) return;
            go(index + (end < start ? 1 : -1));
          }}
        >
          <p className="tut-count">{t('tutorial.step', { n: index + 1, total: STEPS.length })}</p>
          <h2 className="tut-title">{t(step.title)}</h2>
          <div className="tut-body">{step.body(order)}</div>
        </section>

        {last ? (
          <div className="tut-actions tut-actions-end">
            <button type="button" className="btn btn-primary btn-large btn-block" onClick={onPractice}>
              {t('tutorial.end.practice')}
            </button>
            {canCreate && (
              <button type="button" className="btn btn-secondary btn-large btn-block" onClick={onCreate}>
                {t('tutorial.end.create')}
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-block" onClick={() => go(index - 1)}>
              {t('tutorial.prev')}
            </button>
          </div>
        ) : (
          <div className="tut-actions">
            <button type="button" className="btn btn-ghost" onClick={() => go(index - 1)} disabled={index === 0}>
              {t('tutorial.prev')}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => go(index + 1)}>
              {t('tutorial.next')}
            </button>
          </div>
        )}
      </div>
    </Page>
  );
}
