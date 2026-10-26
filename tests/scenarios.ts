/**
 * Escenarios de reglas compartidos.
 * Se ejecutan contra el motor TypeScript (src/game/scenarios.test.ts) y contra las
 * funciones SQL reales del servidor (tests/integration/conformance.test.ts).
 * Si ambos motores dan el mismo resultado, las reglas no se han desincronizado.
 */
import type { ComodinKind, GameErrorCode, RoomConfig, RoomStatus } from '../src/game/types';

export type Step =
  | { play: [player: number, card: number]; error?: GameErrorCode }
  | { propose: number; error?: GameErrorCode }
  | { vote: [player: number, accept: boolean]; error?: GameErrorCode }
  | { shield: number; error?: GameErrorCode }
  | { pick: [player: number, kind: ComodinKind]; error?: GameErrorCode }
  | { ready: number }
  | { leave: number };

export interface Scenario {
  name: string;
  players: number;
  config?: Partial<RoomConfig>;
  /** Estado forzado tras iniciar la partida. */
  level: number;
  lives?: number;
  shurikens?: number;
  rewinds?: number;
  shields?: number;
  shieldActive?: boolean;
  hands: number[][];
  steps: Step[];
  expect: {
    status: RoomStatus;
    level?: number;
    lives?: number;
    shurikens?: number;
    rewinds?: number;
    shields?: number;
    shieldActive?: boolean;
    /** Votación en curso (su tipo) o null. */
    vote?: ComodinKind | null;
    /** Comodines ofrecidos para elegir (en orden alfabético) o null. */
    offer?: ComodinKind[] | null;
    /** Manos restantes por jugador (índices de jugadores que siguen en la sala). */
    hands?: number[][];
    pile?: number[];
    revealed?: number[];
    reward?: { lives: number; shurikens: number; rewinds: number; shields: number } | null;
  };
}

const NO_REWARD = { lives: 0, shurikens: 0, rewinds: 0, shields: 0 };

