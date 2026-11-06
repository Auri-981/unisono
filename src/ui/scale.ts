/**
 * Tamaño de la interfaz en ordenador. Sin esto, en un monitor grande o con el navegador alejado
 * todo se queda en un bloque pequeño en el centro. Aquí se agranda en proporción a la pantalla
 * (propiedad `zoom` de #root), de modo que siempre se vea como en una de BASE_WIDTH × BASE_HEIGHT.
 * Nunca se encoge: en pantallas pequeñas y móviles la escala es 1 y no cambia nada.
 *
 * Con `zoom`, las unidades vh/vw se escalarían de más, así que el CSS usa --vh y --vw: en móvil
 * valen 1dvh y 1vw (lo definido en :root), y aquí, el tamaño real entre la escala, en píxeles.
 */
const BASE_WIDTH = 1440;
const BASE_HEIGHT = 800;
const MIN_DESKTOP_WIDTH = 1024;
const MIN_DESKTOP_HEIGHT = 620;
const MAX_SCALE = 4;

/** Ancho útil a partir del cual caben las cartas decorativas junto a Ajustes y la sala de espera. */
const WIDE_FROM = 1500;
const EXTRA_WIDE_FROM = 1640;

function apply() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const desktop = width >= MIN_DESKTOP_WIDTH && height >= MIN_DESKTOP_HEIGHT;
  const fit = Math.min(width / BASE_WIDTH, height / BASE_HEIGHT);
  const scale = desktop ? Math.min(MAX_SCALE, Math.max(1, Math.floor(fit * 100) / 100)) : 1;

  const root = document.documentElement;
  if (scale > 1) {
    root.style.setProperty('--ui-scale', String(scale));
    root.style.setProperty('--vh', `${height / scale / 100}px`);
    root.style.setProperty('--vw', `${width / scale / 100}px`);
  } else {
    root.style.removeProperty('--ui-scale');
    root.style.removeProperty('--vh');
    root.style.removeProperty('--vw');
  }
  const useful = width / scale;
  root.toggleAttribute('data-ui-wide', useful >= WIDE_FROM);
  root.toggleAttribute('data-ui-extra-wide', useful >= EXTRA_WIDE_FROM);
}

export function startUiScale() {
  apply();
  window.addEventListener('resize', apply);
}
