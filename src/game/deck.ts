import { DECK_SIZE } from '../config/gameConfig';
import type { PlayerId } from './types';

/** Generador de números en [0, 1). Inyectable para poder hacer pruebas reproducibles. */
export type Rng = () => number;

/** Aleatoriedad criptográfica del navegador / Node. */
export const cryptoRng: Rng = () => {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0]! / 2 ** 32;
};

/** Baraja ordenada con las cartas 1..100. */
export function createDeck(): number[] {
  return Array.from({ length: DECK_SIZE }, (_, i) => i + 1);
}

/** Mezcla Fisher–Yates (uniforme). Devuelve una copia. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Reparte `cardsEach` cartas a cada jugador, en rueda, desde una baraja mezclada.
 * Las manos se devuelven ordenadas de menor a mayor.
 */
export function deal(playerIds: readonly PlayerId[], cardsEach: number, rng: Rng): Record<PlayerId, number[]> {
  const needed = playerIds.length * cardsEach;
  if (needed > DECK_SIZE) {
    throw new Error(`No hay cartas suficientes: ${needed} > ${DECK_SIZE}`);
  }
  const deck = shuffle(createDeck(), rng);
  const hands: Record<PlayerId, number[]> = {};
  for (const id of playerIds) hands[id] = [];
  for (let i = 0; i < needed; i++) {
    hands[playerIds[i % playerIds.length]!]!.push(deck[i]!);
  }
  for (const id of playerIds) hands[id]!.sort((a, b) => a - b);
  return hands;
}
