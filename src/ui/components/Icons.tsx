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

/** Manos ocultas: una carta boca abajo con una interrogación. */
export const HiddenHandIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <rect x="5.5" y="3" width="13" height="18" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
    <path d="M10 9.6a2 2 0 1 1 2.9 1.8c-.6.3-.9.8-.9 1.4v.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="12" cy="16.3" r="1.1" fill="currentColor" />
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
