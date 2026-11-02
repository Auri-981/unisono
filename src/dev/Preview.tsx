/**
 * Solo en desarrollo (`npm run dev`): muestra pantallas con estados de ejemplo sin servidor.
 * Uso: http://localhost:5173/?preview=lobby | mistake | won | lost | vote | shieldvote | shieldon | rewind | rewindlast | pick | picked
 *      | lightning | lightninglow | lightningalert | lightningnext | lightninglost
 *      | final | finalpeek | finalalert | finalnext | finallost  (+ «hard»: finalalerthard, finalnexthard, finallosthard)
 *      | lobbyguest | shop | shoptitles | shoprich | collection | collectiontitles | achievements | profile | achtoast | achunlock
 *      | designs | gallery | wonreward | lostreward | noreward | kicked
 *      | profileguest | profilegoogle | settingsguest | settingsgoogle | homeguest | privacy
 *      | accmerged | accsignedin | acccancelled | accsignedout  (ventanas al volver de Google)
 * No se incluye en la web publicada.
 */
import type { RoomController } from '../game/controller';
import * as E from '../game/engine';
import { seededRng } from '../game/testing';
import { GameScreen } from '../ui/screens/game/GameScreen';
import { LobbyScreen } from '../ui/screens/LobbyScreen';
import { KickedScreen } from '../ui/screens/KickedScreen';
import { CollectionScreen, ShopScreen } from '../ui/screens/ShopScreens';
import type { MatchReward, PlayerTitle } from '../game/types';
import type { Achievement, CatalogItem, Profile } from '../net/api';
import { AchievementNotices } from '../ui/components/AchievementNotices';
import { AchievementsScreen, ProfileScreen } from '../ui/screens/ProgressScreens';
import { previewProfile } from '../ui/profile';
import { previewAccount } from '../ui/account';
import { AccountNoticeDialog } from '../ui/components/Account';
import { HomeScreen } from '../ui/screens/HomeScreen';
import { SettingsScreen } from '../ui/screens/InfoScreens';
import { PrivacyScreen } from '../ui/screens/PrivacyScreen';
import { Card } from '../ui/components/Card';
import { CARD_DESIGNS } from '../ui/cosmetics';

/** Catálogo de ejemplo (el de verdad está en el servidor). */
const DEMO_CATALOG: CatalogItem[] = [
  { id: 'classic', kind: 'card_design', name: 'Clásico', description: 'El diseño de siempre: papel cálido y el color de cada número.', price: null, unlock: 'default', rarity: 'common', available: true },
  { id: 'galaxy', kind: 'card_design', name: 'Galaxia', description: 'Cartas llegadas del espacio profundo: nebulosas, estrellas y polvo cósmico.', price: 10, unlock: 'coins', rarity: 'common', available: true },
  { id: 'neon', kind: 'card_design', name: 'Neón', description: 'Rejilla futurista, bordes eléctricos y números que brillan en la oscuridad.', price: 30, unlock: 'coins', rarity: 'rare', available: true },
  { id: 'emerald', kind: 'card_design', name: 'Esmeralda', description: 'Terciopelo verde, filigrana dorada y acabado de joya. El más exclusivo de la tienda.', price: 50, unlock: 'coins', rarity: 'epic', available: true },
  { id: 'obsidian', kind: 'card_design', name: 'Obsidiana', description: 'Piedra volcánica pulida, vetas de magma y filos de acero. Solo para quien ya es de la casa.', price: null, unlock: 'achievement', rarity: 'rare', available: true, achievement: 'games_15' },
  { id: 'aurora', kind: 'card_design', name: 'Aurora', description: 'Cortinas de luz boreal sobre un cielo polar. Brilla como cada victoria.', price: null, unlock: 'achievement', rarity: 'epic', available: true, achievement: 'wins_10' },
  { id: 'chrono', kind: 'card_design', name: 'Crono', description: 'Esfera de reloj, engranajes de plata y el tiempo bajo control. El tiempo no espera a nadie; tú tampoco.', price: null, unlock: 'achievement', rarity: 'epic', available: true, achievement: 'clean_10' },
  { id: 'phoenix', kind: 'card_design', name: 'Fénix', description: 'Plumas de fuego y oro que renacen en cada partida. Para quien nunca se rinde.', price: null, unlock: 'achievement', rarity: 'legendary', available: true, achievement: 'wins_25' },
  { id: 'transcendence', kind: 'card_design', name: 'Trascendencia', description: 'Geometría celeste, marfil y oro. El diseño más difícil de conseguir.', price: null, unlock: 'achievement', rarity: 'legendary', available: true, achievement: 'achievements_20' },
  ...(
    [
      ['apprentice', 'Aprendiz', 10, 'common', 'Todos empezamos por la primera carta.'],
      ['observer', 'Observador', 20, 'common', 'Nada se le escapa: ni una mirada, ni un titubeo.'],
      ['strategist', 'Estratega', 35, 'common', 'Cada carta, en su momento justo.'],
      ['visionary', 'Visionario', 50, 'rare', 'Ve venir el siguiente número antes que nadie.'],
      ['mastermind', 'Mente Maestra', 75, 'rare', 'Piensa tres jugadas por delante.'],
      ['unstoppable', 'Imparable', 100, 'rare', 'Nivel tras nivel, sin pisar el freno.'],
      ['legend', 'Leyenda', 150, 'epic', 'Sus partidas se cuentan en la sala de espera.'],
      ['chosen', 'El Elegido', 200, 'epic', 'Las cartas parecen buscarle.'],
      ['oracle', 'Oráculo', 250, 'epic', 'Sabe qué número viene sin que nadie lo diga.'],
      ['timekeeper', 'Maestro del Tiempo', 300, 'legendary', 'Domina el silencio entre carta y carta.'],
      ['sync', 'Sincronía Perfecta', 400, 'legendary', 'Cuando juega, el equipo late a la vez.'],
      ['last_mind', 'La Última Mente', 500, 'legendary', 'La leyenda que cierra cada partida.'],
    ] as const
  ).map(([id, name, price, rarity, description]): CatalogItem => ({ id: `title_${id}`, kind: 'title', name, description, price, unlock: 'coins', rarity, available: true })),
];