export const SCENARIOS: Scenario[] = [
  {
    name: 'jugadas correctas en orden ascendente',
    players: 3,
    level: 2,
    hands: [[5, 60], [17, 42], [81, 90]],
    steps: [{ play: [0, 5] }, { play: [1, 17] }, { play: [1, 42] }, { play: [0, 60] }],
    expect: { status: 'playing', lives: 3, hands: [[], [], [81, 90]], pile: [5, 17, 42, 60] },
  },
  {
    name: 'no se puede jugar una carta que no es la más baja de la propia mano',
    players: 2,
    level: 2,
    hands: [[10, 20], [30, 40]],
    steps: [{ play: [0, 20], error: 'NOT_LOWEST' }, { play: [0, 99], error: 'NOT_IN_HAND' }, { play: [1, 10], error: 'NOT_IN_HAND' }],
    expect: { status: 'playing', lives: 2, hands: [[10, 20], [30, 40]], pile: [] },
  },
  {
    name: 'error con una única carta inferior pendiente',
    players: 2,
    level: 1,
    hands: [[30], [50]],
    steps: [{ play: [1, 50] }],
    // Se descarta el 30; las manos quedan vacías → nivel superado.
    expect: { status: 'level_complete', lives: 1, hands: [[], []], pile: [50], revealed: [30], reward: NO_REWARD },
  },
  {
    name: 'error con varias cartas inferiores: una sola vida y se descartan todas',
    players: 3,
    level: 2,
    hands: [[18, 70], [25, 80], [40, 90]],
    steps: [{ play: [2, 40] }],
    expect: { status: 'playing', lives: 2, hands: [[70], [80], [90]], pile: [40], revealed: [18, 25] },
  },
  {
    name: 'un error descarta también varias cartas del mismo jugador',
    players: 2,
    level: 3,
    hands: [[3, 9, 77], [50, 60, 70]],
    steps: [{ play: [1, 50] }],
    expect: { status: 'playing', lives: 1, hands: [[77], [60, 70]], pile: [50], revealed: [3, 9] },
  },
  {
    name: 'derrota al quedarse sin vidas',
    players: 2,
    level: 2,
    lives: 1,
    hands: [[10, 20], [30, 40]],
    steps: [{ play: [1, 30] }, { play: [0, 10], error: 'NOT_PLAYING' }],
    expect: { status: 'lost', lives: 0 },
  },
  {
    name: 'nivel superado con premio de comodín: se ofrecen 2 para elegir (sin los que están al máximo)',
    players: 2,
    // Máximo 1 de cada comodín y ya tenéis 1 vistazo: se ofrecen Rebobinar y Escudo.
    config: { maxShurikens: 1 },
    level: 2,
    shurikens: 1,
    hands: [[1, 2], [3, 4]],
    steps: [{ play: [0, 1] }, { play: [0, 2] }, { play: [1, 3] }, { play: [1, 4] }],
    expect: { status: 'level_complete', level: 2, shurikens: 1, lives: 2, offer: ['rewind', 'shield'], reward: NO_REWARD },
  },
  {
    name: 'elegir comodín: cuando votan todos gana el más votado y después se pasa de nivel',
    players: 3,
    config: { maxShurikens: 1 },
    level: 2,
    shurikens: 1,
    hands: [[1, 2], [3, 4], [5, 6]],
    steps: [
      ...[[0, 1], [0, 2], [1, 3], [1, 4], [2, 5], [2, 6]].map((x) => ({ play: x as [number, number] })),
      { pick: [0, 'shuriken'], error: 'INVALID_STATE' },
      { ready: 0 },
      { ready: 1 },
      { ready: 2 }, // todos listos, pero falta elegir: todavía no se avanza
      { pick: [0, 'rewind'] },
      { pick: [0, 'shield'] }, // se puede cambiar el voto
      { pick: [1, 'rewind'] },
      { pick: [2, 'shield'] },
    ],
    expect: { status: 'playing', level: 3, shields: 1, rewinds: 0, shurikens: 1, offer: null },
  },
  {
    name: 'si solo queda un comodín posible se da directamente',
    players: 2,
    config: { maxShurikens: 1 },
    level: 2,
    shurikens: 1,
    rewinds: 1,
    hands: [[1], [2]],
    steps: [{ play: [0, 1] }, { play: [1, 2] }],
    expect: { status: 'level_complete', shields: 1, rewinds: 1, offer: null, reward: { ...NO_REWARD, shields: 1 } },
  },
  {
    name: 'con todos los comodines al máximo el premio no se aplica',
    players: 2,
    config: { maxShurikens: 1 },
    level: 2,
    shurikens: 1,
    rewinds: 1,
    shields: 1,
    hands: [[1], [2]],
    steps: [{ play: [0, 1] }, { play: [1, 2] }],
    expect: { status: 'level_complete', offer: null, reward: NO_REWARD },
  },
  {
    name: 'las recompensas no superan el máximo configurado',
    players: 2,
    config: { maxLives: 3 },
    level: 3,
    lives: 3,
    hands: [[1, 2, 3], [4, 5, 6]],
    steps: [{ play: [0, 1] }, { play: [0, 2] }, { play: [0, 3] }, { play: [1, 4] }, { play: [1, 5] }, { play: [1, 6] }],
    expect: { status: 'level_complete', lives: 3, reward: NO_REWARD },
  },
  {
    name: 'recompensas personalizadas: vidas y dos comodines a elegir, uno tras otro',
    players: 2,
    config: { rewardPreset: 'custom', customRewards: [{ level: 1, lives: 2, shurikens: 2 }], maxShurikens: 1 },
    level: 1,
    hands: [[1], [2]],
    steps: [{ play: [0, 1] }, { play: [1, 2] }, { pick: [0, 'rewind'] }, { pick: [1, 'rewind'] }],
    // Tras elegir Rebobinar solo queda Escudo por debajo del máximo: se da directamente.
    expect: {
      status: 'level_complete',
      lives: 4,
      shurikens: 1,
      rewinds: 1,
      shields: 1,
      offer: null,
      reward: { lives: 2, shurikens: 0, rewinds: 1, shields: 1 },
    },
  },
  {
    name: 'victoria al superar el último nivel',
    players: 4,
    level: 8,
    hands: [
      [1, 2, 3, 4, 5, 6, 7, 8],
      [11, 12, 13, 14, 15, 16, 17, 18],
      [21, 22, 23, 24, 25, 26, 27, 28],
      [31, 32, 33, 34, 35, 36, 37, 38],
    ],
    steps: [
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((c) => ({ play: [0, c] as [number, number] })),
      ...[11, 12, 13, 14, 15, 16, 17, 18].map((c) => ({ play: [1, c] as [number, number] })),
      ...[21, 22, 23, 24, 25, 26, 27, 28].map((c) => ({ play: [2, c] as [number, number] })),
      ...[31, 32, 33, 34, 35, 36, 37].map((c) => ({ play: [3, c] as [number, number] })),
      { play: [3, 38] },
    ],
    expect: { status: 'won', level: 8 },
  },
  {
    name: 'shuriken clásico: todos aceptan y cada uno descarta su carta más baja sin revelarla',
    players: 3,
    level: 3,
    hands: [[5, 50, 70], [8, 51, 71], [9, 52, 72]],
    steps: [{ propose: 0 }, { play: [0, 5], error: 'VOTE_IN_PROGRESS' }, { vote: [1, true] }, { vote: [2, true] }],
    expect: { status: 'playing', shurikens: 0, lives: 3, hands: [[50, 70], [51, 71], [52, 72]], revealed: [] },
  },
  {
    name: 'shuriken con revelación: las cartas descartadas se muestran',
    players: 2,
    config: { shurikenVariant: 'reveal' },
    level: 2,
    hands: [[5, 50], [8, 51]],
    steps: [{ propose: 1 }, { vote: [0, true] }],
    expect: { status: 'playing', shurikens: 0, hands: [[50], [51]], revealed: [5, 8] },
  },
  {
    name: 'shuriken rechazado: no se consume',
    players: 2,
    level: 2,
    hands: [[5, 50], [8, 51]],
    steps: [{ propose: 0 }, { vote: [1, false] }, { play: [0, 5] }],
    expect: { status: 'playing', shurikens: 1, hands: [[50], [8, 51]], pile: [5] },
  },
  {
    name: 'tras un rechazo no puedes repetir el shuriken hasta que se juegue una carta (los demás sí)',
    players: 2,
    level: 2,
    hands: [[5, 50], [8, 51]],
    steps: [
      { propose: 0 },
      { vote: [1, false] },
      { propose: 0, error: 'SHURIKEN_BLOCKED' },
      { propose: 1 },
      { vote: [0, false] },
      { propose: 1, error: 'SHURIKEN_BLOCKED' },
      { play: [0, 5] },
      { propose: 0 },
      { vote: [1, true] },
    ],
    // El shuriken final hace que cada uno descarte su carta más baja: 50 y 8.
    expect: { status: 'playing', shurikens: 0, hands: [[], [51]], pile: [5] },
  },
  {
    name: 'no se puede usar un shuriken si no queda ninguno',
    players: 2,
    level: 1,
    shurikens: 0,
    hands: [[5], [8]],
    steps: [{ propose: 0, error: 'NO_SHURIKENS' }, { vote: [1, true], error: 'NO_VOTE' }],
    expect: { status: 'playing', shurikens: 0, hands: [[5], [8]] },
  },
  {
    name: 'un shuriken que vacía las manos supera el nivel',
    players: 2,
    level: 1,
    hands: [[5], [8]],
    steps: [{ propose: 0 }, { vote: [1, true] }],
    expect: { status: 'level_complete', shurikens: 0 },
  },
  {
    name: 'petición repetida: la misma carta no se juega dos veces',
    players: 2,
    level: 2,
    hands: [[10, 20], [30, 40]],
    steps: [{ play: [0, 10] }, { play: [0, 10], error: 'NOT_IN_HAND' }],
    expect: { status: 'playing', lives: 2, hands: [[20], [30, 40]], pile: [10] },
  },
  {
    name: 'jugadas casi simultáneas: se procesan en orden y la segunda provoca el error',
    players: 2,
    level: 1,
    hands: [[41], [42]],
    // B pulsa 42 y A pulsa 41 "a la vez"; el servidor procesa primero la de B.
    steps: [{ play: [1, 42] }, { play: [0, 41], error: 'NOT_PLAYING' }],
    expect: { status: 'level_complete', lives: 1, pile: [42], revealed: [41] },
  },
  {
    name: 'un jugador abandona: sus cartas se descartan y la partida sigue',
    players: 3,
    level: 2,
    hands: [[5, 6], [7, 8], [9, 10]],
    steps: [{ leave: 1 }, { play: [0, 5] }],
    // Tras salir el jugador 1, los índices de manos son [jugador 0, jugador 2].
    expect: { status: 'playing', hands: [[6], [9, 10]] },
  },
  {
    name: 'si quedan menos de 2 jugadores la partida se abandona',
    players: 2,
    level: 1,
    hands: [[5], [8]],
    steps: [{ leave: 1 }],
    expect: { status: 'abandoned' },
  },

  // ───── Escudo ─────
  {
    name: 'escudo: todos aceptan y el siguiente error no cuesta vida (pero sí descarta)',
    players: 2,
    level: 2,
    shields: 1,
    hands: [[30, 80], [50, 90]],
    steps: [{ shield: 0 }, { play: [1, 50], error: 'VOTE_IN_PROGRESS' }, { vote: [1, true] }, { play: [1, 50] }],
    expect: { status: 'playing', lives: 2, shields: 0, shieldActive: false, hands: [[80], [90]], pile: [50], revealed: [30] },
  },
  {
    name: 'escudo: solo protege de UN error',
    players: 2,
    level: 3,
    shieldActive: true,
    hands: [[10, 30, 70], [20, 50, 90]],
    steps: [{ play: [1, 20] }, { play: [1, 50] }],
    expect: { status: 'playing', lives: 1, shieldActive: false, revealed: [10, 30] },
  },
  {
    name: 'escudo rechazado: no se gasta y quien lo propuso espera a que se juegue una carta',
    players: 2,
    level: 2,
    shields: 1,
    hands: [[5, 50], [8, 51]],
    steps: [{ shield: 0 }, { vote: [1, false] }, { shield: 0, error: 'SHURIKEN_BLOCKED' }, { propose: 0, error: 'SHURIKEN_BLOCKED' }],
    expect: { status: 'playing', shields: 1, shieldActive: false, vote: null },
  },
  {
    name: 'escudo: no se puede proponer sin escudos',
    players: 2,
    level: 2,
    shields: 0,
    hands: [[5, 50], [8, 51]],
    steps: [{ shield: 0, error: 'NO_SHIELDS' }],
    expect: { status: 'playing', shields: 0, vote: null },
  },
  {
    name: 'escudo: no se puede activar otro si ya hay uno activo',
    players: 2,
    level: 2,
    shields: 1,
    shieldActive: true,
    hands: [[5, 50], [8, 51]],
    steps: [{ shield: 1, error: 'SHIELD_ACTIVE' }],
    expect: { status: 'playing', shields: 1, shieldActive: true },
  },
  {
    name: 'el escudo dura solo el nivel en que se activa',
    players: 2,
    level: 1,
    shieldActive: true,
    hands: [[1], [2]],
    steps: [{ play: [0, 1] }, { play: [1, 2] }],
    expect: { status: 'level_complete', shieldActive: false },
  },

  // ───── Rebobinar ─────
  {
    name: 'rebobinar: tras perder una vida se vota y, si todos aceptan, se recupera',
    players: 2,
    level: 2,
    rewinds: 1,
    hands: [[30, 80], [50, 90]],
    steps: [
      { play: [1, 50] },
      { play: [0, 80], error: 'VOTE_IN_PROGRESS' },
      { propose: 0, error: 'VOTE_IN_PROGRESS' },
      { vote: [0, true] },
      { vote: [1, true] },
      { play: [0, 80] },
    ],
    expect: { status: 'playing', lives: 2, rewinds: 0, vote: null, hands: [[], [90]], pile: [50, 80], revealed: [30] },
  },
  {
    name: 'rebobinar rechazado: la vida se pierde, el comodín se guarda y se sigue jugando',
    players: 2,
    level: 2,
    rewinds: 1,
    hands: [[30, 80], [50, 90]],
    steps: [{ play: [1, 50] }, { vote: [0, true] }, { vote: [1, false] }, { play: [0, 80] }],
    expect: { status: 'playing', lives: 1, rewinds: 1, vote: null, pile: [50, 80] },
  },
  {
    name: 'rebobinar en la última vida: si se usa, la partida sigue',
    players: 2,
    level: 2,
    lives: 1,
    rewinds: 2,
    hands: [[30, 80], [50, 90]],
    steps: [{ play: [1, 50] }, { vote: [0, true] }, { vote: [1, true] }],
    expect: { status: 'playing', lives: 1, rewinds: 1, vote: null },
  },
  {
    name: 'rebobinar en la última vida: si no se usa, se pierde la partida',
    players: 2,
    level: 2,
    lives: 1,
    rewinds: 1,
    hands: [[30, 80], [50, 90]],
    steps: [{ play: [1, 50] }, { vote: [0, false] }, { play: [0, 80], error: 'NOT_PLAYING' }],
    expect: { status: 'lost', lives: 0, rewinds: 1 },
  },
  {
    name: 'rebobinar cuando el error vacía las manos: el nivel termina después de votar',
    players: 2,
    level: 1,
    rewinds: 1,
    hands: [[30], [50]],
    steps: [{ play: [1, 50] }, { vote: [0, true] }, { vote: [1, true] }],
    expect: { status: 'level_complete', lives: 2, rewinds: 0, vote: null, reward: NO_REWARD },
  },
  {
    name: 'con un escudo activo no se pierde vida, así que no se pregunta por rebobinar',
    players: 2,
    level: 2,
    rewinds: 1,
    shieldActive: true,
    hands: [[30, 80], [50, 90]],
    steps: [{ play: [1, 50] }],
    expect: { status: 'playing', lives: 2, rewinds: 1, shieldActive: false, vote: null },
  },
  {
    name: 'si alguien sale durante la votación de rebobinar, no se usa',
    players: 3,
    level: 2,
    lives: 1,
    rewinds: 1,
    hands: [[30, 80], [50, 90], [60, 95]],
    steps: [{ play: [1, 50] }, { vote: [0, true] }, { leave: 2 }],
    expect: { status: 'lost', rewinds: 1 },
  },

  // ───── Orden descendente (100 → 1). Las manos se escriben de menor a mayor. ─────
  {
    name: 'descendente: jugadas correctas de mayor a menor',
    players: 3,
    config: { order: 'desc' },
    level: 2,
    hands: [[5, 60], [17, 42], [81, 90]],
    steps: [{ play: [2, 90] }, { play: [2, 81] }, { play: [0, 60] }, { play: [1, 42] }],
    expect: { status: 'playing', lives: 3, hands: [[5], [17], []], pile: [90, 81, 60, 42] },
  },
  {
    name: 'descendente: hay que jugar primero la carta más alta de la mano',
    players: 2,
    config: { order: 'desc' },
    level: 2,
    hands: [[10, 20], [30, 40]],
    steps: [{ play: [0, 10], error: 'NOT_LOWEST' }, { play: [1, 30], error: 'NOT_LOWEST' }, { play: [0, 40], error: 'NOT_IN_HAND' }],
    expect: { status: 'playing', lives: 2, hands: [[10, 20], [30, 40]], pile: [] },
  },
  {
    name: 'descendente: error si alguien tenía cartas más altas (una vida, se descartan todas)',
    players: 3,
    config: { order: 'desc' },
    level: 2,
    hands: [[18, 70], [25, 80], [40, 90]],
    steps: [{ play: [0, 70] }],
    expect: { status: 'playing', lives: 2, hands: [[18], [25], [40]], pile: [70], revealed: [80, 90] },
  },
  {
    name: 'descendente: el shuriken descarta la carta más alta de cada uno',
    players: 2,
    config: { order: 'desc', shurikenVariant: 'reveal' },
    level: 2,
    hands: [[5, 50], [8, 51]],
    steps: [{ propose: 0 }, { vote: [1, true] }],
    expect: { status: 'playing', shurikens: 0, hands: [[5], [8]], revealed: [50, 51] },
  },
  {
    name: 'descendente: superar el último nivel da la victoria',
    players: 2,
    config: { order: 'desc', levels: 1 },
    level: 1,
    hands: [[30], [70]],
    steps: [{ play: [1, 70] }, { play: [0, 30] }],
    expect: { status: 'won', lives: 2, pile: [70, 30] },
  },
];
