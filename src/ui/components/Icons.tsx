/** Iconos SVG propios (sin dependencias). Heredan el color con `currentColor`. */
import type { SVGProps } from 'react';
import type { ComodinKind } from '../../game/types';

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = (size = 20): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  'aria-hidden': true,
  focusable: false,
});

export const LifeIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path
      d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2Z"
      fill="currentColor"
    />
    <path d="M6.5 12.5h3l1.2-2.2 1.8 4.4 1.3-2.2h3.7" stroke="var(--bg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Vistazo: un ojo abierto (el recurso que permite «echar un vistazo» y descartar). */
export const VistazoIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M12 5.5c-5.1 0-8.9 3.6-10.3 6.5 1.4 2.9 5.2 6.5 10.3 6.5s8.9-3.6 10.3-6.5C20.9 9.1 17.1 5.5 12 5.5Z" fill="currentColor" />
    <circle cx="12" cy="12" r="4.3" fill="var(--bg)" />
    <circle cx="12" cy="12" r="2.4" fill="currentColor" />
    <circle cx="13.1" cy="10.9" r="0.8" fill="var(--bg)" />
  </svg>
);

/** Escudo: protege del siguiente error del nivel. */
export const ShieldIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M12 2.8 4.5 5.6v5.6c0 4.8 3.2 8.6 7.5 10 4.3-1.4 7.5-5.2 7.5-10V5.6L12 2.8Z" fill="currentColor" />
    <path d="m8.6 12.1 2.4 2.4 4.6-4.8" stroke="var(--bg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Rebobinar: flecha que vuelve atrás (recupera la vida perdida). */
export const RewindIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M5.2 8.5A8 8 0 1 1 4 13" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    <path d="M3.6 3.8v5.4H9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M12 8.2v4.3l2.8 1.7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Comodín sin especificar (premio a elegir): una estrella de cuatro puntas. */
export const ComodinIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M12 2.5c.7 4.6 2.9 6.8 7.5 7.5v.1c-4.6.7-6.8 2.9-7.5 7.5h-.1c-.7-4.6-2.9-6.8-7.5-7.5V10c4.6-.7 6.8-2.9 7.5-7.5h.1Z" fill="currentColor" />
    <circle cx="18.5" cy="18.5" r="2" fill="currentColor" opacity="0.7" />
  </svg>
);

/** Icono de un comodín concreto. */
export const ComodinKindIcon = ({ kind, ...p }: P & { kind: ComodinKind }) =>
  kind === 'shuriken' ? <VistazoIcon {...p} /> : kind === 'rewind' ? <RewindIcon {...p} /> : <ShieldIcon {...p} />;

export const CrownIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="m3.5 8 4.5 4 4-6 4 6 4.5-4-1.8 10H5.3L3.5 8Z" fill="currentColor" />
  </svg>
);

export const CheckIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const CopyIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <rect x="8" y="8" width="12" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
    <path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

export const LinkIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export const ShareIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5 12v6.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export const ExitIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M14 4H7.5A2.5 2.5 0 0 0 5 6.5v11A2.5 2.5 0 0 0 7.5 20H14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M11 12h9m-3.5-3.5L20 12l-3.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const ChatIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M5 5.5h14A1.5 1.5 0 0 1 20.5 7v8.5A1.5 1.5 0 0 1 19 17h-7l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
  </svg>
);

export const BackIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M15 5 8 12l7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Ronda relámpago: un rayo. */
export const LightningIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M13.5 2.5 5 13.5h6l-1.5 8 8.5-11h-6l1.5-8Z" fill="currentColor" strokeLinejoin="round" />
  </svg>
);

/** Moneda del juego: un disco dorado con la marca de la carta. */
export const CoinIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="12" cy="12" r="9.5" fill="var(--coin, #f5c84c)" />
    <circle cx="12" cy="12" r="7.2" fill="none" stroke="var(--coin-dark, #b8861f)" strokeWidth="1.4" />
    <rect x="10" y="8.2" width="4" height="7.6" rx="1" fill="var(--coin-dark, #b8861f)" opacity="0.85" />
    <path d="M7.6 7.4a6.5 6.5 0 0 1 4.4-2" stroke="#fff7d6" strokeWidth="1.3" strokeLinecap="round" opacity="0.8" />
  </svg>
);

/** Tienda: una bolsa. */
export const ShopIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M5 8.5h14l-1.2 11a1.6 1.6 0 0 1-1.6 1.5H7.8a1.6 1.6 0 0 1-1.6-1.5L5 8.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M9 10.5V7a3 3 0 0 1 6 0v3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