function ach(
  id: string,
  category: Achievement['category'],
  name: string,
  description: string,
  condition: string,
  target: number,
  progress: number,
  rewardCoins: number,
  extra: Partial<Achievement> = {},
): Achievement {
  return {
    id, category, name, description, condition, target, progress: Math.min(progress, target), streak: null, rewardCoins, rewardCosmetics: [],
    unlockedAt: progress >= target ? new Date(Date.now() - 86_400_000 * 3).toISOString() : null, secret: false, ...extra,
  };
}

/** Logros de ejemplo (unos conseguidos, otros a medias y otros sin empezar). */
const DEMO_ACHIEVEMENTS: Achievement[] = [
  ach('games_1', 'games', 'Primera conexión', 'Toda gran aventura empieza con una partida.', 'Termina tu primera partida online', 1, 12, 5),
  ach('games_15', 'games', 'Ya eres de la casa', 'Parece que esto empieza a gustarte.', 'Termina 15 partidas online', 15, 12, 15, { rewardCosmetics: ['obsidian'] }),
  ach('games_50', 'games', 'Adicto a las cartas', 'Una partida más nunca hace daño.', 'Termina 50 partidas online', 50, 12, 30),
  ach('wins_1', 'wins', 'Primera victoria', 'El primer «¡lo conseguimos!» nunca se olvida.', 'Gana una partida', 1, 7, 10),
  ach('wins_10', 'wins', 'Coleccionista de victorias', 'Ganar ya no es casualidad.', 'Gana 10 partidas', 10, 7, 25, { rewardCosmetics: ['aurora'] }),
  ach('wins_25', 'wins', 'Imparable', 'Cuando os ponéis, no hay quien os pare.', 'Gana 25 partidas', 25, 7, 50, { rewardCosmetics: ['phoenix'] }),
  ach('win_streak_3', 'wins', 'En racha', 'Una, dos y tres. ¿Quién os para?', 'Gana 3 partidas seguidas (una derrota corta la racha)', 3, 2, 20, { streak: 1 }),
  ach('levels_50', 'progress', 'Mente en crecimiento', 'Tu intuición ya no es la del primer día.', 'Supera 50 niveles en total', 50, 41, 20),
  ach('hard_win', 'progress', 'Mente extraordinaria', 'Una vida, sin vistazos y la ronda final a muerte súbita. Y aun así.', 'Gana una partida en dificultad Difícil', 1, 0, 50),
  ach('safe_5', 'skill', 'Sin margen de error', 'Ni una vida perdida en cinco niveles.', 'Supera 5 niveles seguidos sin perder ninguna vida', 5, 5, 15),
  ach('clean_10', 'skill', 'Precisión absoluta', 'Diez niveles seguidos sin un solo error. Ni siquiera con escudo.', 'Supera 10 niveles seguidos sin ningún error', 10, 7, 30, { streak: 6, rewardCosmetics: ['chrono'] }),
  ach('duo_win', 'team', 'Dos mentes, una', 'Solo vosotros dos, en perfecta sintonía.', 'Gana una partida de 5 niveles o más con 2 jugadores', 1, 1, 10),
  ach('group_5', 'team', 'Unidos hasta el final', 'Este grupo ya no necesita palabras.', 'Gana 5 partidas con exactamente el mismo grupo de jugadores', 5, 3, 30),
  ach('early_bird', 'special', 'Madrugador', 'Mientras otros duermen, tú juegas.', 'Termina una partida entre las 6:00 y las 9:00 (hora de España)', 1, 0, 10),
  ach('achievements_20', 'special', 'La mente definitiva', 'Lo has visto todo. O casi.', 'Consigue 20 logros', 20, 5, 100, { rewardCosmetics: ['transcendence'] }),
];

