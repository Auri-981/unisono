/** Iconos SVG propios (sin dependencias). Heredan el color con `currentColor`. */
import type { SVGProps } from 'react';

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

export const ShurikenIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path
      d="M12 2.5 14 10l7.5 2-7.5 2-2 7.5-2-7.5-7.5-2 7.5-2 2-7.5Z"
      fill="currentColor"
    />
    <circle cx="12" cy="12" r="1.6" fill="var(--bg)" />
  </svg>
);

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