/** Colección de cartas: tres cartas en abanico. */
export const CardsIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <rect x="3.5" y="6" width="9" height="13" rx="1.8" transform="rotate(-12 8 12.5)" stroke="currentColor" strokeWidth="1.6" opacity="0.6" />
    <rect x="11.5" y="6" width="9" height="13" rx="1.8" transform="rotate(12 16 12.5)" stroke="currentColor" strokeWidth="1.6" opacity="0.6" />
    <rect x="7.5" y="4" width="9" height="14" rx="1.8" fill="var(--surface, #1b2040)" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

/** Logros: una copa con asas. */
export const TrophyIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M7.5 4.5h9v4.2a4.5 4.5 0 0 1-9 0V4.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M7.5 6.5H5a2.6 2.6 0 0 0 2.9 3.7M16.5 6.5H19a2.6 2.6 0 0 1-2.9 3.7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M12 13.2V17m-3.5 2.5h7M9.8 17h4.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

/** Habilidad: una diana con su centro. */
export const TargetIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
    <circle cx="12" cy="12" r="4.4" stroke="currentColor" strokeWidth="1.7" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
  </svg>
);

/** Cooperación: dos personas juntas. */
export const TeamIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="9" cy="8.5" r="3" stroke="currentColor" strokeWidth="1.7" />
    <path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <circle cx="16.2" cy="9.3" r="2.4" stroke="currentColor" strokeWidth="1.6" opacity="0.75" />
    <path d="M15.6 14.2c2.4-.3 4.3 1.2 4.9 4.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.75" />
  </svg>
);

/** Especiales: un destello de cuatro puntas con otro pequeño. */
export const SparkIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M10.5 3.5c.5 4.1 2.3 6 6.5 6.5-4.2.5-6 2.4-6.5 6.5-.5-4.1-2.3-6-6.5-6.5 4.2-.5 6-2.4 6.5-6.5Z" fill="currentColor" />
    <path d="M17.5 14.5c.2 1.8 1 2.6 2.8 2.8-1.8.2-2.6 1-2.8 2.8-.2-1.8-1-2.6-2.8-2.8 1.8-.2 2.6-1 2.8-2.8Z" fill="currentColor" opacity="0.7" />
  </svg>
);

/** Bloqueado: un candado. */
export const LockIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <rect x="5.5" y="10.5" width="13" height="9.5" rx="2.2" stroke="currentColor" strokeWidth="1.8" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="12" cy="15.2" r="1.3" fill="currentColor" />
  </svg>
);

/** Perfil: la silueta de una persona. */
export const ProfileIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="12" cy="8.5" r="3.6" stroke="currentColor" strokeWidth="1.8" />
    <path d="M5 20c.8-3.8 3.6-6 7-6s6.2 2.2 7 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

/** Títulos: una etiqueta con su ojal. */
export const TitleIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M3.5 12.6V5.5a2 2 0 0 1 2-2h7.1l8 8a2 2 0 0 1 0 2.8l-6.3 6.3a2 2 0 0 1-2.8 0l-8-8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    <circle cx="8.3" cy="8.3" r="1.6" fill="currentColor" />
  </svg>
);

/** Ronda final: dos espadas cruzadas (el «jefe final»). */
export const FinalIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4 3.5h3.2l9.3 9.3-2.2 2.2L5 5.7V3.5Z" fill="currentColor" />
    <path d="M20 3.5h-3.2l-9.3 9.3 2.2 2.2L19 5.7V3.5Z" fill="currentColor" opacity="0.8" />
    <path d="m6.5 14 3.5 3.5M17.5 14 14 17.5M4.5 19.5l3-3M19.5 19.5l-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/** Mesa a ciegas: un ojo tachado. */
export const BlindIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M3 12c1.6-3 4.9-6 9-6 1.4 0 2.7.3 3.9.9M21 12c-1.6 3-4.9 6-9 6-1.4 0-2.7-.3-3.9-.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M9.6 14.4a3.4 3.4 0 0 1 4.8-4.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="m4.5 19.5 15-15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/** Sin comodines: la estrella del comodín, tachada. */
export const NoComodinIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M12 3.5c.6 4 2.5 5.9 6.5 6.5v.1c-4 .6-5.9 2.5-6.5 6.5h-.1c-.6-4-2.5-5.9-6.5-6.5V10c4-.6 5.9-2.5 6.5-6.5h.1Z" fill="currentColor" opacity="0.85" />
    <path d="m4.5 19.5 15-15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/** Muerte súbita: un corazón partido. */