/**
 * Perfil de ejemplo. shop: 34 monedas, Galaxia y dos títulos · shoprich: 120 y nada comprado ·
 * achtoast / achunlock: con logros recién conseguidos (aviso normal / carta exclusiva).
 */
function demoProfile(kind: string): Profile {
  const rich = kind === 'shoprich';
  const unlocked = kind === 'achunlock' ? DEMO_ACHIEVEMENTS.map((a) => (a.id === 'clean_10' ? { ...a, progress: 10, streak: 10, unlockedAt: new Date().toISOString() } : a)) : DEMO_ACHIEVEMENTS;
  return {
    coins: rich ? 120 : 34,
    equipped: rich ? { card_design: 'classic' } : { card_design: 'galaxy', title: 'title_observer' },
    owned: rich ? ['classic'] : ['classic', 'galaxy', 'title_apprentice', 'title_observer', ...(kind === 'achunlock' ? ['chrono'] : [])],
    sources: { classic: 'default', galaxy: 'purchase', title_apprentice: 'purchase', title_observer: 'purchase', chrono: 'achievement' },
    catalog: DEMO_CATALOG,
    rewards: { perLevel: 1, cardsPerCoin: 2, participation: 2, victoryCardsPerCoin: 4, minCardsPlayed: 1 },
    stats: { games: 12, wins: 7, levels: 41, bestWinStreak: 2, bestCleanStreak: 7 },
    achievements: rich ? DEMO_ACHIEVEMENTS.map((a) => ({ ...a, progress: 0, streak: a.streak === null ? null : 0, unlockedAt: null })) : unlocked,
    unseen: kind === 'achtoast' ? ['wins_1', 'safe_5'] : kind === 'achunlock' ? ['clean_10'] : [],
  };
}

/** Recompensa de ejemplo para la pantalla final. */
const DEMO_REWARD: Record<string, MatchReward | null> = {
  wonreward: { coins: 118, balanceBefore: 34, balanceAfter: 152, breakdown: { players: 4, maxLevel: 8, levelsCompleted: 8, won: true, participation: 2, levels: 80, victory: 36, total: 118 } },
  lostreward: { coins: 22, balanceBefore: 34, balanceAfter: 56, breakdown: { players: 4, maxLevel: 8, levelsCompleted: 3, won: false, participation: 2, levels: 20, victory: 0, total: 22 } },
  noreward: null,
};

const NOW = Date.now();
const noop = async () => {};

