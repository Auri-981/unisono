import type { CSSProperties } from 'react';
import { designClass } from '../cosmetics';

/**
 * Tono de la carta: de azul frío (1) a ámbar cálido (100), pasando por violeta y rosa.
 * Ayuda a «sentir» el número. (CSS acepta tonos > 360: 380 ≡ 20, ámbar.)
 */
export function cardHue(value: number): number {
  const t = (Math.min(100, Math.max(1, value)) - 1) / 99;
  return Math.round(220 + t * 165);
}

interface CardProps {
  value: number;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  muted?: boolean;
  label?: string;
  /** Diseño de la carta (cosmético). Solo cambia el aspecto, nunca el valor ni el tamaño. */
  design?: string | null;
}

export function Card({ value, size = 'md', className = '', muted, label, design }: CardProps) {
  const style = { '--h': cardHue(value) } as CSSProperties;
  const skin = designClass(design);
  return (
    <div
      className={`card card-${size} ${skin} ${muted ? 'card-muted' : ''} ${className}`}
      style={style}
      aria-label={label ?? `Carta ${value}`}
    >
      {skin && <span className="card-art" aria-hidden />}
      <span className="card-corner card-corner-tl" aria-hidden>
        {value}
      </span>
      <span className="card-value" aria-hidden>
        {value}
      </span>
      <span className="card-corner card-corner-br" aria-hidden>
        {value}
      </span>
    </div>
  );
}

export function CardBacks({ count, max = 6 }: { count: number; max?: number }) {
  const shown = Math.min(count, max);
  return (
    <div className="card-backs" aria-hidden>
      {Array.from({ length: shown }, (_, i) => (
        <span key={i} className="card-back" />
      ))}
      {count > max && <span className="card-backs-more">+{count - max}</span>}
    </div>
  );
}