export const SuddenDeathIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path
      d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
    <path d="m12.6 7.6-2 3.6 3 1.6-2 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Manos ocultas: una carta boca abajo con una interrogación. */
export const HiddenHandIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <rect x="5.5" y="3" width="13" height="18" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
    <path d="M10 9.6a2 2 0 1 1 2.9 1.8c-.6.3-.9.8-.9 1.4v.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="12" cy="16.3" r="1.1" fill="currentColor" />
  </svg>
);

/** Niveles: escalones. */
export const LevelsIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4 19h4.5v-4.5H13V10h4.5V5.5H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Orden de las cartas: una flecha con tres barras crecientes. */
export const OrderIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M5 18v-3M10 18v-6M15 18V9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    <path d="M17 5h3v3M20 5l-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Dificultad: tres barras; se rellenan según el nivel. */
export const DifficultyIcon = ({ size, level = 'classic', ...p }: P & { level?: 'easy' | 'classic' | 'hard' }) => {
  const filled = level === 'easy' ? 1 : level === 'classic' ? 2 : 3;
  return (
    <svg {...base(size)} {...p}>
      {[0, 1, 2].map((i) => (
        <rect key={i} x={4 + i * 6} y={14 - i * 4} width="4" height={6 + i * 4} rx="1.2" fill="currentColor" opacity={i < filled ? 1 : 0.25} />
      ))}
    </svg>
  );
};

/** Cuenta atrás: un cronómetro. */
export const TimerIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="12" cy="13.5" r="7" stroke="currentColor" strokeWidth="1.8" />
    <path d="M12 13.5V9.8M10 3.5h4M18.2 7.3l1.3-1.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export const MinusIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M6 12h12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

export const PlusIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M12 6v12M6 12h12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

export const CloseIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/** Marca del juego: dos ondas que se encuentran en un mismo punto. */
export const LogoMark = ({ size = 56, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden focusable={false} {...p}>
    <defs>
      <linearGradient id="lg-a" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="var(--cool)" />
        <stop offset="1" stopColor="var(--warm)" />
      </linearGradient>
    </defs>
    <circle cx="24" cy="32" r="17" fill="none" stroke="url(#lg-a)" strokeWidth="4" opacity="0.9" />
    <circle cx="40" cy="32" r="17" fill="none" stroke="url(#lg-a)" strokeWidth="4" opacity="0.9" />
    <circle cx="32" cy="32" r="4.5" fill="var(--warm)" />
  </svg>
);

/** Nube: el progreso guardado en la cuenta (con ✓) o solo en este móvil (con !). */
export const CloudIcon = ({ size, saved = false, ...p }: P & { saved?: boolean }) => (
  <svg {...base(size)} {...p}>
    <path
      d="M7.2 19h10.3a4.5 4.5 0 0 0 .7-8.95A6.2 6.2 0 0 0 6.3 9.3 4.9 4.9 0 0 0 7.2 19Z"
      fill="currentColor"
    />
    {saved ? (
      <path d="m9.2 13.8 2 2 3.8-4" stroke="var(--bg)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    ) : (
      <path d="M12 10.6v3.2M12 16.3v.1" stroke="var(--bg)" strokeWidth="2" strokeLinecap="round" />
    )}
  </svg>
);

/** Logotipo de Google (en sus colores, como piden sus normas para el botón de inicio de sesión). */
export const GoogleIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} viewBox="0 0 48 48" {...p}>
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5Z" />
    <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7Z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A11.9 11.9 0 0 1 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44Z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5Z" />
  </svg>
);

export const TrashIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4.5 6.5h15M9.5 6.5V4.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3v1.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M6.3 6.5h11.4l-.9 12.6a1.6 1.6 0 0 1-1.6 1.4H8.8a1.6 1.6 0 0 1-1.6-1.4L6.3 6.5Z" fill="currentColor" />
    <path d="M10.2 10.2v6.6M13.8 10.2v6.6" stroke="var(--bg)" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const SoundIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4 9.5v5h3.6L12.5 19V5L7.6 9.5H4Z" fill="currentColor" />
    <path d="M15.6 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export const VibrationIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <rect x="8" y="4" width="8" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
    <path d="M4.8 9v6M19.2 9v6M2 10.8v2.4M22 10.8v2.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export const MotionIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="15" cy="12" r="5" stroke="currentColor" strokeWidth="1.8" />
    <path d="M3 8.5h4.5M2 12h3.5M3 15.5h4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