function build(variant: string): E.EngineState {
  // Sufijo «hard»: la misma pantalla en dificultad Difícil (p. ej. finalalerthard, finallosthard).
  const hard = variant.endsWith('hard');
  const kind = hard ? variant.slice(0, -4) : variant;
  let s = E.createRoom({
    id: 'demo',
    code: 'K7MPQ',
    hostId: 'me',
    hostName: 'Rubén',
    config: { mode: 'friends', ...(hard ? { difficulty: 'hard' as const } : {}) },
    now: NOW,
  });
  for (const [id, name] of [['a', 'Lucía'], ['b', 'Marcos'], ['c', 'Ainhoa']] as const) {
    const r = E.addPlayer(s, id, name, NOW);
    if (r.ok) s = r.state;
  }
  if (kind === 'lobby' || kind === 'lobbyguest') {
    s.players[1]!.ready = true;
    // lobbyguest: la sala vista por quien no es anfitrión (Lucía crea la sala).
    if (kind === 'lobbyguest') s.hostId = 'a';
    return s;
  }
  for (const p of s.players) p.ready = true;
  const started = E.startGame(s, 'me', seededRng(3), NOW - 10000);
  if (started.ok) s = started.state;
  // Sin ronda relámpago salvo en sus propios ejemplos.
  s.lightningLevel = 0;
  s.lightningEndsAt = null;
  s.level = 4;
  s.hands = { me: [18, 52, 77, 90], a: [25, 61, 70], b: [40, 44, 99], c: [9, 66, 81] };
  const step = (r: E.EngineResult) => {
    if (r.ok) s = r.state;
  };
  step(E.playCard(s, 'c', 9, NOW));
  if (kind === 'mistake') step(E.playCard(s, 'b', 40, NOW));
  if (kind === 'vote') step(E.proposeShuriken(s, 'a', NOW));
  if (kind === 'lost') {
    s.lives = 1;
    step(E.playCard(s, 'b', 40, NOW));
  }
  if (kind === 'big' || kind === 'bigvote') {
    // Nivel 11 de 2 jugadores con muchas cartas y varias descartadas (peor caso de espacio).
    s.players = s.players.slice(0, 2);
    s.level = 11;
    s.maxLevel = 12;
    s.hands = { me: [25, 37, 57, 58, 60, 64, 69, 86, 89, 94], a: [26, 30, 41, 50, 52, 70, 71, 80, 95] };
    s.pile = [{ c: 11, p: 'a' }, { c: 14, p: 'me' }];
    s.revealed = [3, 5, 9, 12, 13].map((c) => ({ c, p: 'a', r: 'mistake' as const }));
    if (kind === 'bigvote') step(E.proposeShuriken(s, 'a', NOW));
  }
  if (kind === 'reward') {
    s.level = 3; // nivel con premio (+1 vida) en la tabla clásica
    s.hands = { me: [18, 52, 77], a: [25, 61, 70], b: [40, 44, 99], c: [66, 81, 90] };
    s.recentEvents = [];
    s.lastEvent = null;
  }
  if (kind === 'levelup') {
    s.level = 1;
    s.hands = { me: [], a: [], b: [], c: [] };
    s.status = 'level_complete';
    s.lastReward = { level: 1, lives: 0, shurikens: 0 };
    s.lastEvent = null;
  }
  if (kind === 'blocked') {
    // A «me» le han rechazado el shuriken: no puede repetirlo hasta que se juegue una carta.
    step(E.proposeShuriken(s, 'me', NOW));
    step(E.voteShuriken(s, 'a', false, NOW));
  }
  if (kind === 'shieldvote') {
    s.shields = 1;
    step(E.proposeShield(s, 'a', NOW));
  }
  if (kind === 'shieldon') {
    s.shields = 1;
    s.shieldActive = true;
  }
  if (kind === 'rewind' || kind === 'rewindlast') {
    s.rewinds = 1;
    s.shields = 1;
    if (kind === 'rewindlast') s.lives = 1;
    step(E.playCard(s, 'b', 40, NOW));
    step(E.voteShuriken(s, 'a', true, NOW));
  }
  if (kind === 'pick' || kind === 'picked') {
    s.level = 2;
    s.hands = { me: [10, 11], a: [20, 21], b: [30, 31], c: [40, 41] };
    for (const [p, c] of [['me', 10], ['me', 11], ['a', 20], ['a', 21], ['b', 30], ['b', 31], ['c', 40], ['c', 41]] as const) {
      step(E.playCard(s, p, c, NOW - 4000, seededRng(4)));
    }
    s.lastEvent = null;
    step(E.pickComodin(s, 'a', 2, s.offer!.choices[0]!, seededRng(5), NOW - 4000));
    if (kind === 'picked') {
      for (const p of ['me', 'b', 'c']) step(E.pickComodin(s, p, 2, s.offer!.choices[1]!, seededRng(5), NOW - 4000));
      s.players.find((p) => p.id === 'a')!.ready = true;
    }
  }
  if (kind.startsWith('lightning')) {
    // lightning: reloj en marcha · lightninglow: últimos segundos · lightningalert: el aviso al empezar
    // lightningnext: «nivel superado» antes de la ronda · lightninglost: se acabó el tiempo
    s.lightningLevel = 4;
    const left = kind === 'lightninglow' ? 8 : kind === 'lightningalert' ? 75 : 47;
    s.lightningEndsAt = new Date(NOW + left * 1000).toISOString();
    if (kind === 'lightningalert') {
      s.pile = [];
      s.hands = { me: [18, 52, 77, 90], a: [9, 25, 61, 70], b: [40, 44, 99, 100], c: [3, 66, 81, 85] };
      s.eventSeq += 1;
      s.lastEvent = { seq: s.eventSeq, kind: 'level_start', actor: null, payload: { level: 4 }, at: new Date(NOW).toISOString() };
      s.recentEvents = [s.lastEvent];
    }
    if (kind === 'lightningnext') {
      s.level = 3;
      s.hands = { me: [], a: [], b: [], c: [] };
      s.status = 'level_complete';
      s.lightningEndsAt = null;
      s.lastReward = { level: 3, lives: 1, shurikens: 0 };
      s.lastEvent = null;
    }
    if (kind === 'lightninglost') {
      s.lightningEndsAt = new Date(NOW - 5000).toISOString();
      step(E.expireVote(s, NOW - 4000));
    }
  }
  if (kind.startsWith('final')) {
    // final: mesa a ciegas con las cartas ya tapadas · finalpeek: la última carta aún a la vista
    // finalalert: el aviso al empezar · finalnext: «nivel superado» justo antes · finallost: derrota en la final
    s.level = s.maxLevel;
    s.hands = { me: [18, 52, 77, 90], a: [25, 61, 70], b: [40, 44, 99], c: [9, 66, 81] };
    s.pile = [];
    s.pileAt = null;
    s.revealed = [];
    s.recentEvents = [];
    s.lastEvent = null;
    if (kind === 'finalalert') {
      s.eventSeq += 1;
      s.lastEvent = { seq: s.eventSeq, kind: 'level_start', actor: null, payload: { level: s.level }, at: new Date(NOW).toISOString() };
      s.recentEvents = [s.lastEvent];
    } else if (kind === 'finalnext') {
      s.level = s.maxLevel - 1;
      s.hands = { me: [], a: [], b: [], c: [] };
      s.status = 'level_complete';
      s.lastReward = { level: s.level, lives: 1, shurikens: 0 };
    } else {
      step(E.playCard(s, 'c', 9, NOW - 9000));
      step(E.playCard(s, 'me', 18, kind === 'finalpeek' ? NOW : NOW - 6000));
      // Dos descartadas de un fallo anterior, para ver que no chocan con el montón.
      s.revealed = [{ c: 30, p: 'a', r: 'mistake' }, { c: 47, p: 'b', r: 'mistake' }];
      if (kind === 'finallost') {
        s.lives = hard ? 3 : 1; // en Difícil se pierden las 3 de golpe
        step(E.playCard(s, 'b', 40, NOW - 4000));
      }
    }
  }
  if (kind === 'designs') {
    // Cada jugador con su diseño: tu mano en Galaxia; en la mesa, la de Ainhoa (Esmeralda) y la de Marcos (Neón).
    step(E.playCard(s, 'b', 40, NOW));
    s.revealed = [];
  }
  if (kind === 'wonreward' || kind === 'lostreward' || kind === 'noreward') {
    s.status = kind === 'wonreward' ? 'won' : 'lost';
    if (kind === 'wonreward') s.level = s.maxLevel;
    s.recentEvents = [];
    s.lastEvent = null;
  }
  if (kind === 'won') {
    s.status = 'won';
    s.level = s.maxLevel;
  }
  return s;
}

