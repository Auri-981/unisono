/**
 * Efectos de sonido sintetizados (sin archivos de audio) y vibración.
 * Opcionales y desactivables en Ajustes.
 */
import { getPrefs } from './prefs';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (!getPrefs().sound) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, duration: number, type: OscillatorType = 'sine', gain = 0.12) {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + start;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

export const sfx = {
  play: () => tone(660, 0, 0.12, 'sine', 0.08),
  mistake: () => {
    tone(196, 0, 0.35, 'triangle', 0.16);
    tone(147, 0.08, 0.4, 'triangle', 0.12);
  },
  levelComplete: () => [523, 659, 784].forEach((f, i) => tone(f, i * 0.09, 0.3)),
  won: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.5)),
  lost: () => [392, 330, 262].forEach((f, i) => tone(f, i * 0.16, 0.45, 'triangle')),
  shuriken: () => {
    tone(880, 0, 0.08, 'square', 0.04);
    tone(1320, 0.06, 0.12, 'square', 0.03);
  },
};

export function vibrate(pattern: number | number[]) {
  if (!getPrefs().vibration) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // iOS Safari no admite vibración: se ignora.
  }
}
