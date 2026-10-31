/**
 * Aspecto de los cosméticos (la parte visual vive en la app; el catálogo, los precios y quién
 * posee qué, en el servidor). Para añadir un diseño de cartas: fila en `public.cosmetics` (SQL)
 * + su id aquí + su bloque `.design-<id>` en global.css. Un id desconocido se ve como el clásico.
 */
export const CARD_DESIGNS = ['classic', 'galaxy', 'neon', 'emerald'] as const;
export type CardDesign = (typeof CARD_DESIGNS)[number];

export const isCardDesign = (id: string | null | undefined): id is CardDesign =>
  Boolean(id) && (CARD_DESIGNS as readonly string[]).includes(id!);

/** Clase CSS del diseño (vacía para el clásico o uno desconocido). */
export function designClass(id: string | null | undefined): string {
  return isCardDesign(id) && id !== 'classic' ? `design-${id}` : '';
}

/** Números de ejemplo para enseñar un diseño (una y dos cifras, frío y cálido). */
export const PREVIEW_VALUES = [7, 42, 96] as const;