function accountPreview(kind: string) {
  const google = kind.endsWith('google');
  previewAccount({ kind: google ? 'google' : 'guest', email: google ? 'ana.garcia@gmail.com' : null, googleReady: true });
  previewProfile(demoProfile('profile'));
  if (kind.startsWith('profile')) return <ProfileScreen onBack={noop} onCollection={noop} onAchievements={noop} onSettings={noop} />;
  if (kind.startsWith('settings')) return <SettingsScreen onBack={noop} onPrivacy={noop} />;
  if (kind === 'privacy') return <PrivacyScreen onBack={noop} />;
  if (kind === 'homeguest') {
    try {
      localStorage.removeItem('unisono.saveNudge');
    } catch {
      // Sin almacenamiento: el aviso sale igual.
    }
    return (
      <HomeScreen
        message={null}
        onCreate={noop}
        onJoin={noop}
        onPractice={noop}
        onTutorial={noop}
        onSettings={noop}
        onHistory={noop}
        onShop={noop}
        onCollection={noop}
        onAchievements={noop}
        onProfile={noop}
      />
    );
  }
  const notices = {
    accmerged: { kind: 'signedIn', merged: { coins: 85, cards: 2, titles: 1, achievements: 6, games: 9 } },
    accsignedin: { kind: 'signedIn', merged: null },
    acccancelled: { kind: 'cancelled' },
    accsignedout: { kind: 'signedOut' },
  } as const;
  previewAccount({ kind: 'google', notice: notices[kind as keyof typeof notices] });
  return (
    <>
      <SettingsScreen onBack={noop} onPrivacy={noop} />
      <AccountNoticeDialog />
    </>
  );
}

