/**
 * Escenarios de reglas compartidos.
 * Se ejecutan contra el motor TypeScript (src/game/scenarios.test.ts) y contra las
 * funciones SQL reales del servidor (tests/integration/conformance.test.ts).
 * Si ambos motores dan el mismo resultado, las reglas no se han desincronizado.
 */
import type { GameErrorCode, RoomConfig, RoomStatus } from '../src/game/types';

export type Step =
  | { play: [player: number, card: number]; error?: GameErrorCode }
  | { propose: number; error?: GameErrorCode }
  | { vote: [player: number, accept: boolean]; error?: GameErrorCode }
  | { leave: number };

export interface Scenario {
  name: string;
  players: number;
  config?: Partial<RoomConfig>;
  /** Estado forzado tras iniciar la partida. */
  level: number;
  lives?: number;
  shurikens?: number;
  hands: number[][];
  steps: Step[];
  expect: {
    status: RoomStatus;
    level?: number;
    lives?: number;
    shurikens?: number;
    /** Manos restantes por jugador (índices de jugadores que siguen en la sala). */
    hands?: number[][];
    pile?: number[];
    revealed?: number[];
    reward?: { lives: number; shurikens: number } | null;
  };
}

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
    expect: { status: 'level_complete', lives: 1, hands: [[], []], pile: [50], revealed: [30], reward: { lives: 0, shurikens: 0 } },
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
    name: 'nivel superado con recompensa clásica (nivel 2 → +1 shuriken)',
    players: 2,
    level: 2,
    shurikens: 1,
    hands: [[1, 2], [3, 4]],
    steps: [{ play: [0, 1] }, { play: [0, 2] }, { play: [1, 3] }, { play: [1, 4] }],
    expect: { status: 'level_complete', level: 2, shurikens: 2, lives: 2, reward: { lives: 0, shurikens: 1 } },
  },
  {
    name: 'las recompensas no superan el máximo configurado',
    players: 2,
    config: { maxLives: 3 },
    level: 3,
    lives: 3,
    hands: [[1, 2, 3], [4, 5, 6]],
    steps: [{ play: [0, 1] }, { play: [0, 2] }, { play: [0, 3] }, { play: [1, 4] }, { play: [1, 5] }, { play: [1, 6] }],
    expect: { status: 'level_complete', lives: 3, reward: { lives: 0, shurikens: 0 } },
  },
  {
    name: 'recompensas personalizadas',
    players: 2,
    config: { rewardPreset: 'custom', customRewards: [{ level: 1, lives: 2, shurikens: 1 }] },
    level: 1,
    hands: [[1], [2]],
    steps: [{ play: [0, 1] }, { play: [1, 2] }],
    expect: { status: 'level_complete', lives: 4, shurikens: 2, reward: { lives: 2, shurikens: 1 } },
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
];