const ACCOUNT_PREVIEWS = ['profileguest', 'profilegoogle', 'settingsguest', 'settingsgoogle', 'homeguest', 'privacy', 'accmerged', 'accsignedin', 'acccancelled', 'accsignedout'];

export function Preview({ kind }: { kind: string }) {
  if (ACCOUNT_PREVIEWS.includes(kind)) return accountPreview(kind);
  if (kind === 'kicked') return <KickedScreen code="J7S7E" onHome={noop} onCreate={noop} />;
  if (kind === 'gallery') {
    // Todos los diseños, con números de una y dos cifras, fríos y cálidos, en cada tamaño.
    return (
      <div className="page" style={{ gap: 18 }}>
        {CARD_DESIGNS.map((d) => (
          <div key={d} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 10 }}>
            <strong style={{ width: '100%' }}>{d}</strong>
            {[1, 7, 42, 77, 100].map((v) => (
              <Card key={v} value={v} size="lg" design={d} />
            ))}
            <Card value={64} size="xl" design={d} />
            <Card value={23} size="md" design={d} />
            <Card value={58} size="sm" design={d} />
            <Card value={91} size="xs" design={d} />
          </div>
        ))}
      </div>
    );
  }
  if (['shop', 'shoptitles', 'shoprich', 'collection', 'collectiontitles', 'achievements', 'profile', 'achtoast', 'achunlock'].includes(kind)) {
    previewProfile(demoProfile(kind));
    const tab = kind.endsWith('titles') ? 'titles' : 'cards';
    if (kind.startsWith('collection')) return <CollectionScreen initialTab={tab} onBack={noop} onShop={noop} onAchievements={noop} />;
    if (kind === 'achievements') return <AchievementsScreen onBack={noop} />;
    if (kind === 'profile') return <ProfileScreen onBack={noop} onCollection={noop} onAchievements={noop} onSettings={noop} />;
    if (kind === 'achtoast' || kind === 'achunlock') return <AchievementNotices />;
    return <ShopScreen initialTab={tab} onBack={noop} onCollection={noop} onAchievements={noop} />;
  }
  previewProfile(demoProfile('shop'));
  const s = build(kind);
  const snapshot = E.toSnapshot(s, 'me', NOW);
  if (kind === 'designs') {
    const designs: Record<string, string> = { me: 'galaxy', a: 'classic', b: 'neon', c: 'emerald' };
    for (const p of snapshot.players) p.cardDesign = designs[p.id];
  }
  if (kind in DEMO_REWARD) snapshot.myReward = DEMO_REWARD[kind];
  // Títulos de ejemplo (Marcos no lleva ninguno).
  const titles: Record<string, PlayerTitle> = {
    me: { id: 'title_observer', name: 'Observador', rarity: 'common' },
    a: { id: 'title_legend', name: 'Leyenda', rarity: 'epic' },
    c: { id: 'title_last_mind', name: 'La Última Mente', rarity: 'legendary' },
  };
  for (const p of snapshot.players) p.title = titles[p.id] ?? null;
  const ctl: RoomController = {
    kind: 'online',
    snapshot,
    connection: 'online',
    onlineIds: new Set(['me', 'a', 'c']),
    clockOffset: 0,
    chat: [],
    notice: null,
    busy: false,
    actions: {
      playCard: noop,
      proposeShuriken: noop,
      proposeShield: noop,
      voteShuriken: noop,
      pickComodin: noop,
      expireVote: noop,
      readyNextLevel: noop,
      setLobbyReady: noop,
      updateConfig: noop,
      startGame: noop,
      kick: noop,
      rematch: noop,
      leave: noop,
      sendChat: noop,
    },
  };
  return kind === 'lobby' || kind === 'lobbyguest' ? <LobbyScreen ctl={ctl} /> : <GameScreen ctl={ctl} onExit={() => {}} />;
}
